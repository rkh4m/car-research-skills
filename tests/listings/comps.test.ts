import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBaselines, fitPriceModel } from "../../src/listings/comps.ts";
import { normalizeListings } from "../../src/listings/normalize.ts";
import type { RawListing } from "../../src/listings/types.ts";
import { ORIGIN, raw } from "./payloads.ts";

const PER_10K = 0.042, PER_YEAR = 0.034;
const truePrice = (base: number, year: number, mi: number) => base * Math.exp(PER_YEAR * (year - 2018) - PER_10K * mi / 10000);

/** Deterministic synthetic market: three families, small structured noise. */
const market = (): RawListing[] => {
  const out: RawListing[] = [];
  const fams: Array<[string, string, number]> = [["Mazda", "Mazda3", 15000], ["Toyota", "Corolla", 16000], ["Honda", "Accord", 19000]];
  let i = 0;
  for (const [make, model, base] of fams) for (let year = 2015; year <= 2021; year++) for (const mi of [60000, 85000, 110000, 135000]) {
    const noise = 1 + ((i++ % 5) - 2) * 0.01;
    out.push(raw({ sourceId: `${model}-${year}-${mi}`, make, model, year, mileage: mi, price: Math.round(truePrice(base, year, mi) * noise), feesTotal: 0 }));
  }
  return out;
};
const listingsOf = (raws: RawListing[]) => normalizeListings(raws, { origin: ORIGIN, radiusMi: 75 }).listings;

test("price model recovers mileage and model-year sensitivities from the market", () => {
  const m = fitPriceModel(listingsOf(market()));
  assert.equal(m.fitted, true);
  assert.ok(Math.abs(m.perTenKMiles - PER_10K) < 0.005, `perTenKMiles ${m.perTenKMiles}`);
  assert.ok(Math.abs(m.perModelYear - PER_YEAR) < 0.005, `perModelYear ${m.perModelYear}`);
});

test("baseline for a fairly priced car lands within 3% of its true value, with a P25–P75 band around it", () => {
  const listings = listingsOf([...market(), raw({ sourceId: "target", make: "Mazda", model: "Mazda3", year: 2018, mileage: 97000, price: 13000, feesTotal: 0 })]);
  const b = computeBaselines(listings, fitPriceModel(listings)).get("user:target")!;
  const expected = truePrice(15000, 2018, 97000);
  assert.ok(Math.abs(b.baseline - expected) / expected < 0.03, `baseline ${b.baseline} vs ${expected.toFixed(0)}`);
  assert.ok(b.p25 <= b.baseline && b.baseline <= b.p75);
  assert.ok(b.comps >= 3);
});

test("an absurd outlier comp is removed and barely moves the baseline", () => {
  const base = [...market(), raw({ sourceId: "target", make: "Toyota", model: "Corolla", year: 2019, mileage: 87000, price: 14000, feesTotal: 0 })];
  const withOutlier = [...base, raw({ sourceId: "junk", make: "Toyota", model: "Corolla", year: 2019, mileage: 84000, price: 3000, feesTotal: 0 })];
  const clean = listingsOf(base), dirty = listingsOf(withOutlier);
  const a = computeBaselines(clean, fitPriceModel(clean)).get("user:target")!.baseline;
  const b = computeBaselines(dirty, fitPriceModel(dirty)).get("user:target")!.baseline;
  assert.ok(Math.abs(a - b) / a < 0.02, `${a} vs ${b}`);
});

test("thin comps widen the window; fewer than 3 gives no baseline", () => {
  const few = listingsOf([
    raw({ sourceId: "t", year: 2018, mileage: 90000 }),
    raw({ sourceId: "c1", year: 2016, mileage: 120000 }), raw({ sourceId: "c2", year: 2020, mileage: 60000 }),
    raw({ sourceId: "c3", year: 2017, mileage: 100000 }),
  ]);
  const model = { perTenKMiles: 0.04, perModelYear: 0.035, fitted: false, n: 0 };
  const b = computeBaselines(few, model).get("user:t")!;
  assert.equal(b.widened, true);
  assert.equal(b.comps, 3);
  const none = listingsOf([raw({ sourceId: "t" }), raw({ sourceId: "c1", mileage: 91000 })]);
  assert.equal(computeBaselines(none, model).get("user:t"), null);
});

test("new and used listings never comp each other, and a listing never comps itself", () => {
  const ls = listingsOf([
    raw({ sourceId: "new1", condition: "new", mileage: 10, year: 2026 }),
    ...[1, 2, 3, 4].map(i => raw({ sourceId: `used${i}`, mileage: 2000 + i * 1000, year: 2026, condition: "used", price: 9000 })),
  ]);
  const model = { perTenKMiles: 0.04, perModelYear: 0.035, fitted: false, n: 0 };
  assert.equal(computeBaselines(ls, model).get("user:new1"), null);
  assert.equal(computeBaselines(ls, model).get("user:used1")!.comps, 3);
});

test("too little data falls back to default sensitivities", () => {
  const m = fitPriceModel(listingsOf([raw({ sourceId: "a" }), raw({ sourceId: "b", mileage: 50000 })]));
  assert.equal(m.fitted, false);
  assert.equal(m.perTenKMiles, 0.04);
});

test("trim names map to rough equipment tiers", async () => {
  const { trimTier } = await import("../../src/listings/comps.ts");
  assert.equal(trimTier("i Sport"), "base");
  assert.equal(trimTier("LE"), "base");
  assert.equal(trimTier("SE FWD"), "base");
  assert.equal(trimTier("Touring Hatchback"), "mid");
  assert.equal(trimTier("EX"), "mid");
  assert.equal(trimTier("i Grand Touring"), "upper");
  assert.equal(trimTier("XLE"), "upper");
  assert.equal(trimTier("EX-L"), "upper");
  assert.equal(trimTier("Sedan FWD"), "base"); // live case: the unnamed base model looked like a bargain against named trims
  assert.equal(trimTier(undefined), undefined);
});

test("live case: a base trim priced like other base trims is not scored as a bargain against upper trims", () => {
  // Same market, but every listing comes in three trims: base, mid (+5%) and upper (+12%).
  const PREMIUM = { LE: 1, EX: 1.05, Limited: 1.12 } as const;
  const raws = market().flatMap(r => (Object.keys(PREMIUM) as Array<keyof typeof PREMIUM>).map((trim, k) =>
    ({ ...r, sourceId: `${r.sourceId}-${trim}`, trim, mileage: r.mileage + 7 * (k + 1), price: Math.round(r.price * PREMIUM[trim]) })));
  const target = raw({ sourceId: "target", make: "Toyota", model: "Corolla", year: 2018, mileage: 84000, trim: "LE", price: Math.round(truePrice(16000, 2018, 84000)), feesTotal: 0 });
  const listings = listingsOf([...raws, target]);
  const model = fitPriceModel(listings);
  assert.ok(model.trimPremium, "trim premium fitted");
  assert.ok(Math.abs(model.trimPremium!.mid - 0.05) < 0.01, `mid ${model.trimPremium!.mid}`);
  assert.ok(Math.abs(model.trimPremium!.upper - 0.12) < 0.01, `upper ${model.trimPremium!.upper}`);
  const fair = truePrice(16000, 2018, 84000);
  const aware = computeBaselines(listings, model).get("user:target")!.baseline;
  const blind = computeBaselines(listings, { ...model, trimPremium: undefined }).get("user:target")!.baseline;
  assert.ok(Math.abs(aware - fair) / fair < 0.02, `trim-aware baseline ${aware} vs fair ${fair}`);
  assert.ok(blind > aware * 1.03, `trim-blind baseline ${blind} overstates the base car's market price`);
});
