import { test } from "node:test";
import assert from "node:assert/strict";
import { fromCarGurus, fromDealerDirect } from "../../src/listings/adapters.ts";
import { buildCandidates } from "../../src/listings/pipeline.ts";
import { scoreCandidates } from "../../src/scoring/engine.ts";
import { loadScorecard } from "../../src/scoring/scorecard.ts";
import { ctx, profile } from "../scoring/fixtures.ts";
import { cgDetail, ddJeepMisparse, ddVehicle, ORIGIN } from "./payloads.ts";

test("end to end: raw CarGurus + Dealer-Direct payloads → candidates with baselines → shortlist", () => {
  const prices = [11200, 11900, 12300, 12800, 13100, 12500, 11600];
  const cg = { listings: [
    cgDetail(),
    ...prices.map((p, i) => cgDetail({
      id: 910000 + i, vin: `SYNMAZDA3COMP${String(i).padStart(4, "0")}`, vdpUrl: `https://www.cargurus.com/details/${910000 + i}`,
      price: { basePriceString: `$${p}`, pricePlusFeesString: `$${p + 800}` }, mileage: { displayValue: `${78000 + i * 1500}` },
      feeTax: { dealerFees: [{ name: "Doc", amountString: "$800" }] }, dealerDistance: `${10 + i} mi`,
    })).map((x, i) => ({ ...x, listingId: 910000 + i })),
    cgDetail({ id: 920000, vin: "SYNCIVICFRAME0001", ontology: { carYear: 2016, makeName: "Mazda", modelName: "MAZDA3", trimName: "i Sport" },
      price: { basePriceString: "$9,500", pricePlusFeesString: "$9,500" }, feeTax: { dealerFees: [] }, mileage: { displayValue: "81,000" },
      vehicleHistory: { hasVehicleHistory: true, frameDamaged: true, ownerCount: 4 } }),
  ].map((x, i) => ({ ...x, listingId: x.listingId + i * 0 })) };
  const dd = { vehicles: [
    ddVehicle({ vin: "SYNMAZDA300000001", year: 2016, make: "Mazda", model: "Mazda3", price: 11600, our_price: 11600, mileage: 80145, lat: 38.88, lng: -77.44 }),
    ddVehicle({ id: "far", vin: "SYNFAR00000000001", lat: 36.85, lng: -75.98, distance_miles: 71.92 }),
    ddJeepMisparse(),
  ] };
  const raws = [...fromCarGurus(cg, "2026-11-08"), ...fromDealerDirect(dd, "2026-11-08")];
  const built = buildCandidates(raws, { origin: ORIGIN, radiusMi: 75 });

  assert.equal(built.mergedCount, 1, "same VIN on both sources merges");
  assert.ok(built.dropped.some(d => d.listing.sourceId === "far"), "Virginia Beach dealer dropped despite reported 71.9 mi");
  const target = built.candidates.find(c => c.id === "SYNMAZDA300000001")!;
  assert.ok(target.market!.baseline, "target has a comps baseline");
  assert.ok((target.market!.comps ?? 0) >= 6);

  const enriched = built.candidates.map(c => ({ ...c, vinCheck: { checksumValid: true, decodeOk: true } }));
  const result = scoreCandidates(loadScorecard(), enriched, profile, ctx);
  const frame = result.ranked.find(r => r.vehicle.id === "SYNCIVICFRAME0001")!;
  assert.ok(frame.gates.includes("frame_or_structural_damage"));
  assert.ok(!result.shortlist.some(r => r.vehicle.id === "SYNCIVICFRAME0001"));
  const jeep = result.ranked.find(r => r.vehicle.id === "SYNJEEP0000000001")!;
  assert.equal(jeep.vehicle.price, 38805, "misparsed price field was discarded by the adapter");
  assert.equal(jeep.profile, "new_vehicle");
});
