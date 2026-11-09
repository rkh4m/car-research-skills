import { test } from "node:test";
import assert from "node:assert/strict";
import { EpaClient, pickEpaModel } from "../../src/clients/epa.ts";
import { parseRpc } from "../../src/clients/mcp.ts";
import { NhtsaClient } from "../../src/clients/nhtsa.ts";
import { vinChecksumValid } from "../../src/clients/vin.ts";
import { WrenchClient } from "../../src/clients/wrench.ts";
import { complaintsPayload, epaModels, epaOptions, fakeFetch, json, mcpRoute, ncapList, ncapVehicle, recallsPayload, testHttp, vpic, wrenchReviewed } from "./fakes.ts";

test("VIN check digit: the classic valid example passes, a one-character change fails, I/O/Q are rejected", () => {
  assert.equal(vinChecksumValid("1HGCM82633A004352"), true);
  assert.equal(vinChecksumValid("1HGCM82633A004353"), false);
  assert.equal(vinChecksumValid("1HGCM82O33A004352"), false);
  assert.equal(vinChecksumValid("SHORT"), false);
});

test("NHTSA complaints: counts, crash/fire/injury, severe share and top components", async () => {
  const { fetch, calls } = fakeFetch([[/complaintsByVehicle/, () => json(complaintsPayload)]]);
  const c = await new NhtsaClient(testHttp(fetch).http).complaints(2016, "Mazda", "MAZDA3");
  assert.match(calls[0]!, /make=mazda&model=mazda3&modelYear=2016/);
  assert.equal(c.complaints, 4);
  assert.equal(c.crashFireInjury, 2);
  assert.equal(c.severeShare, 0.75);
  assert.deepEqual(c.topComponents[0], { component: "ENGINE", count: 2 });
});

test("NHTSA recalls: park-it/park-outside and fire-risk are counted separately", async () => {
  const { fetch } = fakeFetch([[/recallsByVehicle/, () => json(recallsPayload)]]);
  const r = await new NhtsaClient(testHttp(fetch).http).recalls(2016, "Mazda", "MAZDA3");
  assert.deepEqual([r.recalls, r.parkItRecalls, r.fireRiskRecalls], [3, 1, 1]);
  assert.equal(r.campaigns.find(c => c.parkIt)!.id, "15V000000");
});

test("live-run case: NHTSA's HTTP 400 + empty results means 'no recalls', not an error; other 400s still throw", async () => {
  const empty = fakeFetch([[/recallsByVehicle/, () => json({ Count: 0, Message: "Results returned successfully", results: [] }, { status: 400 })]]);
  const r = await new NhtsaClient(testHttp(empty.fetch).http).recalls(2020, "Kia", "Forte");
  assert.deepEqual([r.recalls, r.parkItRecalls], [0, 0]);
  assert.equal(empty.calls.length, 1, "not retried");
  const bad = fakeFetch([[/recallsByVehicle/, () => json({ Message: "bad request" }, { status: 400 })]]);
  await assert.rejects(new NhtsaClient(testHttp(bad.fetch).http).recalls(2020, "Kia", "Forte"), /HTTP 400/);
});

test("NHTSA NCAP: skips 'Not Rated' variants and prefers the sedan", async () => {
  const { fetch } = fakeFetch([[/SafetyRatings\/modelyear/, () => json(ncapList)], [/SafetyRatings\/VehicleId\/(\d+)/, u => json(ncapVehicle(Number(/VehicleId\/(\d+)/.exec(u)![1])))]]);
  const r = await new NhtsaClient(testHttp(fetch).http).ncapOverall(2016, "Mazda", "MAZDA3", /4 ?DR/i);
  assert.deepEqual(r, { stars: 5, description: "2016 Mazda Mazda3 4 DR FWD" });
});

test("vPIC decode reads year/make/model and the success code", async () => {
  const { fetch } = fakeFetch([[/DecodeVinValues/, u => json(vpic(/DecodeVinValues\/(\w+)/.exec(u)![1]!))]]);
  const d = await new NhtsaClient(testHttp(fetch).http).decodeVin("1HGCM82633A004352");
  assert.deepEqual([d.ok, d.year, d.make, d.model], [true, 2003, "HONDA", "Accord"]);
});

test("EPA model matching: sedan over coupe/hatch, hybrids only for hybrids, Prime only for Prime", () => {
  assert.equal(pickEpaModel("MAZDA3", ["3 4-Door", "3 5-Door", "CX-3"]), "3 4-Door");
  assert.equal(pickEpaModel("Civic", ["Civic 2Dr", "Civic 4Dr", "Civic 5Dr", "Civic HF"]), "Civic 4Dr");
  assert.equal(pickEpaModel("Camry", ["Camry", "Camry Hybrid LE"]), "Camry");
  assert.equal(pickEpaModel("Camry Hybrid", ["Camry", "Camry Hybrid LE"]), "Camry Hybrid LE");
  assert.equal(pickEpaModel("Prius", ["Prius", "Prius Prime", "Prius c"]), "Prius");
  assert.equal(pickEpaModel("Prius Prime", ["Prius", "Prius Prime"]), "Prius Prime");
  assert.equal(pickEpaModel("Corolla", ["Corolla Hybrid"]), undefined);
});

test("EPA best combined mpg takes the max across options; single-item menus work", async () => {
  const { fetch } = fakeFetch([
    [/menu\/model/, () => json(epaModels)],
    [/menu\/options/, () => json({ menuItem: epaOptions.menuItem })],
    [/vehicle\/101$/, () => json({ comb08: "33" })], [/vehicle\/102$/, () => json({ comb08: "30" })],
  ]);
  assert.deepEqual(await new EpaClient(testHttp(fetch).http).bestCombinedMpg(2016, "Mazda", "MAZDA3"), { mpg: 33, epaModel: "3 4-Door", optionsChecked: 2 });
  const single = fakeFetch([[/menu\/model/, () => json({ menuItem: { text: "Fit", value: "Fit" } })], [/menu\/options/, () => json({ menuItem: { value: "7" } })], [/vehicle\/7$/, () => json({ comb08: 36 })]]);
  assert.equal((await new EpaClient(testHttp(single.fetch).http).bestCombinedMpg(2017, "Honda", "Fit"))!.mpg, 36);
});

test("MCP responses parse from SSE or plain JSON", () => {
  assert.equal(parseRpc('event: message\ndata: {"jsonrpc":"2.0","id":3,"result":{"x":1}}\n\n', 3).result.x, 1);
  assert.equal(parseRpc('{"jsonrpc":"2.0","id":2,"result":{"x":2}}', 2).result.x, 2);
});

test("Wrench: reviewed clusters map through and theft clusters set theftProne", async () => {
  let args: any;
  const { fetch } = fakeFetch([mcpRoute(/wrench/, (name, a) => { args = { name, ...a }; return wrenchReviewed; })]);
  const k = await new WrenchClient(testHttp(fetch).http, "https://mcp.wrench.test/mcp").knownIssues(2020, "Kia", "Forte");
  assert.deepEqual(args, { name: "get_known_issues", year: "2020", make: "kia", model: "forte" });
  assert.equal(k.mode, "reviewed");
  assert.equal(k.clusters.length, 3);
  assert.equal(k.theftProne, true);
});

test("Wrench: an unknown model (e.g. a hybrid) is 'unavailable', never the base model's issues", async () => {
  const { fetch } = fakeFetch([mcpRoute(/wrench/, () => ({ error: "unknown-vehicle", suggestions: [{ model: "camry" }] }))]);
  const k = await new WrenchClient(testHttp(fetch).http, "https://mcp.wrench.test/mcp").knownIssues(2017, "Toyota", "Camry Hybrid");
  assert.equal(k.mode, "unavailable");
  assert.equal(k.clusters.length, 0);
  const text = fakeFetch([mcpRoute(/wrench/, () => "Wrench.Pro doesn't cover that vehicle.")]);
  assert.equal((await new WrenchClient(testHttp(text.fetch).http, "https://mcp.wrench.test/mcp").knownIssues(2017, "Toyota", "Camry Hybrid")).mode, "unavailable");
});
