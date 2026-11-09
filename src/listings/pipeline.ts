import type { VehicleInput } from "../scoring/types.ts";
import { computeBaselines, fitPriceModel, type CompsOptions, type PriceModel } from "./comps.ts";
import { normalizeListings, type NormalizeOptions } from "./normalize.ts";
import type { Baseline, DroppedListing, NormalizedListing, RawListing } from "./types.ts";

export interface CandidateBuild {
  candidates: VehicleInput[];
  listings: NormalizedListing[];
  baselines: Map<string, Baseline | null>;
  priceModel: PriceModel;
  dropped: DroppedListing[];
  mergedCount: number;
}

/** Map a normalized listing (plus its comps baseline) to scorer input. Reliability/safety/VIN checks are merged in later. */
export const toVehicleInput = (l: NormalizedListing, b: Baseline | null | undefined): VehicleInput => ({
  id: l.id,
  year: l.year, make: l.make, model: l.model, trim: l.trim, condition: l.condition,
  price: l.price, feesTotal: l.feesTotal, mileage: l.mileage, distanceMi: l.distanceMi,
  fuelType: l.fuelType ?? "gas", mpg: l.mpg, url: l.sources[0]?.url, vin: l.vin,
  market: { baseline: b?.baseline, comps: b?.comps ?? 0, msrp: l.msrp },
  listing: { daysOnMarket: l.daysOnMarket, priceDrops: l.priceDrops },
  history: l.history,
});

/** Raw adapter output → normalized, deduped, radius-filtered listings with comps baselines → scorer input. */
export const buildCandidates = (raws: RawListing[], norm: NormalizeOptions, comps: CompsOptions = {}): CandidateBuild => {
  const { listings, dropped, mergedCount } = normalizeListings(raws, norm);
  const priceModel = fitPriceModel(listings, comps);
  const baselines = computeBaselines(listings, priceModel, comps);
  return {
    candidates: listings.map(l => toVehicleInput(l, baselines.get(l.id))),
    listings, baselines, priceModel, dropped, mergedCount,
  };
};
