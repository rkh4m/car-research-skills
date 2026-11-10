import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";
import { CRITERIA } from "./types.ts";

const ScoreOrUnknown = z.union([z.number(), z.literal("unknown")]);
const ScoreMap = z.record(z.string(), ScoreOrUnknown);
const Weights = z.partialRecord(z.enum(CRITERIA), z.number().nonnegative()).refine(
  w => Object.values(w).reduce((a: number, b) => a + (b ?? 0), 0) === 100,
  { message: "profile weights must sum to 100" },
);
const Conditional = z.object({
  when: z.string(),
  add: z.number().optional(),
  multiply: z.number().optional(),
  cap: z.number().optional(),
  flag: z.string().optional(),
  note: z.string().optional(),
});
const Threshold = z.string().transform((s, ctx) => {
  const m = /^>=\s*(-?\d+(?:\.\d+)?)$/.exec(s.trim());
  if (!m) { ctx.addIssue({ code: "custom", message: `expected ">= N", got "${s}"` }); return z.NEVER; }
  return Number(m[1]);
});

export const ScorecardSchema = z.object({
  version: z.union([z.number(), z.string()]),
  unknown_score: z.number(),
  profiles: z.object({
    target: z.object({ weights: Weights }),
    stretch: z.object({ weights: Weights }),
    new_vehicle: z.object({ weights: Weights }),
  }),
  sanity_checks: z.array(z.object({ id: z.string(), when: z.string(), action: z.string() })),
  gates: z.array(z.object({ id: z.string(), when: z.string(), unless: z.string().optional() })),
  criteria: z.object({
    deal_vs_market: z.object({
      bands: z.array(z.object({ min: z.number(), score: z.number() })).min(1),
      modifiers: z.array(Conditional),
      red_flags: z.array(Conditional),
      partial_if: z.object({ comps_between: z.tuple([z.number(), z.number()]), confidence_factor: z.number() }),
    }),
    reliability: z.object({
      components: z.object({
        complaint_severity_percentile: z.number(),
        powertrain_electrical_share: z.number(),
        investigations_and_tsbs: z.number(),
        owner_report_evidence: z.number(),
      }),
      user_rating_override: z.object({ blend: z.number(), map: z.record(z.string(), z.number()) }),
      red_flags: z.array(Conditional),
    }),
    title_status: z.object({ map: ScoreMap, partial_if: z.object({ confidence_factor: z.number() }) }),
    accident_damage: z.object({ map: ScoreMap }),
    owner_count: z.object({ map: ScoreMap, modifiers: z.array(Conditional) }),
    service_records: z.object({ map: ScoreMap }),
    recalls: z.object({
      vin_verified: z.object({ open_count_map: z.record(z.string(), z.number()) }),
      model_year_only: z.object({
        max_score: z.number(),
        severity_penalty: z.object({ park_it_or_outside: z.number(), fire_risk: z.number(), other: z.number() }),
        confidence_factor: z.number(),
      }),
    }),
    total_cost_of_ownership: z.object({
      horizon_years: z.number().positive(),
      insurance_default_annual_usd: z.number().nonnegative(),
      insurance_modifiers: z.array(Conditional),
      maintenance_model: z.object({
        base_annual_usd: z.number(), per_1k_mi_over: z.number(), over_mi: z.number(), cap_annual_usd: z.number(),
      }),
      expected_repairs: z.object({
        rule: z.array(z.object({ id: z.string(), reserve_usd: z.number(), additive: z.boolean().optional() })).min(1),
        label: z.string(),
      }),
    }),
    safety_rating: z.object({ ncap_overall_map: ScoreMap, modifiers: z.array(Conditional) }),
    mileage_for_age: z.object({ bands: z.array(z.object({ max: z.number(), score: z.number() })).min(1) }),
    absolute_mileage: z.object({
      curve: z.array(z.tuple([z.number().nonnegative(), z.number().min(0).max(100)])).min(2)
        .refine(c => c.every((p, i) => i === 0 || p[0] > c[i - 1]![0]), { message: "curve miles must be strictly increasing" }),
      red_flags: z.array(Conditional),
    }),
  }),
  confidence: z.object({ min_for_shortlist: z.number() }),
  budget_rule: z.object({
    stretch_requires: z.object({
      deal_vs_market: Threshold, overall: Threshold, reliability: Threshold, confidence: Threshold,
    }),
    stretch_max_slots: z.number().int().nonnegative(),
    label: z.string(),
  }),
  shortlist: z.object({ size: z.number().int().positive(), min_overall: z.number() }),
  rating_bands: z.object({ excellent: z.number(), strong: z.number(), acceptable: z.number() }),
});
export type Scorecard = z.infer<typeof ScorecardSchema>;

export const DEFAULT_SCORECARD_PATH = fileURLToPath(new URL("../../scoring/scorecard.yaml", import.meta.url));

export const parseScorecard = (yamlText: string): Scorecard => ScorecardSchema.parse(parse(yamlText));

export const loadScorecard = (path = DEFAULT_SCORECARD_PATH): Scorecard =>
  parseScorecard(readFileSync(path, "utf8"));
