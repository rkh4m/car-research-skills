import type { Condition, DroppedListing, NormalizedListing, RawListing, SourceRef } from "./types.ts";

export interface LatLng { lat: number; lng: number }
export interface NormalizeOptions {
  origin: LatLng;
  radiusMi: number;
  /** Keep listings whose distance can't be established (flagged `distance_unknown`). Default true. */
  keepUnknownDistance?: boolean;
  /** Mileage tolerance for merging VIN-less duplicates across sources. Default 5. */
  mileageMatchTolerance?: number;
}
export interface NormalizeResult {
  listings: NormalizedListing[];
  dropped: DroppedListing[];
  mergedCount: number;
}

const NEW_MAX_MILES = 300;
const NEW_WITH_MILES_THRESHOLD = 1000;
const DISTANCE_DISAGREEMENT_MI = 15;
const PRICE_CONFLICT_RATIO = 1.10;

export const haversineMi = (a: LatLng, b: LatLng) => {
  const R = 3958.8, rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2));
};

export const modelFamily = (model: string) =>
  model.replace(/\s+(hatchback|coupe|sedan|wagon|hb|4dr|5dr)$/i, "").trim();
const familyKey = (make: string, model: string) => `${make.toLowerCase()}|${modelFamily(model).toLowerCase().replace(/[\s-]+/g, "")}`;

const resolveDistance = (r: RawListing, origin: LatLng, flags: string[]): number | undefined => {
  const { lat, lng } = r.dealer ?? {};
  if (typeof lat === "number" && typeof lng === "number") {
    const d = haversineMi(origin, { lat, lng });
    if (r.reportedDistanceMi !== undefined && Math.abs(r.reportedDistanceMi - d) > DISTANCE_DISAGREEMENT_MI) flags.push("source_distance_wrong");
    return Math.round(d);
  }
  if (r.trustedDistance && r.reportedDistanceMi !== undefined) return r.reportedDistanceMi;
  flags.push("distance_unknown");
  return undefined;
};

const resolveCondition = (r: RawListing, flags: string[]): Condition => {
  if (r.condition === "new" && r.mileage > NEW_WITH_MILES_THRESHOLD) { flags.push("new_with_miles_reclassified_used"); return "used"; }
  if (r.condition) return r.condition;
  flags.push("condition_inferred");
  return r.mileage <= NEW_MAX_MILES ? "new" : "used";
};

const sameVehicle = (a: NormalizedListing, b: RawListing, tol: number) => {
  if (a.vin && b.vin) return a.vin.toUpperCase() === b.vin.toUpperCase();
  return a.year === b.year && familyKey(a.make, a.model) === familyKey(b.make, b.model) && Math.abs(a.mileage - b.mileage) <= tol;
};

const choosePrice = (l: NormalizedListing) => {
  // Fees belong to the dealer, not the source: when any source states them, use that instead of an assumed fee.
  const stated = l.sources.filter(s => !s.feesAssumed);
  const realFee = stated.length ? Math.max(...stated.map(s => s.feesTotal)) : undefined;
  const fee = (s: SourceRef) => (s.feesAssumed && realFee !== undefined ? realFee : s.feesTotal);
  if (realFee !== undefined) l.flags = l.flags.filter(f => f !== "fees_assumed");
  const eff = (s: SourceRef) => s.price + fee(s);
  const sorted = [...l.sources].sort((a, b) => eff(a) - eff(b));
  const low = sorted[0]!, high = sorted[sorted.length - 1]!;
  const pick = eff(high) > PRICE_CONFLICT_RATIO * eff(low) ? (l.flags.push("source_price_conflict"), high) : low;
  l.price = pick.price; l.feesTotal = fee(pick);
};

/** Distance from coordinates, radius filter, condition, and cross-source dedupe (VIN, else year+family+mileage). */
export const normalizeListings = (raws: RawListing[], opts: NormalizeOptions): NormalizeResult => {
  const tol = opts.mileageMatchTolerance ?? 5;
  const keepUnknown = opts.keepUnknownDistance ?? true;
  const listings: NormalizedListing[] = [];
  const dropped: DroppedListing[] = [];
  let mergedCount = 0;

  for (const r of raws) {
    if (!(r.price > 0) || !(r.year > 1980) || !r.make || !r.model) { dropped.push({ listing: r, reason: "invalid", detail: "missing price/year/make/model" }); continue; }
    const flags = [...(r.flags ?? [])];
    const distanceMi = resolveDistance(r, opts.origin, flags);
    if (distanceMi !== undefined && distanceMi > opts.radiusMi) { dropped.push({ listing: r, reason: "outside_radius", detail: `${distanceMi} mi > ${opts.radiusMi}` }); continue; }
    if (distanceMi === undefined && !keepUnknown) { dropped.push({ listing: r, reason: "outside_radius", detail: "distance unknown" }); continue; }
    const condition = resolveCondition(r, flags);
    const ref: SourceRef = { source: r.source, sourceId: r.sourceId, url: r.url, price: r.price, feesTotal: r.feesTotal ?? 0,
      ...(r.flags?.includes("fees_assumed") ? { feesAssumed: true } : {}), observedAt: r.observedAt };

    const existing = listings.find(l => sameVehicle(l, r, tol));
    if (existing) {
      mergedCount++;
      existing.sources.push(ref);
      existing.vin ??= r.vin;
      existing.trim ??= r.trim;
      existing.msrp ??= r.msrp;
      existing.mpg ??= r.mpg;
      existing.fuelType ??= r.fuelType;
      if (!existing.history) existing.history = r.history;
      else if (r.history) {
        // Keep the first source's history but fill facts it lacks (e.g. Auto.dev knows fleet/rental use, CarGurus doesn't).
        for (const [k, v] of Object.entries(r.history) as [keyof NonNullable<RawListing["history"]>, unknown][]) {
          if (v !== undefined && existing.history[k] === undefined) (existing.history as Record<string, unknown>)[k] = v;
        }
        if (r.history.usage && r.history.usage !== "unknown" && existing.history.usage === "unknown") existing.history.usage = r.history.usage;
      }
      existing.daysOnMarket = Math.max(existing.daysOnMarket ?? 0, r.daysOnMarket ?? 0) || undefined;
      if (existing.distanceMi === undefined && distanceMi !== undefined) {
        existing.distanceMi = distanceMi;
        existing.flags = existing.flags.filter(f => f !== "distance_unknown");
      }
      for (const f of flags) if (f !== "distance_unknown" && !existing.flags.includes(f)) existing.flags.push(f);
      continue;
    }
    listings.push({
      id: r.vin ? r.vin.toUpperCase() : `${r.source}:${r.sourceId}`,
      vin: r.vin, year: r.year, make: r.make, model: modelFamily(r.model), family: familyKey(r.make, r.model), trim: r.trim,
      condition, price: r.price, feesTotal: r.feesTotal ?? 0, msrp: r.msrp, mileage: r.mileage, distanceMi,
      dealer: r.dealer, fuelType: r.fuelType, mpg: r.mpg, daysOnMarket: r.daysOnMarket, priceDrops: r.priceDrops,
      history: r.history, sources: [ref], flags,
    });
  }
  for (const l of listings) if (l.sources.length > 1) choosePrice(l);
  return { listings, dropped, mergedCount };
};
