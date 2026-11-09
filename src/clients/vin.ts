const VALUES: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** ISO 3779 / 49 CFR 565 check digit (position 9). North American VINs only. */
export const vinChecksumValid = (vin: string): boolean => {
  const v = vin.trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return false;
  const sum = [...v].reduce((s, ch, i) => s + (/\d/.test(ch) ? Number(ch) : VALUES[ch]!) * WEIGHTS[i]!, 0);
  const r = sum % 11;
  return v[8] === (r === 10 ? "X" : String(r));
};
