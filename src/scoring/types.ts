import { z } from "zod";

export const CRITERIA = [
  "deal_vs_market", "reliability", "title_status", "accident_damage", "total_cost_of_ownership",
  "safety_rating", "recalls", "service_records", "owner_count", "mileage_for_age",
] as const;
export type CriterionId = (typeof CRITERIA)[number];
export type ProfileId = "target" | "stretch" | "new_vehicle";

export const ReviewedCluster = z.object({
  label: z.string(),
  componentCode: z.string(),
  complaintCount: z.number().int().nonnegative(),
});
export type ReviewedCluster = z.infer<typeof ReviewedCluster>;

/** An already-enriched candidate. The scorer never fetches; adapters build these. */
export const VehicleRecord = z.object({
  id: z.string(),
  year: z.number().int(),
  make: z.string(),
  model: z.string(),
  trim: z.string().optional(),
  condition: z.enum(["new", "used", "cpo"]),
  price: z.number().positive(),
  feesTotal: z.number().nonnegative().default(0),
  mileage: z.number().nonnegative(),
  distanceMi: z.number().nonnegative().optional(),
  fuelType: z.enum(["gas", "hybrid", "plug_in_hybrid", "electric", "diesel"]).default("gas"),
  mpg: z.number().positive().optional(),
  url: z.string().optional(),
  vin: z.string().optional(),
  vinCheck: z.object({
    checksumValid: z.boolean(),
    decodeOk: z.boolean(),
    yearMatches: z.boolean().default(true),
    modelMatches: z.boolean().default(true),
  }).optional(),
  features: z.array(z.string()).default([]),
  market: z.object({
    baseline: z.number().positive().optional(),
    comps: z.number().int().nonnegative().default(0),
    msrp: z.number().positive().optional(),
    localMedianVsNational: z.number().optional(),
  }).default({ comps: 0 }),
  listing: z.object({
    daysOnMarket: z.number().nonnegative().optional(),
    priceDrops: z.number().int().nonnegative().optional(),
    outgoingModelYear: z.boolean().optional(),
    financeOnlyPrice: z.boolean().optional(),
    conditionalRebatesInAd: z.boolean().optional(),
  }).default({}),
  history: z.object({
    source: z.enum(["nmvtis", "carfax", "autocheck", "listing"]),
    titleBrand: z.enum(["clean", "salvage", "flood", "junk", "non_repairable", "rebuilt", "reconstructed", "lemon_buyback"]).optional(),
    accidents: z.number().int().nonnegative().optional(),
    owners: z.number().int().positive().optional(),
    frameDamaged: z.boolean().optional(),
    structuralDamage: z.boolean().optional(),
    airbagDeployed: z.boolean().optional(),
    usage: z.enum(["personal", "rental", "fleet", "unknown"]).optional(),
    service: z.enum(["regular", "some", "gaps_over_24_months", "none_on_report"]).optional(),
    odometerBrand: z.enum(["actual", "not_actual", "exceeds_mechanical_limits"]).optional(),
    odometerRollbackSuspected: z.boolean().optional(),
  }).optional(),
  nicb: z.object({ theftRecord: z.boolean(), recovered: z.boolean().optional() }).optional(),
  reliability: z.object({
    complaints: z.number().int().nonnegative(),
    perYear: z.number().nonnegative(),
    crashFireInjuryPerYear: z.number().nonnegative(),
    severeShare: z.number().min(0).max(1),
    recalls: z.number().int().nonnegative(),
    parkItRecalls: z.number().int().nonnegative().default(0),
    fireRiskRecalls: z.number().int().nonnegative().default(0),
    openInvestigations: z.number().int().nonnegative().optional(),
    reviewedClusters: z.array(ReviewedCluster).optional(),
    theftProne: z.boolean().optional(),
    userRating: z.number().int().min(1).max(5).optional(),
  }).optional(),
  vinRecalls: z.object({
    openCount: z.number().int().nonnegative(),
    openParkIt: z.number().int().nonnegative().default(0),
    remedied: z.boolean().optional(),
  }).optional(),
  safety: z.object({
    ncapOverall: z.number().int().min(1).max(5).optional(),
    iihsTopSafetyPick: z.boolean().optional(),
    automaticEmergencyBraking: z.boolean().optional(),
  }).optional(),
});
export type VehicleRecord = z.infer<typeof VehicleRecord>;
export type VehicleInput = z.input<typeof VehicleRecord>;

export const BuyerProfile = z.object({
  budget: z.object({
    target_min: z.number().nonnegative(),
    target_max: z.number().positive(),
    stretch_max: z.number().positive(),
  }),
  limits: z.object({
    max_mileage: z.number().positive().default(130000),
    allow_branded_title: z.boolean().default(false),
    allow_structural_damage: z.boolean().default(false),
  }).default({ max_mileage: 130000, allow_branded_title: false, allow_structural_damage: false }),
  needs: z.object({ must_have: z.array(z.string()).default([]) }).default({ must_have: [] }),
  usage: z.object({
    annual_miles: z.number().positive().default(12000),
    fuel_price_override: z.number().positive().nullable().default(null),
  }).default({ annual_miles: 12000, fuel_price_override: null }),
  payment: z.object({
    method: z.enum(["cash", "finance"]).default("cash"),
    expected_apr: z.number().nonnegative().nullable().default(null),
    term_months: z.number().int().positive().default(60),
    down_payment: z.number().nonnegative().default(0),
    sales_tax_rate: z.number().min(0).max(0.2).default(0),
  }).default({ method: "cash", expected_apr: null, term_months: 60, down_payment: 0, sales_tax_rate: 0 }),
  shortlist_size: z.number().int().positive().optional(),
}).passthrough();
export type BuyerProfile = z.infer<typeof BuyerProfile>;

/** Run-level inputs that change daily and are fetched by adapters, not stored in the profile. */
export interface RunContext {
  runDate: Date;
  fuelPricePerGal: number;
  defaultAprPercent: number;
  /** Optional reliability cohort; defaults to the distinct model-years among the candidates. */
  reliabilityCohort?: Array<{ perYear: number; crashFireInjuryPerYear: number; severeShare: number }>;
}

export interface CriterionResult {
  score: number;
  known: number;
  weight: number;
  evidence: string;
}

export interface TcoBreakdown {
  horizonYears: number;
  effectivePrice: number;
  salesTax: number;
  interest: number;
  fuel: number;
  insurance: number;
  maintenance: number;
  repairReserve: number;
  total: number;
  monthlyPayment: number | null;
  assumptions: string[];
}

export interface ScoreResult {
  vehicle: VehicleRecord;
  profile: ProfileId;
  gates: string[];
  blockers: string[];
  flags: string[];
  notes: string[];
  criteria: Record<CriterionId, CriterionResult>;
  overall: number;
  confidence: number;
  rating: string;
  stretch: boolean;
  tco: TcoBreakdown | null;
  eligible: boolean;
}

export interface RunResult {
  ranked: ScoreResult[];
  shortlist: ScoreResult[];
  excluded: ScoreResult[];
}
