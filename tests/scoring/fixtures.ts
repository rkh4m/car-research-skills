import type { RunContext, VehicleInput } from "../../src/scoring/types.ts";

export const ctx: RunContext = { runDate: new Date("2026-11-08T12:00:00Z"), fuelPricePerGal: 4.15, defaultAprPercent: 8.5 };

export const profile = {
  budget: { target_min: 10000, target_max: 15000, stretch_max: 35000 },
  limits: { max_mileage: 130000 },
  usage: { annual_miles: 12000 },
  payment: { method: "finance", down_payment: 5000, term_months: 60, sales_tax_rate: 0.0415 },
};

const BENIGN_CLUSTERS = [
  { label: "Infotainment system freeze and reboot", componentCode: "ELECTRICAL SYSTEM", complaintCount: 16 },
  { label: "Rearview camera failure under recall", componentCode: "BACK OVER PREVENTION", complaintCount: 12 },
];
export const FAILURE_CLUSTERS = [
  { label: "Transmission failure and stalling during acceleration", componentCode: "POWER TRAIN", complaintCount: 47 },
  { label: "Engine seizure and excessive oil consumption", componentCode: "ENGINE", complaintCount: 36 },
];

/** A clean, fully enriched, fairly priced used sedan; tests override what they need. */
export const car = (over: Partial<VehicleInput> & { id: string }): VehicleInput => ({
  year: 2017, make: "Mazda", model: "Mazda3", condition: "used",
  price: 12000, feesTotal: 900, mileage: 90000, distanceMi: 20, mpg: 32,
  vin: "JM1BM1T70H0000000", vinCheck: { checksumValid: true, decodeOk: true },
  market: { baseline: 13500, comps: 10 },
  listing: { daysOnMarket: 20 },
  history: { source: "listing", titleBrand: "clean", accidents: 0, owners: 1 },
  reliability: { complaints: 84, perYear: 8.5, crashFireInjuryPerYear: 0.6, severeShare: 0.46, recalls: 2, reviewedClusters: BENIGN_CLUSTERS },
  safety: { ncapOverall: 5 },
  ...over,
});
