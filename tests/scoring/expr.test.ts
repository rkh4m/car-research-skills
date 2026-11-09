import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, tryEvaluate } from "../../src/scoring/expr.ts";

test("comparisons, booleans and bare words", () => {
  assert.equal(evaluate("days_on_market >= 45", { days_on_market: 297 }), true);
  assert.equal(evaluate("days_on_market >= 45", { days_on_market: 12 }), false);
  assert.equal(evaluate("frame_damaged == true", { frame_damaged: true }), true);
  assert.equal(evaluate("condition == new", { condition: "new" }), true);
});

test("and binds tighter than or", () => {
  const f = { a: 1, b: 0, c: 1 };
  assert.equal(evaluate("a == 1 and b == 1 or c == 1", f), true);
  assert.equal(evaluate("a == 1 and b == 1 or c == 2", f), false);
});

test("in-lists, fact-to-fact and scaled comparisons", () => {
  assert.equal(evaluate("title_status in [salvage, rebuilt]", { title_status: "rebuilt" }), true);
  assert.equal(evaluate("run_month in [11, 12]", { run_month: 11 }), true);
  assert.equal(evaluate("price > budget.stretch_max", { price: 36000, "budget.stretch_max": 35000 }), true);
  assert.equal(evaluate("price < 0.70 * msrp", { price: 4500, msrp: 42815 }), true);
  assert.equal(evaluate("price < 0.70 * msrp", { price: 38805, msrp: 42815 }), false);
});

test("missing facts are false except for !=", () => {
  assert.equal(evaluate("owners >= 3", {}), false);
  assert.equal(evaluate("nicb.recovered != true", {}), true);
  assert.equal(evaluate("title_status in [salvage]", {}), false);
});

test("unsupported syntax throws; tryEvaluate returns false", () => {
  assert.throws(() => evaluate("failure_mileage_cluster contains current_mileage", {}));
  assert.equal(tryEvaluate("failure_mileage_cluster contains current_mileage", {}), false);
});
