# car-research-skills

> Agent skills that research used cars the way a careful buyer would. They find listings, check each VIN against free federal data, judge reliability and deal quality, and narrow everything to a scored, explained shortlist. Free sources come first, paid sources are optional, and nothing is scraped behind your back.

**Status:** v0.0. The scoring engine works and is tested; data adapters are planned. US only. TypeScript / Node 20+.

> ⚠️ **Not professional advice.** Output is research support, not a mechanical inspection, vehicle history guarantee, or financial/legal advice. Always get an independent pre-purchase inspection (PPI) and verify title status before buying. See [docs/legal-ethics-privacy.md](docs/legal-ethics-privacy.md).

## What it does

| Capability | Free sources (default) | Optional paid |
|---|---|---|
| Listing discovery | CarGurus MCP (official), Dealer-Direct MCP (~1M dealer-feed vehicles), auto.dev MCP (free tier), OpenDealer MCP; assisted browsing of sites whose robots.txt and ToS allow it; prefilled search link-outs for the rest | MarketCheck, CarsXE |
| Dealer deals and incentives | Below-MSRP and itemized-fee data (Dealer-Direct), days on lot and price drops (OpenDealer, CarGurus), dealer specials pages, manufacturer offer link-outs, year-end timing signals | MarketCheck OEM incentives (cash, APR, lease by ZIP) |
| VIN decode and validation | `@cardog/corgi` (offline vPIC), NHTSA vPIC API | — |
| Recalls, complaints, investigations, TSBs | NHTSA APIs, WhichTrim MCP | — |
| Title, theft and history | Dealer-provided free Carfax/AutoCheck links; guided NICB VINCheck and NHTSA VIN recall lookups (you click them) | NMVTIS report (~$3–10), Carfax / AutoCheck |
| Safety ratings | NHTSA NCAP API; IIHS link-out | — |
| Total cost of ownership | fueleconomy.gov, EIA fuel prices, transparent maintenance and insurance estimate bands | Insurance quotes (manual) |
| Deal quality | Comparable listings baseline, mileage adjustment, days on market, price-drop history, regional variance | MarketCheck price history |
| Scorecard and shortlist | [`scoring/scorecard.yaml`](scoring/scorecard.yaml) with hard gates, weights, confidence | — |

## Repository structure (target)

```text
car-research-skills/
├── skills/                         # Agent instruction modules (SKILL.md each)
│   ├── car-research/               # Orchestrator: intake → shortlist
│   │   └── SKILL.md
│   ├── listing-search/             # (M3) API/MCP search, assisted browsing, link-outs
│   ├── vin-check/                  # (M1) decode, validate, recalls, guided history checks
│   ├── reliability/                # (M5) complaints, TSBs, investigations, forum evidence grading
│   ├── deal-evaluator/             # (M4) comps baseline, mileage adj., DOM, price drops
│   ├── tco-estimator/              # (M5) fuel, insurance band, maintenance, depreciation
│   └── history-report-review/      # (M8) review a user-supplied Carfax/AutoCheck PDF
├── mcp-configs/                    # Ready-to-merge MCP server configs
│   └── mcp.example.json
├── config/
│   ├── buyer-profile.example.yaml  # Budget, ZIP, radius, needs (copy to a private location)
│   └── sources.yaml                # Source registry: access mode, robots/ToS status, limits
├── scoring/
│   ├── scorecard.yaml              # Weights, gates, thresholds, profiles
│   └── schema/                     # (M2) Zod/JSON Schemas: Listing, VehicleRecord, ScoreCard
├── src/                            # (M1+) TypeScript library used by skills and scripts
│   ├── clients/                    # ✅ http (pacing/retry/cache), nhtsa + vpic, fueleconomy, wrench (MCP), VIN check digit
│   ├── enrich/                     # ✅ fills reliability, safety, mpg, VIN checks per model-year
│   ├── policy/                     # robots evaluator, per-domain rate limiter, challenge detector
│   ├── listings/                   # ✅ adapters (CarGurus, Dealer-Direct), normalizer, dedupe, comps baseline
│   ├── scoring/                    # ✅ gates, criteria, TCO, confidence, budget rule, shortlist
│   ├── cli/                        # ✅ `car-research score`
│   └── report/                     # shortlist markdown/HTML renderer with citations
├── playwright-scripts/             # (M3) Assisted-browse extractors (allowed sources only)
├── examples/                       # Synthetic buyer scenarios + expected shortlists
├── tests/                          # Fixture-based unit tests (no network) + opt-in live smoke tests
└── docs/
    ├── architecture.md
    ├── deals-and-incentives.md
    ├── field-notes/                # Lessons from live runs (no buyer data)
    ├── implementation-plan.md
    ├── legal-ethics-privacy.md
    └── research/landscape-2026-11.md
```

Items marked (Mx) are planned milestones. See [docs/implementation-plan.md](docs/implementation-plan.md).

## Quick start

1. Install the MCP servers in [`mcp-configs/mcp.example.json`](mcp-configs/mcp.example.json).
2. Copy `config/buyer-profile.example.yaml` somewhere **outside** the repo and fill it in.
3. Load `skills/car-research/SKILL.md` into your agent and ask, for example: *"Find me a reliable used sedan near 22030, $10–15k, about 12k miles a year."*

### Scoring engine

```bash
npm install
npm run check
```

`npm run check` typechecks and runs the tests. To turn saved MCP payloads into candidates with comps baselines:

```bash
npx tsx src/cli/index.ts normalize --origin 38.91,-77.04 --radius 75 --cargurus cg-detail.json --dealer-direct dd.json --out candidates.json
```

To fill in reliability (NHTSA complaints/recalls and Wrench.Pro reviewed issues), NCAP, EPA mpg and VIN checks:

```bash
npx tsx src/cli/index.ts enrich --candidates candidates.json --out enriched.json
```

Responses are cached for 24h in git-ignored `data/cache`. `npm run smoke:live` checks the clients against the real APIs.

To score candidates:

```bash
npx tsx src/cli/index.ts score --candidates examples/candidates.synthetic.json --profile config/buyer-profile.example.yaml --fuel 4.15 --apr 8.5
```

- **Input:** enriched `VehicleRecord`s ([`src/scoring/types.ts`](src/scoring/types.ts)).
- **Rules:** come from [`scoring/scorecard.yaml`](scoring/scorecard.yaml). Weights, bands and thresholds are read from it, and its gate and modifier conditions run through a small evaluator ([`src/scoring/expr.ts`](src/scoring/expr.ts)).
- **Pass `--fuel` and `--apr` yourself.** They change daily and come from adapters, not the profile.

## Design principles

1. **Unknown stays unknown.** Missing accident data never becomes "accident-free." Unknowns lower a car's confidence score, not its rating.
2. **Evidence is cited and dated.** Every score cites a source, the date it was retrieved, and how fresh it is.
3. **Respect the sites we touch.** The agent checks robots.txt first, makes one page request at a time with delays, never solves CAPTCHAs, never rotates proxies, and never logs in for you. When a site says no, it gives you a link instead.
4. **The buyer stays in control.** The agent never contacts sellers, fills in forms or spends money.
5. **Private data stays private.** Buyer profiles, VIN lists and reports stay in local, git-ignored storage.

## Acknowledgements

Design informed by [OpenVIN](https://github.com/FrancoisChastel/OpenVIN) (MIT), [buy-me-a-car](https://github.com/DaizeDong/buy-me-a-car) (MIT), [vehicle-safety-agent](https://github.com/basit-khan-abdul/vehicle-safety-agent) (MIT) and [corgi](https://github.com/cardog-ai/corgi) (ISC). See the [landscape research](docs/research/landscape-2026-11.md).

## License

[MIT](LICENSE).
