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

## Open questions

- **Sales normalization:** is there a free, citable source of annual US sales by model?
- **Expected repairs:** the reserve amounts are hand-set. Calibrate them against repair-cost data (Wrench.Pro "Pro" tier, or user-reported).
- **Insurance:** no free quote source. Is a class-based band plus the theft multiplier good enough, or should we just require a user quote for finalists?
