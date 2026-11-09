# Phase 1 — Landscape Research (snapshot 2026-11-08)

## Method

- **Search:** GitHub repository search via `gh` across ~55 queries and topics (car/vehicle/automotive MCP, VIN decoder, NHTSA/vPIC, recalls, listing scrapers for Cars.com / Autotrader / CarGurus / Craigslist / Facebook Marketplace / TrueCar / Carvana / AutoTempest, car-buying agents and skills, MarketCheck, CarsXE, Carfax, Edmunds, `topic:claude-skills`, `topic:used-cars`, `topic:vin-decoder`, `topic:nhtsa`). About 450 unique repos were screened, and 24 relevant candidates were pulled in full: metadata, README, file tree, open and closed issue counts, last commit.
- **Ranking:** `score = 100 × (0.30·popularity + 0.25·recency + 0.20·docs + 0.25·reliability)`
  - *popularity* = (log10(stars+1) + 0.5·log10(forks+1)) / 3.2, capped at 1
  - *recency* = 1.0 (≤3 mo since last commit), 0.8 (≤6), 0.6 (≤12), 0.3 (≤24), 0.1 (older), 0 (archived)
  - *docs* = reviewer judgment of the README and docs (0–1)
  - *reliability* = 0.4·min(test files/20, 1) + 0.3·(has CI) + 0.3·(closed ÷ total issues), with 0.15 neutral when there are no issues. Halved if archived.
- **Scope:** generic infrastructure (`microsoft/playwright-mcp`, 39k★; `apify/crawlee`, 26k★) is listed separately as dependencies and not ranked against domain repos.

## Headline findings

1. **The niche is young and thin.** No car-research repo has more than about 20 stars except VIN libraries and old Craigslist wrappers. Most agent skills here appeared in 2026. Nothing combines discovery, VIN, reliability, deal analysis and a scorecard in permissive-licensed TypeScript, so there is **no good fork target**.
2. **Free federal data is excellent and stable.** NHTSA vPIC, recalls, complaints and NCAP, plus EPA fueleconomy.gov, are keyless JSON APIs (all verified live 2026-11-08). Recalls include `parkIt` / `parkOutSide` flags, and complaints include crash, fire and injury flags.
3. **Listing data is the hard part.** Commercial APIs gate it: auto.dev's free tier allows 1,000 calls a month, and MarketCheck and CarsXE are paid. Major marketplaces block bots in robots.txt and with bot protection (see the robots.txt snapshot below).
4. **Two free MCP servers can be used as-is.** `whichtrim` (a remote server with NHTSA recalls, complaints with failure mileage, TSBs, investigations, NCAP and EPA, no key) and `auto-dev` (free-tier listings and VIN decode; already configured in this environment).
5. **Licensing traps.** Several of the most relevant repos have **no license**, which means all rights are reserved, so we can only reference their ideas, not reuse code. `hyacinth` is AGPL-3.0 and must not be copied into an MIT repo.

## Top 10 ranked comparison

| # | Repository | ★ / forks | Last commit | License | Type | Score |
|---|---|---|---|---|---|---|
| 1 | [cardog-ai/corgi](https://github.com/cardog-ai/corgi) | 332 / 35 | 2026-04-15 | ISC | TS library (offline VIN decoder on vPIC SQLite) | **80.9** |
| 2 | [Dropio12/used-car-deal-finder](https://github.com/Dropio12/used-car-deal-finder) | 15 / 2 | 2026-09-29 | **none** | Standalone system (Go crawler + Rust pricing + CF Worker) | **73.8** |
| 3 | [2scraper/autotrader-scraper](https://github.com/2scraper/autotrader-scraper) | 8 / 0 | 2026-11-02 | MIT | Playwright/Selenium scraper (Python) | **63.7** |
| 4 | [FrancoisChastel/OpenVIN](https://github.com/FrancoisChastel/OpenVIN) | 1 / 0 | 2026-08-29 | MIT | Client-side TS web app (free VIN history report) | **62.1** |
| 5 | [drivly/auto-dev-skill](https://github.com/drivly/auto-dev-skill) | 19 / 5 | 2026-08-20 | MIT | Agent skill + MCP (auto.dev API wrapper) | **61.6** |
| 6 | [DaizeDong/buy-me-a-car](https://github.com/DaizeDong/buy-me-a-car) | 12 / 3 | 2026-10-16 | MIT | Agent skill pack (16 skills, Python) | **61.0** |
| 7 | [ShaggyTech/nhtsa-api-wrapper](https://github.com/ShaggyTech/nhtsa-api-wrapper) | 40 / 12 | 2023-05-28 | MIT | TS API wrapper (vPIC) | **61.0** |
| 8 | [carsxe/carsxe-mcp-server](https://github.com/carsxe/carsxe-mcp-server) | 1 / 1 | 2026-10-26 | MIT | MCP server (paid CarsXE API) | **60.5** |
| 9 | [stephanlensky/hyacinth](https://github.com/stephanlensky/hyacinth) | 76 / 14 | 2024-06-19 | AGPL-3.0 | Discord bot polling Craigslist / FB Marketplace | **56.7** |
| 10 | [basit-khan-abdul/vehicle-safety-agent](https://github.com/basit-khan-abdul/vehicle-safety-agent) | 0 / 0 | 2026-07-24 | MIT | LLM agent (Claude + NHTSA + EU) with eval harness | **52.0** |

### Signal breakdown

| # | Repo | Popularity | Recency | Docs | Reliability | Tests / CI | Issues open / closed |
|---|---|---|---|---|---|---|---|
| 1 | corgi | 1.00 | 0.6 | 0.80 | 0.80 | 12 / ✓ | 3 / 18 |
| 2 | used-car-deal-finder | 0.45 | 1.0 | 0.70 | 0.85 | 22 / ✓ | 0 / 0 |
| 3 | autotrader-scraper | 0.30 | 1.0 | 0.85 | 0.51 | 3 / ✓ | 0 / 0 |
| 4 | OpenVIN | 0.09 | 1.0 | 0.90 | 0.65 | 10 / ✓ | 0 / 0 |
| 5 | auto-dev-skill | 0.53 | 1.0 | 0.85 | 0.15 | 0 / ✗ | 0 / 0 |
| 6 | buy-me-a-car | 0.44 | 1.0 | 0.95 | 0.15 | 0 / ✗ | 0 / 0 |
| 7 | nhtsa-api-wrapper | 0.68 | 0.1 | 0.75 | 0.92 | 32 / ✓ | 2 / 6 |
| 8 | carsxe-mcp-server | 0.14 | 1.0 | 0.85 | 0.57 | 6 / ✓ | 0 / 0 |
| 9 | hyacinth | 0.77 | 0.1 | 0.40 | 0.92 | 42 / ✓ | 12 / 33 |
| 10 | vehicle-safety-agent | 0.00 | 0.8 | 0.75 | 0.68 | 19 / ✓ | 6 / 0 |

### Per-repo detail

**1. cardog-ai/corgi** (TS library, npm `@cardog/corgi` 2.0.4)
- **Does:** offline VIN decoding on a compressed vPIC SQLite database, for Node, browser and Cloudflare D1. Includes validation, confidence and pattern diagnostics.
- **Limits / issues:** open issues report wrong results for an IC Bus VIN, an install failure on Node 24.13, and EU manufacturer coverage. No commit in about 7 months. The company pushes its paid Cardog API for market and recall data.
- **Use:** **depend on it** as the primary VIN decoder, with the live vPIC API as fallback and cross-check.

**2. Dropio12/used-car-deal-finder** (standalone system, Canada)
- **Does:** polls 6 Canadian sites every 5 minutes and compares each ad to comparable cars (same model, nearby year and km). It alerts when a car is ≥15% under baseline with ≥6 comps, and excludes parts cars and finance-only prices. Also runs AI photo checks for rust and dents.
- **Limits / issues:** **no license** (reference only). Canadian sources. Its 5-minute scraping of FB, Craigslist and CarGurus is a cadence we deliberately won't copy.
- **Use:** **reference** its baseline rule and exclusion list for deal scoring.

**3. 2scraper/autotrader-scraper** (Python, Playwright/Selenium/pyppeteer)
- **Does:** US Autotrader search and detail extraction (price, VIN, KBB fair price, deal rating).
- **Limits / issues:** documents real site quirks:
  - searches stop at 300 cars
  - unknown slugs silently widen the search
  - listed price includes dealer fees
  - paid placements are mixed into results
  - sold-car pages redirect
  - Akamai "page unavailable" blocks

  It also documents 2Captcha and proxy options, which **we will not adopt**.
- **Use:** **reference** for the quirks list and its distinct "blocked" exit code. Do not reuse its evasion features.

**4. FrancoisChastel/OpenVIN** (TS, static client-side MVP)
- **Does:** free VIN history from public APIs, with a coverage-disclosure panel (what was checked, what nobody can see). Guided link-outs to NMVTIS and NICB. Has a binding LEGAL.md with a prohibited-scraper list (NICB, Copart/IAAI, NMVTIS provider sites).
- **Limits / issues:** static MVP; the backend is only specced. Police-reported non-fatal accidents and dealer service records are structural gaps for every free tool.
- **Use:** **adapt** (MIT, with attribution) its source-coverage matrix, link-out pattern and legal guardrails.

**5. drivly/auto-dev-skill** (skill + MCP, `@auto.dev/sdk` 0.1.25)
- **Does:** natural-language access to auto.dev listings, VIN decode, photos, specs, recalls, TCO, payments and APR.
- **Limits / issues:** the free plan covers only listings, VIN decode and photos, capped at 1,000 calls/month. Recalls, TCO and specs need Growth ($299/mo). Per-call data fees apply on paid plans. No tests.
- **Use:** **configure** its MCP as the free-tier listing source. Already connected in this environment.

**6. DaizeDong/buy-me-a-car** (16-skill pack, Python)
- **Does:** covers the buying cycle: OTD calculator with state fee rules, CARFAX PDF review, CPO checks, dealer reply drafts, PPI scheduling, close-day checklist. Strong principles: keep unknowns visible, require authorization before external actions, keep buyer data in a private companion repo.
- **Limits / issues:**
  - the research report renderer outputs Chinese only
  - depends on the author's `fleet-guards` and `fleet-style` repos
  - no test files in the tree
  - verified OTD support is narrower than its state list

  It focuses on closing the deal, not on discovery or scoring.
- **Use:** **adapt** its principles and the carfax-pdf-review checklist. **Link to it** as the downstream "closing" companion rather than rebuilding OTD and dealer workflows.

**7. ShaggyTech/nhtsa-api-wrapper** (TS, npm 3.0.4)
- **Does:** typed vPIC client with good tests and CI.
- **Limits / issues:** unmaintained since May 2023. vPIC only: recall API support is an open issue from 2023.
- **Use:** **reference**. A thin in-house `fetch` client for the four NHTSA endpoints is simpler than taking a stale dependency.

**8. carsxe/carsxe-mcp-server** (remote MCP, paid)
- **Does:** VIN specs, history, market value, plate decode, recalls and more, via API key or OAuth.
- **Limits / issues:** needs an active paid subscription.
- **Use:** **optional paid adapter**, documented but off by default.

**9. stephanlensky/hyacinth** (Python Discord bot)
- **Does:** watches Craigslist and FB Marketplace searches and notifies on new posts.
- **Limits / issues:** stale (June 2024). Open issues include FB poll failures, geodata errors and slow notifications. AGPL-3.0.
- **Use:** **reference only.** Shows the maintenance burden of login-walled and anti-bot sources.

**10. basit-khan-abdul/vehicle-safety-agent** (Python agent)
- **Does:** cited safety briefs from NHTSA and EU data with a "grounding veto": it rejects answers citing campaigns not present in the tool results. Includes an offline regression eval harness.
- **Limits / issues:** 6 open self-filed harness bugs; EU parser can raise.
- **Use:** **adapt** the grounding-veto and eval-harness patterns for our report generator.

### Honorable mentions (highly relevant, low score from missing tests or stars)

| Repo | Type | Why it matters | Use |
|---|---|---|---|
| [BabbagesCabbages/whichtrim-mcp](https://github.com/BabbagesCabbages/whichtrim-mcp) (MIT, 2026-09) | Remote MCP (free, no key) | Recalls with do-not-drive flags and completion rates; complaints with failure mileage; TSBs; investigations; NCAP; EPA; MY2016+ | **Configure** as a reliability source; cross-check against NHTSA direct |
| [Christophertdoc/nhtsa-mcp](https://github.com/Christophertdoc/nhtsa-mcp) (no license) | Python MCP, 20 tools, 31 test files | Good model of TTL cache, rate limiting and input validation for NHTSA | Reference only |
| [jakehu2937/used-car-research-skill](https://github.com/jakehu2937/used-car-research-skill) (no license) | TS Codex skill + local app | Cost gate before paid calls; valuation by VIN dedupe, MAD outlier removal, weighted median, P25–P75 | Reference the method only |
| [K0rsantan/vehicle-pricing](https://github.com/K0rsantan/vehicle-pricing) (no license) | Claude skill | Deal-quality playbook across CarGurus, AutoTempest, KBB | Reference only |
| [MarketcheckHub/marketcheck-cowork-plugin](https://github.com/MarketcheckHub/marketcheck-cowork-plugin) (no license) | Plugin, 75 skills (paid API) | Richest listing and price history, if you ever go paid | Optional paid integration |
| [juliomalegria/python-craigslist](https://github.com/juliomalegria/python-craigslist) / [brozeph/node-craigslist](https://github.com/brozeph/node-craigslist) | Wrappers | Last commit 2021; open issues report IP blocks and a 120-result cap | Avoid |
| [passivebot/facebook-marketplace-scraper](https://github.com/passivebot/facebook-marketplace-scraper) (406★) | Playwright script | **Archived**; login wall; "getting blocked" issues | Avoid |

### Infrastructure dependencies (not ranked)

| Repo | Use |
|---|---|
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp): 39k★, Apache-2.0, `@playwright/mcp` 0.0.84 (2026-11-03) | Browser automation for agent-assisted browsing. Already installed at user scope. |
| [apify/crawlee](https://github.com/apify/crawlee): 26k★, Apache-2.0 | **Not recommended** for this project. Built for crawling at scale, which conflicts with our user-paced policy. |

## Recommendation: fork vs adapt vs reference

| Decision | Repos | Why |
|---|---|---|
| **Fork** | *None* | No candidate matches the scope, language and license together. Forking buy-me-a-car would bring in Python, a Chinese-only renderer and private dependencies. Forking scrapers would bring in evasion code. |
| **Depend on** | `@cardog/corgi`, `@playwright/mcp`, (optional) `@auto.dev/sdk` | Maintained, permissive, TypeScript-native |
| **Configure as MCP** | `whichtrim` (free), `auto-dev` (free tier), `playwright` | No code to maintain. Free. |
| **Adapt with attribution (MIT)** | OpenVIN (coverage matrix, legal list), buy-me-a-car (principles, CARFAX checklist), vehicle-safety-agent (grounding veto, evals), 2scraper (quirks doc only) | Proven ideas, compatible license |
| **Reference only** | used-car-deal-finder, used-car-research-skill, nhtsa-mcp (Christophertdoc), hyacinth | No license or AGPL. Learn from them, don't copy. |
| **Avoid** | CAPTCHA and proxy-rotation patterns; archived FB scraper; stale Craigslist wrappers | Legal and ethical risk, and constant breakage |

## Addendum: hosted MCP servers for car search and deals (checked 2026-11-08)

Sources: the Claude connector directory, the official MCP Registry (`registry.modelcontextprotocol.io`) and GitHub. Each server's tool list was pulled live, and listing servers were test-queried.

| Server | Endpoint | Cost | What it gives us | Verdict |
|---|---|---|---|---|
| **CarGurus** (official connector) | `mcp-apps.api.cargurus.com/chat-mcp/v1/stream` | Free | NL listing search (≤20/call) + detail with VIN, owners, accidents, salvage, dealer rating | **Primary** (already connected) |
| **Dealer-Direct** | `dealer-direct-mcp.web.app/mcp` | Free | ~1.0M vehicles, 3,450 dealers, 50 states; itemized fees, MSRP savings, `below_msrp_only` | **Primary.** Block its lead and counter-offer tools. Sanity-check prices (a misparsed $4,500 new Jeep was seen in testing). |
| **OpenDealer** | `mcp.opendealer.app/rpc` | Free | 27 tools: deal score, price history, days on lot, market trends and velocity, suggested APR, recalls, NCAP | **Secondary.** Great analytics, but the index is tiny (~1,900 vehicles; zero used Civics near NYC). |
| **MarketCheck** (official) | `mc-api.marketcheck.com/mcp` (+ free docs MCP) | Paid | Listings, price prediction, history, **OEM incentives by ZIP/MSA** | Optional paid. Best structured incentive feed. |
| auto.dev | local `auto --mcp` | Free tier | Listings + VIN decode, 1,000 calls/mo | Secondary |
| Wrench.Pro | `mcp.wrench.pro/mcp` | Free tier | Reviewed known issues, maintenance cost ranges, recalls | **Use** for reliability and TCO |
| WhichTrim / NHTSA safety (cyanheads) | remote | Free | Recalls, complaints, investigations, TSBs, NCAP | **Use** (one primary, one cross-check) |
| vehicle-recalls (zovo) | `vehicle-recalls.zovo.one/mcp` | Free | Batch decode + model-year recalls (≤50 VINs) | **Use** for batch triage. Not VIN-level remedy status. |
| CarsXE | `mcp.carsxe.com/mcp` | Paid | Specs, history, market value | Optional |
| Cars.com via Apify proxy (thenextgennexus) | Apify | Apify account | Cars.com listings | **Avoid** (unofficial scraping of a bot-protected site) |
| Facebook Marketplace MCPs (e.g. jdcodes1, 497★) | local | Free | FB listings using **your browser session cookies** | **Avoid** (ToS violation; account risk) |
| Craigslist MCPs | local | Free | CL listings | **Avoid** (ToS) |
| Copart/IAA auction MCPs (autocarena, apibara) | remote | — | Salvage auctions, bidding | **Avoid** (conflicts with the branded-title gate) |

There are **no official MCP servers** for Autotrader, Cars.com, Edmunds, CarMax, Carvana, TrueCar or KBB as of this check. Those stay as link-outs.

## robots.txt snapshot (generic `*` group, fetched 2026-11-08)

| Site | Search/listing pages for `*` | Notes |
|---|---|---|
| CarGurus | **Disallowed** (`/Cars/search`, `/Cars/inventorylisting/`, `/Cars/api/`) | Link-out only |
| Autotrader | **Disallowed** (`/cars-for-sale/all-cars`, `vehicledetails.xhtml`) | Has a **`Claude-User` group** that disallows only `srp-dark`, `vehicle-dark`, `*.js`. Agent-initiated browsing on a user's request is treated differently. ToS review still required. |
| Edmunds | **Disallowed** (`/inventory/srp.html?*`, `/used-cars-for-sale/i/*`, `/api/`, `*/vin/*`) | `GPTBot: Disallow: /` |
| Carvana | **Disallowed** (`/inventory/`, `/search/`, `/api/`) | Link-out only |
| TrueCar | **Disallowed** (`/used-cars-for-sale/listing/*`, `/used/`, `/api/`) | Link-out only |
| KBB | Mostly allowed; `/*?listingid=` and `*/recall*vin=` disallowed | Values for reference only; respect ToS |
| Cars.com | **robots.txt itself returns a Cloudflare challenge (403)** | Treat as blocked |
| CarMax | **robots.txt returns 403** | Treat as blocked |
| Craigslist | Permissive robots | **ToS prohibits automated access.** Link-out or user-pasted URLs only. |
| AutoTempest | No rules; asks to respect `noindex` and `X-Robots-Tag` | Aggregator. Prefer link-out. |
