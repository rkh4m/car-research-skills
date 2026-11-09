export type FactValue = number | boolean | string | undefined;
export type Facts = Record<string, FactValue>;

const OPS = [">=", "<=", "!=", "==", ">", "<"] as const;
type Op = (typeof OPS)[number];

const literal = (raw: string, facts: Facts): FactValue => {
  const t = raw.trim();
  const scaled = /^(-?\d+(?:\.\d+)?)\s*\*\s*([\w.]+)$/.exec(t);
  if (scaled) {
    const f = facts[scaled[2]!];
    return typeof f === "number" ? Number(scaled[1]) * f : undefined;
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === "true") return true;
  if (t === "false") return false;
  if (t in facts) return facts[t];
  return t;
};

const compare = (left: FactValue, op: Op, right: FactValue): boolean => {
  if (op === "!=") return left !== right;
  if (left === undefined || right === undefined) return false;
  switch (op) {
    case "==": return left === right;
    case ">=": return typeof left === "number" && typeof right === "number" && left >= right;
    case "<=": return typeof left === "number" && typeof right === "number" && left <= right;
    case ">": return typeof left === "number" && typeof right === "number" && left > right;
    case "<": return typeof left === "number" && typeof right === "number" && left < right;
  }
};

const clause = (src: string, facts: Facts): boolean => {
  const inMatch = /^([\w.]+)\s+in\s+\[(.*)\]$/.exec(src.trim());
  if (inMatch) {
    const v = facts[inMatch[1]!];
    if (v === undefined) return false;
    return inMatch[2]!.split(",").map(x => literal(x, {})).some(x => x === v);
  }
  for (const op of OPS) {
    const i = src.indexOf(` ${op} `);
    if (i >= 0) return compare(facts[src.slice(0, i).trim()], op, literal(src.slice(i + op.length + 2), facts));
  }
  throw new Error(`Unsupported condition: "${src}"`);
};

/** Evaluate a scorecard condition: clauses joined by `or` (lowest precedence) and `and`. */
export const evaluate = (condition: string, facts: Facts): boolean =>
  condition.split(/\s+or\s+/).some(part => part.split(/\s+and\s+/).every(c => clause(c, facts)));

/** Like evaluate, but returns false instead of throwing for conditions this evaluator can't express. */
export const tryEvaluate = (condition: string, facts: Facts): boolean => {
  try { return evaluate(condition, facts); } catch { return false; }
};
