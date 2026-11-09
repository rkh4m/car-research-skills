import type { EpaClient } from "../clients/epa.ts";
import type { NhtsaClient } from "../clients/nhtsa.ts";
import { vinChecksumValid } from "../clients/vin.ts";
import type { WrenchClient } from "../clients/wrench.ts";
import { modelAgeYears } from "../scoring/engine.ts";
import type { RunContext, VehicleInput } from "../scoring/types.ts";

export interface EnrichClients {
  nhtsa: NhtsaClient;
  epa: EpaClient;
  wrench?: WrenchClient;
}

export interface EnrichResult {
  candidates: VehicleInput[];
  cohort: NonNullable<RunContext["reliabilityCohort"]>;
  fuelPricePerGal: number | null;
  /** Per-source failures and data caveats; failures leave fields unknown (scored neutral), never guessed. */
  notes: string[];
}

type Reliability = NonNullable<VehicleInput["reliability"]>;
interface ModelYearData { reliability?: Reliability; ncap?: number; mpg?: number }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const modelsMatch = (a: string, b: string) => { const x = norm(a), y = norm(b); return x === y || x.startsWith(y) || y.startsWith(x); };

/**
 * Fill reliability (NHTSA complaints + recalls + Wrench.Pro reviewed clusters), NCAP safety, EPA mpg and VIN checks.
 * One fetch set per distinct model-year; existing fields on the input win over fetched ones.
 */
export const enrichCandidates = async (inputs: VehicleInput[], clients: EnrichClients, opts: { runDate: Date }): Promise<EnrichResult> => {
  const notes: string[] = [];
  const attempt = async <T>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    try { return await fn(); } catch (e) { notes.push(`${label}: ${(e as Error).message}`); return undefined; }
  };

  const byKey = new Map<string, ModelYearData>();
  for (const v of inputs) {
    const key = `${v.year}|${v.make}|${v.model}`;
    if (byKey.has(key)) continue;
    const label = `${v.year} ${v.make} ${v.model}`;
    const data: ModelYearData = {};
    const [complaints, recalls] = [await attempt(`NHTSA complaints ${label}`, () => clients.nhtsa.complaints(v.year, v.make, v.model)),
      await attempt(`NHTSA recalls ${label}`, () => clients.nhtsa.recalls(v.year, v.make, v.model))];
    const issues = clients.wrench ? await attempt(`Wrench.Pro ${label}`, () => clients.wrench!.knownIssues(v.year, v.make, v.model)) : undefined;
    if (issues?.mode === "unavailable") notes.push(`Wrench.Pro has no entry for ${label}; reviewed issues left unknown (not substituted)`);
    if (complaints && recalls) {
      const years = Math.max(1, modelAgeYears(v.year, opts.runDate));
      if (complaints.complaints === 0 && recalls.recalls > 0) notes.push(`${label}: 0 NHTSA complaints but ${recalls.recalls} recall(s) — likely filed under another model name; reliability will be unknown`);
      data.reliability = {
        complaints: complaints.complaints,
        perYear: Math.round((complaints.complaints / years) * 10) / 10,
        crashFireInjuryPerYear: Math.round((complaints.crashFireInjury / years) * 100) / 100,
        severeShare: Math.round(complaints.severeShare * 100) / 100,
        recalls: recalls.recalls, parkItRecalls: recalls.parkItRecalls, fireRiskRecalls: recalls.fireRiskRecalls,
        ...(issues?.mode === "reviewed" ? { reviewedClusters: issues.clusters, theftProne: issues.theftProne } : {}),
      };
    }
    const ncap = await attempt(`NHTSA NCAP ${label}`, () => clients.nhtsa.ncapOverall(v.year, v.make, v.model, /4 ?DR|SEDAN/i));
    if (ncap) data.ncap = ncap.stars;
    if (inputs.some(x => x.year === v.year && x.make === v.make && x.model === v.model && !x.mpg)) {
      const mpg = await attempt(`EPA ${label}`, () => clients.epa.bestCombinedMpg(v.year, v.make, v.model));
      if (mpg) data.mpg = mpg.mpg; else if (mpg === null) notes.push(`EPA has no match for ${label}`);
    }
    byKey.set(key, data);
  }

  const decoded = new Map<string, Awaited<ReturnType<NhtsaClient["decodeVin"]>>>();
  for (const vin of new Set(inputs.flatMap(v => (v.vin && !v.vinCheck ? [v.vin.toUpperCase()] : [])))) {
    const d = await attempt(`vPIC decode ${vin}`, () => clients.nhtsa.decodeVin(vin));
    if (d) decoded.set(vin, d);
  }

  const candidates = inputs.map((v): VehicleInput => {
    const d = byKey.get(`${v.year}|${v.make}|${v.model}`) ?? {};
    const dec = v.vin ? decoded.get(v.vin.toUpperCase()) : undefined;
    return {
      ...v,
      mpg: v.mpg ?? d.mpg,
      reliability: d.reliability || v.reliability ? { ...d.reliability, ...v.reliability } as Reliability : undefined,
      safety: d.ncap !== undefined || v.safety ? { ncapOverall: d.ncap, ...v.safety } : undefined,
      vinCheck: v.vinCheck ?? (v.vin && dec ? {
        checksumValid: vinChecksumValid(v.vin), decodeOk: dec.ok,
        yearMatches: dec.year === undefined || dec.year === v.year,
        modelMatches: !dec.model || modelsMatch(dec.model, v.model),
      } : undefined),
    };
  });

  const cohort = [...byKey.values()].flatMap(d => (d.reliability && d.reliability.complaints > 0 ? [{
    perYear: d.reliability.perYear, crashFireInjuryPerYear: d.reliability.crashFireInjuryPerYear, severeShare: d.reliability.severeShare,
  }] : []));
  const fuelPricePerGal = (await attempt("EPA fuel price", () => clients.epa.regularFuelPrice())) ?? null;
  return { candidates, cohort, fuelPricePerGal, notes };
};
