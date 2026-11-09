# Implementation Plan

**Ordering principle:** build value from the most stable and lowest-risk sources first.

1. Free federal data and the scoring engine are useful even with zero automated listing search. The user can paste VINs or URLs and still get a scored shortlist.
2. Listing automation comes later, because it carries the most legal and maintenance risk.

Stack: TypeScript, Node 22+, npm workspaces, `vitest`, `zod`, `yaml`, `@cardog/corgi`, and `@playwright/mcp` (runtime, via MCP). There is no Python.

| Milestone | Scope | Exit criteria | Est. |
|---|---|---|---|
| **M0: Bootstrap** | Repo, MIT license, CONTRIBUTING, CODE_OF_CONDUCT, `docs/legal-ethics-privacy.md`, CI (lint, typecheck, test, secret scan), `.gitignore` for `data/`, profiles and reports | CI green on an empty package; branch protection on | 2–3 days |
| **M1: VIN and safety core (free)** | `src/clients/`: vPIC, NHTSA recalls/complaints/NCAP, fueleconomy.gov, EIA. VIN check-digit validation; corgi decode with vPIC cross-check. TTL cache and per-host rate limiter. `npx car-research vin <vin>` | Fixture tests with no network; opt-in `npm run smoke:live` passes against the real APIs; decode agrees with vPIC on 50 sample VINs | 1 week |
| **M2: Scoring engine** | Zod schemas (`Listing`, `VehicleRecord`, `ScoreResult`); load and validate `scorecard.yaml` (weights sum to 100); gates, criteria, modifiers, confidence, budget rule; per-criterion explanations. `npx car-research score` | Golden tests: 12 synthetic cars with expected gate, score and confidence outcomes, including every gate and the stretch rule | 1 week |
| **M3: Discovery and policy engine** | `src/policy/`: robots.txt evaluator for the UA-token group, ToS registry, token bucket, challenge detector, PII stripper. Adapters: auto.dev MCP and dealer-site JSON-LD. Link-out URL builders for Tier 3. Normalizer and dedupe-by-VIN | Policy unit tests (disallowed path → refusal, challenge page → domain stop, 429 → backoff); recorded-fixture extractor tests; no live scraping in CI | 2 weeks |
| **M4: Deal evaluator and incentives** | Comps selection, MAD outlier removal, weighted median and P25–P75, mileage regression with fallback, fee normalization, days on market and price drops from a local snapshot store, regional variance. Effective-price engine (fees, conditional-rebate add-back, qualifying incentives, financing-deal present value); price and incentive sanity checks; year-end and aged-inventory notes; CarGurus and Dealer-Direct adapters with blocked-tool enforcement | Synthetic comp sets reproduce expected baselines within 1%; "too good to be true", low-comp, misparsed-price (the $4,500 Cherokee case) and conditional-rebate paths covered | 1.5 weeks |
| **M5: Reliability and TCO** | Complaint severity normalization vs. cohort; component share; WhichTrim TSB and investigation lookup; forum evidence-grading rubric (A/B/C); TCO model with labeled assumptions | Cohort-ranking tests; every TCO line in the report shows its inputs | 1–1.5 weeks |
| **M6: Skills and report** | Finalize the orchestrator `SKILL.md` and split it into module skills; shortlist report renderer (Markdown + HTML) with citations and a coverage panel; grounding veto (claims must come from tool output); 6 example scenarios | Eval harness: the agent run on the scenarios passes rubric checks (no uncited recall IDs, unknowns never shown as "clean", disclaimer present, no disallowed fetches in the logs) | 1.5 weeks |
| **M7: Hardening and v0.1.0 release** | Security review, dependency audit, docs pass, README demo using synthetic data, tag v0.1.0, publish to skills registries | Fresh-clone install works in under 5 minutes; all checks green | 3–4 days |
| **M8 (optional): Paid adapters** | MarketCheck and CarsXE adapters behind `paid_sources_enabled` plus a per-call cost-approval gate; `history-report-review` skill for user-supplied Carfax/AutoCheck PDFs; NMVTIS guided flow | A paid call is impossible without explicit approval (tested); PDFs are never written outside private storage | 1–2 weeks |

**Total to v0.1.0:** about 9–10 weeks part-time, or 4–5 weeks full-time.

## Prioritized backlog (top 10)

**Added after the first live run** ([field notes](field-notes/2026-11-first-live-run.md)). These come first because a working prototype already exists:

- **A. ✅ Done (2026-11-08).** Ported the prototype scorer to `src/scoring/`:
  - Scorecard loader (Zod-validated, weights must sum to 100) and a YAML condition evaluator.
  - Engine with gates, sanity checks, all 10 criteria, TCO with repair reserve and theft multiplier, confidence, the stretch rule and shortlist slots.
  - `car-research score` CLI.
  - 25 tests (node:test via tsx), including the live-run cases: frame-damaged "bargain", cheap failure-prone car, ex-rental "new" car, misparsed $4,500 new-car price, 297-day aged inventory.

  Still pending: the comps baseline (M4) is an *input* (`market.baseline`), not computed yet.
- **B. ✅ Done (2026-11-08).** `src/listings/`:
  - **Adapters** for CarGurus (detail + search payloads) and Dealer-Direct. They drop a price field below half of MSRP.
  - **Normalizer:** recomputes distance from coordinates and flags source distances that disagree; applies the radius filter (unknown distance is kept but flagged); reclassifies "new" cars with miles as used; dedupes on VIN, else year + family + mileage within 5; resolves price conflicts.
  - **Comps:** a pooled log-price model (mileage and model-year sensitivity, with fallbacks); per-listing comps adjusted to the target car; MAD outlier removal; weighted-median baseline with a P25–P75 band; window widening when comps are thin.
  - **Pipeline and CLI:** `buildCandidates` and the `car-research normalize` command.
  - **Tests:** 21 new (46 total), including an end-to-end raw-payload → shortlist test.

  Still pending: `priceDrops` isn't populated (needs snapshot history); auto.dev adapter.
- **C. ✅ Done (2026-11-08).** Reference-data clients and an enrich step:
  - **`src/clients/`:**
    - `HttpClient`: per-host pacing, bounded retries honoring Retry-After, 24h memory + disk cache in git-ignored `data/cache`.
    - `NhtsaClient`: complaints, recalls with park-it/fire counts, NCAP preferring the sedan, vPIC decode.
    - VIN check digit.
    - `EpaClient`: best-mpg option, sedan preferred over coupe/hatch, hybrids matched only to hybrids; fuel price.
    - Minimal MCP client and `WrenchClient` for reviewed clusters and the theft flag. An unknown model returns `unavailable`, never a substitute.
  - **`src/enrich/`:** one fetch set per model-year. Input fields win. Source failures become notes, never guesses.
  - **CLI:** `car-research enrich`.
  - **Tests:** 22 new offline tests (68 total) plus `npm run smoke:live` (5 live checks).
  - **Found by the live run:** NHTSA answers HTTP 400 with an empty result list for zero recalls. It's handled, with a regression test.

1. Policy engine: robots evaluator and challenge detector (blocks everything in M3; write it first).
2. VIN validate and decode CLI (immediately useful on its own).
3. Scorecard loader with weight validation and golden tests.
4. NHTSA recalls with `parkIt`/`parkOutSide` gate wiring.
5. Model-year pre-screen (reliability, safety, TCO), so listing-API calls aren't spent on bad model years.
6. auto.dev listing adapter with a call budget.
7. Comps baseline and deal score.
8. Shortlist report with coverage panel and disclaimer.
9. Dealer JSON-LD extractor (the first assisted-browse source).
10. Link-out URL builders for the Tier 3 marketplaces.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| The auto.dev free tier changes or is too small | Adapter interface lets you swap in MarketCheck; dealer JSON-LD and user-pasted URLs still work |
| WhichTrim disappears or goes stale | NHTSA direct clients are the source of record; WhichTrim is a convenience layer |
| Site structure changes break extractors | Prefer JSON-LD; recorded-fixture tests; extractor failure falls back to a link-out, never to aggressive retries |
| Complaint counts are biased by sales volume | Rank against the cohort; label it; let the user supply a CR-style rating |
| LLM invents recall numbers or history facts | Grounding veto in the report renderer, plus eval checks |
| Legal or ToS exposure | Registry defaults to link-out; `pending` ToS never auto-enables browsing; see `legal-ethics-privacy.md` |
