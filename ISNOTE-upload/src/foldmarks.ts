// Everything drawn on a solid while it folds: points, lines and vertex names ride on their faces; picking works on the folded geometry. Pure, no DOM.
import type { Mark, Section, Solid, SolidKind } from "./model.ts";
import { candidateSections } from "./sections.ts";
import { isPlanarFace, foldModel, foldNormalOnFace, foldToSolid, foldToSolidVec, foldPointOnFace, closedFrame, projectFold, pickFoldFace, foldRadius, canFold, type FoldIn } from "./fold.ts";
import { invRotator, meshOf, rotator, snapTargets, facesAt, type V3 } from "./solids.ts";

export interface FDot { x: number; y: number; name: string; hidden: boolean; id?: string }
export interface FLine { pts: number[]; hidden: boolean; alpha: number }
export interface FoldMarks { dots: FDot[]; lines: FLine[]; vlabels: FDot[] }
export type FoldSolid = Pick<Solid, "kind" | "yaw" | "pitch" | "roll"> & Partial<Pick<Solid, "marks" | "lines" | "labels">> & { fold: number };

const same = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-7);
const unitV = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Faces on which a straight line between two marks can lie: faces that contain both; on curved lateral faces only along a generator. */
export function commonFaces(kind: SolidKind, a: Mark, b: Mark): number[] {
  let common = a.faces.filter((f) => b.faces.includes(f));
  if (!meshOf(kind)) {
    const lateral = kind === "cylinder" || kind === "frustumcone" ? 2 : 1;
    const ta = Math.atan2(a.p[2], a.p[0]), tb = Math.atan2(b.p[2], b.p[0]);
    const apex = kind === "cone" && ((a.faces.length === 1 && a.faces[0] === 1) || (b.faces.length === 1 && b.faces[0] === 1));
    const generator = apex || Math.abs(Math.atan2(Math.sin(ta - tb), Math.cos(ta - tb))) < 1e-6;
    if (!generator) common = common.filter((f) => f !== lateral);
  }
  return common;
}

/** Marks, segments and vertex names of a folding solid, in unit screen space (like solids.project). */
export function foldMarks(s: FoldSolid): FoldMarks {
  const R = rotator(s.yaw, s.pitch, s.roll), t = s.fold;
  const P = (v: V3): [number, number] => { const r = R(v); return [r[0], -r[1]]; };
  const at = (face: number, p: V3) => {
    const v = foldPointOnFace(s.kind, t, face, p), n = foldNormalOnFace(s.kind, t, face, p);
    if (!v) return null;
    return { xy: P(foldToSolid(s.kind, v, t)), front: n ? R(foldToSolidVec(s.kind, n, t))[2] > 1e-9 : true };
  };
  const marks = s.marks ?? [], byId = new Map(marks.map((m) => [m.id, m]));
  const dots: FDot[] = [];
  const names = new Set(snapTargets(s.kind).map((q) => q.name).filter(Boolean));
  for (const m of marks) {
    const seen: [number, number][] = [];
    for (const f of m.faces) {
      const q = at(f, m.p);
      if (!q) continue;
      const k = seen.findIndex((o) => same(o, q.xy)); // copies that coincide (the hinge, or the closed solid) are drawn once; a visible copy wins
      if (k >= 0) { if (q.front) dots[dots.length - seen.length + k].hidden = false; continue; }
      seen.push(q.xy);
      dots.push({ x: q.xy[0], y: q.xy[1], name: s.labels && names.has(m.name) ? "" : m.name, hidden: !q.front, id: m.id });
    }
  }
  const lines: FLine[] = [];
  for (const [i, j] of s.lines ?? []) {
    const a = byId.get(i), b = byId.get(j);
    if (!a || !b) continue;
    const faces = commonFaces(s.kind, a, b);
    if (!faces.length) { // passes through the inside of the solid: cannot lie on the net, so it fades out as the model flattens
      const pa = at(a.faces[0], a.p), pb = at(b.faces[0], b.p);
      if (pa && pb) lines.push({ pts: [pa.xy[0], pa.xy[1], pb.xy[0], pb.xy[1]], hidden: true, alpha: Math.max(0, Math.min(1, t)) });
      continue;
    }
    const out: FLine[] = [];
    for (const f of faces) {
      const pa = at(f, a.p), pb = at(f, b.p);
      if (!pa || !pb) continue;
      const pts = [pa.xy[0], pa.xy[1], pb.xy[0], pb.xy[1]], hidden = !pa.front;
      const k = out.findIndex((o) => same(o.pts, pts));
      if (k >= 0) { if (!hidden) out[k].hidden = false; } else out.push({ pts, hidden, alpha: 1 });
    }
    lines.push(...out);
  }
  const vlabels: FDot[] = [];
  if (s.labels) for (const sn of snapTargets(s.kind)) {
    if (!sn.name) continue;
    const seen: [number, number][] = [];
    for (const f of sn.faces) {
      const q = at(f, sn.p);
      if (!q) continue;
      const k = seen.findIndex((o) => same(o, q.xy));
      if (k >= 0) { if (q.front) vlabels[vlabels.length - seen.length + k].hidden = false; continue; }
      seen.push(q.xy);
      const l = Math.hypot(q.xy[0], q.xy[1]) || 1;
      vlabels.push({ x: q.xy[0] + (q.xy[0] / l) * 0.09 + 0.02, y: q.xy[1] + (q.xy[1] / l) * 0.09, name: sn.name, hidden: !q.front });
    }
  }
  return { dots, lines, vlabels };
}

// ---- picking on the folded model -----------------------------------------------------------------------------
export interface FoldHit { p: V3; faces: number[]; name: string }

/** Closed-solid point under unit-space (u,v) on a folded planar face (polyhedra), or null. */
function unproject(s: FoldIn, face: number, u: number, v: number): V3 | null {
  const m = foldModel(s.kind, s.fold), f = closedFrame(s.kind, face);
  if (!m || !f) return null;
  const g = m.faces[face];
  if (!g.n) return null;
  const R = rotator(s.yaw, s.pitch, s.roll), inv = invRotator(s.yaw, s.pitch, s.roll);
  const g0 = foldToSolid(s.kind, g.pts[0], s.fold), g1 = foldToSolid(s.kind, g.pts[1], s.fold), gn = foldToSolidVec(s.kind, g.n, s.fold);
  const nv = R(gn), d = nv[0] * R(g0)[0] + nv[1] * R(g0)[1] + nv[2] * R(g0)[2];
  if (Math.abs(nv[2]) < 1e-6) return null;
  const X = u, Y = -v, Z = (d - nv[0] * X - nv[1] * Y) / nv[2];
  const w = inv([X, Y, Z]);
  const e1 = unitV([g1[0] - g0[0], g1[1] - g0[1], g1[2] - g0[2]]);
  const e2: V3 = [gn[1] * e1[2] - gn[2] * e1[1], gn[2] * e1[0] - gn[0] * e1[2], gn[0] * e1[1] - gn[1] * e1[0]];
  const q: V3 = [w[0] - g0[0], w[1] - g0[1], w[2] - g0[2]];
  const a = q[0] * e1[0] + q[1] * e1[1] + q[2] * e1[2], b = q[0] * e2[0] + q[1] * e2[1] + q[2] * e2[2];
  return [f.v0[0] + a * f.e1[0] + b * f.e2[0], f.v0[1] + a * f.e1[1] + b * f.e2[1], f.v0[2] + a * f.e1[2] + b * f.e2[2]];
}

/** Snap target (vertex, midpoint, face centre) or free point of a face under (u,v) on the folded model. `thr` is in unit space. */
export function pickFolded(s: FoldIn, u: number, v: number, thr: number): FoldHit | null {
  const R = rotator(s.yaw, s.pitch, s.roll);
  let best: FoldHit | null = null, bd = Infinity;
  for (const sn of snapTargets(s.kind)) for (const f of sn.faces) {
    const q0 = foldPointOnFace(s.kind, s.fold, f, sn.p), n0 = foldNormalOnFace(s.kind, s.fold, f, sn.p);
    const q = q0 && foldToSolid(s.kind, q0, s.fold), n = n0 && foldToSolidVec(s.kind, n0, s.fold);
    if (!q || (n && R(n)[2] <= 1e-9)) continue; // only copies that face the viewer
    const r = R(q), d = Math.hypot(r[0] - u, -r[1] - v) * (sn.name ? 0.7 : 1);
    if (d < thr && d < bd) { bd = d; best = { p: sn.p, faces: sn.faces, name: sn.name }; }
  }
  if (best || !meshOf(s.kind)) return best;
  const f = pickFoldFace(s, u, v);
  if (f === null) return null;
  const p = unproject(s, f, u, v);
  if (!p) return null;
  const fa = facesAt(s.kind, p);
  return { p, faces: fa.length ? fa : [f], name: "" };
}
export { projectFold, foldRadius, canFold };


// ---- cross-sections -------------------------------------------------------------------------------------------
export interface SecPoly { marks: string[]; color: string | null; pts: number[]; alpha: number; area: number }
const shoelace = (p: number[]): number => { let a = 0; for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length; a += p[i] * p[j + 1] - p[j] * p[i + 1]; } return Math.abs(a) / 2; };

/**
 * Projected polygons of sections (unit screen space). A section lying on one outer face unfolds with that face; any other section is inside the solid,
 * so while the model flattens it fades out (opacity t: 1 at t = 1, 0 at t = 0), like an interior line.
 */
export function sectionPolys(s: FoldSolid & { sections?: Section[] }, secs: Section[]): SecPoly[] {
  const R = rotator(s.yaw, s.pitch, s.roll), t = s.fold;
  const P = (v: V3): [number, number] => { const r = R(v); return [r[0], -r[1]]; };
  const byId = new Map((s.marks ?? []).map((m) => [m.id, m]));
  const closed = t >= 0.9999 || !canFold(s.kind);
  const out: SecPoly[] = [];
  for (const sec of secs) {
    const ms = sec.marks.map((id) => byId.get(id));
    if (ms.length < 3 || ms.some((m) => !m)) continue;
    const marks = ms as Mark[];
    let pts: number[] = [], alpha = 1;
    const common = marks.reduce((acc, m) => acc.filter((f) => m.faces.includes(f)), marks[0].faces).filter((f) => isPlanarFace(s.kind, f));
    if (closed) pts = marks.flatMap((m) => P(m.p));
    else if (common.length) pts = marks.flatMap((m) => { const v = foldPointOnFace(s.kind, t, common[0], m.p); return v ? P(foldToSolid(s.kind, v, t)) : [NaN, NaN]; });
    else { alpha = Math.max(0, Math.min(1, t)); pts = marks.flatMap((m) => { const v = foldPointOnFace(s.kind, t, m.faces[0], m.p); return v ? P(foldToSolid(s.kind, v, t)) : [NaN, NaN]; }); }
    if (!pts.every(Number.isFinite)) continue;
    out.push({ marks: sec.marks, color: sec.color, pts, alpha, area: shoelace(pts) });
  }
  return out;
}
const insidePoly = (pts: number[], x: number, y: number): boolean => {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) if (pts[i + 1] > y !== pts[j + 1] > y && x < ((pts[j] - pts[i]) * (y - pts[i + 1])) / (pts[j + 1] - pts[i + 1]) + pts[i]) inside = !inside;
  return inside;
};
/** The smallest section (stored or detected loop) whose projected polygon contains unit-space (u,v), or null. */
export function pickSection(s: FoldSolid & { sections?: Section[] }, u: number, v: number): Section | null {
  const cands = candidateSections(s.kind, s.marks ?? [], s.lines ?? [], s.sections);
  const polys = sectionPolys(s, cands).filter((p) => p.alpha > 0.05 && p.area > 1e-6 && insidePoly(p.pts, u, v));
  if (!polys.length) return null;
  polys.sort((a, b) => a.area - b.area);
  return { marks: polys[0].marks, color: polys[0].color };
}
