import type { ReviewedCluster } from "../scoring/types.ts";
import type { HttpClient } from "./http.ts";
import { McpHttpClient } from "./mcp.ts";

export const WRENCH_URL = "https://mcp.wrench.pro/mcp";
const THEFT = /theft|immobili[sz]er|anti-theft/i;

export type KnownIssues =
  | { mode: "reviewed"; clusters: ReviewedCluster[]; theftProne: boolean }
  | { mode: "raw" | "none"; clusters: []; theftProne: false }
  | { mode: "unavailable"; clusters: []; theftProne: false; detail: string };

export const slug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-");

export class WrenchClient {
  private readonly mcp: McpHttpClient;
  constructor(http: HttpClient, url = WRENCH_URL) { this.mcp = new McpHttpClient(url, http); }

  /**
   * Reviewed known-issue clusters. If Wrench doesn't recognize the model (e.g. a hybrid it only knows as the base
   * model), returns `unavailable` rather than substituting another model's issues.
   */
  async knownIssues(year: number, make: string, model: string): Promise<KnownIssues> {
    const res = await this.mcp.callTool("get_known_issues", { year: String(year), make: slug(make), model: slug(model) });
    if (typeof res !== "object" || res === null || res.error || !res.knownIssues) {
      const detail = typeof res === "string" ? res.slice(0, 200) : JSON.stringify(res?.error ?? res).slice(0, 200);
      return { mode: "unavailable", clusters: [], theftProne: false, detail };
    }
    const k = res.knownIssues;
    if (k.mode !== "reviewed") return { mode: k.mode === "raw" ? "raw" : "none", clusters: [], theftProne: false };
    const clusters: ReviewedCluster[] = (k.clusters ?? []).map((c: any) => ({
      label: String(c.label), componentCode: String(c.componentCode ?? ""), complaintCount: Number(c.complaintCount) || 0,
    }));
    return { mode: "reviewed", clusters, theftProne: clusters.some(c => THEFT.test(c.label) || THEFT.test(c.componentCode)) };
  }
}
