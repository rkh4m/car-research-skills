import { test } from "node:test";
import assert from "node:assert/strict";
import { haversineMi, modelFamily, normalizeListings } from "../../src/listings/normalize.ts";
import { ORIGIN, raw } from "./payloads.ts";

const norm = (raws: Parameters<typeof normalizeListings>[0], extra = {}) => normalizeListings(raws, { origin: ORIGIN, radiusMi: 75, ...extra });

test("haversine is sane (origin to ~1 degree north ≈ 69 mi)", () => {
  assert.ok(Math.abs(haversineMi(ORIGIN, { lat: ORIGIN.lat + 1, lng: ORIGIN.lng }) - 69.1) < 0.5);
});

test("live-run case: coordinates override a bogus reported distance and drive the radius filter", () => {
  const far = raw({ sourceId: "harrisonburg", source: "dealer_direct", trustedDistance: false, reportedDistanceMi: 0, dealer: { lat: 38.45, lng: -78.87 } });
  const near = raw({ sourceId: "near", source: "dealer_direct", trustedDistance: false, reportedDistanceMi: 71.9, dealer: { lat: 38.85, lng: -77.30 } });
  const r = norm([far, near]);
  assert.equal(r.dropped.length, 1);
  assert.equal(r.dropped[0]!.reason, "outside_radius");
  assert.equal(r.dropped[0]!.listing.sourceId, "harrisonburg");
  const kept = r.listings[0]!;
  assert.ok(kept.distanceMi! < 20);
  assert.ok(kept.flags.includes("source_distance_wrong"));
});

test("trusted reported distance is used without coordinates; unknown distance is flagged or dropped", () => {
  const r = norm([raw({ sourceId: "cg", reportedDistanceMi: 130 }), raw({ sourceId: "unk", trustedDistance: false, mileage: 50000 })]);
  assert.deepEqual(r.dropped.map(d => d.listing.sourceId), ["cg"]);
  assert.ok(r.listings[0]!.flags.includes("distance_unknown"));
  const strict = norm([raw({ sourceId: "unk", trustedDistance: false })], { keepUnknownDistance: false });
  assert.equal(strict.listings.length, 0);
});

test("live-run case: a 'new' current-model-year car with miles is reclassified used; missing condition is inferred", () => {
  const r = norm([
    raw({ sourceId: "exrental", year: 2026, model: "Corolla", make: "Toyota", condition: "new", mileage: 14957 }),
    raw({ sourceId: "nocond", condition: undefined, mileage: 12 }),
  ]);
  const [ex, nc] = r.listings;
  assert.equal(ex!.condition, "used");
  assert.ok(ex!.flags.includes("new_with_miles_reclassified_used"));
  assert.equal(nc!.condition, "new");
  assert.ok(nc!.flags.includes("condition_inferred"));
});

test("dedupe by VIN across sources fills gaps from the second source", () => {
  const r = norm([
    raw({ sourceId: "a", source: "dealer_direct", vin: "vin123", dealer: { lat: 38.95, lng: -77.05 }, trustedDistance: false }),
    raw({ sourceId: "b", source: "cargurus", vin: "VIN123", history: { source: "listing", titleBrand: "clean", owners: 1, accidents: 0 }, daysOnMarket: 40 }),
  ]);
  assert.equal(r.listings.length, 1);
  assert.equal(r.mergedCount, 1);
  const l = r.listings[0]!;
  assert.equal(l.id, "VIN123");
  assert.equal(l.sources.length, 2);
  assert.equal(l.history!.owners, 1);
  assert.equal(l.daysOnMarket, 40);
});

test("live-run case: VIN-less duplicates merge on year + family + mileage within 5; 6 apart do not", () => {
  const r = norm([
    raw({ sourceId: "cg", source: "cargurus", year: 2016, model: "MAZDA3", mileage: 73105, price: 13800 }),
    raw({ sourceId: "dd", source: "dealer_direct", year: 2016, model: "Mazda3 Hatchback", mileage: 73104, price: 13900 }),
    raw({ sourceId: "other", source: "dealer_direct", year: 2016, model: "Mazda3", mileage: 73111, price: 13000 }),
  ]);
  assert.equal(r.listings.length, 2);
  assert.equal(r.mergedCount, 1);
  assert.equal(modelFamily("Civic Hatchback"), "Civic");
});

test("merged prices: within 10% keep the lower; over 10% keep the higher and flag a conflict", () => {
  const close = norm([raw({ sourceId: "1", vin: "V1", price: 13998, feesTotal: 799 }), raw({ sourceId: "2", vin: "V1", price: 14200, feesTotal: 0 })]);
  assert.equal(close.listings[0]!.price + close.listings[0]!.feesTotal, 14200);
  assert.ok(!close.listings[0]!.flags.includes("source_price_conflict"));
  const far = norm([raw({ sourceId: "1", vin: "V2", price: 9000, feesTotal: 0 }), raw({ sourceId: "2", vin: "V2", price: 12000, feesTotal: 0 })]);
  assert.equal(far.listings[0]!.price, 12000);
  assert.ok(far.listings[0]!.flags.includes("source_price_conflict"));
});

test("invalid listings are dropped with a reason", () => {
  const r = norm([raw({ sourceId: "bad", price: 0 })]);
  assert.equal(r.dropped[0]!.reason, "invalid");
});
