import { test } from "node:test";
import assert from "node:assert/strict";
import { amortizedPayment, scoreCandidates } from "../../src/scoring/engine.ts";
import { loadScorecard } from "../../src/scoring/scorecard.ts";
import { car, ctx, FAILURE_CLUSTERS, profile } from "./fixtures.ts";

const sc = loadScorecard();
const run = (cars: Parameters<typeof scoreCandidates>[1], prof: object = profile) => scoreCandidates(sc, cars, prof, ctx);
const byId = (r: ReturnType<typeof run>, id: string) => r.ranked.find(x => x.vehicle.id === id)!;

test("live-run case: a frame-damaged 'bargain' is gated out despite a top deal score", () => {
  const r = run([
    car({ id: "frame", make: "Honda", model: "Civic", price: 12000, feesTotal: 0, market: { baseline: 15948, comps: 20 },
      history: { source: "listing", titleBrand: "clean", owners: 4, frameDamaged: true } }),
    car({ id: "clean" }),
  ]);
  const frame = byId(r, "frame");
  assert.ok(frame.criteria.deal_vs_market.score >= 90);
  assert.deepEqual(frame.gates, ["frame_or_structural_damage"]);
  assert.ok(!r.shortlist.some(x => x.vehicle.id === "frame"));
  assert.ok(r.excluded.some(x => x.vehicle.id === "frame"));
});

test("allow_structural_damage lifts the frame-damage gate", () => {
  const r = run([car({ id: "frame", history: { source: "listing", titleBrand: "clean", owners: 1, frameDamaged: true } })],
    { ...profile, limits: { max_mileage: 130000, allow_structural_damage: true } });
  assert.deepEqual(byId(r, "frame").gates, []);
});

test("live-run case: cheap, failure-prone, theft-prone car costs more to own than a pricier reliable one", () => {
  const r = run([
    car({ id: "cheap", make: "Kia", model: "Forte", year: 2020, price: 9995, feesTotal: 895, mpg: 33,
      reliability: { complaints: 78, perYear: 11.4, crashFireInjuryPerYear: 1.6, severeShare: 0.65, recalls: 0, reviewedClusters: FAILURE_CLUSTERS, theftProne: true } }),
    car({ id: "reliable", price: 11495, feesTotal: 895, mpg: 33 }),
  ]);
  const cheap = byId(r, "cheap"); const reliable = byId(r, "reliable");
  assert.equal(cheap.tco!.repairReserve, 3000);
  assert.equal(reliable.tco!.repairReserve, 500);
  assert.equal(cheap.tco!.insurance, Math.round(5 * 1800 * 1.25));
  assert.ok(cheap.tco!.total > reliable.tco!.total, `cheap ${cheap.tco!.total} vs reliable ${reliable.tco!.total}`);
  assert.ok(cheap.flags.includes("theft_prone") && cheap.flags.includes("reviewed_engine_or_transmission_failures"));
  assert.ok(reliable.criteria.reliability.score > cheap.criteria.reliability.score);
});

test("hybrid over 120k miles adds the battery reserve and the over-100k wear reserve on top of the base", () => {
  const r = run([car({ id: "hyb", fuelType: "hybrid", mileage: 123000, mpg: 40 })]);
  assert.equal(byId(r, "hyb").tco!.repairReserve, 500 + 1500 + 1000);
});

test("absolute mileage: gentle to 100k, steep after, smooth across band points", () => {
  const r = run([60000, 80145, 100000, 110000, 125000].map(m => car({ id: `m${m}`, mileage: m })));
  const s = (m: number) => byId(r, `m${m}`).criteria.absolute_mileage.score;
  assert.equal(s(60000), 92);
  assert.equal(s(80145), 80, "145 miles past a point barely moves the score");
  assert.equal(s(100000), 62);
  assert.equal(s(110000), 35, "first 10k past 100k costs 27 points");
  assert.equal(s(125000), 17);
  assert.ok(!byId(r, "m100000").flags.includes("high_mileage_over_100k"));
  assert.ok(byId(r, "m110000").flags.includes("high_mileage_over_100k"));
  assert.equal(byId(r, "m110000").tco!.repairReserve, 500 + 1000);
});

test("a cheaper car past 100k ranks below an otherwise identical car at 80k", () => {
  const r = run([
    car({ id: "low", mileage: 80000, price: 12000, market: { baseline: 13000, comps: 10 } }),
    car({ id: "high", mileage: 120000, price: 10500, market: { baseline: 11000, comps: 10 } }),
  ]);
  assert.equal(r.ranked[0]!.vehicle.id, "low");
  assert.ok(byId(r, "low").overall - byId(r, "high").overall >= 5);
});

test("absolute mileage carries no weight for new cars", () => {
  const r = run([car({ id: "new", condition: "new", year: 2026, price: 31000, feesTotal: 0, mileage: 5, market: { msrp: 36000, comps: 0 }, history: undefined })]);
  assert.equal(byId(r, "new").criteria.absolute_mileage.weight, 0);
});

test("live-run case: a current-model-year car with miles is scored as used/stretch, not new", () => {
  const r = run([car({ id: "exrental", year: 2026, model: "Corolla", make: "Toyota", condition: "used", price: 20495, feesTotal: 799, mileage: 14957,
    market: { baseline: 23842, comps: 12 }, reliability: undefined })]);
  const x = byId(r, "exrental");
  assert.equal(x.profile, "stretch");
  assert.ok(x.stretch);
  assert.ok(x.blockers.some(b => b.startsWith("stretch not exceptional") && b.includes("reliability unknown")));
  assert.equal(r.shortlist.length, 0);
});

test("live-run case: misparsed new-car price ($4,500 vs $42,815 MSRP) is held as data-suspect", () => {
  const r = run([car({ id: "jeep", condition: "new", year: 2026, make: "Jeep", model: "Cherokee", price: 4500, feesTotal: 490, mileage: 0,
    market: { msrp: 42815, comps: 0 }, history: undefined })]);
  const x = byId(r, "jeep");
  assert.equal(x.profile, "new_vehicle");
  assert.ok(x.gates.includes("price_data_suspect"));
});

test("new car uses MSRP for the deal score and its own weights", () => {
  const r = run([car({ id: "new", condition: "new", year: 2026, price: 31000, feesTotal: 0, mileage: 5, market: { msrp: 36000, comps: 0 }, history: undefined })]);
  const x = byId(r, "new");
  assert.equal(x.criteria.deal_vs_market.score, 90); // 13.9% under MSRP
  assert.equal(x.criteria.title_status.weight, 0);
  assert.equal(x.criteria.deal_vs_market.weight, 35);
});

test("unknown history scores neutral and lowers confidence, never outranking the enriched twin", () => {
  const r = run([car({ id: "enriched" }), car({ id: "bare", history: undefined })]);
  const e = byId(r, "enriched"); const b = byId(r, "bare");
  assert.equal(b.criteria.accident_damage.score, sc.unknown_score);
  assert.equal(b.criteria.accident_damage.known, 0);
  assert.ok(b.confidence < e.confidence);
  assert.ok(b.overall < e.overall);
});

test("listing-sourced title counts as partial evidence; NMVTIS counts fully", () => {
  const r = run([car({ id: "listing" }), car({ id: "nmvtis", history: { source: "nmvtis", titleBrand: "clean", accidents: 0, owners: 1 } })]);
  assert.equal(byId(r, "listing").criteria.title_status.known, 0.5);
  assert.equal(byId(r, "nmvtis").criteria.title_status.known, 1);
});

test("zero complaints with recalls is treated as unknown reliability, not as perfect", () => {
  const r = run([car({ id: "camryhyb", model: "Camry Hybrid", reliability: { complaints: 0, perYear: 0, crashFireInjuryPerYear: 0, severeShare: 0, recalls: 1 } })]);
  const x = byId(r, "camryhyb");
  assert.equal(x.criteria.reliability.known, 0);
  assert.equal(x.criteria.reliability.score, sc.unknown_score);
  assert.ok(x.flags.includes("reliability_data_missing"));
});

test("hard gates: branded title (with opt-in), unremedied park-it recall, over budget, over mileage, missing VIN", () => {
  const r = run([
    car({ id: "salvage", history: { source: "carfax", titleBrand: "salvage", accidents: 1, owners: 2 } }),
    car({ id: "rebuilt", history: { source: "carfax", titleBrand: "rebuilt", accidents: 1, owners: 2 } }),
    car({ id: "parkit", vinRecalls: { openCount: 1, openParkIt: 1 } }),
    car({ id: "parkit_fixed", vinRecalls: { openCount: 1, openParkIt: 1, remedied: true } }),
    car({ id: "pricey", price: 36000 }),
    car({ id: "miles", mileage: 132869 }),
    car({ id: "novin", vin: undefined, vinCheck: undefined }),
  ], { ...profile, limits: { max_mileage: 130000, allow_branded_title: true } });
  assert.ok(byId(r, "salvage").gates.includes("branded_title"));
  assert.ok(!byId(r, "rebuilt").gates.includes("branded_title"));
  assert.ok(byId(r, "parkit").gates.includes("unremedied_do_not_drive_recall"));
  assert.ok(!byId(r, "parkit_fixed").gates.includes("unremedied_do_not_drive_recall"));
  assert.ok(byId(r, "pricey").gates.includes("over_budget"));
  assert.ok(byId(r, "miles").gates.includes("over_mileage"));
  assert.ok(byId(r, "novin").gates.includes("vin_unverifiable"));
});

test("model-year park-it recall is a flag and a penalty, not a gate", () => {
  const r = run([car({ id: "my", reliability: { complaints: 103, perYear: 9.5, crashFireInjuryPerYear: 0.7, severeShare: 0.54, recalls: 6, parkItRecalls: 1 } })]);
  const x = byId(r, "my");
  assert.deepEqual(x.gates, []);
  assert.ok(x.flags.includes("park_it_recall_on_model_year_confirm_by_vin"));
  assert.equal(x.criteria.recalls.score, 70 - 30 - 5 * 5);
  assert.equal(x.criteria.recalls.known, 0.5);
});

test("live-run case: 297 days on the lot adds leverage notes and points; bands follow the scorecard", () => {
  const r = run([car({ id: "aged", price: 7597, feesTotal: 731, market: { baseline: 9901, comps: 10 }, listing: { daysOnMarket: 297 } }),
    car({ id: "fair", price: 12500, feesTotal: 500, market: { baseline: 13000, comps: 10 } })]);
  const aged = byId(r, "aged");
  assert.equal(aged.criteria.deal_vs_market.score, 100);
  assert.ok(aged.notes.includes("negotiation leverage") && aged.notes.some(n => n.startsWith("aged inventory")));
  assert.equal(byId(r, "fair").criteria.deal_vs_market.score, 60);
  assert.ok(aged.notes.some(n => n.startsWith("year-end")));
});

test("thin comps make the deal score partial; no baseline makes it unknown", () => {
  const r = run([car({ id: "thin", market: { baseline: 13500, comps: 4 } }), car({ id: "none", market: { comps: 0 } })]);
  assert.equal(byId(r, "thin").criteria.deal_vs_market.known, 0.5);
  assert.equal(byId(r, "none").criteria.deal_vs_market.known, 0);
});

test("shortlist respects size, floors and the stretch-slot cap", () => {
  const great = (id: string, price: number) => car({ id, price, feesTotal: 0, mileage: 30000, year: 2022,
    market: { baseline: price * 1.3, comps: 12 }, history: { source: "nmvtis", titleBrand: "clean", accidents: 0, owners: 1, service: "regular" },
    reliability: { complaints: 20, perYear: 4, crashFireInjuryPerYear: 0.2, severeShare: 0.3, recalls: 0, reviewedClusters: [] } });
  const cars = [great("s1", 20000), great("s2", 21000), great("s3", 22000), ...["t1", "t2", "t3", "t4", "t5", "t6"].map((id, i) => car({ id, price: 11000 + i * 300 }))];
  const r = run(cars);
  assert.equal(r.shortlist.length, 5);
  assert.ok(r.shortlist.filter(x => x.stretch).length <= sc.budget_rule.stretch_max_slots);
  for (const x of r.shortlist) assert.ok(x.eligible && x.overall >= sc.shortlist.min_overall && x.confidence >= sc.confidence.min_for_shortlist);
  for (let i = 1; i < r.ranked.length; i++) assert.ok(r.ranked[i - 1]!.overall >= r.ranked[i]!.overall);
});

test("cash buyers carry no interest; financed TCO matches the amortization formula", () => {
  const cash = run([car({ id: "c" })], { ...profile, payment: { method: "cash", sales_tax_rate: 0.0415 } });
  assert.equal(byId(cash, "c").tco!.interest, 0);
  const fin = byId(run([car({ id: "f" })]), "f");
  const principal = 12900 * 1.0415 - 5000;
  assert.equal(fin.tco!.monthlyPayment, Math.round(amortizedPayment(principal, 8.5, 60)));
});
