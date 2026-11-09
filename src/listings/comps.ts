import type { Baseline, NormalizedListing } from "./types.ts";

/** Log-price sensitivities shared by all families in a run. */
export interface PriceModel {
  /** Fractional price drop per 10,000 extra miles (e.g. 0.042). */
  perTenKMiles: number;
  /** Fractional price gain per newer model year (e.g. 0.034). */
  perModelYear: number;
  fitted: boolean;
  n: number;
}

export interface CompsOptions {
  window?: { years: number; miles: number };
  widenedWindow?: { years: number; miles: number };
  minComps?: number;
  minCompsBeforeWidening?: number;
  defaultModel?: Omit<PriceModel, "fitted" | "n">;
}

const DEFAULTS = {
  window: { years: 1, miles: 20000 },
  widenedWindow: { years: 2, miles: 40000 },
  minComps: 3,
  minCompsBeforeWidening: 6,
  defaultModel: { perTenKMiles: 0.04, perModelYear: 0.035 },
};

const effective = (l: NormalizedListing) => l.price + l.feesTotal;
const isNewClass = (l: NormalizedListing) => l.condition === "new";

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
};
const weightedMedian = (pairs: Array<{ x: number; w: number }>) => {
  const s = [...pairs].sort((a, b) => a.x - b.x);
  const half = s.reduce((a, p) => a + p.w, 0) / 2;
  let acc = 0;
  for (const p of s) { acc += p.w; if (acc >= half) return p.x; }
  return s[s.length - 1]!.x;
};

/** Least squares via normal equations (small systems only). Returns null if singular. */
const solve = (X: number[][], y: number[]): number[] | null => {
  const n = X[0]!.length;
  const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => X.reduce((s, r) => s + r[i]! * r[j]!, 0)));
  const b = Array.from({ length: n }, (_, i) => X.reduce((s, r, k) => s + r[i]! * y[k]!, 0));
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[p]![i]!)) p = r;
    if (Math.abs(A[p]![i]!) < 1e-9) return null;
    [A[i], A[p]] = [A[p]!, A[i]!]; [b[i], b[p]] = [b[p]!, b[i]!];
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = A[r]![i]! / A[i]![i]!;
      for (let c = i; c < n; c++) A[r]![c]! -= f * A[i]![c]!;
      b[r]! -= f * b[i]!;
    }
  }
  return b.map((v, i) => v / A[i]![i]!);
};

/**
 * Fit log(price incl. fees) ~ family + model year + mileage over used listings, dropping MAD outliers once.
 * Falls back to defaults when data is thin or the fit is implausible (price rising with miles or age).
 */
export const fitPriceModel = (listings: NormalizedListing[], opts: CompsOptions = {}): PriceModel => {
  const def = opts.defaultModel ?? DEFAULTS.defaultModel;
  const used = listings.filter(l => !isNewClass(l));
  const fams = [...new Set(used.map(l => l.family))];
  const fallback: PriceModel = { ...def, fitted: false, n: used.length };
  if (used.length < 2 * (fams.length + 2)) return fallback;
  const row = (l: NormalizedListing) => [...fams.map(f => (l.family === f ? 1 : 0)), l.year - 2018, l.mileage / 10000];
  const fit = (rows: NormalizedListing[]) => solve(rows.map(row), rows.map(l => Math.log(effective(l))));
  let beta = fit(used);
  if (!beta) return fallback;
  const resid = used.map(l => Math.log(effective(l)) - row(l).reduce((s, x, j) => s + x * beta![j]!, 0));
  const med = median(resid), mad = median(resid.map(r => Math.abs(r - med)));
  const kept = used.filter((_, i) => Math.abs(resid[i]! - med) <= 3 * 1.4826 * mad);
  if (kept.length >= 2 * (fams.length + 2)) beta = fit(kept) ?? beta;
  const perModelYear = beta[fams.length]!, perTenKMiles = -beta[fams.length + 1]!;
  if (!(perTenKMiles > 0 && perTenKMiles < 0.2 && perModelYear > 0 && perModelYear < 0.3)) return fallback;
  return { perTenKMiles, perModelYear, fitted: true, n: kept.length };
};

const compsWithin = (t: NormalizedListing, pool: NormalizedListing[], w: { years: number; miles: number }) =>
  pool.filter(c => c !== t && c.family === t.family && isNewClass(c) === isNewClass(t)
    && Math.abs(c.year - t.year) <= w.years && Math.abs(c.mileage - t.mileage) <= w.miles);

/**
 * Baseline per listing: comps' prices (incl. fees) adjusted to the target's year and mileage,
 * MAD outliers removed, weighted median with weight = similarity². Null when comps are too thin.
 */
export const computeBaselines = (listings: NormalizedListing[], model: PriceModel, opts: CompsOptions = {}): Map<string, Baseline | null> => {
  const o = { ...DEFAULTS, ...opts };
  const out = new Map<string, Baseline | null>();
  for (const t of listings) {
    let window = o.window, widened = false;
    let comps = compsWithin(t, listings, window);
    if (comps.length < o.minCompsBeforeWidening) { window = o.widenedWindow; widened = true; comps = compsWithin(t, listings, window); }
    let adjusted = comps.map(c => {
      const x = effective(c) * Math.exp(-model.perTenKMiles * (t.mileage - c.mileage) / 10000 + model.perModelYear * (t.year - c.year));
      const sim = Math.max(0.05, 1 - 0.5 * Math.abs(c.year - t.year) / window.years - 0.5 * Math.abs(c.mileage - t.mileage) / window.miles);
      return { x, w: sim * sim };
    });
    if (adjusted.length >= 5) {
      const med = median(adjusted.map(a => a.x));
      const mad = median(adjusted.map(a => Math.abs(a.x - med)));
      if (mad > 0) adjusted = adjusted.filter(a => Math.abs(a.x - med) <= 3 * 1.4826 * mad);
    }
    if (adjusted.length < o.minComps) { out.set(t.id, null); continue; }
    const xs = adjusted.map(a => a.x);
    out.set(t.id, {
      baseline: Math.round(weightedMedian(adjusted)),
      comps: adjusted.length,
      p25: Math.round(quantile(xs, 0.25)),
      p75: Math.round(quantile(xs, 0.75)),
      widened,
    });
  }
  return out;
};
