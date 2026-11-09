import { HttpError, type HttpClient } from "./http.ts";

export class McpToolError extends Error {}

const ACCEPT = { Accept: "application/json, text/event-stream" };

/** Parse a JSON-RPC response that may arrive as plain JSON or as an SSE stream of `data:` lines. */
export const parseRpc = (text: string, id?: number): any => {
  const data = text.split(/\r?\n/).filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).filter(Boolean);
  const candidates = data.length ? data : [text.slice(Math.max(0, text.indexOf("{")))];
  const parsed = candidates.flatMap(c => { try { return [JSON.parse(c)]; } catch { return []; } });
  return parsed.find(m => id === undefined || m.id === id) ?? parsed[parsed.length - 1];
};

/** Minimal read-only client for remote MCP servers over streamable HTTP. */
export class McpHttpClient {
  private sessionId?: string;
  private ready?: Promise<void>;
  private nextId = 1;

  constructor(private readonly url: string, private readonly http: HttpClient, private readonly clientName = "car-research-skills") {}

  private headers() { return this.sessionId ? { ...ACCEPT, "mcp-session-id": this.sessionId } : ACCEPT; }

  private init() {
    this.ready ??= (async () => {
      const res = await this.http.post(this.url, {
        jsonrpc: "2.0", id: this.nextId++, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: this.clientName, version: "0.1" } },
      }, ACCEPT);
      if (res.status >= 400) throw new HttpError(res.status, this.url, res.text);
      this.sessionId = res.headers.get("mcp-session-id") ?? undefined;
      await this.http.post(this.url, { jsonrpc: "2.0", method: "notifications/initialized" }, this.headers());
    })();
    return this.ready;
  }

  /** Call a tool and return structuredContent, else JSON-parsed text content, else raw text. */
  async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    await this.init();
    const id = this.nextId++;
    const res = await this.http.post(this.url, { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, this.headers());
    if (res.status >= 400) throw new HttpError(res.status, this.url, res.text);
    const msg = parseRpc(res.text, id);
    if (!msg) throw new McpToolError(`unparseable response from ${name}`);
    if (msg.error) throw new McpToolError(`${name}: ${msg.error.message ?? JSON.stringify(msg.error)}`);
    const result = msg.result ?? {};
    const text = (result.content ?? []).map((c: any) => c.text ?? "").join("");
    if (result.isError) throw new McpToolError(`${name}: ${text.slice(0, 300)}`);
    if (result.structuredContent) return result.structuredContent;
    try { return JSON.parse(text); } catch { return text; }
  }
}
