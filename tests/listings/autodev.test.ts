import { test } from "node:test";
import assert from "node:assert/strict";
import { fromAutoDev } from "../../src/listings/adapters.ts";
import { buildCandidates } from "../../src/listings/pipeline.ts";

// Shape of an api.auto.dev /listings row (synthetic values; Washington, DC coordinates).
const row = (over: Record<string, unknown> = {}) => ({
  vin: "2T1BURHE0KC000000",
  location: [-77.0369, 38.9072],
  vehicle: { make: "Toyota", model: "Corolla", year: 2019, trim: "LE", style: "Sedan", fuel: "Gasoline" },
  retailListing: { price: 14265, miles: 97585, dealer: "Example Motors", city: "Washington", state: "DC", used: true, cpo: false, vdp: "https://example.com/vdp" },
  history: { accidentCount: 2, ownerCount: 1, usageType: "Personal Use" },
  ...over,
});

test("maps an Auto.dev row, including history and coordinates", () => {
  const [l] = fromAutoDev([row()], "2026-11-12");
  assert.equal(l!.source, "auto_dev");
  assert.equal(l!.price, 14265);
  assert.equal(l!.mileage, 97585);
  assert.equal(l!.condition, "used");
  assert.deepEqual(l!.history, { source: "listing", accidents: 2, owners: 1, usage: "personal" });
  assert.equal(l!.dealer?.lat, 38.9072);
  assert.equal(l!.trustedDistance, false);
  assert.equal(l!.feesTotal, 0);
  assert.deepEqual(l!.flags, []);
});

test("assumed fees are added and flagged; usage types map to the scorecard's enum", () => {
  const [a] = fromAutoDev([row({ history: { usageType: "Rental" } })], "2026-11-12", 899);
  assert.equal(a!.feesTotal, 899);
  assert.deepEqual(a!.flags, ["fees_assumed"]);
  assert.equal(a!.history?.usage, "rental");
  const [b] = fromAutoDev([row({ history: { usageType: "Multiple Use" } })]);
  assert.equal(b!.history?.usage, "unknown");
  const [c] = fromAutoDev([row({ history: null })]);
  assert.equal(c!.history, undefined);
  // Live case (2026-11-12): ownerCount 0 failed VehicleRecord validation; it means "unknown", not zero owners.
  const [d] = fromAutoDev([row({ history: { accidentCount: 0, ownerCount: 0 } })]);
  assert.equal(d!.history?.owners, undefined);
});

test("accepts the CLI's bare array and the {listings} wrapper; skips rows without price", () => {
  assert.equal(fromAutoDev({ listings: [row(), row({ retailListing: {} })] }).length, 1);
  assert.equal(fromAutoDev([row({ retailListing: { ...row().retailListing, cpo: true } })])[0]!.condition, "cpo");
});

test("live case: when the same VIN is also on a source that states fees, the stated fee replaces the assumed one", () => {
  const stated = { source: "cargurus" as const, sourceId: "1", observedAt: "2026-11-12", vin: "2T1BURHE0KC000000", year: 2019, make: "Toyota",
    model: "Corolla", price: 14265, feesTotal: 895, mileage: 97585, dealer: { lat: 38.9072, lng: -77.0369 },
    history: { source: "listing" as const, accidents: 2 } };
  const b = buildCandidates([stated, ...fromAutoDev([row()], "2026-11-12", 800)], { origin: { lat: 38.9072, lng: -77.0369 }, radiusMi: 75 });
  assert.equal(b.listings.length, 1);
  assert.equal(b.listings[0]!.feesTotal, 895);
  // History from the first source is kept, and Auto.dev fills what it lacked.
  assert.deepEqual(b.listings[0]!.history, { source: "listing", accidents: 2, owners: 1, usage: "personal" });
  assert.ok(!b.listings[0]!.flags.includes("fees_assumed"));
  // Auto.dev alone keeps its assumed fee and the flag.
  const solo = buildCandidates(fromAutoDev([row()], "2026-11-12", 800), { origin: { lat: 38.9072, lng: -77.0369 }, radiusMi: 75 });
  assert.equal(solo.listings[0]!.feesTotal, 800);
  assert.ok(solo.listings[0]!.flags.includes("fees_assumed"));
});

test("distance comes from coordinates, so far-away rows are dropped", () => {
  const far = row({ vin: "2T1BURHE0KC000001", location: [-95.4, 29.9] });
  const b = buildCandidates(fromAutoDev([row(), far]), { origin: { lat: 38.9072, lng: -77.0369 }, radiusMi: 75 });
  assert.equal(b.listings.length, 1);
  assert.equal(b.dropped[0]?.reason, "outside_radius");
});
