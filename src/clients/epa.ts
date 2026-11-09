import type { HttpClient } from "./http.ts";

const WS = "https://www.fueleconomy.gov/ws/rest";
const arr = <T>(x: T | T[] | undefined | null): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);

/**
 * Pick the EPA model name for our model: exact > hybrid-for-hybrid > prefix > contains;
 * hybrids never match a non-hybrid request (and vice versa), and "Prime" only matches "Prius Prime".
 */
export const pickEpaModel = (model: string, names: string[]): string | undefined => {
  const want = model.toLowerCase().replace(/^mazda(\d)$/, "$1").trim();
  const wantsHybrid = want.includes("hybrid");
  const score = (name: string) => {
    const l = name.toLowerCase();
    if (l === want) return 100;
    if (l.includes("hybrid") !== wantsHybrid) return -1;
    if (l.includes("prime") !== want.includes("prime")) return -1;
    if (wantsHybrid && l.startsWith(want.split(" ")[0]!)) return 90;
    if (l.startsWith(`${want} `) || l.startsWith(`${want}-`)) return 60 - l.length / 100 + (/4[ -]?d(oo)?r|sedan/.test(l) ? 1 : 0);
    if (l.startsWith(want)) return 50 - l.length / 100;
    return -1;
  };
  return names.map(n => [n, score(n)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1])[0]?.[0];
};

export class EpaClient {
  constructor(private readonly http: HttpClient) {}

  /** Best combined mpg across the first `maxOptions` engine/trans options (base engine proxy when trim is unknown). */
  async bestCombinedMpg(year: number, make: string, model: string, maxOptions = 6): Promise<{ mpg: number; epaModel: string; optionsChecked: number } | null> {
    const models = await this.http.getJson<{ menuItem?: any }>(`${WS}/vehicle/menu/model?year=${year}&make=${encodeURIComponent(make)}`);
    const epaModel = pickEpaModel(model, arr(models.menuItem).map((m: any) => String(m.text)));
    if (!epaModel) return null;
    const opts = await this.http.getJson<{ menuItem?: any }>(`${WS}/vehicle/menu/options?year=${year}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(epaModel)}`);
    const ids = arr(opts.menuItem).slice(0, maxOptions).map((o: any) => String(o.value));
    const mpgs: number[] = [];
    for (const id of ids) {
      const v = await this.http.getJson<{ comb08?: string | number }>(`${WS}/vehicle/${id}`, { ttlMs: 30 * 24 * 3600 * 1000 });
      const m = Number(v.comb08);
      if (m > 0) mpgs.push(m);
    }
    return mpgs.length ? { mpg: Math.max(...mpgs), epaModel, optionsChecked: mpgs.length } : null;
  }

  /** National average regular gasoline price, $/gal (fueleconomy.gov, sourced from EIA). */
  async regularFuelPrice(): Promise<number | null> {
    const p = await this.http.getJson<{ regular?: string }>(`${WS}/fuelprices`, { ttlMs: 6 * 3600 * 1000 });
    const n = Number(p.regular);
    return n > 0 ? n : null;
  }
}
