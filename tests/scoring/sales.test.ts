import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreCandidates } from "../../src/scoring/engine.ts";
import { loadSalesTable, parseSalesTable, salesFor } from "../../src/scoring/sales.ts";
import { loadScorecard } from "../../src/scoring/scorecard.ts";
import { car, ctx, profile } from "./fixtures.ts";

const sc = loadScorecard();
const table = loadSalesTable();
const rel = (complaints: number, perYear: number) => ({ complaints, perYear, crashFireInjuryPerYear: perYear / 10, severeShare: 0.5, recalls: 1, reviewedClusters: [] });

// A best-seller with 4x the complaints of a small seller, at ~3.5x the sales: worse raw, about equal per car.
const cohort = () => [
  car({ id: "civic", year: 2016, make: "Honda", model: "Civic", reliability: rel(400, 40) }),
  car({ id: "mazda3", year: 2016, make: "Mazda", model: "MAZDA3", reliability: rel(100, 10) }),
  car({ id: "forte", year: 2016, make: "Kia", model: "Forte", reliability: rel(150, 15) }),
  car({ id: "elantra", year: 2016, make: "Hyundai", model: "Elantra", reliability: rel(300, 30) }),
];
const byId = (r: ReturnType<typeof scoreCandidates>, id: string) => r.ranked.find(x => x.vehicle.id === id)!;

test("repo sales table parses and matches model names loosely", () => {
  assert.equal(salesFor(table, "MAZDA", "MAZDA3", 2016), 100000);
  assert.equal(salesFor(table, "Mazda", "Mazda 3", 2018), 65000);
  assert.equal(salesFor(table, "Toyota", "CAMRY HYBRID", 2015), 40000);
  assert.equal(salesFor(table, "Honda", "Civic", 2010), undefined);      // outside every era
  assert.equal(salesFor(table, "Subaru", "Impreza", 2016), undefined);   // not in table
  assert.equal(salesFor(undefined, "Honda", "Civic", 2016), undefined);
});

test("eras must be [from, to, sales] tuples", () => {
  assert.throws(() => parseSalesTable("models:\n  - { make: A, model: B, eras: [[2016, 100]] }"));
});

test("without sales data, raw complaint rates rank the best-seller last", () => {
  const r = scoreCandidates(sc, cohort(), profile, ctx);
  const civic = byId(r, "civic").criteria.reliability;
  assert.ok(civic.score < byId(r, "mazda3").criteria.reliability.score);
  assert.match(civic.evidence, /not sales-normalized/);
});

test("with sales data, complaints are compared per 100k sold", () => {
  const r = scoreCandidates(sc, cohort(), profile, { ...ctx, salesTable: table });
  const civic = byId(r, "civic").criteria.reliability, raw = byId(scoreCandidates(sc, cohort(), profile, ctx), "civic").criteria.reliability;
  assert.ok(civic.score > raw.score, `normalized ${civic.score} should beat raw ${raw.score}`);
  assert.match(civic.evidence, /11\.4\/yr per 100k sold, ~350k US sales\/yr/);
  assert.match(civic.evidence, /sales-normalized \(approx\.\)/);
});

test("a record's own annualSales wins over the table", () => {
  const cars = cohort();
  cars[0]!.reliability = { ...rel(400, 40), annualSales: 1_000_000 };
  const r = scoreCandidates(sc, cars, profile, { ...ctx, salesTable: table });
  assert.match(byId(r, "civic").criteria.reliability.evidence, /~1000k US sales/);
});

test("too few cohort model-years with sales falls back to raw rates", () => {
  const cars = cohort().map(c => ({ ...c, make: "Nobody", model: "Unknown" }));
  cars[0] = { ...cars[0]!, make: "Honda", model: "Civic" };
  const r = scoreCandidates(sc, cars, profile, { ...ctx, salesTable: table });
  assert.match(byId(r, "civic").criteria.reliability.evidence, /not sales-normalized/);
});

test("the 'large powertrain cluster' bar scales with sales", () => {
  const cluster = [{ label: "Transmission shudder", componentCode: "POWER TRAIN", complaintCount: 20 },
    { label: "Radio static", componentCode: "ELECTRICAL SYSTEM", complaintCount: 30 }];
  const cars = cohort();
  cars[0]!.reliability = { ...rel(400, 40), reviewedClusters: cluster };
  const raw = byId(scoreCandidates(sc, cars, profile, ctx), "civic").criteria.reliability.score;
  const norm = byId(scoreCandidates(sc, cars, profile, { ...ctx, salesTable: table }), "civic").criteria.reliability.score;
  // 20 complaints is "large" for an unknown seller (bar 10) but not for a 350k/yr seller (bar 35).
  assert.ok(norm > raw);
});
