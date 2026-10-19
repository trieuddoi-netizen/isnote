// Solids of revolution from a graph: y=f(x) on [a,b] spun about Ox, or radius=f(y) on [a,b] spun about Oy.
// Wireframe with hidden lines (rings + silhouette). Hidden-line accuracy is exact for convex profiles, approximate otherwise.
import type { Revolve } from "./model.ts";
import { compile } from "./mathexpr.ts";
import { rotator, runs, type Path, type V3 } from "./solids.ts";

export type RevIn = Pick<Revolve, "expr" | "a" | "b" | "axis" | "yaw" | "pitch" | "roll" | "rings">;

/** V = π ∫ f(t)² dt, by Simpson's rule. */
export function revolveVolume(expr: string, a: number, b: number): number {
  const f = compile(expr);
  const n = 2000, h = (b - a) / n;
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const v = f(a + i * h), w = Number.isFinite(v) ? v * v : 0;
    s += w * (i === 0 || i === n ? 1 : i % 2 ? 4 : 2);
  }
  return Math.PI * (s * h) / 3;
}

export function projectRevolve(r: RevIn): { paths: Path[]; radius: number } | null {
  let f: (x: number) => number;
  try { f = compile(r.expr); } catch { return null; }
  const a = Math.min(r.a, r.b), b = Math.max(r.a, r.b), len = b - a;
  if (!(len > 0)) return null;
  const val = (t: number) => { const v = Math.abs(f(t)); return Number.isFinite(v) ? v : 0; };
  let maxR = 0;
  for (let i = 0; i <= 200; i++) maxR = Math.max(maxR, val(a + (len * i) / 200));
  if (maxR <= 0) return null;
  const S = Math.max(len, 2 * maxR);
  const X = (t: number) => (t - (a + b) / 2) / S;
  const rho = (t: number) => val(t) / S;
  const h = len * 1e-4;
  const drho = (t: number) => (val(t + h) - val(t - h)) / (2 * h); // dρ/dX = f'(t)
  const R = rotator(r.yaw, r.pitch, r.roll);
  const ax = r.axis === "x";
  const at = (t: number, th: number): V3 => (ax ? [X(t), rho(t) * Math.cos(th), rho(t) * Math.sin(th)] : [rho(t) * Math.cos(th), X(t), rho(t) * Math.sin(th)]);
  const normal = (t: number, th: number): V3 => (ax ? [-drho(t), Math.cos(th), Math.sin(th)] : [Math.cos(th), -drho(t), Math.sin(th)]);
  const P = (v: V3): [number, number] => { const q = R(v); return [q[0], -q[1]]; };
  const capNormal = (end: -1 | 1): V3 => (ax ? [end, 0, 0] : [0, end, 0]);
  const paths: Path[] = [];
  const N = 72;
  const K = Math.max(0, Math.min(40, Math.round(r.rings)));
  for (let k = 0; k <= K + 1; k++) {
    const t = a + (len * k) / (K + 1);
    if (rho(t) < 1e-6) continue;
    const end = k === 0 ? -1 : k === K + 1 ? 1 : 0;
    const capFront = end !== 0 && R(capNormal(end as -1 | 1))[2] > 0;
    const pts: [number, number][] = [];
    const vis: boolean[] = [];
    for (let i = 0; i < N; i++) {
      pts.push(P(at(t, (2 * Math.PI * i) / N)));
      vis.push(capFront || R(normal(t, (2 * Math.PI * (i + 0.5)) / N))[2] > 0);
    }
    paths.push(...runs(pts, vis));
  }
  // silhouette: where the surface normal is perpendicular to the view direction
  const M = 160;
  const Rx = R([1, 0, 0])[2], Ry = R([0, 1, 0])[2], Rz = R([0, 0, 1])[2];
  for (const sign of [1, -1]) {
    let cur: number[] = [];
    for (let i = 0; i <= M; i++) {
      const t = a + (len * i) / M, dr = drho(t);
      const c1 = ax ? Ry : Rx, c2 = Rz, D = dr * (ax ? Rx : Ry), m = Math.hypot(c1, c2);
      if (m > 1e-9 && Math.abs(D) <= m) {
        const th = Math.atan2(c2, c1) + sign * Math.acos(D / m);
        const q = P(at(t, th));
        cur.push(q[0], q[1]);
      } else if (cur.length) { if (cur.length > 2) paths.push({ pts: cur, hidden: false }); cur = []; }
    }
    if (cur.length > 2) paths.push({ pts: cur, hidden: false });
  }
  const half = len / (2 * S);
  return { paths, radius: Math.max(0.05, Math.hypot(half, maxR / S)) };
}
