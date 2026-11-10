import { evaluate, tryEvaluate, type Facts } from "./expr.ts";
import type { Scorecard } from "./scorecard.ts";
import {
  BuyerProfile, CRITERIA, VehicleRecord,
  type CriterionId, type CriterionResult, type ProfileId, type ReviewedCluster, type RunContext,
  type RunResult, type ScoreResult, type TcoBreakdown, type VehicleInput,
} from "./types.ts";

const FAILURE_COMPONENT = /ENGINE|POWER ?TRAIN|TRANSMISSION/i;
const FAILURE_LABEL = /fail|seiz|slip|stall|knock|replac|oil (loss|consumption)/i;
const POWERTRAIN_COMPONENT = /ENGINE|POWER ?TRAIN|TRANSMISSION|HYBRID|FUEL\/PROPULSION/i;

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
/** Share of values strictly below x (0 = best/lowest in cohort). */
const percentile = (values: number[], x: number) => (values.length ? values.filter(v => v < x).length / values.length : 0);

export const modelAgeYears = (year: number, runDate: Date) =>
  Math.max(0.5, runDate.getUTCFullYear() + (runDate.getUTCMonth() + 0.5) / 12 - year);

export const amortizedPayment = (principal: number, aprPercent: number, months: number) => {
  if (principal <= 0) return 0;
  const r = aprPercent / 1200;
  return r === 0 ? principal / months : (principal * r) / (1 - (1 + r) ** -months);
};

const sortedClusters = (c: ReviewedCluster[] | undefined) => [...(c ?? [])].sort((a, b) => b.complaintCount - a.complaintCount);
export const hasTopFailureCluster = (clusters: ReviewedCluster[] | undefined) =>
  sortedClusters(clusters).slice(0, 2).some(c => FAILURE_COMPONENT.test(c.componentCode) && FAILURE_LABEL.test(c.label));
const hasLargePowertrainCluster = (clusters: ReviewedCluster[] | undefined) =>
  (clusters ?? []).some(c => POWERTRAIN_COMPONENT.test(c.componentCode) && c.complaintCount >= 10);

const lookup = (map: Record<string, number | "unknown">, key: string | undefined): number | null => {
  if (key === undefined) return null;
  const v = map[key];
  return v === undefined || v === "unknown" ? null : v;
};
const countKey = (map: Record<string, unknown>, n: number) => {
  if (String(n) in map) return String(n);
  const plus = Object.keys(map).filter(k => k.endsWith("+")).map(k => [k, Number(k.slice(0, -1))] as const).filter(([, m]) => n >= m);
  return plus.sort((a, b) => b[1] - a[1])[0]?.[0];
};

const selectProfile = (v: VehicleRecord, p: BuyerProfile): ProfileId =>
  v.condition === "new" ? "new_vehicle" : v.price > p.budget.target_max ? "stretch" : "target";

const ratingFor = (sc: Scorecard, overall: number) =>
  overall >= sc.rating_bands.excellent ? "excellent" : overall >= sc.rating_bands.strong ? "strong"
    : overall >= sc.rating_bands.acceptable ? "acceptable" : "below shortlist floor";

const vehicleFacts = (v: VehicleRecord, p: BuyerProfile, ctx: RunContext): Facts => {
  const h = v.history;
  const missingMustHave = p.needs.must_have.filter(f => !v.features.includes(f)).length;
  const baseline = v.market.baseline;
  const effective = v.price + v.feesTotal;
  return {
    condition: v.condition,
    price: v.price,
    mileage: v.mileage,
    msrp: v.market.msrp,
    baseline,
    "budget.stretch_max": p.budget.stretch_max,
    "limits.max_mileage": p.limits.max_mileage,
    "profile.allow_branded_title": p.limits.allow_branded_title,
    "profile.allow_structural_damage": p.limits.allow_structural_damage,
    title_status: h?.titleBrand,
    frame_damaged: h?.frameDamaged,
    structural_damage: h?.structuralDamage,
    airbag_deployed: h?.airbagDeployed,
    odometer_brand: h?.odometerBrand,
    odometer_rollback_suspected: h?.odometerRollbackSuspected,
    usage: h?.usage,
    owners: h?.owners,
    "nicb.theft_record": v.nicb?.theftRecord,
    "nicb.recovered": v.nicb?.recovered,
    vin_open_park_it_recalls: v.vinRecalls?.openParkIt,
    remedied: v.vinRecalls?.remedied,
    vin_present: Boolean(v.vin),
    vin_checks_failed: v.vinCheck ? !v.vinCheck.checksumValid && !v.vinCheck.decodeOk : undefined,
    vin_year_mismatch: v.vinCheck ? !v.vinCheck.yearMatches : undefined,
    vin_model_mismatch: v.vinCheck ? !v.vinCheck.modelMatches : undefined,
    missing_must_have_count: missingMustHave,
    model_age_years: modelAgeYears(v.year, ctx.runDate),
    run_month: ctx.runDate.getUTCMonth() + 1,
    days_on_market: v.listing.daysOnMarket,
    price_drops: v.listing.priceDrops,
    outgoing_model_year: v.listing.outgoingModelYear,
    price_is_finance_only: v.listing.financeOnlyPrice,
    ad_price_includes_conditional_rebates: v.listing.conditionalRebatesInAd,
    local_median_vs_national: v.market.localMedianVsNational,
    pct_vs_baseline: baseline ? (baseline - effective) / baseline : undefined,
    theft_prone_model_year: v.reliability?.theftProne,
    iihs_top_safety_pick: v.safety?.iihsTopSafetyPick,
    has_automatic_emergency_braking: v.safety?.automaticEmergencyBraking,
  };
};

type Unweighted<K extends string> = Record<K, Omit<CriterionResult, "weight">>;
interface PartialScore { gates: string[]; flags: string[]; notes: string[]; criteria: Unweighted<CriterionId>; tco: TcoBreakdown | null }

const unknown = (sc: Scorecard, evidence: string) => ({ score: sc.unknown_score, known: 0, evidence });

const scoreDeal = (sc: Scorecard, v: VehicleRecord, facts: Facts, flags: string[], notes: string[]) => {
  const cfg = sc.criteria.deal_vs_market;
  const effective = v.price + v.feesTotal;
  let pct: number | undefined; let known = 0; let basis = "";
  if (v.condition === "new" && v.market.msrp) {
    pct = (v.market.msrp - effective) / v.market.msrp; known = 1; basis = `MSRP $${v.market.msrp.toLocaleString()}`;
  } else if (v.market.baseline) {
    pct = (v.market.baseline - effective) / v.market.baseline;
    const [lo, hi] = cfg.partial_if.comps_between;
    known = v.market.comps > hi ? 1 : v.market.comps >= lo ? cfg.partial_if.confidence_factor : 0;
    basis = `comps baseline $${v.market.baseline.toLocaleString()} (n=${v.market.comps})`;
  }
  if (pct === undefined) return unknown(sc, "no market baseline or MSRP");
  const p0 = pct;
  let score = cfg.bands.find(b => p0 >= b.min)?.score ?? cfg.bands[cfg.bands.length - 1]!.score;
  for (const m of cfg.modifiers) if (tryEvaluate(m.when, facts)) { score += m.add ?? 0; if (m.note) notes.push(m.note); }
  for (const r of cfg.red_flags) if (r.flag && tryEvaluate(r.when, facts)) flags.push(r.flag);
  const dir = pct >= 0 ? "under" : "over";
  return { score: clamp(score), known, evidence: `$${effective.toLocaleString()} incl. fees is ${Math.abs(pct * 100).toFixed(1)}% ${dir} ${basis}` };
};

const scoreReliability = (sc: Scorecard, v: VehicleRecord, ctx: RunContext, cohort: NonNullable<RunContext["reliabilityCohort"]>, facts: Facts, flags: string[]) => {
  const cfg = sc.criteria.reliability;
  const r = v.reliability;
  for (const f of cfg.red_flags) if (f.flag && tryEvaluate(f.when, facts)) flags.push(f.flag);
  if (!r) return unknown(sc, "no complaint data for this model year");
  if (r.complaints === 0) {
    flags.push("reliability_data_missing");
    return unknown(sc, r.recalls > 0 ? "0 complaints but recalls exist — model likely filed under another name" : "no complaints on file");
  }
  const parts: Array<[number, number]> = [];
  const sev = 100 * (1 - (0.7 * percentile(cohort.map(c => c.perYear), r.perYear) + 0.3 * percentile(cohort.map(c => c.crashFireInjuryPerYear), r.crashFireInjuryPerYear)));
  parts.push([sev, cfg.components.complaint_severity_percentile]);
  parts.push([100 * (1 - percentile(cohort.map(c => c.severeShare), r.severeShare)), cfg.components.powertrain_electrical_share]);
  if (r.openInvestigations !== undefined) parts.push([clamp(100 - 30 * r.openInvestigations), cfg.components.investigations_and_tsbs]);
  if (r.reviewedClusters) {
    const ev = hasTopFailureCluster(r.reviewedClusters) ? 25 : hasLargePowertrainCluster(r.reviewedClusters) ? 50 : 85;
    parts.push([ev, cfg.components.owner_report_evidence]);
    if (ev <= 30) flags.push("reviewed_engine_or_transmission_failures");
  }
  const totalW = parts.reduce((s, [, w]) => s + w, 0);
  let score = parts.reduce((s, [x, w]) => s + x * w, 0) / totalW;
  if (r.userRating !== undefined) {
    const u = cfg.user_rating_override.map[String(r.userRating)];
    if (u !== undefined) score = (1 - cfg.user_rating_override.blend) * score + cfg.user_rating_override.blend * u;
  }
  if (r.theftProne) flags.push("theft_prone");
  const top = sortedClusters(r.reviewedClusters)[0];
  return {
    score: Math.round(score), known: 1,
    evidence: `${r.complaints} NHTSA complaints (${r.perYear}/yr on market)${top ? `; top reviewed issue: ${top.label} (${top.complaintCount})` : ""}; not sales-normalized`,
  };
};

const scoreHistory = (sc: Scorecard, v: VehicleRecord, facts: Facts, flags: string[]) => {
  const h = v.history;
  const c = sc.criteria;
  const out: Unweighted<"title_status" | "accident_damage" | "owner_count" | "service_records"> = {
    title_status: unknown(sc, "no title data"),
    accident_damage: unknown(sc, "no accident history"),
    owner_count: unknown(sc, "owner count unknown"),
    service_records: unknown(sc, "no service records reviewed"),
  };
  if (!h) return out;
  const verified = h.source !== "listing";
  const t = lookup(c.title_status.map, h.titleBrand);
  if (t !== null) out.title_status = { score: t, known: verified ? 1 : c.title_status.partial_if.confidence_factor, evidence: `${h.titleBrand} per ${h.source}${verified ? "" : " (not NMVTIS-verified)"}` };
  const structural = h.frameDamaged || h.structuralDamage || h.airbagDeployed;
  if (structural) {
    out.accident_damage = { score: lookup(c.accident_damage.map, "severe") ?? 0, known: 1, evidence: "frame/structural damage or airbag deployment reported" };
    flags.push("structural_or_airbag_damage");
  } else if (h.accidents !== undefined) {
    const key = h.accidents === 0 ? "none_reported" : h.accidents === 1 ? "minor" : h.accidents === 2 ? "moderate" : "severe";
    out.accident_damage = { score: lookup(c.accident_damage.map, key) ?? sc.unknown_score, known: 1, evidence: `${h.accidents} reported accident(s) per ${h.source}` };
  }
  if (h.owners !== undefined) {
    let s = lookup(c.owner_count.map, countKey(c.owner_count.map, h.owners)) ?? sc.unknown_score;
    for (const m of c.owner_count.modifiers) if (tryEvaluate(m.when, facts)) { s += m.add ?? 0; if (m.flag) flags.push(m.flag); }
    out.owner_count = { score: clamp(s), known: 1, evidence: `${h.owners} owner(s)${h.usage && h.usage !== "personal" ? `, ${h.usage} use` : ""}` };
  }
  const svc = lookup(c.service_records.map, h.service);
  if (svc !== null) out.service_records = { score: svc, known: 1, evidence: `service history: ${h.service}` };
  return out;
};

const scoreRecalls = (sc: Scorecard, v: VehicleRecord, flags: string[]) => {
  const cfg = sc.criteria.recalls;
  if (v.vinRecalls) {
    const s = cfg.vin_verified.open_count_map[countKey(cfg.vin_verified.open_count_map, v.vinRecalls.openCount) ?? ""];
    return { score: s ?? 0, known: 1, evidence: `${v.vinRecalls.openCount} open recall(s) for this VIN` };
  }
  const r = v.reliability;
  if (!r) return unknown(sc, "no recall data");
  const m = cfg.model_year_only;
  const other = Math.max(0, r.recalls - r.parkItRecalls - r.fireRiskRecalls);
  let s = m.max_score + other * m.severity_penalty.other;
  if (r.parkItRecalls > 0) { s += m.severity_penalty.park_it_or_outside; flags.push("park_it_recall_on_model_year_confirm_by_vin"); }
  if (r.fireRiskRecalls > 0) s += m.severity_penalty.fire_risk;
  return { score: clamp(s), known: m.confidence_factor, evidence: `${r.recalls} model-year recall(s), ${r.parkItRecalls} park-it/park-outside; VIN remedy status unknown` };
};

const scoreSafety = (sc: Scorecard, v: VehicleRecord, facts: Facts) => {
  const cfg = sc.criteria.safety_rating;
  const base = lookup(cfg.ncap_overall_map, v.safety?.ncapOverall !== undefined ? String(v.safety.ncapOverall) : undefined);
  if (base === null) return unknown(sc, "not rated / no NCAP data");
  let s = base;
  for (const m of cfg.modifiers) if (tryEvaluate(m.when, facts)) s = Math.min(m.cap ?? 100, s + (m.add ?? 0));
  return { score: s, known: 1, evidence: `NHTSA ${v.safety!.ncapOverall}-star overall` };
};

const scoreMileage = (sc: Scorecard, v: VehicleRecord, p: BuyerProfile, ctx: RunContext) => {
  const age = modelAgeYears(v.year, ctx.runDate);
  const ratio = v.mileage / (age * p.usage.annual_miles);
  const bands = sc.criteria.mileage_for_age.bands;
  const s = bands.find(b => ratio <= b.max)?.score ?? bands[bands.length - 1]!.score;
  return { score: s, known: 1, evidence: `${Math.round(v.mileage / age).toLocaleString()} mi/yr over ${age.toFixed(1)} yrs` };
};

/** Linear interpolation over [miles, score] points; flat beyond the ends. */
export const interpolateCurve = (curve: Array<[number, number]>, x: number) => {
  if (x <= curve[0]![0]) return curve[0]![1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i]!, [x0, y0] = curve[i - 1]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return curve[curve.length - 1]![1];
};

const scoreAbsoluteMileage = (sc: Scorecard, v: VehicleRecord, facts: Facts, flags: string[], notes: string[]) => {
  const cfg = sc.criteria.absolute_mileage;
  for (const r of cfg.red_flags) if (r.flag && tryEvaluate(r.when, facts)) { flags.push(r.flag); if (r.note) notes.push(r.note); }
  return { score: Math.round(interpolateCurve(cfg.curve, v.mileage)), known: 1, evidence: `${v.mileage.toLocaleString()} mi on the odometer` };
};

export const computeTco = (sc: Scorecard, v: VehicleRecord, p: BuyerProfile, ctx: RunContext, facts: Facts, flags: string[]): TcoBreakdown | null => {
  if (!v.mpg) return null;
  const cfg = sc.criteria.total_cost_of_ownership;
  const yrs = cfg.horizon_years;
  const effectivePrice = v.price + v.feesTotal;
  const salesTax = effectivePrice * p.payment.sales_tax_rate;
  const fuelPrice = p.usage.fuel_price_override ?? ctx.fuelPricePerGal;
  const fuel = (yrs * p.usage.annual_miles / v.mpg) * fuelPrice;
  let interest = 0; let monthlyPayment: number | null = null;
  const assumptions = [`${p.usage.annual_miles.toLocaleString()} mi/yr`, `fuel $${fuelPrice}/gal`, `${v.mpg} mpg`];
  if (p.payment.method === "finance") {
    const apr = p.payment.expected_apr ?? ctx.defaultAprPercent;
    const principal = Math.max(0, effectivePrice + salesTax - p.payment.down_payment);
    monthlyPayment = amortizedPayment(principal, apr, p.payment.term_months);
    interest = monthlyPayment * p.payment.term_months - principal;
    assumptions.push(`${apr}% APR, ${p.payment.term_months} mo, $${p.payment.down_payment.toLocaleString()} down`);
  }
  let insuranceMult = 1;
  for (const m of cfg.insurance_modifiers) if (tryEvaluate(m.when, facts)) { insuranceMult *= m.multiply ?? 1; if (m.flag) flags.push(m.flag); }
  const insurance = yrs * cfg.insurance_default_annual_usd * insuranceMult;
  assumptions.push(`insurance placeholder $${cfg.insurance_default_annual_usd}/yr${insuranceMult !== 1 ? ` ×${insuranceMult}` : ""} (get a quote)`);
  const mm = cfg.maintenance_model;
  const midMileage = v.mileage + (p.usage.annual_miles * yrs) / 2;
  const maintenance = yrs * Math.min(mm.cap_annual_usd, mm.base_annual_usd + mm.per_1k_mi_over * Math.max(0, (midMileage - mm.over_mi) / 1000));
  const clusters = v.reliability?.reviewedClusters;
  const matches: Record<string, boolean> = {
    engine_or_transmission_failure_top2: hasTopFailureCluster(clusters),
    powertrain_cluster_10plus: hasLargePowertrainCluster(clusters),
    hybrid_high_mileage: (v.fuelType === "hybrid" || v.fuelType === "plug_in_hybrid") && v.mileage >= 120000,
    over_100k_wear: v.mileage > 100000,
    default: true,
  };
  const rules = cfg.expected_repairs.rule;
  const base = rules.find(r => !r.additive && matches[r.id])?.reserve_usd ?? 0;
  const repairReserve = base + rules.filter(r => r.additive && matches[r.id]).reduce((s, r) => s + r.reserve_usd, 0);
  assumptions.push(`${cfg.expected_repairs.label}: $${repairReserve.toLocaleString()}`);
  const total = effectivePrice + salesTax + interest + fuel + insurance + maintenance + repairReserve;
  const r0 = (n: number) => Math.round(n);
  return {
    horizonYears: yrs, effectivePrice: r0(effectivePrice), salesTax: r0(salesTax), interest: r0(interest), fuel: r0(fuel),
    insurance: r0(insurance), maintenance: r0(maintenance), repairReserve: r0(repairReserve), total: r0(total),
    monthlyPayment: monthlyPayment === null ? null : r0(monthlyPayment), assumptions,
  };
};

const scoreOne = (sc: Scorecard, v: VehicleRecord, p: BuyerProfile, ctx: RunContext, cohort: NonNullable<RunContext["reliabilityCohort"]>): PartialScore => {
  const facts = vehicleFacts(v, p, ctx);
  const gates: string[] = []; const flags: string[] = []; const notes: string[] = [];
  for (const g of sc.gates) if (evaluate(g.when, facts) && !(g.unless && evaluate(g.unless, facts))) gates.push(g.id);
  for (const s of sc.sanity_checks) if (s.action === "exclude_until_verified" && tryEvaluate(s.when, facts) && !gates.includes(s.id)) gates.push(s.id);
  const history = scoreHistory(sc, v, facts, flags);
  const tco = computeTco(sc, v, p, ctx, facts, flags);
  const criteria: Unweighted<CriterionId> = {
    deal_vs_market: scoreDeal(sc, v, facts, flags, notes),
    reliability: scoreReliability(sc, v, ctx, cohort, facts, flags),
    ...history,
    total_cost_of_ownership: tco ? { score: sc.unknown_score, known: 1, evidence: `5-yr est. $${tco.total.toLocaleString()}` } : unknown(sc, "no fuel economy data"),
    safety_rating: scoreSafety(sc, v, facts),
    recalls: scoreRecalls(sc, v, flags),
    mileage_for_age: scoreMileage(sc, v, p, ctx),
    absolute_mileage: scoreAbsoluteMileage(sc, v, facts, flags, notes),
  };
  return { gates, flags: [...new Set(flags)], notes: [...new Set(notes)], criteria, tco };
};

const compareResults = (a: ScoreResult, b: ScoreResult) =>
  b.overall - a.overall || b.confidence - a.confidence
  || b.criteria.deal_vs_market.score - a.criteria.deal_vs_market.score
  || b.criteria.reliability.score - a.criteria.reliability.score
  || (a.vehicle.distanceMi ?? Infinity) - (b.vehicle.distanceMi ?? Infinity);

/** Score and rank candidates, then pick the shortlist under the scorecard's gates, floors and budget rule. */
export const scoreCandidates = (sc: Scorecard, inputs: VehicleInput[], profileInput: unknown, ctx: RunContext): RunResult => {
  const profile = BuyerProfile.parse(profileInput);
  const vehicles = inputs.map(v => VehicleRecord.parse(v));
  const cohort = ctx.reliabilityCohort ?? [...new Map(vehicles.filter(v => v.reliability && v.reliability.complaints > 0)
    .map(v => [`${v.year}|${v.make}|${v.model}`, v.reliability!])).values()];
  const partials = vehicles.map(v => scoreOne(sc, v, profile, ctx, cohort));
  const totals = partials.flatMap(p => (p.tco ? [p.tco.total] : []));
  for (const p of partials) if (p.tco) p.criteria.total_cost_of_ownership.score = Math.round(100 * (1 - percentile(totals, p.tco.total)));

  const req = sc.budget_rule.stretch_requires;
  const results: ScoreResult[] = vehicles.map((v, i) => {
    const part = partials[i]!;
    const profileId = selectProfile(v, profile);
    const weights = sc.profiles[profileId].weights;
    const criteria = Object.fromEntries(CRITERIA.map(id => [id, { ...part.criteria[id], weight: weights[id] ?? 0 }])) as ScoreResult["criteria"];
    const overall = round1(CRITERIA.reduce((s, id) => s + criteria[id].weight * criteria[id].score, 0) / 100);
    const confidence = Math.round(CRITERIA.reduce((s, id) => s + criteria[id].weight * criteria[id].known, 0)) / 100;
    const stretch = v.price > profile.budget.target_max;
    const blockers: string[] = [];
    if (overall < sc.shortlist.min_overall) blockers.push(`overall below ${sc.shortlist.min_overall}`);
    if (confidence < sc.confidence.min_for_shortlist) blockers.push(`confidence below ${sc.confidence.min_for_shortlist}`);
    if (stretch) {
      const misses = [
        criteria.deal_vs_market.score < req.deal_vs_market && `deal ${criteria.deal_vs_market.score} < ${req.deal_vs_market}`,
        overall < req.overall && `overall ${overall} < ${req.overall}`,
        (criteria.reliability.known === 0 || criteria.reliability.score < req.reliability) && `reliability ${criteria.reliability.known ? criteria.reliability.score : "unknown"} < ${req.reliability}`,
        confidence < req.confidence && `confidence ${confidence} < ${req.confidence}`,
      ].filter(Boolean) as string[];
      if (misses.length) blockers.push(`stretch not exceptional (${misses.join("; ")})`);
    }
    return {
      vehicle: v, profile: profileId, gates: part.gates, blockers, flags: part.flags, notes: part.notes, criteria,
      overall, confidence, rating: ratingFor(sc, overall), stretch, tco: part.tco,
      eligible: part.gates.length === 0 && blockers.length === 0,
    };
  });

  const ranked = [...results].sort(compareResults);
  const size = profile.shortlist_size ?? sc.shortlist.size;
  const shortlist: ScoreResult[] = [];
  let stretchUsed = 0;
  for (const r of ranked) {
    if (shortlist.length >= size) break;
    if (!r.eligible) continue;
    if (r.stretch) { if (stretchUsed >= sc.budget_rule.stretch_max_slots) continue; stretchUsed++; }
    shortlist.push(r);
  }
  return { ranked, shortlist, excluded: ranked.filter(r => r.gates.length > 0) };
};
