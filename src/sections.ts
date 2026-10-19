// Cross-sections of a solid: closed planar loops formed by the lines drawn on it, coplanarity, area. Pure, no DOM.
import type { Mark, Section, SolidKind } from "./model.ts";
import { meshOf, type V3 } from "./solids.ts";

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);

/** Unit normal of the plane through the points (best non-degenerate triple), or null if they are collinear. */
export function planeNormal(pts: V3[]): V3 | null {
  let best: V3 | null = null, bl = 1e-9;
  for (let i = 1; i + 1 < pts.length; i++) {
    const n = cross(sub(pts[i], pts[0]), sub(pts[i + 1], pts[0])), l = len(n);
    if (l > bl) { bl = l; best = [n[0] / l, n[1] / l, n[2] / l]; }
  }
  return best;
}
/** Are all points in one plane (≥3 points, not all on a line)? */
export function isCoplanar(pts: V3[], eps = 1e-6): boolean {
  if (pts.length < 3) return false;
  const n = planeNormal(pts);
  if (!n) return false;
  return pts.every((p) => Math.abs(dot(n, sub(p, pts[0]))) < eps);
}
/** Area of a planar polygon given as 3D points in order. */
export function polygonArea3(pts: V3[]): number {
  let s: V3 = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) { const c = cross(pts[i], pts[(i + 1) % pts.length]); s = [s[0] + c[0], s[1] + c[1], s[2] + c[2]]; }
  return len(s) / 2;
}

/** Connections that are part of the solid itself: consecutive marks along each edge (marks at vertices and on edges). */
export function structuralEdges(kind: SolidKind, marks: Mark[]): [string, string][] {
  const mesh = meshOf(kind);
  if (!mesh) return [];
  const out: [string, string][] = [];
  const seen = new Set<string>();
  for (const idx of mesh.f) for (let k = 0; k < idx.length; k++) {
    const a = idx[k], b = idx[(k + 1) % idx.length], key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const A = mesh.v[a], B = mesh.v[b], d = sub(B, A), L2 = dot(d, d);
    const on = marks.map((m) => { const t = dot(sub(m.p, A), d) / L2; return { m, t, off: len(cross(sub(m.p, A), d)) / Math.sqrt(L2) }; }).filter((q) => q.off < 1e-6 && q.t > -1e-9 && q.t < 1 + 1e-9).sort((p, q) => p.t - q.t);
    for (let i = 0; i + 1 < on.length; i++) out.push([on[i].m.id, on[i + 1].m.id]);
  }
  return out;
}

/** Key of a loop: its marks, order- and direction-independent. */
export const loopKey = (ids: string[]): string => [...ids].sort().join("|");

/**
 * Closed loops (≥ 3 marks) joined by drawn lines or by edges of the solid whose marks all lie in one plane: the candidate cross-sections.
 * Loops that are exactly one outer face of the solid are left out (those are painted as faces).
 */
export function findLoops(kind: SolidKind, marks: Mark[], lines: [string, string][], maxLen = 8, maxLoops = 300): string[][] {
  const byId = new Map(marks.map((m) => [m.id, m]));
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => { if (a === b || !byId.has(a) || !byId.has(b)) return; (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b); (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a); };
  for (const [a, b] of lines) link(a, b);
  for (const [a, b] of structuralEdges(kind, marks)) link(a, b);
  const order = marks.map((m) => m.id).filter((id) => adj.has(id));
  const rank = new Map(order.map((id, i) => [id, i]));
  const loops: string[][] = [], keys = new Set<string>();
  const mesh = meshOf(kind);
  const isFace = (ids: string[]): boolean => !!mesh && mesh.f.some((idx) => idx.length === ids.length && ids.every((id) => idx.some((vi) => { const p = mesh.v[vi], q = byId.get(id)!.p; return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) < 1e-6; })));
  const path: string[] = [];
  const dfs = (start: string, cur: string) => {
    if (loops.length >= maxLoops) return;
    for (const nx of adj.get(cur) ?? []) {
      if (nx === start && path.length >= 3) {
        if (rank.get(path[1])! < rank.get(path[path.length - 1])!) { // each loop once (not both directions)
          const pts = path.map((id) => byId.get(id)!.p);
          const key = loopKey(path);
          if (!keys.has(key) && isCoplanar(pts) && polygonArea3(pts) > 1e-9 && !isFace(path)) { keys.add(key); loops.push([...path]); }
        }
      } else if (!path.includes(nx) && rank.get(nx)! > rank.get(start)! && path.length < maxLen) { path.push(nx); dfs(start, nx); path.pop(); }
    }
  };
  for (const s of order) { path.length = 0; path.push(s); dfs(s, s); }
  return loops;
}

/** Candidate sections for painting: stored sections plus every detected loop (stored colours win). */
export function candidateSections(kind: SolidKind, marks: Mark[], lines: [string, string][], stored: Section[] | undefined): Section[] {
  const ids = new Set(marks.map((m) => m.id));
  const have = (stored ?? []).filter((s) => s.marks.every((id) => ids.has(id)));
  const keys = new Set(have.map((s) => loopKey(s.marks)));
  const extra = findLoops(kind, marks, lines).filter((l) => !keys.has(loopKey(l))).map((l): Section => ({ marks: l, color: null }));
  return [...have, ...extra];
}
