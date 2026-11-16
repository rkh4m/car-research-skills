import { test } from "node:test";
import assert from "node:assert/strict";
import { combinedMpg, fromCarGurus, fromDealerDirect } from "../../src/listings/adapters.ts";
import { cgDetail, cgSearchItem, ddJeepMisparse, ddVehicle } from "./payloads.ts";

test("CarGurus detail → vehicle facts, fees, trusted distance and listing history", () => {
  const [r] = fromCarGurus({ listings: [cgDetail()] }, "2026-11-08");
  assert.ok(r);
  assert.equal(r.vin, "SYNMAZDA300000001");
  assert.equal(r.year, 2016); assert.equal(r.model, "MAZDA3"); assert.equal(r.condition, "used");
  assert.equal(r.price, 11495); assert.equal(r.feesTotal, 895); assert.equal(r.mileage, 80145);
  assert.equal(r.reportedDistanceMi, 16); assert.equal(r.trustedDistance, true);
  assert.equal(r.daysOnMarket, 43); assert.equal(r.mpg, combinedMpg(30, 41));
  assert.deepEqual(r.history, { source: "listing", titleBrand: "clean", accidents: 0, owners: 1, frameDamaged: false });
  assert.equal(JSON.stringify(r).includes("example.invalid/p.jpg"), false, "photos are not carried");
});

test("CarGurus detail: certified → cpo, NEW → new, frame damage and salvage carried", () => {
  const [cpo] = fromCarGurus([cgDetail({ certified: true })]);
  assert.equal(cpo!.condition, "cpo");
  const [nw] = fromCarGurus([cgDetail({ vehicleCondition: "NEW" })]);
  assert.equal(nw!.condition, "new");
  const [bad] = fromCarGurus([cgDetail({ vehicleHistory: { hasVehicleHistory: true, salvage: true, frameDamaged: true, accidentCount: 1, ownerCount: 4 } })]);
  assert.equal(bad!.history!.titleBrand, "salvage");
  assert.equal(bad!.history!.frameDamaged, true);
});

test("CarGurus search item → parsed title, fees from price+fees, no trusted distance", () => {
  const [r] = fromCarGurus({ listings: [cgSearchItem()] });
  assert.equal(r!.year, 2017); assert.equal(r!.make, "Toyota"); assert.equal(r!.model, "Corolla");
  assert.equal(r!.price, 12987); assert.equal(r!.feesTotal, 800);
  assert.deepEqual(r!.dealer, { city: "Laurel", state: "MD" });
  assert.equal(r!.trustedDistance, undefined);
});

test("Dealer-Direct: coordinates kept, reported distance untrusted, fees and mpg mapped", () => {
  const [r] = fromDealerDirect({ vehicles: [ddVehicle({ fee_breakdown: { dealer_fees_total_usd: 999 } })] });
  assert.equal(r!.trustedDistance, false);
  assert.equal(r!.dealer!.lat, 38.30);
  assert.equal(r!.feesTotal, 999);
  assert.equal(r!.mpg, combinedMpg(28, 36));
});

test("Dealer-Direct: a price field below half of MSRP is discarded (the $4,500 Jeep)", () => {
  const [r] = fromDealerDirect([ddJeepMisparse()]);
  assert.equal(r!.price, 38805);
  assert.ok(r!.flags!.includes("price_field_discarded"));
  assert.equal(r!.msrp, 42815);
});

test("unusable items are skipped rather than throwing", () => {
  assert.deepEqual(fromCarGurus({ listings: [{ id: 1, listingTitle: "garbage" }, { listingId: 2, data: {} }] }), []);
  assert.deepEqual(fromDealerDirect([{ id: "x", year: 2020 }]), []);
});

test("live case: a CarGurus theft title reaches the scorer and excludes the car", async () => {
  const { buildCandidates } = await import("../../src/listings/pipeline.ts");
  const { scoreCandidates } = await import("../../src/scoring/engine.ts");
  const { loadScorecard } = await import("../../src/scoring/scorecard.ts");
  const { ORIGIN } = await import("./payloads.ts");
  const theft = cgDetail({ vehicleHistory: { ...cgDetail().data.vehicleHistory, theftTitle: true, ownerCount: 2 },
    deal: { rating: "NA", noDealRatingReason: "Theft reported" } });
  const [r] = fromCarGurus([theft]);
  assert.equal(r!.history?.theftReported, true);
  // The rating reason alone is enough, even if the history flag is missing.
  const [r2] = fromCarGurus([cgDetail({ deal: { rating: "NA", noDealRatingReason: "Theft reported" } })]);
  assert.equal(r2!.history?.theftReported, true);
  assert.equal(fromCarGurus([cgDetail()])[0]!.history?.theftReported, undefined);

  const b = buildCandidates(fromCarGurus([theft]), { origin: ORIGIN, radiusMi: 75 });
  const profile = { budget: { target_min: 10000, target_max: 15000, stretch_max: 35000 }, payment: { method: "cash" } };
  const res = scoreCandidates(loadScorecard(), b.candidates, profile, { runDate: new Date("2026-11-15T12:00:00Z"), fuelPricePerGal: 4, defaultAprPercent: 8.5 });
  assert.deepEqual(res.ranked[0]!.gates, ["theft_on_history"]);
  assert.equal(res.shortlist.length, 0);
});

test("live case: Dealer-Direct with no fee breakdown gets the assumed fee, not a stated $0", () => {
  const [unknown] = fromDealerDirect({ vehicles: [ddVehicle()] }, "2026-11-16", 800);
  assert.equal(unknown!.feesTotal, 800);
  assert.ok(unknown!.flags!.includes("fees_assumed"));
  const [stated] = fromDealerDirect({ vehicles: [ddVehicle({ fee_breakdown: { dealer_fees_total_usd: 0 } })] }, "2026-11-16", 800);
  assert.equal(stated!.feesTotal, 0); // a real $0 stays $0
  assert.ok(!stated!.flags!.includes("fees_assumed"));
});
