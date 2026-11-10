# Field Notes: First Live Run (2026-11-08)

The orchestrator workflow was run end to end for a real buyer: used sedans and high-mpg cars, a $10–15k target, financed with a down payment, new cars only if exceptional. The engine was a throwaway JavaScript prototype of `scoring/scorecard.yaml`. Buyer details and the shortlist are private and not included here.

## What the run looked like

| Stage | Result |
|---|---|
| Model-year pre-screen | ~110 model-years pulled from NHTSA complaints/recalls (free, no key, about 3 minutes at 350 ms pacing) |
| Discovery | 11 CarGurus searches (≤20 results each) + Dealer-Direct bulk pull → **106 local listings** after the distance filter and dedupe |
| Gates | 62 eligible; all 44 exclusions were the 130k-mile cap |
| Enrichment | 24 CarGurus detail lookups (VIN, history flags, days on lot); Wrench.Pro reviewed issues for 12 model-years; EPA mpg + NCAP for 56 model-years |
| New-car check | Dealer-Direct below-MSRP search + CarGurus; none met the stretch rule |
| Output | Top 5 shortlist, alternates, an excluded list with reasons, coverage section, disclaimer |

## What worked

- **The pre-screen paid off.** It flagged the worst model years (2018 Accord, 2017 Elantra, 2018 Camry) before any listing calls.
- **The comps regression was stable.** Pooled log-price ~ model family + age + mileage, with MAD outlier removal: about −4.2% per 10k miles and +3.4% per newer model year. Its "under market" calls broadly agreed with CarGurus's own deal ratings.
- **Treating unknowns as neutral worked.** Before history data, scores capped around 71 with confidence 0.64. Enrichment raised confidence to 0.83 and separated the field.
- **The "find out why it's cheap" rule earned its place.** The car scored 25% under market had frame damage.
- **Days on lot is real leverage data.** Values ranged from 1 to 297 days, which is useful for year-end negotiating.

## What broke or misled (now fixed in the design)

| Problem | Fix |
|---|---|
| A frame-damaged car scored 68 (above the shortlist floor) on price alone | New hard gate `frame_or_structural_damage` in `scorecard.yaml` |
| Cheap cars with reviewed engine/transmission failure patterns ranked #2–#4 | `expected_repairs` is now a **required** TCO term with concrete reserves; theft-prone model years get an insurance multiplier |
| Dealer-Direct distances were wrong (a 120 mi dealer reported 0) | Recompute from lat/lng (SKILL.md step 3, `sources.yaml`) |
| CarGurus search padded results with listings from other states | Filter by radius before scoring (SKILL.md step 3) |
| Current-model-year "new" cars had 1–15k miles (ex-rental) | Use `vehicleCondition`, not model year, to pick the profile |
| NHTSA returned 0 complaints for a hybrid filed under its base model | `0 complaints + recalls > 0 → unknown` rule |
| EPA "average of engine options" understated 4-cylinder mpg (V6/AWD pulled it down) | Use the best-mpg option unless trim/engine is known |
| The same car appeared on two sources at different prices | Dedupe on VIN, or year + model + mileage within 5; keep both prices |
| CarGurus detail batches overflowed tool output (85–130k chars) | Batch ≤ 10 and extract fields immediately |
| Raw complaint counts penalize best-selling models | Caveat required in reports; sales normalization added to the backlog |

## Buyer feedback (2026-11-09): mileage over 100k should hurt much more

The buyer felt the original scorecard was too lenient on high-mileage cars. Mileage only counted through `mileage_for_age` (weight 5), so a 120k-mile car with "normal" miles per year scored fine. Changes:

- **New `absolute_mileage` criterion** (weight 13 target / 12 stretch / 0 new). It interpolates over a curve that declines gently to 100k (80k → 80, 100k → 62), then steeply (110k → 35, 120k → 22, 130k → 12). `mileage_for_age` drops to weight 2.
- **New additive repair reserve** `over_100k_wear` (+$1,000) and a red flag `high_mileage_over_100k`.

On the live-run listings, the top pick (80k) stayed #1, while the 111k–125k Mazda3s and the 114k Prius fell 4–8 places. Sub-100k Mazda3 hatchbacks moved into the top 6.

Side effect to watch: a sub-90k car with reviewed engine/transmission issues (2020 Forte, 87k) now ranks #2. The repair reserve still prices that risk in TCO, but low mileage now outweighs it in the overall score.

## Rescan (2026-11-09): complaint counts normalized by sales

After the mileage change, the top 10 was almost all Mazda and Kia, with no Toyota or Honda. The cause was the reliability criterion: it compared **raw** NHTSA complaints per year. Best-sellers collect complaints in proportion to volume. The 2016 Civic logged 99.5 complaints a year against the Mazda3's 9.5, on roughly 3.5× the sales.

- **New `scoring/us-sales.yaml`:** approximate annual US sales by model and era, rounded from manufacturer year-end figures (as tabulated by goodcarbadcar.net and others). It's accurate to about ±15%, which is enough for a percentile comparison.
- **What the engine does with it:** when a car and at least 3 model-years in its cohort have sales data, complaint rates are compared per 100k cars sold. The "large powertrain cluster" threshold (10 complaints) also scales with sales above 100k per year. Evidence strings say whether a score is sales-normalized. `--no-sales` turns it off.
- **Effect on the 90-listing rescan:**
  - A 2016 Camry LE moved from #13 to #4, and a 2017 Corolla LE from #20 to #5.
  - The 2018 Mazda3 fell from #4 to #15: it's a low-volume year, at about 19 complaints per 100k sold.
  - The 2016 Civic stays low even normalized (about 28 per 100k), so its penalty is real.
  - #1 didn't change.

## Open questions

- **Sales coverage:** `us-sales.yaml` covers only the models this buyer searched. Expand it, and replace the "rough" rows (older Prius, hybrids) with sourced figures.
- **Expected repairs:** the reserve amounts are hand-set. Calibrate them against repair-cost data (Wrench.Pro "Pro" tier, or user-reported).
- **Insurance:** no free quote source. Is a class-based band plus the theft multiplier good enough, or should we just require a user quote for finalists?
