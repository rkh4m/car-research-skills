# Legal, Ethical and Privacy Considerations

> This document sets project policy. It is not legal advice. Scraping law, data-licensing terms and consumer-protection rules vary and change. Get a qualified lawyer's opinion before enabling any new automated source or a commercial use.

## 1. Web access and scraping

| Topic | Project rule |
|---|---|
| **robots.txt** | Always checked before any automated page load, for the active user-agent token, falling back to `*`. A disallowed path means no fetch. If robots.txt is unreachable or behind a bot challenge, treat the site as disallowed. robots.txt is not by itself a contract, but it is the site's stated wish, and we honor it. |
| **Terms of Service** | Many marketplaces (e.g. Craigslist, Facebook) prohibit automated access in their ToS. A source may use `assisted_browse` only after a written ToS review marks it `ok` in `config/sources.yaml`. `pending` means link-out only. |
| **Technical barriers** | Never circumvent CAPTCHAs, bot challenges, rate limits, logins, paywalls or IP blocks. That means no CAPTCHA-solving services, proxy rotation, stealth or fingerprint plugins, or UA spoofing. Circumventing access controls can raise legal risk, for example under anti-hacking and anti-circumvention laws, beyond a contract dispute. |
| **Volume** | User-initiated, low-volume, rate-limited (see the policy engine). No background crawling, no scheduled polling of marketplaces, no bulk dataset building. |
| **Logged-in access** | Never log in on the user's behalf or reuse their session to scrape. |
| **Redistribution** | Don't republish listing content, photos, valuations (e.g. KBB) or deal ratings. Reports cite and link to the source; they don't mirror it. |
| **Prohibited targets** | NICB VINCheck, NMVTIS provider sites, salvage auctions (Copart, IAA) and any history-report vendor: guided link-out only, never automated. |

## 2. Vehicle data and history reports

- **History reports** (Carfax, AutoCheck, NMVTIS) are licensed to the purchaser. Never commit, upload or share them. Parse them locally and keep only the derived findings in the private report.
- **NMVTIS** is the federal title database. Use an approved provider through the official portal, and follow that provider's consumer terms.
- **Completeness disclaimer:** no source, free or paid, sees every accident, repair or title event. The report must say so.
- **Recalls** are issued per build range. Model-year recall data doesn't prove a specific VIN is affected or remedied. Only the VIN lookup or a dealer remedy record does.
- **Valuations and deal scores** are statistical estimates from asking prices, not appraisals or transaction prices.

## 3. Personal data and privacy

| Data | Rule |
|---|---|
| Buyer profile (ZIP, budget, needs) | Stored locally outside the repo or in git-ignored `data/`. Never sent anywhere except the minimum query parameters a source needs (e.g. ZIP + radius). |
| Private-seller info (names, phones, emails, addresses, faces or plates in photos) | Not stored. Stripped at extraction. Don't use it for anything beyond the user viewing the original listing. |
| Vehicle owner identity | **Never sought.** The Driver's Privacy Protection Act (DPPA) restricts personal information from state motor-vehicle records. The project doesn't do owner lookups, plate-to-owner lookups, or people searches. |
| VINs | Not personal data on their own, but VIN + location + time can identify a person. Keep run logs local and expire caches. |
| API keys (auto.dev, EIA, paid APIs) | Environment variables or the OS keychain only. Never in config files, URLs, logs or commits. CI runs a secret scan. |
| Telemetry | None. |

## 4. Agent action limits (authorization)

The agent must **not**, without explicit per-action approval from the user:

- contact sellers or dealers, submit lead forms, or click "check availability" or "get a quote"
- buy any report or make any paid API call
- create accounts, log in, or accept terms on the user's behalf
- schedule inspections or test drives

## 5. Consumer-protection context worth surfacing to users

- **FTC Used Car Rule:** dealers must post a Buyers Guide showing whether the car is sold "As Is" or with a warranty. The report should tell users to check it.
- **State lemon laws and dealer-fee rules** vary. The tool doesn't interpret them; point users to their state AG or DMV resources.
- **Branded titles** (salvage, rebuilt, flood) affect insurability, financing and resale value. That's why they are excluded by default.

## 6. Required disclaimers

Every shortlist report ends with:

> *This is research support, not a mechanical inspection, vehicle history guarantee, appraisal, or financial or legal advice. Data can be incomplete, stale or wrong. Verify title status, confirm open recalls for the specific VIN, and get an independent pre-purchase inspection before buying.*

The README and SKILL.md carry the short form.

## 7. Trademarks and affiliation

The project isn't affiliated with or endorsed by Carfax, Experian (AutoCheck), Cox Automotive (Autotrader, KBB), CarGurus, Cars.com, Edmunds, Carvana, TrueCar, CarMax, Craigslist, Meta, NICB, IIHS, NHTSA or any data provider. Names are used only to identify them. Don't use their logos.

## 8. Contribution rules

- PRs that add scrapers for `prohibited` or `pending` sources, evasion techniques, or owner-PII lookups are declined, whatever their technical quality.
- New sources need a `config/sources.yaml` entry with a robots snapshot, a ToS review note and rate limits.
- Tests must not hit live third-party sites in CI. Live smoke tests are opt-in and limited to government APIs.
