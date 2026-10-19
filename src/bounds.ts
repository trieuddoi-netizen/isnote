// Bounding boxes of objects ([x, y, w, h]) and point-in-polygon tests used by the selection tools. No DOM.
import { instOutline } from "./instruments.ts";
import { findPoint, formulaSize, textSize, type Obj, type Page } from "./model.ts";

export type Box = [number, number, number, number];

export function boundsOf(o: Obj, page: Page): Box | null {
  switch (o.t) {
    case "formula": { const s = formulaSize.get(o.id) ?? { w: 80, h: 40 }; return [o.x, o.y, s.w, s.h]; }
    case "graph": case "net": case "image": return [o.x, o.y, o.w, o.h];
    case "solid": case "revolve": case "fold": return [o.x, o.y, o.s, o.s];
    case "text": { const s = textSize.get(o.id) ?? { w: o.w, h: o.size * 1.3 }; return [o.x, o.y, Math.max(o.w, s.w), s.h]; }
    case "shape": { const cx = o.x + o.w / 2, cy = o.y + o.h / 2, r = Math.hypot(o.w, o.h) / 2; return [cx - r, cy - r, 2 * r, 2 * r]; }
    case "gpoint": return [o.x - 8, o.y - 8, 16, 16];
    case "inst": { const p = instOutline(o); const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]); const x0 = Math.min(...xs), y0 = Math.min(...ys); return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0]; }
    case "gline": case "gangle": case "gmark": return null;
    case "gpoly": {
      const ps = o.pts.map((i) => findPoint(page, i)).filter((p): p is NonNullable<typeof p> => !!p);
      if (!ps.length) return null;
      const x0 = Math.min(...ps.map((p) => p.x)), x1 = Math.max(...ps.map((p) => p.x)), y0 = Math.min(...ps.map((p) => p.y)), y1 = Math.max(...ps.map((p) => p.y));
      return [x0, y0, x1 - x0, y1 - y0];
    }
    case "line": return [Math.min(o.x1, o.x2) - o.w, Math.min(o.y1, o.y2) - o.w, Math.abs(o.x1 - o.x2) + 2 * o.w, Math.abs(o.y1 - o.y2) + 2 * o.w];
    case "stroke": {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < o.pts.length; i += 2) { x0 = Math.min(x0, o.pts[i]); x1 = Math.max(x1, o.pts[i]); y0 = Math.min(y0, o.pts[i + 1]); y1 = Math.max(y1, o.pts[i + 1]); }
      return [x0 - o.w, y0 - o.w, x1 - x0 + 2 * o.w, y1 - y0 + 2 * o.w];
    }
    case "fill": {
      if (!o.runs.length) return null;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < o.runs.length; i += 3) { y0 = Math.min(y0, o.runs[i]); y1 = Math.max(y1, o.runs[i]); x0 = Math.min(x0, o.runs[i + 1]); x1 = Math.max(x1, o.runs[i + 2]); }
      return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
    }
    case "gseg": { const a = findPoint(page, o.a), b = findPoint(page, o.b); return a && b ? [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y)] : null; }
    case "gcircle": { const c = findPoint(page, o.c), p = findPoint(page, o.p); if (!c || !p) return null; const r = Math.hypot(p.x - c.x, p.y - c.y); return [c.x - r, c.y - r, 2 * r, 2 * r]; }
  }
}

export function pointInPolygon(poly: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export const rectPolygon = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[Math.min(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.max(y0, y1)], [Math.min(x0, x1), Math.max(y0, y1)]];

/** Ids of the objects selected by a rectangle or free-shape (lasso): strokes need at least half of their points inside, other objects their centre. */
export function selectIn(page: Page, poly: [number, number][]): string[] {
  const ids: string[] = [];
  for (const o of page.objects) {
    if (o.t === "gpoint") { if (pointInPolygon(poly, o.x, o.y)) ids.push(o.id); continue; }
    if (o.t === "gpoly") continue;
    if (o.t === "gseg" || o.t === "gcircle" || o.t === "gline" || o.t === "gangle" || o.t === "gmark") continue; // follow their points
    if (o.t === "stroke") {
      let n = 0, inn = 0;
      for (let i = 0; i < o.pts.length; i += 2) { n++; if (pointInPolygon(poly, o.pts[i], o.pts[i + 1])) inn++; }
      if (n && inn * 2 >= n) ids.push(o.id);
      continue;
    }
    if (o.t === "fill") continue; // fills are never moved on their own
    const b = boundsOf(o, page);
    if (b && pointInPolygon(poly, b[0] + b[2] / 2, b[1] + b[3] / 2)) ids.push(o.id);
  }
  // A segment/circle is selected together with its points.
  const set = new Set(ids);
  for (const o of page.objects) {
    if (o.t === "gseg" && set.has(o.a) && set.has(o.b)) ids.push(o.id);
    if (o.t === "gcircle" && set.has(o.c) && set.has(o.p)) ids.push(o.id);
    if (o.t === "gpoly" && o.pts.every((p) => set.has(p))) ids.push(o.id);
  }
  return ids;
}
