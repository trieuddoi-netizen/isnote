// Ink-to-shape: recognise a straight line, circle/ellipse, triangle or rectangle from a pen stroke. Pure, no DOM.
export type Recognized =
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "circle"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "triangle"; pts: [number, number][] }
  | { kind: "rect"; pts: [number, number][] };

type P = [number, number];
const toPts = (a: number[]): P[] => { const o: P[] = []; for (let i = 0; i + 1 < a.length; i += 2) o.push([a[i], a[i + 1]]); return o; };
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function pathLength(p: P[]): number { let l = 0; for (let i = 1; i < p.length; i++) l += dist(p[i - 1], p[i]); return l; }
function segDist(p: P, a: P, b: P): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas–Peucker; returns the indices of the kept points (first and last always kept). */
export function simplify(p: P[], lo: number, hi: number, eps: number, keep: Set<number>): void {
  let best = -1, bd = eps;
  for (let i = lo + 1; i < hi; i++) { const d = segDist(p[i], p[lo], p[hi]); if (d > bd) { bd = d; best = i; } }
  if (best < 0) return;
  keep.add(best);
  simplify(p, lo, best, eps, keep);
  simplify(p, best, hi, eps, keep);
}

/** Corner points of a closed stroke (without repeating the first point). */
export function corners(p: P[], eps: number): P[] {
  // Split the loop at the point farthest from the start so a corner at the start is not lost.
  let far = 0, fd = 0;
  for (let i = 0; i < p.length; i++) { const d = dist(p[i], p[0]); if (d > fd) { fd = d; far = i; } }
  const keep = new Set<number>([0, far, p.length - 1]);
  simplify(p, 0, far, eps, keep);
  simplify(p, far, p.length - 1, eps, keep);
  let v = [...keep].sort((a, b) => a - b).map((i) => p[i]);
  if (dist(v[0], v[v.length - 1]) < eps * 2) v = v.slice(0, -1);
  // Drop almost-straight vertices (the start point may lie in the middle of a side).
  for (let changed = true; changed && v.length > 3;) {
    changed = false;
    for (let i = 0; i < v.length; i++) {
      const a = v[(i + v.length - 1) % v.length], b = v[i], c = v[(i + 1) % v.length];
      const u1 = Math.atan2(b[1] - a[1], b[0] - a[0]), u2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
      let t = Math.abs(u2 - u1); if (t > Math.PI) t = 2 * Math.PI - t;
      if (t < (25 * Math.PI) / 180) { v.splice(i, 1); changed = true; break; }
    }
  }
  return v;
}

function ellipseFit(p: P[]): { cx: number; cy: number; rx: number; ry: number; cv: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
  const rs = p.map(([x, y]) => Math.hypot((x - cx) / (rx || 1), (y - cy) / (ry || 1)));
  const m = rs.reduce((a, b) => a + b, 0) / rs.length;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - m) ** 2, 0) / rs.length);
  return { cx, cy, rx, ry, cv: sd / (m || 1) };
}

/** Evenly spaced copy of the stroke (so dense/sparse sampling does not bias the fits). */
export function resample(p: P[], n: number): P[] {
  const L = pathLength(p);
  if (L === 0) return p.slice();
  const out: P[] = [p[0]];
  const step = L / (n - 1);
  let acc = 0, i = 1, prev = p[0];
  while (out.length < n && i < p.length) {
    const d = dist(prev, p[i]);
    if (acc + d >= step) {
      const t = (step - acc) / d;
      const q: P = [prev[0] + (p[i][0] - prev[0]) * t, prev[1] + (p[i][1] - prev[1]) * t];
      out.push(q); prev = q; acc = 0;
    } else { acc += d; prev = p[i]; i++; }
  }
  while (out.length < n) out.push(p[p.length - 1]);
  return out;
}

/** Try to recognise a pen stroke (flat x,y array). `lineOnly` skips closed shapes (ink-to-line mode). */
export function recognize(flat: number[], lineOnly = false): Recognized | null {
  const raw = toPts(flat);
  if (raw.length < 4) return null;
  const L = pathLength(raw);
  const a = raw[0], b = raw[raw.length - 1];
  const chord = dist(a, b);
  if (L < 40) return null;
  // Straight line: every point close to the chord.
  if (chord > 0.85 * L) {
    let maxd = 0;
    for (const q of raw) maxd = Math.max(maxd, segDist(q, a, b));
    if (maxd < Math.max(4, 0.07 * chord)) return { kind: "line", x1: a[0], y1: a[1], x2: b[0], y2: b[1] };
  }
  if (lineOnly) return null;
  // Closed shapes.
  if (chord > 0.22 * L) return null;
  const p = resample(raw, 96);
  const eps = 0.035 * L;
  const c = corners(p, eps);
  if (c.length === 3) return { kind: "triangle", pts: c };
  if (c.length === 4) {
    // Accept rectangles: opposite sides about equal and angles about 90°.
    const ang = (i: number) => {
      const u = c[(i + 3) % 4], v = c[i], w = c[(i + 1) % 4];
      const a1 = Math.atan2(u[1] - v[1], u[0] - v[0]), a2 = Math.atan2(w[1] - v[1], w[0] - v[0]);
      let t = Math.abs(a1 - a2); if (t > Math.PI) t = 2 * Math.PI - t;
      return t;
    };
    const ok = [0, 1, 2, 3].every((i) => Math.abs(ang(i) - Math.PI / 2) < (22 * Math.PI) / 180);
    const sides = [dist(c[0], c[1]), dist(c[1], c[2]), dist(c[2], c[3]), dist(c[3], c[0])];
    const eq = Math.abs(sides[0] - sides[2]) < 0.25 * Math.max(sides[0], sides[2]) && Math.abs(sides[1] - sides[3]) < 0.25 * Math.max(sides[1], sides[3]);
    if (ok && eq) return { kind: "rect", pts: regularRect(c) };
    return null;
  }
  if (c.length >= 5) {
    const e = ellipseFit(p);
    if (e.cv < 0.12 && e.rx > 8 && e.ry > 8) return { kind: "circle", cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry };
  }
  return null;
}

/** Snap four corners to an exact rectangle (average of opposite sides, same orientation). */
function regularRect(c: P[]): [number, number][] {
  const cx = (c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4, cy = (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4;
  let ang = (Math.atan2(c[1][1] - c[0][1], c[1][0] - c[0][0]) + Math.atan2(c[2][1] - c[3][1], c[2][0] - c[3][0])) / 2;
  const q = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
  if (Math.abs(ang - q) < (7 * Math.PI) / 180) ang = q; // nearly axis-aligned: make it exactly so
  const co = Math.cos(ang), si = Math.sin(ang);
  const along = (v: P) => (v[0] - cx) * co + (v[1] - cy) * si, across = (v: P) => -(v[0] - cx) * si + (v[1] - cy) * co;
  const w = (Math.abs(along(c[0])) + Math.abs(along(c[1])) + Math.abs(along(c[2])) + Math.abs(along(c[3]))) / 4;
  const h = (Math.abs(across(c[0])) + Math.abs(across(c[1])) + Math.abs(across(c[2])) + Math.abs(across(c[3]))) / 4;
  const at = (u: number, v: number): P => [cx + u * co - v * si, cy + u * si + v * co];
  return [at(-w, -h), at(w, -h), at(w, h), at(-w, h)];
}
