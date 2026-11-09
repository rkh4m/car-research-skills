import { test } from "node:test";
import assert from "node:assert/strict";
import { EpaClient } from "../../src/clients/epa.ts";
import { NhtsaClient } from "../../src/clients/nhtsa.ts";
import { WrenchClient } from "../../src/clients/wrench.ts";
import { enrichCandidates } from "../../src/enrich/enrich.ts";
import { scoreCandidates } from "../../src/scoring/engine.ts";
import { loadScorecard } from "../../src/scoring/scorecard.ts";
import { ctx, profile } from "../scoring/fixtures.ts";
import { complaintsPayload, epaModels, epaOptions, fakeFetch, json, mcpRoute, ncapList, ncapVehicle, recallsPayload, testHttp, vpic, wrenchReviewed } from "./fakes.ts";

const routes = (over: { complaints?: unknown; failWrench?: boolean } = {}) => fakeFetch([
  [/complaintsByVehicle/, () => json(over.complaints ?? complaintsPayload)],
  [/recallsByVehicle/, () => json(recallsPayload)],
  [/SafetyRatings\/modelyear/, () => json(ncapList)],
  [/SafetyRatings\/VehicleId\/(\d+)/, u => json(ncapVehicle(Number(/VehicleId\/(\d+)/.exec(u)![1])))],
  [/DecodeVinValues/, u => json(vpic(/DecodeVinValues\/(\w+)/.exec(u)![1]!))],
  [/menu\/model/, () => json(epaModels)], [/menu\/options/, () => json(epaOptions)],
  [/vehicle\/101$/, () => json({ comb08: "33" })], [/vehicle\/102$/, () => json({ comb08: "30" })],
  [/fuelprices/, () => json({ regular: "4.15" })],
  over.failWrench ? [/wrench/, () => new Response("down", { status: 404 })] : mcpRoute(/wrench/, () => wrenchReviewed),
]);
const clients = (fetch: Parameters<typeof testHttp>[0]) => {
  const { http } = testHttp(fetch);
  return { http, c: { nhtsa: new NhtsaClient(http), epa: new EpaClient(http), wrench: new WrenchClient(http, "https://mcp.wrench.test/mcp") } };
};
const car = (id: string, extra: Record<string, unknown> = {}) => ({
  id, year: 2016, make: "Mazda", model: "MAZDA3", condition: "used" as const, price: 11495, feesTotal: 895, mileage: 80145,
  vin: "1HGCM82633A004352", market: { baseline: 13964, comps: 10 },
  history: { source: "listing" as const, titleBrand: "clean" as const, accidents: 0, owners: 1 }, ...extra,
});

test("enrich fills reliability, reviewed issues, NCAP, mpg, VIN checks and fuel price — once per model-year", async () => {
  const { fetch, calls } = routes();
  const { c } = clients(fetch);
  const r = await enrichCandidates([car("a"), car("b", { mileage: 90000 })], c, { runDate: ctx.runDate });
  const a = r.candidates[0]!;
  assert.equal(a.reliability!.complaints, 4);
  assert.equal(a.reliability!.parkItRecalls, 1);
  assert.equal(a.reliability!.reviewedClusters!.length, 3);
  assert.equal(a.reliability!.theftProne, true);
  assert.equal(a.safety!.ncapOverall, 5);
  assert.equal(a.mpg, 33);
  assert.deepEqual(a.vinCheck, { checksumValid: true, decodeOk: true, yearMatches: false, modelMatches: false });
  assert.equal(r.fuelPricePerGal, 4.15);
  assert.equal(calls.filter(u => /complaintsByVehicle/.test(u)).length, 1, "one complaints fetch for two cars of the same model-year");
  assert.equal(calls.filter(u => /DecodeVinValues/.test(u)).length, 1, "one decode per distinct VIN");
  assert.equal(r.cohort.length, 1);
});

test("existing fields win over fetched ones (e.g. a user-supplied rating and known mpg)", async () => {
  const { fetch, calls } = routes();
  const r = await enrichCandidates([car("a", { mpg: 31, reliability: { complaints: 4, perYear: 0.4, crashFireInjuryPerYear: 0.2, severeShare: 0.75, recalls: 3, userRating: 5 } })], clients(fetch).c, { runDate: ctx.runDate });
  assert.equal(r.candidates[0]!.mpg, 31);
  assert.equal(r.candidates[0]!.reliability!.userRating, 5);
  assert.equal(calls.filter(u => /fueleconomy.*vehicle\//.test(u)).length, 0, "no EPA lookup when mpg is known");
});

test("a failing source leaves its fields unknown and records a note instead of guessing", async () => {
  const { fetch } = routes({ failWrench: true });
  const r = await enrichCandidates([car("a")], clients(fetch).c, { runDate: ctx.runDate });
  assert.equal(r.candidates[0]!.reliability!.reviewedClusters, undefined);
  assert.ok(r.notes.some(n => n.startsWith("Wrench.Pro 2016 Mazda MAZDA3")));
  assert.equal(r.candidates[0]!.reliability!.complaints, 4, "NHTSA data still filled");
});

test("zero complaints with recalls is noted, and the scorer then treats reliability as unknown", async () => {
  const { fetch } = routes({ complaints: { count: 0, results: [] } });
  const r = await enrichCandidates([car("a")], clients(fetch).c, { runDate: ctx.runDate });
  assert.ok(r.notes.some(n => /0 NHTSA complaints but 3 recall/.test(n)));
  const scored = scoreCandidates(loadScorecard(), r.candidates, profile, { ...ctx, reliabilityCohort: r.cohort });
  assert.equal(scored.ranked[0]!.criteria.reliability.known, 0);
});

test("enriched output scores end to end: reviewed engine/transmission failures drive the repair reserve", async () => {
  const { fetch } = routes();
  const r = await enrichCandidates([car("a", { vin: undefined })], clients(fetch).c, { runDate: ctx.runDate });
  const scored = scoreCandidates(loadScorecard(), r.candidates.map(x => ({ ...x, vin: "1HGCM82633A004352", vinCheck: { checksumValid: true, decodeOk: true } })), profile, { ...ctx, fuelPricePerGal: r.fuelPricePerGal!, reliabilityCohort: r.cohort });
  const x = scored.ranked[0]!;
  assert.equal(x.tco!.repairReserve, 3000);
  assert.ok(x.flags.includes("theft_prone"));
});
