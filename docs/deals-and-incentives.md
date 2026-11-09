# Dealer Deals and Manufacturer Incentives

Dealers discount most when they need to move stock. This module finds those deals, works out the **effective price the buyer actually qualifies for**, and folds it into the deal score. It also flags ads where the headline price depends on rebates you may not qualify for.

## When deals happen (timing signals)

| Signal | Why it matters | How the skill uses it |
|---|---|---|
| **Year-end (Nov–Dec)** | Dealers chase monthly, quarterly and annual sales targets plus manufacturer volume bonuses. Holiday sales events (Black Friday, year-end events) bring manufacturer cash and APR programs. | When the run date is in Nov–Dec, query incentive sources for every candidate model and widen the new and CPO stretch search |
| **Month-end / quarter-end** | Same target pressure, on a shorter cycle | Note in the report, e.g. "Nov 30 is a month-end; Dec 31 is a year-end" |
| **Model-year changeover** | Outgoing-model-year new cars sit beside the next year's models and get bigger rebates | Flag new cars whose model year is older than the newest one on the lot |
| **Aged inventory** | Many dealers aim to sell used cars within roughly 60–90 days, then cut prices or send them to wholesale auction | Days on lot ≥ 60 plus price drops means negotiation leverage (OpenDealer `get_vehicle_history`, CarGurus listing detail, local snapshots) |
| **Program expiry** | Manufacturer programs run in fixed windows, often monthly, and are tied to a metro area | Record `valid_through`. If it ends within 14 days, add an "expires soon" note. Never invent dates. |

## What counts as a "deal"

| Type | Applies to | Source |
|---|---|---|
| Dealer discount (price below MSRP or below market) | New, used | Listing price vs. MSRP (Dealer-Direct `savings_vs_msrp_usd`, `below_msrp_only`) and vs. comps baseline |
| Manufacturer cash back | Mostly new | MarketCheck OEM Incentives (paid); manufacturer offer pages; Edmunds / TrueCar / CarsDirect incentive pages |
| Special APR (e.g. 0.9–3.9%) | New, and **CPO from manufacturer programs** | Same sources. Valued against the national average rate (OpenDealer `get_suggested_rates`) |
| Lease specials | New | Same sources. Reported but not scored, since the target buyer is purchasing. |
| Conditional rebates (military, college grad, loyalty, conquest, first responder) | New | Manufacturer pages. Applied **only** if the buyer profile says they qualify. |
| Dealer "specials" pages | New, used | Dealer site `/specials` pages via assisted browse (robots and ToS gated) |

## Effective price (what gets scored)

```
effective_price = advertised_price
                + mandatory_dealer_fees (doc, e-file, non-optional add-ons)   # normalize
                + conditional_rebates_baked_into_ad_that_buyer_lacks         # undo bait pricing
                − qualifying_cash_incentives_not_already_applied
                − pv_financing_savings   (only if buyer.payment == finance)
```

- `pv_financing_savings` is the present value of the payment difference between the promotional APR and the buyer's expected rate (the profile value, or else the national average from `get_suggested_rates`) over the promotional term. Cash buyers get $0. Manufacturer programs often make you choose **either** cash back **or** special APR. The engine evaluates both and picks the better option for this buyer.
- **Bait-price detection.** If the fine print says the price "includes all rebates", "requires dealer financing", "with trade-in" or "includes $X conquest/loyalty", flag `conditional_price`. Add back any rebate the buyer doesn't qualify for.

## Sanity checks (seen in live data, 2026-11-08)

Dealer feeds contain parsing errors. A Dealer-Direct record showed a new 2026 Jeep Cherokee "price $4,500" against a $42,815 MSRP: the internet-price field was misread, and the real price was $38,805. The engine must:

| Check | Action |
|---|---|
| New car price < 70% of MSRP | `price_data_suspect`: use the secondary price field if present, otherwise exclude from scoring and show it as "verify price" |
| Used car price < 50% of comps baseline | `price_data_suspect` (separate from `too_good_to_be_true`, which covers 25–50% below) |
| Incentive amount > 25% of MSRP | `incentive_data_suspect` |
| Two sources disagree on price by more than 10% | Show both. Score the higher one until confirmed. |

## Sources (see `config/sources.yaml`)

| Source | Mode | Cost | Coverage / notes |
|---|---|---|---|
| **Dealer-Direct MCP** `search_inventory` (`below_msrp_only`, `cpo_or_new_only`, itemized fees) | MCP | Free | ~1.0M vehicles, 3,450 dealers, 50 states (live check 2026-11-08). **Lead, counter-offer and reveal tools are blocked** (see SKILL.md). |
| **CarGurus MCP** `vehicle-listing-search` / `vehicle-listing-detail` | MCP (connected) | Free | National used and new; listing detail includes owners, accidents, salvage status and dealer rating |
| **OpenDealer MCP** `get_deal_score`, `get_vehicle_history`, `get_market_trends`, `get_market_velocity`, `get_suggested_rates` | MCP | Free | Excellent deal and days-on-lot tools, but a **small index** (~1,900 vehicles on 2026-11-08). Use it for rates and for vehicles it does carry. |
| **MarketCheck OEM Incentives** (`search_oem_incentives_by_zip`) | MCP / API | Paid | 30+ manufacturers, cash / APR / lease, metro-area level, validity dates. The best structured incentive feed. Optional. |
| Manufacturer offer pages: Toyota `/deals-incentives/`, Hyundai, Kia, Ford, Nissan, Mazda, Subaru | Assisted browse once ToS is reviewed; link-out until then | Free | robots.txt allows these paths (checked 2026-11-08). Toyota `/local-specials*` is **disallowed**. Honda and Chevrolet return Akamai "Access Denied", so link-out only. |
| Edmunds `/car-incentives/`, TrueCar `/deals/`, CarsDirect `/deals` | Link-out until ToS is reviewed | Free | robots.txt allows these paths. Their ToS generally restrict reuse, so cite and link, don't republish. |
| Dealer `/specials` pages | Assisted browse | Free | Per-dealer robots.txt check at runtime |

## What this means for the default $10–15k used-car search

- Manufacturer cash incentives rarely apply to used cars. The year-end gains in that range come from **aged-inventory price cuts and dealer motivation**. So the skill prioritizes days on lot, price-drop history and dealer specials pages.
- **CPO special APR** can make a $15–20k CPO car cheaper over the loan than a $14k non-CPO car, for financed buyers. The effective-price formula captures this.
- **New cars** enter only through the stretch rule. A new car around $25–30k with year-end cash qualifies only if it clears the "exceptional" bar in `scoring/scorecard.yaml`.
