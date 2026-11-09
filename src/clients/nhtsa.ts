import type { HttpClient } from "./http.ts";

const API = "https://api.nhtsa.gov";
const VPIC = "https://vpic.nhtsa.dot.gov/api/vehicles";
const SEVERE = /ENGINE|POWER TRAIN|TRANSMISSION|ELECTRICAL|FUEL|HYBRID|STEERING|AIR BAGS|BRAKES/i;

export interface ComplaintSummary {
  complaints: number;
  crashFireInjury: number;
  severeShare: number;
  topComponents: Array<{ component: string; count: number }>;
}
export interface RecallSummary {
  recalls: number;
  parkItRecalls: number;
  fireRiskRecalls: number;
  campaigns: Array<{ id: string; component: string; parkIt: boolean }>;
}
export interface VinDecode {
  vin: string;
  ok: boolean;
  year?: number;
  make?: string;
  model?: string;
  errorText?: string;
}

/** api.nhtsa.gov returns HTTP 400 with `{"Count":0,"results":[]}` when a model-year has no recalls/complaints. */
const emptyResultsOk = (status: number, body: unknown) =>
  status === 400 && Array.isArray((body as { results?: unknown })?.results);

const q = (year: number, make: string, model: string) =>
  `make=${encodeURIComponent(make.toLowerCase())}&model=${encodeURIComponent(model.toLowerCase())}&modelYear=${year}`;

export class NhtsaClient {
  constructor(private readonly http: HttpClient) {}

  async complaints(year: number, make: string, model: string): Promise<ComplaintSummary> {
    const r = await this.http.getJson<{ results?: any[] }>(`${API}/complaints/complaintsByVehicle?${q(year, make, model)}`, { acceptErrorBody: emptyResultsOk });
    const rows = r.results ?? [];
    const counts = new Map<string, number>();
    for (const x of rows) for (const c of String(x.components ?? "").split(",").map(s => s.trim()).filter(Boolean)) counts.set(c, (counts.get(c) ?? 0) + 1);
    return {
      complaints: rows.length,
      crashFireInjury: rows.filter(x => x.crash || x.fire || x.numberOfInjuries > 0 || x.numberOfDeaths > 0).length,
      severeShare: rows.length ? rows.filter(x => SEVERE.test(String(x.components ?? ""))).length / rows.length : 0,
      topComponents: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([component, count]) => ({ component, count })),
    };
  }

  async recalls(year: number, make: string, model: string): Promise<RecallSummary> {
    const r = await this.http.getJson<{ results?: any[] }>(`${API}/recalls/recallsByVehicle?${q(year, make, model)}`, { acceptErrorBody: emptyResultsOk });
    const rows = r.results ?? [];
    const park = (x: any) => Boolean(x.parkIt || x.parkOutSide);
    return {
      recalls: rows.length,
      parkItRecalls: rows.filter(park).length,
      fireRiskRecalls: rows.filter(x => !park(x) && (/FIRE/i.test(String(x.Component)) || /\bfire\b/i.test(String(x.Summary)))).length,
      campaigns: rows.map(x => ({ id: String(x.NHTSACampaignNumber), component: String(x.Component ?? ""), parkIt: park(x) })),
    };
  }

  /** NCAP overall stars; prefers a variant whose description matches `bodyHint` (e.g. "4 DR"). */
  async ncapOverall(year: number, make: string, model: string, bodyHint?: RegExp): Promise<{ stars: number; description: string } | null> {
    const list = await this.http.getJson<{ Results?: any[] }>(`${API}/SafetyRatings/modelyear/${year}/make/${encodeURIComponent(make)}/model/${encodeURIComponent(model)}`);
    const variants = [...(list.Results ?? [])].sort((a, b) => Number(bodyHint?.test(b.VehicleDescription) ?? 0) - Number(bodyHint?.test(a.VehicleDescription) ?? 0));
    for (const v of variants.slice(0, 4)) {
      const d = await this.http.getJson<{ Results?: any[] }>(`${API}/SafetyRatings/VehicleId/${v.VehicleId}`);
      const r = d.Results?.[0];
      const stars = Number(r?.OverallRating);
      if (Number.isInteger(stars) && stars >= 1 && stars <= 5) return { stars, description: String(r.VehicleDescription) };
    }
    return null;
  }

  async decodeVin(vin: string): Promise<VinDecode> {
    const r = await this.http.getJson<{ Results?: any[] }>(`${VPIC}/DecodeVinValues/${encodeURIComponent(vin)}?format=json`, { ttlMs: 30 * 24 * 3600 * 1000 });
    const x = r.Results?.[0] ?? {};
    const codes = String(x.ErrorCode ?? "").split(",").map(s => s.trim());
    return {
      vin, ok: codes.includes("0") && Boolean(x.Make),
      year: Number(x.ModelYear) || undefined, make: x.Make || undefined, model: x.Model || undefined,
      errorText: codes.includes("0") ? undefined : String(x.ErrorText ?? ""),
    };
  }
}
