// Segment eraser: cut the part of a pen stroke that lies inside a circle and keep the rest as separate strokes. Pure, no DOM.
export interface Piece { pts: number[]; pr?: number[] }
export const ERASER_RADIUS = { s: 6, m: 14, l: 28 } as const;
export type EraserMode = "stroke" | keyof typeof ERASER_RADIUS;

/** Pieces of the polyline `pts` (x,y,...) that remain after removing everything within `r` of (cx,cy). Returns null when the circle does not touch the stroke. */
export function eraseFromStroke(pts: number[], pr: number[] | undefined, cx: number, cy: number, r: number): Piece[] | null {
  const n = pts.length / 2;
  if (n === 0) return null;
  const inside = (i: number) => Math.hypot(pts[2 * i] - cx, pts[2 * i + 1] - cy) <= r;
  if (n === 1) return inside(0) ? [] : null;
  const pieces: Piece[] = [];
  let cur: Piece | null = null, touched = false;
  const push = (x: number, y: number, p: number | undefined) => { (cur ??= { pts: [], pr: pr ? [] : undefined }).pts.push(x, y); if (pr && p !== undefined) cur.pr!.push(p); };
  const end = () => { if (cur && cur.pts.length >= 4) pieces.push(cur); cur = null; };
  for (let i = 0; i + 1 < n; i++) {
    const ax = pts[2 * i], ay = pts[2 * i + 1], bx = pts[2 * i + 2], by = pts[2 * i + 3];
    const dx = bx - ax, dy = by - ay, a = dx * dx + dy * dy;
    // parameter interval [t0,t1] of the segment inside the circle
    let t0 = 1, t1 = 0;
    if (a === 0) { if (inside(i)) { t0 = 0; t1 = 1; } } else {
      const fx = ax - cx, fy = ay - cy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r, disc = b * b - 4 * a * c;
      if (disc >= 0) { const s = Math.sqrt(disc); t0 = Math.max(0, (-b - s) / (2 * a)); t1 = Math.min(1, (-b + s) / (2 * a)); }
    }
    const lerpP = (t: number) => (pr ? pr[i] + ((pr[i + 1] ?? pr[i]) - pr[i]) * t : undefined);
    if (t0 >= t1) { // segment untouched
      if (!cur) push(ax, ay, pr?.[i]);
      push(bx, by, pr?.[i + 1]);
      continue;
    }
    touched = true;
    if (t0 > 0) { if (!cur) push(ax, ay, pr?.[i]); push(ax + dx * t0, ay + dy * t0, lerpP(t0)); }
    end();
    if (t1 < 1) { push(ax + dx * t1, ay + dy * t1, lerpP(t1)); push(bx, by, pr?.[i + 1]); }
  }
  end();
  return touched ? pieces : null;
}
