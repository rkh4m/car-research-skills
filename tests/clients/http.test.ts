import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpClient, HttpError } from "../../src/clients/http.ts";
import { fakeFetch, json, testHttp } from "./fakes.ts";

test("GET JSON is cached within TTL and refetched after it", async () => {
  const { fetch, calls } = fakeFetch([[/x\.test/, () => json({ n: 1 })]]);
  const { http, advance } = testHttp(fetch, { ttlMs: 1000 });
  await http.getJson("https://x.test/a"); await http.getJson("https://x.test/a");
  assert.equal(calls.length, 1);
  advance(1001);
  await http.getJson("https://x.test/a");
  assert.equal(calls.length, 2);
});

test("disk cache survives a new client", async () => {
  const dir = mkdtempSync(join(tmpdir(), "crs-cache-"));
  try {
    const a = fakeFetch([[/x\.test/, () => json({ n: 1 })]]);
    await testHttp(a.fetch, { cacheDir: dir }).http.getJson("https://x.test/a");
    const b = fakeFetch([]);
    assert.deepEqual(await testHttp(b.fetch, { cacheDir: dir }).http.getJson("https://x.test/a"), { n: 1 });
    assert.equal(b.calls.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("same-host requests are paced; other hosts aren't held up", async () => {
  const { fetch } = fakeFetch([[/./, () => json({})]]);
  const { http, sleeps } = testHttp(fetch, { ttlMs: 0, minIntervalMs: { "a.test": 500 } });
  await http.getJson("https://a.test/1"); await http.getJson("https://a.test/2"); await http.getJson("https://b.test/1");
  assert.deepEqual(sleeps, [500]);
});

test("retries 503 with backoff and honors Retry-After on 429", async () => {
  let n = 0;
  const { fetch } = fakeFetch([[/x\.test/, () => (++n === 1 ? new Response("busy", { status: 503 }) : n === 2 ? new Response("slow down", { status: 429, headers: { "retry-after": "2" } }) : json({ ok: true }))]]);
  const { http, sleeps } = testHttp(fetch, { ttlMs: 0, defaultMinIntervalMs: 0 });
  assert.deepEqual(await http.getJson("https://x.test/a"), { ok: true });
  assert.deepEqual(sleeps, [500, 2000]);
});

test("non-retryable errors throw HttpError without retrying; retries are bounded", async () => {
  const notFound = fakeFetch([[/x\.test/, () => new Response("nope", { status: 404 })]]);
  await assert.rejects(testHttp(notFound.fetch, { ttlMs: 0 }).http.getJson("https://x.test/a"), HttpError);
  assert.equal(notFound.calls.length, 1);
  const down = fakeFetch([[/x\.test/, () => new Response("down", { status: 503 })]]);
  await assert.rejects(testHttp(down.fetch, { ttlMs: 0, retries: 2 }).http.getJson("https://x.test/a"), /503/);
  assert.equal(down.calls.length, 3);
});

test("a custom User-Agent is sent", async () => {
  let ua = "";
  const http = new HttpClient({ fetch: async (_u, i) => { ua = (i?.headers as Record<string, string>)["User-Agent"]!; return json({}); }, ttlMs: 0 });
  await http.getJson("https://x.test/a");
  assert.match(ua, /car-research-skills/);
});
