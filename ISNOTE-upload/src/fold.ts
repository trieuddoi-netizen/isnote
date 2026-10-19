// Animated fold model: a net that folds (t = 0 flat) into its solid (t = 1). Pure maths, no DOM.
// Polyhedra: every face turns about its hinge edge (parent -> child in the spanning tree of nets.ts) by the exterior dihedral angle × t.
// Cylinder, cone and frustum of a cone: the lateral surface bends continuously and the caps swing about their tangent hinge.
import type { Fold, SolidKind } from "./model.ts";
import { meshOf, rotator, type V3 } from "./solids.ts";
import { meshFoldTree } from "./nets.ts";

export const FOLD_KINDS: SolidKind[] = ["cube", "box", "pyramid", "tetra", "prism", "octahedron", "frustum", "cylinder", "cone", "frustumcone"];
/** Kinds without an animated model: the truncated cylinder and the sphere / cap (their nets are approximate or not developable by hinges). */
export const canFold = (k: SolidKind): boolean => FOLD_KINDS.includes(k);

export interface FoldFace { id: number; pts: V3[]; n: V3 | null } // n = outward normal when known (polyhedra)
export interface FoldEdge { a: V3; b: V3; kind: "edge" | "hinge" | "faint"; faces: number[] }
export interface FoldModel { faces: FoldFace[]; edges: FoldEdge[] }

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** Rodrigues: rotate vector v about unit axis d by angle th. */
function rotVec(v: V3, d: V3, th: number): V3 {
  const c = Math.cos(th), s = Math.sin(th), k = cross(d, v), p = dot(d, v) * (1 - c);
  return [v[0] * c + k[0] * s + d[0] * p, v[1] * c + k[1] * s + d[1] * p, v[2] * c + k[2] * s + d[2] * p];
}
const rotPt = (p: V3, A: V3, d: V3, th: number): V3 => add(A, rotVec(sub(p, A), d, th));
const clamp01 = (t: number) => (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0);

// ---- polyhedra --------------------------------------------------------------------------------
interface Hinge { A: V3; d: V3; ang: number } // signed angle at t = 1
interface Poly {
  faces: number[][]; flat: V3[][]; chain: Hinge[][]; nFlat: V3[]; pivot: V3; parent: number[]; hingeKey: (string | null)[];
  v0: V3; e1: V3; e2: V3; n0: V3; // frame of the root face in the solid's own coordinates
}
const polyCache = new Map<SolidKind, Poly>();
const ekey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

function polyData(kind: SolidKind): Poly | null {
  if (polyCache.has(kind)) return polyCache.get(kind)!;
  const m = meshOf(kind), tree = meshFoldTree(kind);
  if (!m || !tree) return null;
  const F = m.f;
  const normal = F.map((idx) => {
    const p = idx.map((i) => m.v[i]);
    let n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
    const c: V3 = [0, 0, 0];
    p.forEach((q) => { c[0] += q[0] / p.length; c[1] += q[1] / p.length; c[2] += q[2] / p.length; });
    if (dot(n, c) < 0) n = mul(n, -1);
    return unit(n);
  });
  // The root face lies flat in z = 0: frame (e1, e2, n0), exactly as in nets.ts; the closed solid is G(v) = (v - v0)·(e1, e2, n0).
  const v0 = m.v[F[0][0]], e1 = unit(sub(m.v[F[0][1]], v0)), e2 = cross(normal[0], e1), n0 = normal[0];
  const G = (v: V3): V3 => { const q = sub(v, v0); return [dot(q, e1), dot(q, e2), dot(q, n0)]; };
  const Gn = (n: V3): V3 => [dot(n, e1), dot(n, e2), dot(n, n0)];
  const flat = F.map((idx, fi) => idx.map((vi): V3 => { const p = tree.pos.get(fi)!.get(vi)!; return [p[0], p[1], 0]; }));
  const children: number[][] = F.map(() => []);
  tree.parent.forEach((p, f) => { if (p >= 0) children[p].push(f); });
  const chain: Hinge[][] = F.map(() => []);
  const nFlat: V3[] = F.map(() => [0, 0, 1]);
  const evalAt1 = (ch: Hinge[], p: V3): V3 => { let q = p; for (let i = ch.length - 1; i >= 0; i--) q = rotPt(q, ch[i].A, ch[i].d, ch[i].ang); return q; };
  const order: number[] = [0];
  nFlat[0] = Gn(normal[0]);
  for (let qi = 0; qi < order.length; qi++) {
    const f = order[qi];
    for (const g of children[f]) {
      const [a, b] = tree.hinge[g]!;
      const pg = tree.pos.get(g)!;
      const pa = pg.get(a)!, pb = pg.get(b)!;
      const A: V3 = [pa[0], pa[1], 0], B: V3 = [pb[0], pb[1], 0], d = unit(sub(B, A));
      const psi = Math.acos(Math.max(-1, Math.min(1, dot(normal[f], normal[g]))));
      const w = F[g].find((vi) => vi !== a && vi !== b)!; // a vertex off the hinge decides the direction of the turn
      const target = G(m.v[w]), pw = flat[g][F[g].indexOf(w)];
      let best: Hinge | null = null, bd = Infinity;
      for (const sgn of [1, -1]) {
        const h: Hinge = { A, d, ang: sgn * psi };
        const q = evalAt1([...chain[f], h], pw);
        const dd = Math.hypot(q[0] - target[0], q[1] - target[1], q[2] - target[2]);
        if (dd < bd) { bd = dd; best = h; }
      }
      chain[g] = [...chain[f], best!];
      // outward normal in the flat frame: undo the linear parts of the chain from the outermost hinge inwards
      let n = Gn(normal[g]);
      for (let i = 0; i < chain[g].length; i++) n = rotVec(n, chain[g][i].d, -chain[g][i].ang);
      nFlat[g] = n;
      order.push(g);
    }
  }
  const pivot: V3 = [0, 0, 0];
  m.v.forEach((v) => { const q = G(v); pivot[0] += q[0] / m.v.length; pivot[1] += q[1] / m.v.length; pivot[2] += q[2] / m.v.length; });
  const hingeKey = tree.hinge.map((h) => (h ? ekey(h[0], h[1]) : null));
  const data: Poly = { faces: F, flat, chain, nFlat, pivot, parent: tree.parent, hingeKey, v0, e1, e2, n0 };
  polyCache.set(kind, data);
  return data;
}

function polyModel(kind: SolidKind, t: number): FoldModel | null {
  const P = polyData(kind);
  if (!P) return null;
  const fold = (g: number, p: V3): V3 => { let q = p; const ch = P.chain[g]; for (let i = ch.length - 1; i >= 0; i--) q = rotPt(q, ch[i].A, ch[i].d, ch[i].ang * t); return q; };
  const faces: FoldFace[] = P.faces.map((_, g) => {
    const pts = P.flat[g].map((p) => sub(fold(g, p), P.pivot));
    let n = P.nFlat[g];
    const ch = P.chain[g];
    for (let i = ch.length - 1; i >= 0; i--) n = rotVec(n, ch[i].d, ch[i].ang * t);
    return { id: g, pts, n };
  });
  const edges: FoldEdge[] = [];
  P.faces.forEach((idx, f) => idx.forEach((a, k) => {
    const b = idx[(k + 1) % idx.length], key = ekey(a, b);
    const isOwnHinge = P.hingeKey[f] === key;
    const isChildHinge = P.hingeKey.some((hk, g) => hk === key && P.parent[g] === f);
    if (isChildHinge) return; // drawn once, by the child
    edges.push({ a: faces[f].pts[k], b: faces[f].pts[(k + 1) % idx.length], kind: isOwnHinge ? "hinge" : "edge", faces: isOwnHinge ? [f, P.parent[f]] : [f] });
  }));
  return { faces, edges };
}

// ---- cylinder, cone, frustum of a cone ----------------------------------------------------------------
const NU = 48;
const R_CYL = 0.5, H_CYL = 1;
function quadStrip(P: (u: number, v: number) => V3, id: number, faces: FoldFace[], v0 = 0, v1 = 1): void {
  for (let i = 0; i < NU; i++) faces.push({ id, pts: [P(i / NU, v0), P((i + 1) / NU, v0), P((i + 1) / NU, v1), P(i / NU, v1)], n: null });
}
function capCircle(H: V3, a: number, r: number): V3[] {
  const dir: V3 = [0, Math.cos(a), Math.sin(a)];
  return Array.from({ length: NU }, (_, i) => { const k = (2 * Math.PI * i) / NU; return add(add(H, mul(dir, r * (1 + Math.sin(k)))), [r * Math.cos(k), 0, 0] as V3); });
}
function boundary(P: (u: number, v: number) => V3, v: number, edges: FoldEdge[], face: number): void {
  for (let i = 0; i < NU; i++) edges.push({ a: P(i / NU, v), b: P((i + 1) / NU, v), kind: "edge", faces: [face] });
}
function circleEdges(pts: V3[], edges: FoldEdge[], face: number): void { pts.forEach((p, i) => edges.push({ a: p, b: pts[(i + 1) % pts.length], kind: "edge", faces: [face] })); }

function cylinderModel(t: number): FoldModel {
  const r = R_CYL, h = H_CYL, W = 2 * Math.PI * r;
  const alpha = Math.max(t, 1e-6) * 2 * Math.PI, rho = W / alpha;
  const pivot: V3 = [0, 0, r];
  const P = (u: number, v: number): V3 => { const phi = alpha * (u - 0.5); return sub([rho * Math.sin(phi), v * h - h / 2, 2 * rho * Math.sin(phi / 2) ** 2], pivot); };
  const faces: FoldFace[] = [], edges: FoldEdge[] = [];
  quadStrip(P, 2, faces);
  const bot = capCircle(sub([0, -h / 2, 0], pivot), Math.PI - (Math.PI / 2) * t, r), top = capCircle(sub([0, h / 2, 0], pivot), (Math.PI / 2) * t, r);
  faces.push({ id: 1, pts: bot, n: null }, { id: 0, pts: top, n: null });
  boundary(P, 0, edges, 2); boundary(P, 1, edges, 2);
  edges.push({ a: P(0, 0), b: P(0, 1), kind: "edge", faces: [2] }, { a: P(1, 0), b: P(1, 1), kind: "edge", faces: [2] });
  for (let k = 1; k < 8; k++) edges.push({ a: P(k / 8, 0), b: P(k / 8, 1), kind: "faint", faces: [2] });
  circleEdges(bot, edges, 1); circleEdges(top, edges, 0);
  return { faces, edges };
}

/** Cone (rb = 0 top radius) and frustum of a cone: the sector turns into the lateral surface; Ω is the total azimuth, sin β = θ0 / Ω. */
// (Ω grows like t²: the flat sector starts to curl linearly in t instead of with a square-root jump)
function coneModel(t: number, R: number, r: number, h: number, ids: { lateral: number; bottom: number; top: number | null }): FoldModel {
  const l = Math.hypot(R - r, h), L = (R * l) / (R - r), Lin = L - l, theta0 = (2 * Math.PI * R) / L;
  const Om = theta0 + (2 * Math.PI - theta0) * t * t, beta = Math.asin(Math.min(1, theta0 / Om));
  const sb = Math.sin(beta), cb = Math.cos(beta), beta1 = Math.asin(R / L);
  const pivot: V3 = [0, -((L + Lin) / 2) * Math.cos(beta1), 0];
  const S = (rho: number, w: number): V3 => sub([rho * sb * Math.sin(w), -rho * cb, rho * sb * Math.cos(w)], pivot);
  const P = (u: number, v: number): V3 => S(Lin + v * (L - Lin), Om * (u - 0.5));
  const faces: FoldFace[] = [], edges: FoldEdge[] = [];
  quadStrip(P, ids.lateral, faces);
  const Hb = S(L, 0), bot = capCircle(Hb, Math.PI / 2 - Math.PI * t, R);
  faces.push({ id: ids.bottom, pts: bot, n: null });
  boundary(P, 1, edges, ids.lateral); circleEdges(bot, edges, ids.bottom);
  if (r > 1e-9 && ids.top !== null) {
    const top = capCircle(S(Lin, 0), -Math.PI / 2, r);
    faces.push({ id: ids.top, pts: top, n: null });
    boundary(P, 0, edges, ids.lateral); circleEdges(top, edges, ids.top);
  }
  edges.push({ a: P(0, 0), b: P(0, 1), kind: "edge", faces: [ids.lateral] }, { a: P(1, 0), b: P(1, 1), kind: "edge", faces: [ids.lateral] });
  for (let k = 1; k < 8; k++) edges.push({ a: P(k / 8, 0), b: P(k / 8, 1), kind: "faint", faces: [ids.lateral] });
  return { faces, edges };
}

/** 3D model of the fold at parameter t in [0,1] (0 = flat net, 1 = closed solid), centred on the closed solid. Null if the kind cannot be folded. */
export function foldModel(kind: SolidKind, t: number): FoldModel | null {
  const tt = clamp01(t);
  switch (kind) {
    case "cylinder": return cylinderModel(tt);
    case "cone": return coneModel(tt, 0.5, 0, 1, { lateral: 1, bottom: 0, top: null });
    case "frustumcone": return coneModel(tt, 0.5, 0.25, 1, { lateral: 2, bottom: 1, top: 0 });
    default: return polyModel(kind, tt);
  }
}

const radiusCache = new Map<SolidKind, number>();
/** Bounding radius over the whole animation, so the model does not change size while folding. */
export function foldRadius(kind: SolidKind): number {
  if (radiusCache.has(kind)) return radiusCache.get(kind)!;
  let r = 0.1;
  for (let i = 0; i <= 16; i++) { const m = foldModel(kind, i / 16); if (m) for (const f of m.faces) for (const p of f.pts) r = Math.max(r, Math.hypot(p[0], p[1], p[2])); }
  radiusCache.set(kind, r);
  return r;
}

// ---- projection for drawing and picking ---------------------------------------------------------------------
export interface PFace { id: number; pts: number[]; z: number }
export interface PEdge { pts: number[]; kind: FoldEdge["kind"]; hidden: boolean }
export interface FoldProjection { faces: PFace[]; edges: PEdge[]; radius: number }
export type FoldIn = Pick<Fold, "kind" | "yaw" | "pitch" | "roll" | "fold">;

/** Hinge/closed-solid edges count as hidden when the model is (almost) closed and no face next to them faces the viewer. */
const CLOSED = 0.98;
export function projectFold(o: FoldIn): FoldProjection {
  const radius = foldRadius(o.kind);
  const m = foldModel(o.kind, o.fold);
  if (!m) return { faces: [], edges: [], radius };
  const R = rotator(o.yaw, o.pitch, o.roll);
  const P = (v: V3): [number, number, number] => { const r = R(foldToSolid(o.kind, v, o.fold)); return [r[0], -r[1], r[2]]; };
  const faces: PFace[] = m.faces.map((f) => {
    const q = f.pts.map(P);
    return { id: f.id, pts: q.flatMap((p) => [p[0], p[1]]), z: q.reduce((s, p) => s + p[2], 0) / q.length };
  });
  const front = m.faces.map((f) => (f.n ? R(foldToSolidVec(o.kind, f.n, o.fold))[2] > 1e-9 : true));
  const closed = o.fold >= CLOSED;
  const edges: PEdge[] = m.edges.map((e) => {
    const a = P(e.a), b = P(e.b);
    const hidden = closed && e.kind !== "faint" && m.faces[e.faces[0]]?.n !== null && !e.faces.some((f) => front[f]);
    return { pts: [a[0], a[1], b[0], b[1]], kind: e.kind === "hinge" && closed ? "edge" : e.kind, hidden };
  });
  faces.sort((a, b) => a.z - b.z); // painter's algorithm: far first
  return { faces, edges, radius };
}
function inPoly(pts: number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    if (pts[i + 1] > y !== pts[j + 1] > y && x < ((pts[j] - pts[i]) * (y - pts[i + 1])) / (pts[j + 1] - pts[i + 1]) + pts[i]) inside = !inside;
  }
  return inside;
}
/** Front-most face under unit-space point (u,v), or null. */
export function pickFoldFace(o: FoldIn, u: number, v: number): number | null {
  const fs = projectFold(o).faces;
  for (let i = fs.length - 1; i >= 0; i--) if (inPoly(fs[i].pts, u, v)) return fs[i].id;
  return null;
}

// ---- points on the folding surface ---------------------------------------------------------------------------
const wrapPi = (a: number): number => { let x = a; while (x > Math.PI) x -= 2 * Math.PI; while (x <= -Math.PI) x += 2 * Math.PI; return x; };
interface Cone { L: number; Lin: number; Om: number; sb: number; cb: number; pivotY: number; S: (rho: number, w: number) => V3; R: number; r: number }
function coneGeom(t: number, R: number, r: number, h: number): Cone {
  const l = Math.hypot(R - r, h), L = (R * l) / (R - r), Lin = L - l, theta0 = (2 * Math.PI * R) / L;
  const Om = theta0 + (2 * Math.PI - theta0) * t * t, beta = Math.asin(Math.min(1, theta0 / Om));
  const sb = Math.sin(beta), cb = Math.cos(beta), beta1 = Math.asin(R / L);
  const pivot: V3 = [0, -((L + Lin) / 2) * Math.cos(beta1), 0];
  return { L, Lin, Om, sb, cb, pivotY: pivot[1], R, r, S: (rho, w) => sub([rho * sb * Math.sin(w), -rho * cb, rho * sb * Math.cos(w)], pivot) };
}
/** Cap hinge frame at time t: point H, unit direction of the cap's own "up" axis, and the sign relating a closed point's z to the cap's local coordinate. */
function capFrame(kind: SolidKind, t: number, face: number): { H: V3; dir: V3; sgn: number; r: number; sigma: number } | null {
  const dirOf = (a: number): V3 => [0, Math.cos(a), Math.sin(a)];
  if (kind === "cylinder") {
    const pivot: V3 = [0, 0, R_CYL];
    if (face === 0) return { H: sub([0, H_CYL / 2, 0], pivot), dir: dirOf((Math.PI / 2) * t), sgn: 1, r: R_CYL, sigma: -1 };
    if (face === 1) return { H: sub([0, -H_CYL / 2, 0], pivot), dir: dirOf(Math.PI - (Math.PI / 2) * t), sgn: 1, r: R_CYL, sigma: 1 };
    return null;
  }
  if (kind === "cone" || kind === "frustumcone") {
    const R = 0.5, r = kind === "cone" ? 0 : 0.25, c = coneGeom(t, R, r, 1);
    const bottom = kind === "cone" ? 0 : 1;
    if (face === bottom) return { H: c.S(c.L, 0), dir: dirOf(Math.PI / 2 - Math.PI * t), sgn: -1, r: R, sigma: -1 };
    if (kind === "frustumcone" && face === 0) return { H: c.S(c.Lin, 0), dir: dirOf(-Math.PI / 2), sgn: -1, r, sigma: 1 };
  }
  return null;
}

/** Where the point p (in the closed solid's coordinates, lying on `face`) is at fold time t, in fold-model coordinates. Null if it cannot be mapped. */
export function foldPointOnFace(kind: SolidKind, t: number, face: number, p: V3): V3 | null {
  const tt = clamp01(t);
  if (kind === "cylinder" || kind === "cone" || kind === "frustumcone") {
    const cap = capFrame(kind, tt, face);
    if (cap) return add(add(cap.H, mul(cap.dir, cap.r + cap.sgn * p[2])), [p[0], 0, 0] as V3);
    if (kind === "cylinder") { // lateral surface: unrolled strip bent about its middle
      const phi = wrapPi(Math.atan2(p[2], p[0]) + Math.PI / 2), alpha = Math.max(tt, 1e-6) * 2 * Math.PI, rho = (2 * Math.PI * R_CYL) / alpha, ph = alpha * (phi / (2 * Math.PI));
      return sub([rho * Math.sin(ph), p[1], 2 * rho * Math.sin(ph / 2) ** 2], [0, 0, R_CYL]);
    }
    const R = 0.5, r = kind === "cone" ? 0 : 0.25, c = coneGeom(tt, R, r, 1);
    const w = wrapPi(Math.PI / 2 - Math.atan2(p[2], p[0]));
    const beta1 = Math.asin(R / c.L), apexY = ((c.L + c.Lin) / 2) * Math.cos(beta1);
    const rho = (apexY - p[1]) / Math.cos(beta1);
    return c.S(rho, (w * c.Om) / (2 * Math.PI));
  }
  const P = polyData(kind);
  const mesh = meshOf(kind);
  const m = foldModel(kind, tt);
  if (!P || !mesh || !m || face < 0 || face >= P.faces.length) return null;
  const f = closedFrame(kind, face)!, g = m.faces[face];
  const q = sub(p, f.v0), a = dot(q, f.e1), b = dot(q, f.e2), c = dot(q, f.n);
  const e1 = unit(sub(g.pts[1], g.pts[0])), n = g.n!, e2 = cross(n, e1);
  return add(add(add(g.pts[0], mul(e1, a)), mul(e2, b)), mul(n, c));
}
/** Outward normal of the folding surface at time t where the point p of `face` goes. */
export function foldNormalOnFace(kind: SolidKind, t: number, face: number, p: V3): V3 | null {
  const tt = clamp01(t);
  if (kind === "cylinder" || kind === "cone" || kind === "frustumcone") {
    const cap = capFrame(kind, tt, face);
    if (cap) return mul(cross([1, 0, 0], cap.dir), cap.sigma);
    if (kind === "cylinder") { const phi = wrapPi(Math.atan2(p[2], p[0]) + Math.PI / 2), ph = Math.max(tt, 1e-6) * phi; return [Math.sin(ph), 0, -Math.cos(ph)]; }
    const c = coneGeom(tt, 0.5, kind === "cone" ? 0 : 0.25, 1), w = (wrapPi(Math.PI / 2 - Math.atan2(p[2], p[0])) * c.Om) / (2 * Math.PI);
    return unit([c.sb * c.cb * Math.sin(w), c.sb * c.sb, c.sb * c.cb * Math.cos(w)]);
  }
  const m = foldModel(kind, tt);
  return m && m.faces[face]?.n ? m.faces[face].n : null;
}
/** Frame of a polyhedron face in the closed solid: origin, in-plane axes and outward normal (right-handed). */
export function closedFrame(kind: SolidKind, face: number): { v0: V3; e1: V3; e2: V3; n: V3 } | null {
  const mesh = meshOf(kind);
  if (!mesh || !Number.isInteger(face) || face < 0 || face >= mesh.f.length) return null;
  const idx = mesh.f[face], p = idx.map((i) => mesh.v[i]);
  let n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
  const c: V3 = [0, 0, 0];
  p.forEach((q) => { c[0] += q[0] / p.length; c[1] += q[1] / p.length; c[2] += q[2] / p.length; });
  if (dot(n, c) < 0) n = mul(n, -1);
  n = unit(n);
  const e1 = unit(sub(p[1], p[0]));
  return { v0: p[0], e1, e2: cross(n, e1), n };
}
export const isPlanarFace = (kind: SolidKind, face: number): boolean => !!meshOf(kind) || ((kind === "cylinder") ? face !== 2 : kind === "cone" ? face === 0 : face !== 2);

/** Radius used to scale a solid on the page: the closed solid's radius, growing smoothly to the net's radius as it unfolds. */
export function effRadius(kind: SolidKind, boundR: number, fold: number | undefined): number {
  if (fold === undefined || fold >= 1 || !canFold(kind)) return boundR;
  const f = clamp01(fold);
  return boundR + (foldRadius(kind) - boundR) * (1 - f);
}

/** Axis and angle of the rotation whose columns are (e1, e2, n0): the turn from the flat net's frame to the solid's frame. */
function frameRotation(P: Poly): { axis: V3; angle: number } {
  const m = [[P.e1[0], P.e2[0], P.n0[0]], [P.e1[1], P.e2[1], P.n0[1]], [P.e1[2], P.e2[2], P.n0[2]]]; // m[row][col]
  const angle = Math.acos(Math.max(-1, Math.min(1, (m[0][0] + m[1][1] + m[2][2] - 1) / 2)));
  let axis: V3 = [m[2][1] - m[1][2], m[0][2] - m[2][0], m[1][0] - m[0][1]];
  if (Math.hypot(...axis) < 1e-9) { // angle 0 (any axis) or π (axis from the symmetric part)
    if (angle < 1e-6) return { axis: [0, 0, 1], angle: 0 };
    const d = [m[0][0], m[1][1], m[2][2]].map((v) => (v + 1) / 2), k = d.indexOf(Math.max(...d));
    axis = [0, 0, 0]; axis[k] = Math.sqrt(Math.max(d[k], 0));
    for (let j = 0; j < 3; j++) if (j !== k) axis[j] = (m[k][j] + m[j][k]) / (4 * axis[k]);
  }
  return { axis: unit(axis), angle };
}
const rotCache = new Map<SolidKind, { axis: V3; angle: number }>();
const rotOf = (kind: SolidKind, P: Poly) => rotCache.get(kind) ?? (rotCache.set(kind, frameRotation(P)), rotCache.get(kind)!);

/**
 * Fold-model coordinates -> the solid's own coordinates (where a normal solid is drawn). Polyhedra fold in the frame of their root face,
 * which is turned gradually into the solid's frame: the flat net (t = 0) faces the viewer, the closed solid (t = 1) sits exactly where the solid is.
 */
export function foldToSolid(kind: SolidKind, p: V3, t = 1): V3 {
  const P = meshOf(kind) ? polyData(kind) : null;
  if (!P) return p;
  const tt = clamp01(t), { axis, angle } = rotOf(kind, P);
  const shift = add(P.v0, add(add(mul(P.e1, P.pivot[0]), mul(P.e2, P.pivot[1])), mul(P.n0, P.pivot[2])));
  return add(rotVec(p, axis, angle * tt), mul(shift, tt));
}
export function foldToSolidVec(kind: SolidKind, n: V3, t = 1): V3 {
  const P = meshOf(kind) ? polyData(kind) : null;
  if (!P) return n;
  const { axis, angle } = rotOf(kind, P);
  return rotVec(n, axis, angle * clamp01(t));
}
