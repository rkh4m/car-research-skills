import { HttpClient, type FetchLike } from "../../src/clients/http.ts";

export type Route = [RegExp, (url: string, init?: RequestInit) => Response | Promise<Response>];

export const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
export const sse = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, { status: 200, headers: { "content-type": "text/event-stream", ...headers } });

/** Fake fetch: first matching route wins; records every URL; unmatched URLs fail loudly. */
export const fakeFetch = (routes: Route[]) => {
  const calls: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push(url);
    const r = routes.find(([re]) => re.test(url));
    if (!r) throw new Error(`no fake route for ${url}`);
    return r[1](url, init);
  };
  return { fetch, calls };
};

/** HttpClient with no real waiting and a controllable clock. */
export const testHttp = (fetch: FetchLike, extra: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) => {
  let t = 0;
  const sleeps: number[] = [];
  const http = new HttpClient({ fetch, sleep: async ms => { sleeps.push(ms); t += ms; }, now: () => t, ...extra });
  return { http, sleeps, advance: (ms: number) => { t += ms; } };
};

// ---- canned payloads shaped like the live APIs (2026-11-08) ----
export const complaintsPayload = {
  count: 4, results: [
    { components: "ENGINE,POWER TRAIN", crash: false, fire: false, numberOfInjuries: 0, numberOfDeaths: 0 },
    { components: "ELECTRICAL SYSTEM", crash: true, fire: false, numberOfInjuries: 1, numberOfDeaths: 0 },
    { components: "EXTERIOR LIGHTING", crash: false, fire: false, numberOfInjuries: 0, numberOfDeaths: 0 },
    { components: "ENGINE", crash: false, fire: true, numberOfInjuries: 0, numberOfDeaths: 0 },
  ],
};
export const recallsPayload = {
  Count: 3, results: [
    { NHTSACampaignNumber: "15V000000", Component: "FUEL SYSTEM, GASOLINE", Summary: "valve may stick", parkIt: false, parkOutSide: true },
    { NHTSACampaignNumber: "17V000000", Component: "ELECTRICAL SYSTEM", Summary: "may short, increasing the risk of a fire.", parkIt: false, parkOutSide: false },
    { NHTSACampaignNumber: "23V000000", Component: "BACK OVER PREVENTION", Summary: "camera image may flicker", parkIt: false, parkOutSide: false },
  ],
};
export const ncapList = { Count: 2, Results: [{ VehicleDescription: "2016 Mazda Mazda3 5 HB FWD", VehicleId: 1 }, { VehicleDescription: "2016 Mazda Mazda3 4 DR FWD", VehicleId: 2 }] };
export const ncapVehicle = (id: number) => ({ Results: [{ OverallRating: id === 2 ? "5" : "Not Rated", VehicleDescription: id === 2 ? "2016 Mazda Mazda3 4 DR FWD" : "HB" }] });
export const epaModels = { menuItem: [{ text: "3 4-Door", value: "3 4-Door" }, { text: "3 5-Door", value: "3 5-Door" }, { text: "CX-3", value: "CX-3" }] };
export const epaOptions = { menuItem: [{ text: "Auto 6-spd, 4 cyl, 2.0 L", value: "101" }, { text: "Auto 6-spd, 4 cyl, 2.5 L", value: "102" }] };
export const vpic = (vin: string) => ({ Results: [{ VIN: vin, ModelYear: "2003", Make: "HONDA", Model: "Accord", ErrorCode: "0", ErrorText: "0 - VIN decoded clean." }] });
export const wrenchReviewed = {
  vehicle: { year: 2020, make: "kia", model: "forte" },
  knownIssues: { mode: "reviewed", clusters: [
    { label: "Engine knocking, oil loss, and stalling", componentCode: "ENGINE", complaintCount: 14 },
    { label: "Transmission slipping and replacement", componentCode: "POWER TRAIN", complaintCount: 14 },
    { label: "Theft and anti-theft security system", componentCode: "UNKNOWN OR OTHER", complaintCount: 9 },
  ] },
};

/** Minimal MCP server: answers initialize with a session id, accepts notifications, and routes tools/call. */
export const mcpRoute = (url: RegExp, onCall: (name: string, args: any) => unknown): Route => [url, async (_u, init) => {
  const msg = JSON.parse(String(init?.body));
  if (msg.method === "initialize") return sse({ jsonrpc: "2.0", id: msg.id, result: { serverInfo: { name: "fake" } } }, { "mcp-session-id": "s1" });
  if (msg.method === "notifications/initialized") return new Response("", { status: 202 });
  const out = onCall(msg.params.name, msg.params.arguments);
  const content = typeof out === "string" ? [{ type: "text", text: out }] : [{ type: "text", text: JSON.stringify(out) }];
  return sse({ jsonrpc: "2.0", id: msg.id, result: { content } });
}];
