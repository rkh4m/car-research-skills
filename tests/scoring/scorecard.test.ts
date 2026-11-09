import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate } from "../../src/scoring/expr.ts";
import { DEFAULT_SCORECARD_PATH, loadScorecard, parseScorecard } from "../../src/scoring/scorecard.ts";

test("repo scorecard parses and every profile sums to 100", () => {
  const sc = loadScorecard();
  for (const p of Object.values(sc.profiles)) assert.equal(Object.values(p.weights).reduce((a, b) => a + (b ?? 0), 0), 100);
});

test("every gate and unless condition is expressible by the evaluator", () => {
  const sc = loadScorecard();
  for (const g of sc.gates) {
    assert.doesNotThrow(() => evaluate(g.when, {}), `gate ${g.id}`);
    if (g.unless) assert.doesNotThrow(() => evaluate(g.unless!, {}), `gate ${g.id} unless`);
  }
});

test("weights that don't sum to 100 are rejected", () => {
  const text = readFileSync(DEFAULT_SCORECARD_PATH, "utf8").replace("deal_vs_market: 16", "deal_vs_market: 20");
  assert.throws(() => parseScorecard(text), /sum to 100/);
});

test("stretch thresholds are parsed from '>= N' strings", () => {
  const sc = loadScorecard();
  assert.equal(sc.budget_rule.stretch_requires.deal_vs_market, 90);
  assert.equal(sc.budget_rule.stretch_requires.confidence, 0.7);
});
