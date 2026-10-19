// Unfolded nets of solids (trải phẳng). Polyhedra are unfolded face-by-face along a spanning tree of shared edges;
// cylinder and cone use their classic nets (rectangle + 2 circles, sector + circle).
import { meshOf, type V3 } from "./solids.ts";
import type { SolidKind } from "./model.ts";

export interface NetFace { id: number; pts: number[]; fold: boolean[] } // fold[i]: edge pts[i] -> pts[i+1] is a fold line (drawn dashed)
export interface Net2D { faces: NetFace[]; w: number; h: number; approx?: boolean }

type V2 = [number, number];
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit3 = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const ekey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** How a polyhedron unfolds: raw flat coordinates (before centring), each face's parent in the spanning tree and the hinge edge (vertex indices) it turns about. Face 0 is the root. */
export interface FoldTree { pos: Map<number, Map<number, [number, number]>>; parent: number[]; hinge: ([number, number] | null)[] }
const treeCache = new Map<SolidKind, FoldTree>();
export function meshFoldTree(kind: SolidKind): FoldTree | null {
  if (!meshOf(kind)) return null;
  if (!treeCache.has(kind)) unfoldMesh(kind);
  return treeCache.get(kind) ?? null;
}

function unfoldMesh(kind: SolidKind): Net2D {
  const m = meshOf(kind)!;
  const faces = m.f;
  const normal = faces.map((idx) => {
    const p = idx.map((i) => m.v[i]);
    let n = cross3(sub3(p[1], p[0]), sub3(p[2], p[0]));
    const c: V3 = [0, 0, 0];
    p.forEach((q) => { c[0] += q[0] / p.length; c[1] += q[1] / p.length; c[2] += q[2] / p.length; });
    if (dot3(n, c) < 0) n = [-n[0], -n[1], -n[2]];
    return unit3(n);
  });
  const adj = new Map<string, number[]>();
  faces.forEach((idx, fi) => idx.forEach((a, k) => { const key = ekey(a, idx[(k + 1) % idx.length]); (adj.get(key) ?? adj.set(key, []).get(key)!).push(fi); }));

  const pos = new Map<number, Map<number, V2>>(); // face -> vertex -> 2D
  const folds = faces.map(() => new Set<string>());
  const parent: number[] = faces.map(() => -1), hinge: ([number, number] | null)[] = faces.map(() => null);
  // Root face laid flat.
  const r = faces[0], v0 = m.v[r[0]];
  const e1 = unit3(sub3(m.v[r[1]], v0)), e2 = cross3(normal[0], e1);
  pos.set(0, new Map(r.map((vi): [number, V2] => [vi, [dot3(sub3(m.v[vi], v0), e1), dot3(sub3(m.v[vi], v0), e2)]])));
  const queue = [0];
  while (queue.length) {
    const f = queue.shift()!;
    const idx = faces[f], pf = pos.get(f)!;
    const cen: V2 = [0, 0];
    idx.forEach((vi) => { cen[0] += pf.get(vi)![0] / idx.length; cen[1] += pf.get(vi)![1] / idx.length; });
    idx.forEach((a, k) => {
      const b = idx[(k + 1) % idx.length];
      const g = adj.get(ekey(a, b))!.find((x) => x !== f);
      if (g === undefined || pos.has(g)) return;
      const A = pf.get(a)!, B = pf.get(b)!;
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
      const d: V2 = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
      let mm: V2 = [-d[1], d[0]];
      if (mm[0] * (cen[0] - A[0]) + mm[1] * (cen[1] - A[1]) > 0) mm = [-mm[0], -mm[1]]; // away from the parent face
      const eh = unit3(sub3(m.v[b], m.v[a]));
      const placed = new Map<number, V2>();
      for (const vi of faces[g]) {
        if (vi === a) placed.set(vi, A);
        else if (vi === b) placed.set(vi, B);
        else {
          const q = sub3(m.v[vi], m.v[a]), t = dot3(q, eh);
          const perp = Math.hypot(q[0] - t * eh[0], q[1] - t * eh[1], q[2] - t * eh[2]);
          placed.set(vi, [A[0] + t * d[0] + perp * mm[0], A[1] + t * d[1] + perp * mm[1]]);
        }
      }
      pos.set(g, placed);
      parent[g] = f; hinge[g] = [a, b];
      folds[f].add(ekey(a, b)); folds[g].add(ekey(a, b));
      queue.push(g);
    });
  }
  treeCache.set(kind, { pos, parent, hinge });
  return normalize(faces.map((idx, fi) => ({ id: fi, pts: idx.flatMap((vi) => pos.get(fi)!.get(vi)!), fold: idx.map((a, k) => folds[fi].has(ekey(a, idx[(k + 1) % idx.length]))) })));
}

function circle(cx: number, cy: number, r: number, n = 64): number[] {
  return Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]).flat();
}

function normalize(faces: NetFace[]): Net2D {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of faces) for (let i = 0; i < f.pts.length; i += 2) { x0 = Math.min(x0, f.pts[i]); x1 = Math.max(x1, f.pts[i]); y0 = Math.min(y0, f.pts[i + 1]); y1 = Math.max(y1, f.pts[i + 1]); }
  for (const f of faces) f.pts = f.pts.map((v, i) => v - (i % 2 ? y0 : x0));
  return { faces, w: x1 - x0, h: y1 - y0 };
}

export function netOf(kind: SolidKind): Net2D | null {
  if (meshOf(kind)) return unfoldMesh(kind);
  const r = 0.5;
  if (kind === "cylinder") {
    const W = 2 * Math.PI * r;
    return normalize([
      { id: 2, pts: [0, 0, W, 0, W, 1, 0, 1], fold: [false, false, false, false] },
      { id: 0, pts: circle(W / 2, -r, r), fold: Array(64).fill(false) },
      { id: 1, pts: circle(W / 2, 1 + r, r), fold: Array(64).fill(false) },
    ]);
  }
  if (kind === "cone") {
    const l = Math.hypot(r, 1), ang = (2 * Math.PI * r) / l;
    const arc = Array.from({ length: 49 }, (_, i) => { const a = Math.PI / 2 - ang / 2 + (ang * i) / 48; return [l * Math.cos(a), l * Math.sin(a)]; }).flat();
    return normalize([
      { id: 1, pts: [0, 0, ...arc], fold: Array(50).fill(false) },
      { id: 0, pts: circle(0, l + r, r), fold: Array(64).fill(false) },
    ]);
  }
  if (kind === "frustumcone") return frustumConeNet();
  if (kind === "truncyl") return truncCylNet();
  if (kind === "sphere") return goreNet(0.5, Math.PI, 12, 0);
  if (kind === "cap") { const R = 0.75, h = 0.55, a = Math.sqrt(R * R - (R - h) ** 2); return goreNet(R, Math.asin(a / R), 10, a); }
  return null;
}

const arcPts = (cx: number, cy: number, r: number, a0: number, a1: number, n = 48): number[] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }).flat();

/** Frustum of a cone (radii 0.5 / 0.25, height 1): an annular sector (exact development) plus the two circles. Face ids as in solids.ts: 0 top, 1 bottom, 2 side. */
export function frustumConeNet(R = 0.5, r = 0.25, h = 1): Net2D {
  const l = Math.hypot(R - r, h), L = (R * l) / (R - r), Lin = L - l, theta = (2 * Math.PI * R) / L;
  const a0 = Math.PI / 2 - theta / 2, a1 = Math.PI / 2 + theta / 2;
  const outer = arcPts(0, 0, L, a0, a1), inner = arcPts(0, 0, Lin, a1, a0); // inner arc walked backwards to close the ring sector
  const side = [...outer, ...inner];
  return normalize([
    { id: 2, pts: side, fold: Array(side.length / 2).fill(false) },
    { id: 1, pts: circle(0, L + R, R), fold: Array(64).fill(false) }, // beyond the outer arc
    { id: 0, pts: circle(0, Lin - r, r), fold: Array(64).fill(false) }, // inside the cut-out, tangent to the inner arc
  ]);
}

/** Truncated cylinder (radius a, bottom at y=-0.5, top plane y = 0.5 + k·x/a): the lateral surface develops into a strip whose top edge is the
 *  curve H(θ) = 1 + k·cosθ; the bottom circle hangs below, the elliptical top face sits above the lowest point of the curve. */
export function truncCylNet(a = 0.45, k = 0.28): Net2D {
  const n = 96, W = 2 * Math.PI * a;
  
  // polygon: bottom edge left->right, then up the right side and back along the curve to the left
  const poly: number[] = [0, 0, W, 0];
  for (let i = n; i >= 0; i--) { const th = (2 * Math.PI * i) / n; poly.push(a * th, -(1 + k * Math.cos(th))); }
  const bx = Math.PI * a, ymin = -(1 - k); // lowest point of the curve (θ = π)
  const bxe = a * Math.sqrt(1 + (k / a) ** 2); // semi-axis of the slanted top ellipse along the slope
  const ellipse = Array.from({ length: 64 }, (_, i) => { const t = (2 * Math.PI * i) / 64; return [bx + bxe * Math.cos(t), ymin - a + a * Math.sin(t)]; }).flat();
  return normalize([
    { id: 2, pts: poly, fold: Array(poly.length / 2).fill(false) },
    { id: 1, pts: circle(W / 2, a, a), fold: Array(64).fill(false) },
    { id: 0, pts: ellipse, fold: Array(64).fill(false) },
  ]);
}

/** Approximate net of a sphere / spherical cap by `n` gores (orange peel); the flattening is not exact, so the net is flagged `approx`.
 *  Gore width at polar angle t is 2πR·sin t / n; the cap also gets its base disc (radius `baseR`) below the gores. */
export function goreNet(R: number, tmax: number, n: number, baseR: number): Net2D {
  const faces: NetFace[] = [];
  const step = (2 * Math.PI * R * Math.sin(Math.min(tmax, Math.PI / 2))) / n;
  const m = 24;
  for (let g = 0; g < n; g++) {
    const cx = (g + 0.5) * step, left: number[] = [], right: number[] = [];
    for (let i = 0; i <= m; i++) {
      const t = (tmax * i) / m, hw = (Math.PI * R * Math.sin(t)) / n;
      left.push(cx - hw, R * t); right.push(cx + hw, R * t);
    }
    const pts = [...left];
    for (let i = right.length - 2; i >= 0; i -= 2) pts.push(right[i], right[i + 1]);
    faces.push({ id: baseR ? 1 : 0, pts, fold: Array(pts.length / 2).fill(false) });
  }
  if (baseR) faces.push({ id: 0, pts: circle((n * step) / 2, R * tmax + baseR, baseR), fold: Array(64).fill(false) });
  const net = normalize(faces);
  net.approx = true;
  return net;
}

export function pickNetFace(net: Net2D, u: number, v: number): number | null {
  for (let k = net.faces.length - 1; k >= 0; k--) {
    const p = net.faces[k].pts;
    let inside = false;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      if (p[i + 1] > v !== p[j + 1] > v && u < ((p[j] - p[i]) * (v - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) inside = !inside;
    }
    if (inside) return net.faces[k].id;
  }
  return null;
}
