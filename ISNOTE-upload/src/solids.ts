// 3D solids: orthographic projection with hidden edges, face picking, and points/segments anchored on the solid.
// Pure math (no DOM), unit-tested. Model space: y up, solids centred on the origin, viewer looks down -z (z' > 0 faces the viewer).
import type { Mark, Solid, SolidKind } from "./model.ts";

export type V3 = [number, number, number];
export interface Path { pts: number[]; hidden: boolean } // pts in unit screen space (x right, y down)
export interface Face { id: number; pts: number[]; z: number }
export interface Dot { x: number; y: number; name: string; hidden: boolean }
export interface Projection { paths: Path[]; faces: Face[]; lines: Path[]; dots: Dot[]; vlabels: Dot[]; radius: number }
export type ProjIn = Pick<Solid, "kind" | "yaw" | "pitch" | "roll"> & Partial<Pick<Solid, "marks" | "lines" | "labels">>;

const N = 96;
const R_CIRCLE = 0.5, H_CYL = 1;

/** Rotation: Ry(yaw), then Rx(pitch), then Rz(roll). Any orientation is reachable; all three angles are free (±360°). */
export function rotator(yaw: number, pitch: number, roll: number): (v: V3) => V3 {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch), cz = Math.cos(roll), sz = Math.sin(roll);
  return ([x, y, z]) => {
    const x1 = cy * x + sy * z, z1 = -sy * x + cy * z;
    const y2 = cx * y - sx * z1, z2 = sx * y + cx * z1;
    return [cz * x1 - sz * y2, sz * x1 + cz * y2, z2];
  };
}
export function invRotator(yaw: number, pitch: number, roll: number): (v: V3) => V3 {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch), cz = Math.cos(roll), sz = Math.sin(roll);
  return ([X, Y, Z]) => {
    const x1 = cz * X + sz * Y, y2 = -sz * X + cz * Y;
    const y = cx * y2 + sx * Z, z1 = -sx * y2 + cx * Z;
    return [cy * x1 - sy * z1, y, sy * x1 + cy * z1];
  };
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export interface Mesh { v: V3[]; f: number[][]; names: string[] }
const box = (a: number, b: number, c: number): Mesh => {
  const v: V3[] = [];
  for (const x of [-a, a]) for (const y of [-b, b]) for (const z of [-c, c]) v.push([x, y, z]); // index = (x?4:0)+(y?2:0)+(z?1:0)
  return { v, f: [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]], names: ["A", "B", "A'", "B'", "D", "C", "D'", "C'"] };
};
const meshCache = new Map<SolidKind, Mesh | null>();
export function meshOf(kind: SolidKind): Mesh | null {
  if (meshCache.has(kind)) return meshCache.get(kind)!;
  let m: Mesh | null = null;
  switch (kind) {
    case "cube": m = box(0.5, 0.5, 0.5); break;
    case "box": m = box(0.7, 0.4, 0.5); break;
    case "pyramid": m = { v: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5], [0, 0.5, 0]], f: [[0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]], names: ["A", "B", "C", "D", "S"] }; break;
    case "tetra": { const k = 0.45; m = { v: [[k, k, k], [k, -k, -k], [-k, k, -k], [-k, -k, k]], f: [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]], names: ["S", "A", "B", "C"] }; break; }
    case "prism": {
      const b: [number, number][] = [[-0.6, 0.35], [0.6, 0.35], [0, -0.5]];
      m = { v: [...b.map(([x, z]): V3 => [x, -0.5, z]), ...b.map(([x, z]): V3 => [x, 0.5, z])], f: [[0, 1, 2], [3, 4, 5], [0, 1, 4, 3], [1, 2, 5, 4], [2, 0, 3, 5]], names: ["A", "B", "C", "A'", "B'", "C'"] };
      break;
    }
    case "octahedron": {
      const r = 0.6;
      m = { v: [[r, 0, 0], [0, 0, r], [-r, 0, 0], [0, 0, -r], [0, r, 0], [0, -r, 0]], f: [[4, 0, 1], [4, 1, 2], [4, 2, 3], [4, 3, 0], [5, 1, 0], [5, 2, 1], [5, 3, 2], [5, 0, 3]], names: ["A", "B", "C", "D", "S", "S'"] };
      break;
    }
    case "frustum": { // frustum of a square pyramid: base A B C D (y = -0.5), top A' B' C' D' (y = 0.5)
      const b = 0.5, t = 0.25;
      m = { v: [[-b, -0.5, -b], [b, -0.5, -b], [b, -0.5, b], [-b, -0.5, b], [-t, 0.5, -t], [t, 0.5, -t], [t, 0.5, t], [-t, 0.5, t]],
        f: [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], names: ["A", "B", "C", "D", "A'", "B'", "C'", "D'"] };
      break;
    }
  }
  meshCache.set(kind, m);
  return m;
}

// ---- smooth convex solids (frustum of a cone, truncated cylinder, spherical cap) ---------------------------
// Built as fine polygon meshes whose faces are grouped into real faces (group ids = face ids used for painting/points).
// Only feature edges (between groups) and silhouette edges are drawn, so the curved sides show no facets.
export interface CMesh { v: V3[]; f: number[][]; g: number[]; groups: number; curved: Set<number>; generators: boolean; normals: V3[]; snaps: Snap[] }
const CN = 48;
const cmeshCache = new Map<SolidKind, CMesh | null>();
function buildC(v: V3[], f: number[][], g: number[], curved: number[], generators: boolean, snaps: Snap[]): CMesh {
  const c: V3 = [0, 0, 0];
  v.forEach((p) => { c[0] += p[0] / v.length; c[1] += p[1] / v.length; c[2] += p[2] / v.length; });
  const normals = f.map((idx) => {
    const a = v[idx[0]], b = v[idx[1]], d = v[idx[2]];
    let n = cross(sub(b, a), sub(d, a));
    const cen: V3 = [0, 0, 0];
    idx.forEach((i) => { cen[0] += v[i][0] / idx.length; cen[1] += v[i][1] / idx.length; cen[2] += v[i][2] / idx.length; });
    if (dot(n, sub(cen, c)) < 0) n = [-n[0], -n[1], -n[2]];
    return unit(n);
  });
  return { v, f, g, groups: Math.max(...g) + 1, curved: new Set(curved), generators, normals, snaps };
}
const ringSnaps = (r: (t: number) => V3, faces: (t: number) => number[]): Snap[] => Array.from({ length: 8 }, (_, i) => { const t = (Math.PI * 2 * i) / 8; return { p: r(t), faces: faces(t), name: "" }; });
export function cmeshOf(kind: SolidKind): CMesh | null {
  if (cmeshCache.has(kind)) return cmeshCache.get(kind)!;
  let m: CMesh | null = null;
  const th = (i: number) => (2 * Math.PI * i) / CN;
  if (kind === "frustumcone" || kind === "truncyl") {
    // Groups: 0 top, 1 bottom, 2 lateral (same as the cylinder). Frustum: radii 0.5 (bottom) and 0.25 (top). Truncated cylinder: radius 0.45, slanted top.
    const yb = -0.5;
    const top = (t: number): V3 => kind === "frustumcone" ? [0.25 * Math.cos(t), 0.5, 0.25 * Math.sin(t)] : [0.45 * Math.cos(t), 0.5 + 0.28 * Math.cos(t), 0.45 * Math.sin(t)];
    const bot = (t: number): V3 => { const r = kind === "frustumcone" ? 0.5 : 0.45; return [r * Math.cos(t), yb, r * Math.sin(t)]; };
    const v: V3[] = [];
    for (let i = 0; i < CN; i++) v.push(top(th(i)));
    for (let i = 0; i < CN; i++) v.push(bot(th(i)));
    const f: number[][] = [Array.from({ length: CN }, (_, i) => i), Array.from({ length: CN }, (_, i) => CN + i)], g: number[] = [0, 1];
    for (let i = 0; i < CN; i++) { const j = (i + 1) % CN; f.push([i, j, CN + j, CN + i]); g.push(2); }
    const snaps: Snap[] = [{ p: kind === "frustumcone" ? [0, 0.5, 0] : [0, 0.5, 0], faces: [0], name: "O'" }, { p: [0, yb, 0], faces: [1], name: "O" },
      ...ringSnaps((t) => top(t), () => [0, 2]), ...ringSnaps((t) => bot(t), () => [1, 2])];
    m = buildC(v, f, g, [2], true, snaps);
  } else if (kind === "cap") {
    const R = 0.75, h = 0.55, a = Math.sqrt(R * R - (R - h) ** 2), yc = h / 2 - R, yb = -h / 2; // sphere centre at yc, apex at +h/2, base plane y = -h/2
    const maxT = Math.asin(a / R), RINGS = 14;
    const v: V3[] = [[0, h / 2, 0]];
    for (let k = 1; k <= RINGS; k++) { const t = (maxT * k) / RINGS; for (let i = 0; i < CN; i++) v.push([R * Math.sin(t) * Math.cos(th(i)), yc + R * Math.cos(t), R * Math.sin(t) * Math.sin(th(i))]); }
    const ring = (k: number, i: number) => 1 + (k - 1) * CN + (i % CN);
    const f: number[][] = [], g: number[] = [];
    for (let i = 0; i < CN; i++) { f.push([0, ring(1, i), ring(1, i + 1)]); g.push(1); }
    for (let k = 1; k < RINGS; k++) for (let i = 0; i < CN; i++) { f.push([ring(k, i), ring(k + 1, i), ring(k + 1, i + 1), ring(k, i + 1)]); g.push(1); }
    f.push(Array.from({ length: CN }, (_, i) => ring(RINGS, i))); g.push(0); // base disc (group 0), group 1 = dome
    const base = (t: number): V3 => [a * Math.cos(t), yb, a * Math.sin(t)];
    const snaps: Snap[] = [{ p: [0, h / 2, 0], faces: [1], name: "S" }, { p: [0, yb, 0], faces: [0], name: "O" }, ...ringSnaps(base, () => [0, 1])];
    m = buildC(v, f, g, [1], false, snaps);
    void yc;
  }
  cmeshCache.set(kind, m);
  return m;
}
export const isCurved = (k: SolidKind) => meshOf(k) === null && cmeshOf(k) === null;

/** Face ids: polyhedra = index in mesh.f; cylinder 0 top / 1 bottom / 2 lateral; cone 0 base / 1 lateral; sphere 0. */
export function faceCount(kind: SolidKind): number {
  const m = meshOf(kind);
  if (m) return m.f.length;
  const cm = cmeshOf(kind);
  if (cm) return cm.groups;
  return kind === "cylinder" ? 3 : kind === "cone" ? 2 : 1;
}
export const FACE_NAMES: Record<string, string[]> = { cylinder: ["top", "bottom", "side"], cone: ["base", "side"], sphere: ["surface"], frustumcone: ["top", "bottom", "side"], truncyl: ["top (slanted)", "bottom", "side"], cap: ["base", "dome"] };

export function boundRadius(kind: SolidKind): number {
  const m = meshOf(kind);
  if (m) return Math.max(...m.v.map((p) => Math.hypot(p[0], p[1], p[2])));
  const cm = cmeshOf(kind);
  if (cm) return Math.max(...cm.v.map((p) => Math.hypot(p[0], p[1], p[2])));
  if (kind === "sphere") return 0.5;
  return Math.hypot(R_CIRCLE, H_CYL / 2);
}

// ---- face normals / planes ---------------------------------------------------
interface Plane { n: V3; d: number }
const planeCache = new Map<SolidKind, Plane[]>();
function planes(kind: SolidKind): Plane[] {
  let c = planeCache.get(kind);
  if (c) return c;
  const m = meshOf(kind)!;
  c = m.f.map((idx) => {
    const pts = idx.map((i) => m.v[i]);
    let n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
    const cen: V3 = [0, 0, 0];
    pts.forEach((p) => { cen[0] += p[0] / pts.length; cen[1] += p[1] / pts.length; cen[2] += p[2] / pts.length; });
    if (dot(n, cen) < 0) n = [-n[0], -n[1], -n[2]]; // outward
    n = unit(n);
    return { n, d: dot(n, pts[0]) };
  });
  planeCache.set(kind, c);
  return c;
}

function lateralNormal(kind: SolidKind, t: number): V3 {
  return kind === "cone" ? [H_CYL * Math.cos(t), R_CIRCLE, H_CYL * Math.sin(t)] : [Math.cos(t), 0, Math.sin(t)];
}
/** Is face `f` facing the viewer? `theta` is only needed for the lateral face of cylinders/cones. */
function faceFront(kind: SolidKind, f: number, R: (v: V3) => V3, theta = 0, at?: V3): boolean {
  const m = meshOf(kind);
  if (m) return R(planes(kind)[f].n)[2] > 1e-9;
  const cm = cmeshOf(kind);
  if (cm) { // group f: use the polygon of the group nearest to the point (a curved group faces different ways in different places)
    let best = -1, bd = Infinity;
    cm.f.forEach((idx, i) => {
      if (cm.g[i] !== f) return;
      let d = 0;
      if (at) { const c: V3 = [0, 0, 0]; idx.forEach((k) => { c[0] += cm.v[k][0] / idx.length; c[1] += cm.v[k][1] / idx.length; c[2] += cm.v[k][2] / idx.length; }); d = Math.hypot(c[0] - at[0], c[1] - at[1], c[2] - at[2]); }
      if (d < bd) { bd = d; best = i; }
    });
    return best >= 0 && R(cm.normals[best])[2] > 1e-9;
  }
  if (kind === "sphere") return true;
  const lateral = kind === "cylinder" ? 2 : 1;
  if (f === lateral) return R(lateralNormal(kind, theta))[2] > 0;
  const up = kind === "cylinder" && f === 0;
  return R(up ? [0, 1, 0] : [0, -1, 0])[2] > 0;
}

// ---- snap targets (where points/lines can be attached) --------------------------
export interface Snap { p: V3; faces: number[]; name: string }
const snapCache = new Map<SolidKind, Snap[]>();
export function snapTargets(kind: SolidKind): Snap[] {
  let c = snapCache.get(kind);
  if (c) return c;
  c = [];
  const cm0 = cmeshOf(kind);
  if (cm0) { snapCache.set(kind, cm0.snaps); return cm0.snaps; }
  const m = meshOf(kind);
  if (m) {
    m.v.forEach((p, i) => c!.push({ p, faces: m.f.flatMap((f, fi) => (f.includes(i) ? [fi] : [])), name: m.names[i] }));
    const seen = new Map<string, number[]>();
    m.f.forEach((idx, fi) => idx.forEach((a, k) => { const b = idx[(k + 1) % idx.length]; const key = a < b ? `${a}-${b}` : `${b}-${a}`; (seen.get(key) ?? seen.set(key, []).get(key)!).push(fi); }));
    for (const [key, fs] of seen) { const [a, b] = key.split("-").map(Number); c.push({ p: [(m.v[a][0] + m.v[b][0]) / 2, (m.v[a][1] + m.v[b][1]) / 2, (m.v[a][2] + m.v[b][2]) / 2], faces: fs, name: "" }); }
    m.f.forEach((idx, fi) => { const p: V3 = [0, 0, 0]; idx.forEach((i) => { p[0] += m.v[i][0] / idx.length; p[1] += m.v[i][1] / idx.length; p[2] += m.v[i][2] / idx.length; }); c!.push({ p, faces: [fi], name: "" }); });
  } else if (kind === "cylinder") {
    c.push({ p: [0, 0.5, 0], faces: [0], name: "O'" }, { p: [0, -0.5, 0], faces: [1], name: "O" });
    for (let i = 0; i < 8; i++) { const t = (Math.PI * 2 * i) / 8, x = R_CIRCLE * Math.cos(t), z = R_CIRCLE * Math.sin(t); c.push({ p: [x, 0.5, z], faces: [0, 2], name: "" }, { p: [x, -0.5, z], faces: [1, 2], name: "" }); }
  } else if (kind === "cone") {
    c.push({ p: [0, 0.5, 0], faces: [1], name: "S" }, { p: [0, -0.5, 0], faces: [0], name: "O" });
    for (let i = 0; i < 8; i++) { const t = (Math.PI * 2 * i) / 8; c.push({ p: [R_CIRCLE * Math.cos(t), -0.5, R_CIRCLE * Math.sin(t)], faces: [0, 1], name: "" }); }
  }
  snapCache.set(kind, c);
  return c;
}

// ---- line visibility ---------------------------------------------------------------
function lineHidden(kind: SolidKind, R: (v: V3) => V3, a: Mark, b: Mark): boolean {
  let common = a.faces.filter((f) => b.faces.includes(f));
  const cm = cmeshOf(kind);
  if (cm) {
    const ta = Math.atan2(a.p[2], a.p[0]), tb = Math.atan2(b.p[2], b.p[0]);
    const generator = cm.generators && Math.abs(Math.atan2(Math.sin(ta - tb), Math.cos(ta - tb))) < 1e-6;
    if (!generator) common = common.filter((f) => !cm.curved.has(f)); // a chord between two points of a curved face passes through the solid
    if (!common.length) return true;
    const mid: V3 = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2, (a.p[2] + b.p[2]) / 2];
    return !common.some((f) => faceFront(kind, f, R, 0, mid));
  }
  if (isCurved(kind) && kind !== "sphere") {
    const lateral = kind === "cylinder" ? 2 : 1;
    const ta = Math.atan2(a.p[2], a.p[0]), tb = Math.atan2(b.p[2], b.p[0]);
    const apex = kind === "cone" && (a.faces.length === 1 && a.faces[0] === 1 || b.faces.length === 1 && b.faces[0] === 1);
    const generator = apex || Math.abs(Math.atan2(Math.sin(ta - tb), Math.cos(ta - tb))) < 1e-6; // lies on the side surface
    if (!generator) common = common.filter((f) => f !== lateral);
  }
  if (!common.length) return true; // passes through the inside of the solid
  const mid: V3 = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2, (a.p[2] + b.p[2]) / 2];
  const th = Math.atan2(mid[2], mid[0]);
  return !common.some((f) => faceFront(kind, f, R, th));
}

// ---- projection ------------------------------------------------------------------------
export function runs(p: [number, number][], vis: boolean[]): Path[] {
  const out: Path[] = [];
  let cur: Path | null = null;
  for (let i = 0; i < vis.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    if (!cur || cur.hidden === vis[i]) { if (cur) out.push(cur); cur = { pts: [a[0], a[1]], hidden: !vis[i] }; }
    cur.pts.push(b[0], b[1]);
  }
  if (cur) out.push(cur);
  return out;
}

export function project(s: ProjIn): Projection {
  const R = rotator(s.yaw, s.pitch, s.roll);
  const P = (v: V3): [number, number] => { const r = R(v); return [r[0], -r[1]]; };
  const paths: Path[] = [];
  const faces: Face[] = [];
  const kind = s.kind;
  const mesh = meshOf(kind);

  if (mesh) {
    const pl = planes(kind);
    const front = pl.map((p) => R(p.n)[2] > 1e-9);
    const edgeFaces = new Map<string, number[]>();
    mesh.f.forEach((idx, fi) => idx.forEach((a, k) => { const b = idx[(k + 1) % idx.length]; const key = a < b ? `${a}-${b}` : `${b}-${a}`; (edgeFaces.get(key) ?? edgeFaces.set(key, []).get(key)!).push(fi); }));
    for (const [key, fs] of edgeFaces) {
      const [a, b] = key.split("-").map(Number);
      const pa = P(mesh.v[a]), pb = P(mesh.v[b]);
      paths.push({ pts: [pa[0], pa[1], pb[0], pb[1]], hidden: !fs.some((f) => front[f]) });
    }
    mesh.f.forEach((idx, fi) => {
      if (!front[fi]) return;
      faces.push({ id: fi, pts: idx.flatMap((i) => P(mesh.v[i])), z: idx.reduce((z, i) => z + R(mesh.v[i])[2], 0) / idx.length });
    });
    faces.sort((a, b) => a.z - b.z);
  } else if (cmeshOf(kind)) {
    const cm = cmeshOf(kind)!;
    const front = cm.normals.map((n) => R(n)[2] > 1e-9);
    const edgeFaces = new Map<string, number[]>();
    cm.f.forEach((idx, fi) => idx.forEach((a, k) => { const b = idx[(k + 1) % idx.length]; const key = a < b ? `${a}-${b}` : `${b}-${a}`; (edgeFaces.get(key) ?? edgeFaces.set(key, []).get(key)!).push(fi); }));
    for (const [key, fs] of edgeFaces) {
      const feature = fs.some((f) => cm.g[f] !== cm.g[fs[0]]);
      const sil = fs.length === 2 && front[fs[0]] !== front[fs[1]];
      if (!feature && !sil) continue;
      const [a, b] = key.split("-").map(Number);
      const pa = P(cm.v[a]), pb = P(cm.v[b]);
      paths.push({ pts: [pa[0], pa[1], pb[0], pb[1]], hidden: feature && !fs.some((f) => front[f]) });
    }
    cm.f.forEach((idx, fi) => {
      if (!front[fi]) return;
      faces.push({ id: cm.g[fi], pts: idx.flatMap((i) => P(cm.v[i])), z: idx.reduce((z, i) => z + R(cm.v[i])[2], 0) / idx.length });
    });
    faces.sort((a, b) => a.z - b.z);
  } else if (kind === "sphere") {
    const r = 0.5;
    const outline = Array.from({ length: N }, (_, i) => [r * Math.cos((2 * Math.PI * i) / N), r * Math.sin((2 * Math.PI * i) / N)] as [number, number]);
    paths.push({ pts: [...outline.flat(), outline[0][0], outline[0][1]], hidden: false });
    faces.push({ id: 0, pts: outline.flat(), z: 0 });
    for (const plane of [0, 1]) {
      const ring = Array.from({ length: N }, (_, i) => { const t = (2 * Math.PI * i) / N, c = r * Math.cos(t), sn = r * Math.sin(t); return plane === 0 ? ([c, 0, sn] as V3) : ([0, c, sn] as V3); });
      paths.push(...runs(ring.map(P), ring.map((v, i) => R(v)[2] + R(ring[(i + 1) % N])[2] >= 0)));
    }
  } else {
    const cone = kind === "cone";
    const r = R_CIRCLE, h = H_CYL;
    const ring = (y: number) => Array.from({ length: N }, (_, i) => { const t = (2 * Math.PI * i) / N; return [r * Math.cos(t), y, r * Math.sin(t)] as V3; });
    const theta = (i: number) => (2 * Math.PI * i) / N;
    const latFront = (t: number) => faceFront(kind, cone ? 1 : 2, R, t);
    const mid = (i: number) => theta(i + 0.5);
    const topFront = !cone && faceFront(kind, 0, R), botFront = faceFront(kind, cone ? 0 : 1, R);
    const bot = ring(-h / 2), top = ring(h / 2);
    const botP = bot.map(P), topP = top.map(P);
    paths.push(...runs(botP, bot.map((_, i) => latFront(mid(i)) || botFront)));
    const apex: V3 = [0, h / 2, 0];
    if (!cone) paths.push(...runs(topP, top.map((_, i) => latFront(mid(i)) || topFront)));
    // silhouette generators
    const sil: number[] = [];
    if (cone) {
      const A = h * R([1, 0, 0])[2], B = h * R([0, 0, 1])[2], C = -r * R([0, 1, 0])[2], m = Math.hypot(A, B);
      if (m >= Math.abs(C) && m > 1e-9) { const base = Math.atan2(B, A), d = Math.acos(C / m); sil.push(base + d, base - d); }
    } else {
      const A = R([1, 0, 0])[2], B = R([0, 0, 1])[2];
      if (Math.hypot(A, B) > 1e-9) { const t = Math.atan2(A, -B); sil.push(t, t + Math.PI); }
    }
    for (const t of sil) {
      const lo: V3 = [r * Math.cos(t), -h / 2, r * Math.sin(t)], hi: V3 = cone ? apex : [r * Math.cos(t), h / 2, r * Math.sin(t)];
      const a = P(lo), b = P(hi);
      paths.push({ pts: [a[0], a[1], b[0], b[1]], hidden: false });
    }
    // faces
    const vis = Array.from({ length: N }, (_, i) => latFront(theta(i)));
    let start = vis.findIndex((v, i) => v && !vis[(i + N - 1) % N]);
    const arc: number[] = [];
    if (start < 0 && vis.every(Boolean)) { start = 0; }
    if (start >= 0) for (let k = 0; k < N; k++) { const i = (start + k) % N; if (!vis[i]) break; arc.push(i); }
    if (arc.length > 1) {
      const lat = cone ? [...P(apex), ...arc.flatMap((i) => botP[i])] : [...arc.flatMap((i) => topP[i]), ...[...arc].reverse().flatMap((i) => botP[i])];
      faces.push({ id: cone ? 1 : 2, pts: lat, z: -1 });
    }
    if (botFront) faces.push({ id: cone ? 0 : 1, pts: botP.flat(), z: 1 });
    if (topFront) faces.push({ id: 0, pts: topP.flat(), z: 1 });
  }

  // points and segments anchored on the solid
  const lines: Path[] = [], dots: Dot[] = [], vlabels: Dot[] = [];
  const marks = s.marks ?? [];
  const byId = new Map(marks.map((m) => [m.id, m]));
  for (const [i, j] of s.lines ?? []) {
    const a = byId.get(i), b = byId.get(j);
    if (!a || !b) continue;
    const pa = P(a.p), pb = P(b.p);
    lines.push({ pts: [pa[0], pa[1], pb[0], pb[1]], hidden: lineHidden(kind, R, a, b) });
  }
  const markHidden = (m: Mark) => !m.faces.some((f) => faceFront(kind, f, R, Math.atan2(m.p[2], m.p[0]), m.p));
  const vnames = new Set(snapTargets(kind).map((t) => t.name).filter(Boolean));
  for (const m of marks) { const q = P(m.p); dots.push({ x: q[0], y: q[1], name: s.labels && vnames.has(m.name) ? "" : m.name, hidden: markHidden(m) }); }
  if (s.labels) for (const sn of snapTargets(kind)) {
    if (!sn.name) continue;
    const q = P(sn.p), l = Math.hypot(q[0], q[1]) || 1;
    vlabels.push({ x: q[0] + (q[0] / l) * 0.09 + 0.02, y: q[1] + (q[1] / l) * 0.09, name: sn.name, hidden: markHidden({ id: "", p: sn.p, faces: sn.faces, name: sn.name }) });
  }
  return { paths, faces, lines, dots, vlabels, radius: boundRadius(kind) };
}

// ---- picking ------------------------------------------------------------------------------
function inPoly(pts: number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Front-most visible face under unit-space point (u,v), or null. */
export function pickFace(s: ProjIn, u: number, v: number): number | null {
  const fs = project({ kind: s.kind, yaw: s.yaw, pitch: s.pitch, roll: s.roll }).faces;
  for (let i = fs.length - 1; i >= 0; i--) if (inPoly(fs[i].pts, u, v)) return fs[i].id;
  return null;
}
/** Nearest snap target within `thr` (unit space), preferring named vertices. */
export function pickSnap(s: ProjIn, u: number, v: number, thr: number): Snap | null {
  const R = rotator(s.yaw, s.pitch, s.roll);
  let best: Snap | null = null, bd = Infinity;
  for (const sn of snapTargets(s.kind)) {
    const q = R(sn.p), d = Math.hypot(q[0] - u, -q[1] - v) * (sn.name ? 0.7 : 1); // vertices win ties
    if (d < thr && d < bd) { bd = d; best = sn; }
  }
  return best;
}
/** 3D point on face `f` under unit-space (u,v) (polyhedra only; curved solids use snap targets). */
export function facePoint(s: ProjIn, f: number, u: number, v: number): V3 | null {
  if (!meshOf(s.kind)) return null;
  const R = rotator(s.yaw, s.pitch, s.roll), inv = invRotator(s.yaw, s.pitch, s.roll);
  const pl = planes(s.kind)[f];
  const n = R(pl.n); // plane in view space: n·X = d (d is rotation-invariant)
  if (Math.abs(n[2]) < 1e-6) return null;
  const X = u, Y = -v;
  const Z = (pl.d - n[0] * X - n[1] * Y) / n[2];
  return inv([X, Y, Z]);
}
/** Which faces does a 3D point on a polyhedron lie on? */
export function facesAt(kind: SolidKind, p: V3): number[] {
  const m = meshOf(kind);
  if (!m) return [];
  return planes(kind).flatMap((pl, i) => (Math.abs(dot(pl.n, p) - pl.d) < 1e-4 ? [i] : []));
}
