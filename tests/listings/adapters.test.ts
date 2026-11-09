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
