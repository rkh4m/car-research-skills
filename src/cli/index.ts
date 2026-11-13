#!/usr/bin/env -S npx tsx
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parse as parseYaml } from "yaml";
import { EpaClient } from "../clients/epa.ts";
import { HttpClient } from "../clients/http.ts";
import { NhtsaClient } from "../clients/nhtsa.ts";
import { WrenchClient } from "../clients/wrench.ts";
import { enrichCandidates } from "../enrich/enrich.ts";
import { fromAutoDev, fromCarGurus, fromDealerDirect } from "../listings/adapters.ts";
import { buildCandidates } from "../listings/pipeline.ts";
import { scoreCandidates } from "../scoring/engine.ts";
import { DEFAULT_SALES_PATH, loadSalesTable } from "../scoring/sales.ts";
import { DEFAULT_SCORECARD_PATH, loadScorecard } from "../scoring/scorecard.ts";
import type { ScoreResult } from "../scoring/types.ts";

const USAGE = `Usage:
  car-research normalize --origin <lat,lng> --radius <mi> [--cargurus <file.json>]... [--dealer-direct <file.json>]... [--auto-dev <file.json>]... [--auto-dev-fee <usd>] [--date YYYY-MM-DD] --out <candidates.json>
  car-research enrich --candidates <in.json> --out <out.json> [--date YYYY-MM-DD] [--cache-dir data/cache] [--no-wrench]
  car-research score --candidates <file.json> --profile <profile.yaml> --fuel <usd/gal> --apr <percent>
                     [--date YYYY-MM-DD] [--scorecard <scorecard.yaml>] [--sales <us-sales.yaml> | --no-sales] [--out <result.json>]`;

const fail = (): never => { console.error(USAGE); process.exit(2); };
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const line = (r: ScoreResult, i: number) => {
  const v = r.vehicle;
  return [`${String(i + 1).padStart(2)}.`, r.overall.toFixed(1).padStart(5), `c=${r.confidence.toFixed(2)}`,
    `${v.year} ${v.make} ${v.model}${v.trim ? ` ${v.trim}` : ""}`, money(v.price), `${v.mileage.toLocaleString()} mi`,
    r.tco ? `5yr ${money(r.tco.total)}${r.tco.monthlyPayment !== null ? ` (${money(r.tco.monthlyPayment)}/mo)` : ""}` : "",
    r.stretch ? "STRETCH" : "", r.flags.length ? `flags: ${r.flags.join(", ")}` : ""].filter(Boolean).join("  ");
};
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

const normalize = (args: string[]) => {
  const { values } = parseArgs({ args, options: {
    origin: { type: "string" }, radius: { type: "string" }, cargurus: { type: "string", multiple: true },
    "dealer-direct": { type: "string", multiple: true }, date: { type: "string" }, out: { type: "string" },
    "auto-dev": { type: "string", multiple: true }, "auto-dev-fee": { type: "string" },
  } });
  const [lat, lng] = (values.origin ?? "").split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !values.radius || !values.out) fail();
  const observedAt = values.date ?? new Date().toISOString().slice(0, 10);
  const raws = [
    ...(values.cargurus ?? []).flatMap(f => fromCarGurus(readJson(f), observedAt)),
    ...(values["dealer-direct"] ?? []).flatMap(f => fromDealerDirect(readJson(f), observedAt)),
    ...(values["auto-dev"] ?? []).flatMap(f => fromAutoDev(readJson(f), observedAt, Number(values["auto-dev-fee"] ?? 0))),
  ];
  const b = buildCandidates(raws, { origin: { lat: lat!, lng: lng! }, radiusMi: Number(values.radius) });
  writeFileSync(values.out!, JSON.stringify(b.candidates, null, 2));
  const dropReasons = b.dropped.reduce<Record<string, number>>((m, d) => ({ ...m, [d.reason]: (m[d.reason] ?? 0) + 1 }), {});
  const withBaseline = [...b.baselines.values()].filter(Boolean).length;
  console.log(`raw ${raws.length} → kept ${b.listings.length} (merged ${b.mergedCount} duplicates; dropped ${JSON.stringify(dropReasons)})`);
  console.log(`price model: ${(b.priceModel.perTenKMiles * 100).toFixed(1)}%/10k mi, ${(b.priceModel.perModelYear * 100).toFixed(1)}%/model year (${b.priceModel.fitted ? `fitted on ${b.priceModel.n}` : "defaults"})`);
  console.log(`baselines: ${withBaseline}/${b.listings.length} listings have ≥3 comps`);
  console.log(`wrote ${values.out}`);
};

const enrich = async (args: string[]) => {
  const { values } = parseArgs({ args, options: {
    candidates: { type: "string" }, out: { type: "string" }, date: { type: "string" },
    "cache-dir": { type: "string" }, "no-wrench": { type: "boolean" },
  } });
  if (!values.candidates || !values.out) fail();
  const http = new HttpClient({
    cacheDir: values["cache-dir"] ?? "data/cache",
    minIntervalMs: { "api.nhtsa.gov": 350, "vpic.nhtsa.dot.gov": 350, "www.fueleconomy.gov": 150, "mcp.wrench.pro": 300 },
  });
  const r = await enrichCandidates(readJson(values.candidates!), {
    nhtsa: new NhtsaClient(http), epa: new EpaClient(http), wrench: values["no-wrench"] ? undefined : new WrenchClient(http),
  }, { runDate: values.date ? new Date(`${values.date}T12:00:00Z`) : new Date() });
  writeFileSync(values.out!, JSON.stringify(r.candidates, null, 2));
  const n = r.candidates.length;
  const count = (f: (c: typeof r.candidates[number]) => unknown) => r.candidates.filter(f).length;
  console.log(`enriched ${n}: reliability ${count(c => c.reliability)}, reviewed issues ${count(c => c.reliability?.reviewedClusters)}, NCAP ${count(c => c.safety?.ncapOverall)}, mpg ${count(c => c.mpg)}, VIN checks ${count(c => c.vinCheck)} (${http.requests} network requests)`);
  if (r.fuelPricePerGal) console.log(`fuel: $${r.fuelPricePerGal}/gal national regular (fueleconomy.gov) — pass as --fuel to score`);
  for (const note of r.notes) console.log(`note: ${note}`);
  console.log(`wrote ${values.out}`);
};

const score = (args: string[]) => {
  const { values } = parseArgs({ args, options: {
    candidates: { type: "string" }, profile: { type: "string" }, fuel: { type: "string" }, apr: { type: "string" },
    date: { type: "string" }, scorecard: { type: "string" }, out: { type: "string" },
    sales: { type: "string" }, "no-sales": { type: "boolean" },
  } });
  if (!values.candidates || !values.profile || !values.fuel || !values.apr) fail();
  const sc = loadScorecard(values.scorecard ?? DEFAULT_SCORECARD_PATH);
  const result = scoreCandidates(sc, readJson(values.candidates!), parseYaml(readFileSync(values.profile!, "utf8")), {
    runDate: values.date ? new Date(`${values.date}T12:00:00Z`) : new Date(),
    fuelPricePerGal: Number(values.fuel),
    defaultAprPercent: Number(values.apr),
    salesTable: values["no-sales"] ? undefined : loadSalesTable(values.sales ?? DEFAULT_SALES_PATH),
  });
  console.log(`Shortlist (${result.shortlist.length}):`);
  result.shortlist.forEach((r, i) => console.log(line(r, i)));
  const notShort = result.ranked.filter(r => !result.shortlist.includes(r));
  if (notShort.length) {
    console.log(`\nNot shortlisted (${notShort.length}):`);
    for (const r of notShort) console.log(`    ${r.vehicle.year} ${r.vehicle.make} ${r.vehicle.model} (${r.vehicle.id}) — ${[...r.gates, ...r.blockers].join("; ") || "ranked below shortlist size"}`);
  }
  if (values.out) { writeFileSync(values.out, JSON.stringify(result, null, 2)); console.log(`\nFull results: ${values.out}`); }
};

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "normalize") normalize(rest);
else if (cmd === "enrich") await enrich(rest);
else if (cmd === "score") score(rest);
else fail();
