import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  fetch?: FetchLike;
  /** Minimum ms between requests to the same host. */
  minIntervalMs?: Record<string, number>;
  defaultMinIntervalMs?: number;
  retries?: number;
  /** Default cache TTL for GET JSON. 0 disables caching. */
  ttlMs?: number;
  /** Persist GET cache here (git-ignored `data/cache` by convention). Memory-only when omitted. */
  cacheDir?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  userAgent?: string;
}

export class HttpError extends Error {
  constructor(public status: number, public url: string, body: string) {
    super(`HTTP ${status} for ${url}: ${body.slice(0, 200)}`);
  }
}

const DAY = 24 * 60 * 60 * 1000;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** Polite HTTP: per-host pacing, bounded retries with backoff (honoring Retry-After), and a TTL cache for GETs. */
export class HttpClient {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly lastByHost = new Map<string, number>();
  private readonly mem = new Map<string, { at: number; body: unknown }>();
  /** Network requests actually sent (cache hits excluded). */
  requests = 0;

  constructor(private readonly opts: HttpOptions = {}) {
    this.fetchImpl = opts.fetch ?? ((u, i) => fetch(u, i));
    this.sleep = opts.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
    this.now = opts.now ?? (() => Date.now());
  }

  private async pace(url: string) {
    const host = new URL(url).host;
    const gap = this.opts.minIntervalMs?.[host] ?? this.opts.defaultMinIntervalMs ?? 300;
    const wait = (this.lastByHost.get(host) ?? -Infinity) + gap - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastByHost.set(host, this.now());
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    const retries = this.opts.retries ?? 3;
    const headers = { "User-Agent": this.opts.userAgent ?? "car-research-skills/0.1", ...(init.headers as Record<string, string>) };
    for (let attempt = 0; ; attempt++) {
      await this.pace(url);
      this.requests++;
      let res: Response | undefined; let err: unknown;
      try { res = await this.fetchImpl(url, { ...init, headers }); } catch (e) { err = e; }
      if (res && (res.ok || !RETRYABLE.has(res.status))) return res;
      if (attempt >= retries) {
        if (res) return res;
        throw err instanceof Error ? err : new Error(String(err));
      }
      const retryAfter = Number(res?.headers.get("retry-after"));
      await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 500 * 2 ** attempt);
    }
  }

  private cacheFile(key: string) {
    return this.opts.cacheDir ? join(this.opts.cacheDir, `${createHash("sha1").update(key).digest("hex")}.json`) : undefined;
  }

  private readCache(key: string, ttl: number): unknown {
    const hit = this.mem.get(key);
    if (hit && this.now() - hit.at < ttl) return hit.body;
    const file = this.cacheFile(key);
    if (!file) return undefined;
    try {
      const disk = JSON.parse(readFileSync(file, "utf8")) as { at: number; body: unknown };
      if (this.now() - disk.at < ttl) { this.mem.set(key, disk); return disk.body; }
    } catch { /* cache miss */ }
    return undefined;
  }

  private writeCache(key: string, body: unknown) {
    const entry = { at: this.now(), body };
    this.mem.set(key, entry);
    const file = this.cacheFile(key);
    if (file) { mkdirSync(this.opts.cacheDir!, { recursive: true }); writeFileSync(file, JSON.stringify(entry)); }
  }

  /**
   * `acceptErrorBody` lets an API that signals "no results" with a 4xx (e.g. NHTSA recalls → 400 + empty results)
   * be read as a normal response when the body passes the check.
   */
  async getJson<T = unknown>(url: string, opts: { ttlMs?: number; headers?: Record<string, string>; acceptErrorBody?: (status: number, body: unknown) => boolean } = {}): Promise<T> {
    const ttl = opts.ttlMs ?? this.opts.ttlMs ?? DAY;
    if (ttl > 0) {
      const cached = this.readCache(url, ttl);
      if (cached !== undefined) return cached as T;
    }
    const res = await this.send(url, { headers: { Accept: "application/json", ...opts.headers } });
    const text = await res.text();
    let body: T;
    try { body = JSON.parse(text) as T; } catch { throw new HttpError(res.status, url, text); }
    if (!res.ok && !opts.acceptErrorBody?.(res.status, body)) throw new HttpError(res.status, url, text);
    if (ttl > 0) this.writeCache(url, body);
    return body;
  }

  async post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; headers: Headers; text: string }> {
    const res = await this.send(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    return { status: res.status, headers: res.headers, text: await res.text() };
  }
}
