import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";

const Era = z.tuple([z.number().int(), z.number().int(), z.number().positive()]);
export const SalesTableSchema = z.object({
  models: z.array(z.object({ make: z.string(), model: z.string(), eras: z.array(Era).min(1) })),
});
export type SalesTable = z.infer<typeof SalesTableSchema>;

export const DEFAULT_SALES_PATH = fileURLToPath(new URL("../../scoring/us-sales.yaml", import.meta.url));

export const parseSalesTable = (yamlText: string): SalesTable => SalesTableSchema.parse(parse(yamlText));
export const loadSalesTable = (path = DEFAULT_SALES_PATH): SalesTable => parseSalesTable(readFileSync(path, "utf8"));

/** "MAZDA3", "Mazda 3" and "mazda3" all match; so do "Camry Hybrid" and "CAMRY HYBRID". */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Approximate annual US sales for a model year, or undefined when the table doesn't cover it. */
export const salesFor = (table: SalesTable | undefined, make: string, model: string, year: number): number | undefined => {
  if (!table) return undefined;
  const mk = norm(make), md = norm(model);
  const row = table.models.find(m => norm(m.make) === mk && norm(m.model) === md);
  return row?.eras.find(([from, to]) => year >= from && year <= to)?.[2];
};
