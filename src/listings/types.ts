import type { VehicleRecord } from "../scoring/types.ts";

export type SourceId = "cargurus" | "dealer_direct" | "auto_dev" | "user";
export type Condition = VehicleRecord["condition"];
export type FuelType = VehicleRecord["fuelType"];

/** One listing as a source adapter produced it. Vehicle facts only — no seller contact details. */
export interface RawListing {
  source: SourceId;
  sourceId: string;
  url?: string;
  observedAt: string;
  vin?: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  condition?: Condition;
  price: number;
  feesTotal?: number;
  msrp?: number;
  mileage: number;
  dealer?: { name?: string; city?: string; state?: string; lat?: number; lng?: number; rating?: number };
  /** Distance as the source reported it. Only used when `trustedDistance` is true and no coordinates exist. */
  reportedDistanceMi?: number;
  trustedDistance?: boolean;
  bodyStyle?: string;
  fuelType?: FuelType;
  mpg?: number;
  daysOnMarket?: number;
  priceDrops?: number;
  history?: VehicleRecord["history"];
  flags?: string[];
}

export interface SourceRef {
  source: SourceId;
  sourceId: string;
  url?: string;
  price: number;
  feesTotal: number;
  observedAt: string;
}

export interface NormalizedListing {
  id: string;
  vin?: string;
  year: number;
  make: string;
  model: string;
  /** Model with body-style suffixes removed; the unit comps are grouped by. */
  family: string;
  trim?: string;
  condition: Condition;
  price: number;
  feesTotal: number;
  msrp?: number;
  mileage: number;
  distanceMi?: number;
  dealer?: RawListing["dealer"];
  fuelType?: FuelType;
  mpg?: number;
  daysOnMarket?: number;
  priceDrops?: number;
  history?: VehicleRecord["history"];
  sources: SourceRef[];
  flags: string[];
}

export interface DroppedListing {
  listing: RawListing;
  reason: "outside_radius" | "invalid";
  detail: string;
}

export interface Baseline {
  baseline: number;
  comps: number;
  p25: number;
  p75: number;
  widened: boolean;
}
