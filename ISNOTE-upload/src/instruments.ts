// Drawing instruments (ruler, protractor, set-square, compass): outlines, edges to draw along, tick marks. Pure, no DOM.
import type { Inst } from "./model.ts";

type V = [number, number];
const toWorld = (o: Pick<Inst, "x" | "y" | "rot">, p: V): V => { const c = Math.cos(o.rot), s = Math.sin(o.rot); return [o.x + p[0] * c - p[1] * s, o.y + p[0] * s + p[1] * c]; };
const toLocal = (o: Pick<Inst, "x" | "y" | "rot">, p: V): V => { const c = Math.cos(-o.rot), s = Math.sin(-o.rot), x = p[0] - o.x, y = p[1] - o.y; return [x * c - y * s, x * s + y * c]; };
export const RULER_H = 64;
export const defaultSize = (k: Inst["kind"]): number => (k === "ruler" ? 640 : k === "square" ? 360 : k === "protractor" ? 190 : 200);

/** Outline polygon in page coordinates (used for hit-testing and drawing). */
export function instOutline(o: Inst): [number, number][] {
  const L = o.s;
  let local: V[];
  switch (o.kind) {
    case "ruler": local = [[0, 0], [L, 0], [L, RULER_H], [0, RULER_H]]; break;
    case "square": local = [[0, 0], [L, 0], [0, L]]; break; // 45° set-square: right angle at the origin
    case "protractor": local = [[-L, 0], ...Array.from({ length: 49 }, (_, i): V => { const a = Math.PI + (Math.PI * i) / 48; return [L * Math.cos(a), L * Math.sin(a)]; }), [L, 0]]; break; // semicircle above the baseline (y negative)
    case "compass": local = Array.from({ length: 24 }, (_, i): V => { const a = (2 * Math.PI * i) / 24; return [14 * Math.cos(a), 14 * Math.sin(a)]; }); break; // the pivot knob
  }
  return local.map((p) => toWorld(o, p));
}
export function pointInPoly(poly: [number, number][], x: number, y: number, tol = 0): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  if (inside || !tol) return inside;
  for (let i = 0; i < poly.length; i++) { // within tol of the border
    const a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
    if (Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy)) <= tol) return true;
  }
  return false;
}

/** A guide a pen can follow: a straight line (point + unit direction) or a circle. */
export type Guide = { kind: "line"; p: V; d: V } | { kind: "circle"; c: V; r: number; a0?: number; a1?: number };

/** All edges of an instrument that a pen can draw along, in page coordinates. */
export function guides(o: Inst): Guide[] {
  const line = (a: V, b: V): Guide => { const A = toWorld(o, a), B = toWorld(o, b), l = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1; return { kind: "line", p: A, d: [(B[0] - A[0]) / l, (B[1] - A[1]) / l] }; };
  switch (o.kind) {
    case "ruler": return [line([0, 0], [o.s, 0]), line([0, RULER_H], [o.s, RULER_H])];
    case "square": return [line([0, 0], [o.s, 0]), line([0, 0], [0, o.s]), line([o.s, 0], [0, o.s])];
    case "protractor": return [line([-o.s, 0], [o.s, 0]), { kind: "circle", c: toWorld(o, [0, 0]), r: o.s }];
    case "compass": return [{ kind: "circle", c: [o.x, o.y], r: o.s }];
  }
}
export function distToGuide(g: Guide, p: V): number {
  if (g.kind === "line") return Math.abs((p[0] - g.p[0]) * g.d[1] - (p[1] - g.p[1]) * g.d[0]);
  return Math.abs(Math.hypot(p[0] - g.c[0], p[1] - g.c[1]) - g.r);
}
/** Closest point of the guide to p. */
export function projectOnGuide(g: Guide, p: V): V {
  if (g.kind === "line") { const t = (p[0] - g.p[0]) * g.d[0] + (p[1] - g.p[1]) * g.d[1]; return [g.p[0] + g.d[0] * t, g.p[1] + g.d[1] * t]; }
  const dx = p[0] - g.c[0], dy = p[1] - g.c[1], l = Math.hypot(dx, dy) || 1;
  return [g.c[0] + (dx / l) * g.r, g.c[1] + (dy / l) * g.r];
}
/** Guide of any instrument that a stroke starting at `p` should follow (within `tol`), or null. Only the part of a ruler/square/protractor edge that exists counts. */
export function guideAt(insts: Inst[], p: V, tol = 16): Guide | null {
  let best: Guide | null = null, bd = tol;
  for (const o of insts) {
    const lp = toLocal(o, p);
    const onBody = o.kind === "compass" ? true : o.kind === "ruler" ? lp[0] >= -tol && lp[0] <= o.s + tol : o.kind === "square" ? lp[0] >= -tol && lp[1] >= -tol && lp[0] + lp[1] <= o.s + tol : lp[1] <= tol && Math.hypot(lp[0], lp[1]) <= o.s + tol;
    if (!onBody) continue;
    for (const g of guides(o)) { const d = distToGuide(g, p); if (d < bd) { bd = d; best = g; } }
  }
  return best;
}

/** Tick marks along the ruler: [position along the edge, length]. 1 mm = 4.76 page units (A4 is 210 mm = 1000 units). */
export const MM = 1000 / 210;
export function rulerTicks(len: number): { x: number; h: number; label?: number }[] {
  const out: { x: number; h: number; label?: number }[] = [];
  for (let i = 0; i * MM <= len; i++) out.push({ x: i * MM, h: i % 10 === 0 ? 22 : i % 5 === 0 ? 15 : 9, label: i % 10 === 0 ? i / 10 : undefined });
  return out;
}
export const protractorTicks = (): { deg: number; h: number; label?: number }[] => Array.from({ length: 181 }, (_, d) => ({ deg: d, h: d % 10 === 0 ? 16 : d % 5 === 0 ? 11 : 6, label: d % 30 === 0 ? d : undefined }));
/** Angle (0..180°, measured from the baseline's right end counter-clockwise on screen) of page point p about the protractor centre. */
export function protractorAngle(o: Inst, p: V): number {
  const l = toLocal(o, p);
  let a = (Math.atan2(-l[1], l[0]) * 180) / Math.PI;
  if (a < 0) a += 360;
  return a;
}
export { toWorld as instToWorld, toLocal as instToLocal };

/** Handles in the instrument's own frame: `rot` turns it, `size` changes its length/radius. */
export function instHandleLocal(o: Inst): { rot: V; size: V } {
  switch (o.kind) {
    case "ruler": return { rot: [o.s / 2, -34], size: [o.s, RULER_H / 2] };
    case "square": return { rot: [o.s / 3, -34], size: [o.s, 0] };
    case "protractor": return { rot: [0, -o.s - 34], size: [o.s, 0] };
    case "compass": return { rot: [o.s * 0 + 0, -34], size: [o.s, 0] };
  }
}
/** Apply a handle drag: rotate about the origin so the rot handle follows the pointer, or set the size from the pointer's distance along the instrument. */
export function dragInst(o: Inst, which: "rot" | "size", p: V): void {
  const h = instHandleLocal(o);
  if (which === "rot") o.rot = Math.atan2(p[1] - o.y, p[0] - o.x) - Math.atan2(h.rot[1], h.rot[0]);
  else {
    const l = toLocal(o, p);
    o.s = Math.max(60, Math.min(1400, o.kind === "ruler" || o.kind === "square" || o.kind === "protractor" || o.kind === "compass" ? l[0] : l[0]));
  }
}
