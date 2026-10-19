// Graph helpers: roots, extrema, intersections, inequality regions, 1:1 scale. Pure, no DOM.
import { compile, compile2 } from "./mathexpr.ts";

export interface XY { x: number; y: number }

/** Roots of f on [a,b] (sign changes refined by bisection, plus tangential touches such as x² at 0). */
export function roots(f: (x: number) => number, a: number, b: number, n = 2000): number[] {
  const out: number[] = [];
  const add = (x: number) => { if (!out.some((r) => Math.abs(r - x) < (b - a) * 1e-4)) out.push(x); };
  let px = a, py = f(a);
  for (let i = 1; i <= n; i++) {
    const x = a + ((b - a) * i) / n, y = f(x);
    if (Number.isFinite(py) && Number.isFinite(y)) {
      if (py === 0) add(px);
      else if (py * y < 0 && Math.abs(py) + Math.abs(y) < 1e6) { // ignore jumps across asymptotes
        let lo = px, hi = x, flo = py;
        for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2, fm = f(m); if (flo * fm <= 0) hi = m; else { lo = m; flo = fm; } }
        const r = (lo + hi) / 2;
        if (Math.abs(f(r)) < 1e-3 * (1 + Math.abs(py) + Math.abs(y))) add(r);
      }
    }
    px = x; py = y;
  }
  // tangential roots: local minima of |f| that are (almost) zero
  const h = (b - a) / n;
  for (let i = 1; i < n; i++) {
    const x = a + h * i, y0 = Math.abs(f(x - h)), y1 = Math.abs(f(x)), y2 = Math.abs(f(x + h));
    if (y1 < y0 && y1 <= y2 && y1 < 1e-5) add(x);
  }
  return out.sort((p, q) => p - q);
}

export interface Extremum extends XY { kind: "min" | "max" }
/** Local extrema of f on [a,b] (derivative sign changes, refined by golden-section search). */
export function extrema(f: (x: number) => number, a: number, b: number, n = 2000): Extremum[] {
  const out: Extremum[] = [];
  const h = (b - a) / n;
  const d = (x: number) => (f(x + h / 2) - f(x - h / 2)) / h;
  let pd = d(a + h);
  for (let i = 2; i < n; i++) {
    const x = a + h * i, cd = d(x);
    if (Number.isFinite(pd) && Number.isFinite(cd) && pd * cd < 0 && Math.abs(pd) + Math.abs(cd) < 1e3) {
      const isMax = pd > 0;
      let lo = x - h, hi = x + h;
      const g = isMax ? (v: number) => -f(v) : f;
      for (let k = 0; k < 80; k++) {
        const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
        if (g(m1) < g(m2)) hi = m2; else lo = m1;
      }
      const xm = (lo + hi) / 2;
      if (!out.some((e) => Math.abs(e.x - xm) < h)) out.push({ x: xm, y: f(xm), kind: isMax ? "max" : "min" });
    }
    pd = cd;
  }
  return out;
}

/** Intersections of two functions on [a,b]. */
export function intersectFns(f: (x: number) => number, g: (x: number) => number, a: number, b: number): XY[] {
  return roots((x) => f(x) - g(x), a, b).map((x) => ({ x, y: f(x) }));
}

export type IneqOp = "<" | ">" | "<=" | ">=";
export interface Ineq { test: (x: number, y: number) => boolean; src: string }
/** "y > x^2 - 1", "x + y <= 3", "x >= 0" ... -> predicate. Throws on bad input. */
export function parseIneq(src: string): Ineq {
  const s = src.replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/≠/g, "!=");
  const m = /^(.*?)(<=|>=|<|>)(.*)$/.exec(s);
  if (!m || !m[1].trim() || !m[3].trim()) throw new Error("Not an inequality");
  const l = compile2(m[1]), r = compile2(m[3]), op = m[2] as IneqOp;
  const test = (x: number, y: number) => { const v = l(x, y) - r(x, y); return op === "<" ? v < 0 : op === ">" ? v > 0 : op === "<=" ? v <= 1e-12 : v >= -1e-12; };
  return { test, src };
}
export const inRegion = (ineqs: Ineq[], x: number, y: number): boolean => ineqs.every((q) => q.test(x, y));

/** y-range giving a 1:1 scale for a box of w×h with the given x-range, keeping the vertical centre. */
export function squareScale(xmin: number, xmax: number, ymin: number, ymax: number, w: number, h: number): { ymin: number; ymax: number } {
  const half = ((xmax - xmin) * h) / w / 2, mid = (ymin + ymax) / 2;
  return { ymin: mid - half, ymax: mid + half };
}

/** Evaluate a graph function by source text; NaN when the expression is invalid. */
export function evalFn(src: string, x: number): number {
  try { return compile(src)(x); } catch { return NaN; }
}
/** Text for a point on a graph, e.g. "(1; -4)" or "I(1; -4)". */
export const pointLabel = (name: string | undefined, x: number, y: number): string => `${name ?? ""}(${+x.toFixed(3)}; ${+y.toFixed(3)})`;
