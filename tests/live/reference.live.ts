// Opt-in live smoke test against public government APIs and Wrench.Pro. Run: npm run smoke:live
import { test } from "node:test";
import assert from "node:assert/strict";
import { EpaClient } from "../../src/clients/epa.ts";
import { HttpClient } from "../../src/clients/http.ts";
import { NhtsaClient } from "../../src/clients/nhtsa.ts";
import { WrenchClient } from "../../src/clients/wrench.ts";

const http = new HttpClient({ ttlMs: 0, minIntervalMs: { "api.nhtsa.gov": 400, "vpic.nhtsa.dot.gov": 400, "www.fueleconomy.gov": 200, "mcp.wrench.pro": 400 } });
const nhtsa = new NhtsaClient(http), epa = new EpaClient(http), wrench = new WrenchClient(http);

test("NHTSA complaints and recalls for 2016 Mazda MAZDA3", async () => {
  const c = await nhtsa.complaints(2016, "Mazda", "MAZDA3");
  const r = await nhtsa.recalls(2016, "Mazda", "MAZDA3");
  console.log("complaints", c.complaints, "severe", c.severeShare, "top", c.topComponents.slice(0, 2), "| recalls", r.recalls, "parkIt", r.parkItRecalls, "fire", r.fireRiskRecalls);
  assert.ok(c.complaints > 50);
  assert.ok(r.recalls >= 1 && r.parkItRecalls >= 1);
});

test("NHTSA NCAP for 2016 Mazda MAZDA3 sedan", async () => {
  const n = await nhtsa.ncapOverall(2016, "Mazda", "MAZDA3", /4 ?DR/i);
  console.log("ncap", n);
  assert.ok(n && n.stars >= 1 && n.stars <= 5);
});

test("vPIC decodes the classic example VIN", async () => {
  const d = await nhtsa.decodeVin("1HGCM82633A004352");
  console.log("vpic", d);
  assert.equal(d.ok, true);
  assert.equal(d.year, 2003);
  assert.match(d.make ?? "", /honda/i);
});

test("EPA best mpg for 2016 Mazda3 and 2017 Civic sedan, plus fuel price", async () => {
  const m = await epa.bestCombinedMpg(2016, "Mazda", "MAZDA3");
  const c = await epa.bestCombinedMpg(2017, "Honda", "Civic");
  const p = await epa.regularFuelPrice();
  console.log("epa", m, c, "fuel", p);
  assert.ok(m && m.mpg >= 28 && m.mpg <= 40);
  assert.ok(c && /4/.test(c.epaModel));
  assert.ok(p && p > 1 && p < 10);
});

test("Wrench.Pro reviewed issues for 2020 Kia Forte; hybrid not substituted", async () => {
  const k = await wrench.knownIssues(2020, "Kia", "Forte");
  const h = await wrench.knownIssues(2017, "Toyota", "Camry Hybrid");
  console.log("wrench", k.mode, k.clusters.slice(0, 3), "theft", k.theftProne, "| hybrid", h.mode);
  assert.equal(k.mode, "reviewed");
  assert.ok(k.clusters.length > 0);
  assert.notEqual(h.mode, "reviewed");
});
