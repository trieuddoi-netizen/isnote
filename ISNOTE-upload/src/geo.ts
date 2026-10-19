// Dynamic geometry: constructed points/lines evaluated from their parents, and the construction table used by the UI. Pure, no DOM.
import type { GeoCircle, GeoDef, GeoLine, GeoPoint, Obj, Page } from "./model.ts";

type V = [number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k];
const len = (a: V) => Math.hypot(a[0], a[1]);
const unit = (a: V): V => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const cross = (a: V, b: V) => a[0] * b[1] - a[1] * b[0];
const dotp = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];

export const byId = (page: Page, id: string): Obj | undefined => page.objects.find((o) => o.id === id);
const pt = (page: Page, id: string): V | null => { const o = byId(page, id); return o && o.t === "gpoint" ? [o.x, o.y] : null; };

/** Every object id that `o` is built from (used to delete dependants together with their parents). */
export function refsOf(o: Obj): string[] {
  switch (o.t) {
    case "gseg": return [o.a, o.b];
    case "gcircle": return [o.c, o.p];
    case "gline": return [o.p, ...(o.q ? [o.q] : []), ...(o.par ? [o.par] : []), ...(o.perp ? [o.perp] : []), ...(o.bis ?? [])];
    case "gpoly": return o.pts;
    case "gangle": return [o.a, o.b, o.c];
    case "gmark": return [o.seg];
    case "gpoint": {
      const d = o.def;
      if (!d) return [];
      switch (d.k) {
        case "mid": return [d.a, d.b];
        case "foot": case "reflL": return [d.p, d.l];
        case "inter": return [d.a, d.b];
        case "cen": return [d.a, d.b, d.c];
        case "reflP": case "rot": case "dil": return [d.p, d.c];
        case "trans": return [d.p, d.a, d.b];
      }
    }
  }
  return [];
}

export interface Ln { p: V; d: V } // point and unit direction
/** The straight line carried by a segment or line object, or null if it cannot be computed. */
export function lineOf(page: Page, id: string): Ln | null {
  const o = byId(page, id);
  if (!o) return null;
  if (o.t === "gseg") { const a = pt(page, o.a), b = pt(page, o.b); return a && b && len(sub(b, a)) > 1e-9 ? { p: a, d: unit(sub(b, a)) } : null; }
  if (o.t !== "gline") return null;
  const p = pt(page, o.p);
  if (!p) return null;
  if (o.q) { const q = pt(page, o.q); return q && len(sub(q, p)) > 1e-9 ? { p, d: unit(sub(q, p)) } : null; }
  if (o.par) { const l = lineOf(page, o.par); return l ? { p, d: l.d } : null; }
  if (o.perp) { const l = lineOf(page, o.perp); return l ? { p, d: [-l.d[1], l.d[0]] } : null; }
  if (o.bis) {
    const a = pt(page, o.bis[0]), c = pt(page, o.bis[2]);
    if (!a || !c) return null;
    const u = add(unit(sub(a, p)), unit(sub(c, p)));
    return len(u) < 1e-9 ? { p, d: unit([-(a[1] - p[1]), a[0] - p[0]]) } : { p, d: unit(u) }; // straight angle: perpendicular
  }
  return null;
}
export interface Circ { c: V; r: number }
export function circleOf(page: Page, id: string): Circ | null {
  const o = byId(page, id);
  if (!o || o.t !== "gcircle") return null;
  const c = pt(page, o.c), p = pt(page, o.p);
  return c && p ? { c, r: len(sub(p, c)) } : null;
}

export const footOn = (p: V, l: Ln): V => add(l.p, mul(l.d, dotp(sub(p, l.p), l.d)));
export const reflectLine = (p: V, l: Ln): V => { const f = footOn(p, l); return sub(mul(f, 2), p); };
export function rotateAbout(p: V, c: V, deg: number): V {
  const a = (deg * Math.PI) / 180, v = sub(p, c);
  return add(c, [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)]);
}

export function circumcenter(a: V, b: V, c: V): V | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a[0] ** 2 + a[1] ** 2, b2 = b[0] ** 2 + b[1] ** 2, c2 = c[0] ** 2 + c[1] ** 2;
  return [(a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d, (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d];
}
export function triangleCenter(type: "centroid" | "ortho" | "circum" | "in", a: V, b: V, c: V): V | null {
  if (type === "centroid") return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
  if (type === "circum") return circumcenter(a, b, c);
  if (type === "ortho") { const o = circumcenter(a, b, c); return o ? [a[0] + b[0] + c[0] - 2 * o[0], a[1] + b[1] + c[1] - 2 * o[1]] : null; }
  const la = len(sub(b, c)), lb = len(sub(a, c)), lc = len(sub(a, b)), s = la + lb + lc; // incentre: weights = opposite side lengths
  return s < 1e-9 ? null : [(la * a[0] + lb * b[0] + lc * c[0]) / s, (la * a[1] + lb * b[1] + lc * c[1]) / s];
}

/** Intersections of two lines / a line and a circle / two circles (sorted so index 0 and 1 are stable). */
export function intersections(page: Page, ida: string, idb: string): V[] {
  const A = byId(page, ida), B = byId(page, idb);
  if (!A || !B) return [];
  const isCirc = (o: Obj) => o.t === "gcircle";
  if (!isCirc(A) && !isCirc(B)) {
    const l1 = lineOf(page, ida), l2 = lineOf(page, idb);
    if (!l1 || !l2) return [];
    const den = cross(l1.d, l2.d);
    if (Math.abs(den) < 1e-9) return [];
    return [add(l1.p, mul(l1.d, cross(sub(l2.p, l1.p), l2.d) / den))];
  }
  if (isCirc(A) && isCirc(B)) {
    const c1 = circleOf(page, ida), c2 = circleOf(page, idb);
    if (!c1 || !c2) return [];
    const d = len(sub(c2.c, c1.c));
    if (d < 1e-9 || d > c1.r + c2.r + 1e-9 || d < Math.abs(c1.r - c2.r) - 1e-9) return [];
    const x = (d * d + c1.r ** 2 - c2.r ** 2) / (2 * d), h = Math.sqrt(Math.max(0, c1.r ** 2 - x * x));
    const u = unit(sub(c2.c, c1.c)), base = add(c1.c, mul(u, x)), n: V = [-u[1], u[0]];
    return h < 1e-9 ? [base] : [add(base, mul(n, h)), sub(base, mul(n, h))];
  }
  const circ = circleOf(page, isCirc(A) ? ida : idb), l = lineOf(page, isCirc(A) ? idb : ida);
  if (!circ || !l) return [];
  const f = footOn(circ.c, l), d = len(sub(f, circ.c));
  if (d > circ.r + 1e-9) return [];
  const h = Math.sqrt(Math.max(0, circ.r ** 2 - d * d));
  return h < 1e-9 ? [f] : [add(f, mul(l.d, h)), sub(f, mul(l.d, h))];
}

/** Evaluate a point definition; null when its parents are missing or degenerate. */
export function evalDef(page: Page, d: GeoDef): V | null {
  switch (d.k) {
    case "mid": { const a = pt(page, d.a), b = pt(page, d.b); return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null; }
    case "foot": { const p = pt(page, d.p), l = lineOf(page, d.l); return p && l ? footOn(p, l) : null; }
    case "inter": return intersections(page, d.a, d.b)[d.i] ?? null;
    case "cen": { const a = pt(page, d.a), b = pt(page, d.b), c = pt(page, d.c); return a && b && c ? triangleCenter(d.type, a, b, c) : null; }
    case "reflL": { const p = pt(page, d.p), l = lineOf(page, d.l); return p && l ? reflectLine(p, l) : null; }
    case "reflP": { const p = pt(page, d.p), c = pt(page, d.c); return p && c ? sub(mul(c, 2), p) : null; }
    case "trans": { const p = pt(page, d.p), a = pt(page, d.a), b = pt(page, d.b); return p && a && b ? add(p, sub(b, a)) : null; }
    case "rot": { const p = pt(page, d.p), c = pt(page, d.c); return p && c ? rotateAbout(p, c, d.deg) : null; }
    case "dil": { const p = pt(page, d.p), c = pt(page, d.c); return p && c ? add(c, mul(sub(p, c), d.f)) : null; }
  }
}
/** Recompute every constructed point (parents always come earlier in the object list). */
export function resolveGeo(page: Page): void {
  for (const o of page.objects) {
    if (o.t !== "gpoint" || !o.def) continue;
    const v = evalDef(page, o.def);
    if (v) { o.x = v[0]; o.y = v[1]; }
  }
}

/** Angle in degrees at b between rays ba and bc (0..180). */
export function angleAt(a: V, b: V, c: V): number {
  const u = unit(sub(a, b)), w = unit(sub(c, b));
  return (Math.acos(Math.max(-1, Math.min(1, dotp(u, w)))) * 180) / Math.PI;
}

// ---- constructions (used by the geometry menu) -----------------------------------------------------
export type Need = "point" | "line" | "circle" | "lineOrCircle";
export interface Ctx { uid: () => string; label: () => string; page: Page; rotDeg: number; dilK: number }
export interface Construction { needs: Need[]; build: (ids: string[], c: Ctx) => Obj[] }
const P = (c: Ctx, def: GeoDef, over: Partial<GeoPoint> = {}): GeoPoint => ({ t: "gpoint", id: c.uid(), x: 0, y: 0, label: c.label(), def, ...over });

export const CONSTRUCTIONS: Record<string, Construction> = {
  midpoint: { needs: ["point", "point"], build: ([a, b], c) => [P(c, { k: "mid", a, b })] },
  line: { needs: ["point", "point"], build: ([p, q], c) => [{ t: "gline", id: c.uid(), p, q }] },
  ray: { needs: ["point", "point"], build: ([p, q], c) => [{ t: "gline", id: c.uid(), p, q, ray: true }] },
  perpendicular: { needs: ["point", "line"], build: ([p, l], c) => [{ t: "gline", id: c.uid(), p, perp: l }] },
  parallel: { needs: ["point", "line"], build: ([p, l], c) => [{ t: "gline", id: c.uid(), p, par: l }] },
  altitude: { needs: ["point", "line"], build: ([p, l], c) => { const f = P(c, { k: "foot", p, l }); return [f, { t: "gseg", id: c.uid(), a: p, b: f.id }]; } },
  intersection: { needs: ["lineOrCircle", "lineOrCircle"], build: ([a, b], c) => {
    const n = Math.max(1, intersections(c.page, a, b).length);
    return Array.from({ length: Math.min(2, n) }, (_, i) => P(c, { k: "inter", a, b, i }));
  } },
  bisector: { needs: ["point", "point", "point"], build: ([a, b, cc], c) => [{ t: "gline", id: c.uid(), p: b, bis: [a, b, cc] }] },
  centroid: { needs: ["point", "point", "point"], build: ([a, b, cc], c) => [P(c, { k: "cen", type: "centroid", a, b, c: cc })] },
  orthocenter: { needs: ["point", "point", "point"], build: ([a, b, cc], c) => [P(c, { k: "cen", type: "ortho", a, b, c: cc })] },
  circumcenter: { needs: ["point", "point", "point"], build: ([a, b, cc], c) => [P(c, { k: "cen", type: "circum", a, b, c: cc })] },
  incenter: { needs: ["point", "point", "point"], build: ([a, b, cc], c) => [P(c, { k: "cen", type: "in", a, b, c: cc })] },
  circumcircle: { needs: ["point", "point", "point"], build: ([a, b, cc], c) => { const o = P(c, { k: "cen", type: "circum", a, b, c: cc }); return [o, { t: "gcircle", id: c.uid(), c: o.id, p: a } as GeoCircle]; } },
  reflectLine: { needs: ["point", "line"], build: ([p, l], c) => [P(c, { k: "reflL", p, l })] },
  reflectPoint: { needs: ["point", "point"], build: ([p, o], c) => [P(c, { k: "reflP", p, c: o })] },
  translate: { needs: ["point", "point", "point"], build: ([p, a, b], c) => [P(c, { k: "trans", p, a, b })] },
  rotate: { needs: ["point", "point"], build: ([p, o], c) => [P(c, { k: "rot", p, c: o, deg: c.rotDeg })] },
  dilate: { needs: ["point", "point"], build: ([p, o], c) => [P(c, { k: "dil", p, c: o, f: c.dilK })] },
  angle: { needs: ["point", "point", "point"], build: ([a, b, cc], c) => [{ t: "gangle", id: c.uid(), a, b, c: cc, mark: "arc" }] },
  rightAngle: { needs: ["point", "point", "point"], build: ([a, b, cc], c) => [{ t: "gangle", id: c.uid(), a, b, c: cc, mark: "right" }] },
  equalMark: { needs: ["line"], build: ([s], c) => { const n = (c.page.objects.filter((o) => o.t === "gmark").length % 3) + 1; return [{ t: "gmark", id: c.uid(), seg: s, n }]; } },
};
/** Does an object satisfy a pick requirement? */
export function matches(need: Need, o: Obj): boolean {
  if (need === "point") return o.t === "gpoint";
  if (need === "line") return o.t === "gseg" || o.t === "gline";
  if (need === "circle") return o.t === "gcircle";
  return o.t === "gseg" || o.t === "gline" || o.t === "gcircle";
}
export type { GeoLine };
