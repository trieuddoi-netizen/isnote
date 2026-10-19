// Pen behaviour: kinds, smoothing, pressure/speed dependent width, laser fade. Pure, no DOM.
import type { PenKind } from "./model.ts";

export interface PenStyle { mul: number; alpha: number }
export const PEN_STYLE: Record<PenKind, PenStyle> = {
  ballpoint: { mul: 1, alpha: 1 },
  felt: { mul: 2.4, alpha: 0.88 },
  fountain: { mul: 1.5, alpha: 1 },
  pencil: { mul: 0.9, alpha: 0.62 },
  brush: { mul: 2.2, alpha: 1 },
};
export const MAX_SMOOTH = 5;
export const NIB_ANGLE = (40 * Math.PI) / 180;

/** Live smoothing: moves from `prev` towards `raw`; level 0 = off, 5 = very smooth (lags behind the pen). */
export function smoothStep(prev: [number, number], raw: [number, number], level: number): [number, number] {
  const l = Math.min(MAX_SMOOTH, Math.max(0, level));
  if (l === 0) return raw;
  const a = 1 / (1 + l * 0.9); // fraction of the way to the new point
  return [prev[0] + (raw[0] - prev[0]) * a, prev[1] + (raw[1] - prev[1]) * a];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Line width of every segment (pts.length/2 - 1 values) for a stroke of `base` width.
 * Pressure (0..1, optional) scales the width for any pen; the pen kind adds its own character:
 * fountain = angled nib (thick across, thin along), brush = thinner when fast and tapered at both ends.
 */
export function strokeWidths(kind: PenKind, pts: number[], base: number, pressure?: number[]): number[] {
  const n = pts.length / 2;
  const out: number[] = [];
  const mul = PEN_STYLE[kind].mul;
  for (let i = 0; i + 1 < n; i++) {
    const dx = pts[2 * i + 2] - pts[2 * i], dy = pts[2 * i + 3] - pts[2 * i + 1];
    const d = Math.hypot(dx, dy);
    const pr = pressure ? clamp((pressure[i] + (pressure[i + 1] ?? pressure[i])) / 2, 0.05, 1) : 0.5;
    let f = pressure ? 0.35 + 1.3 * pr : 1; // pressure 0.5 -> 1.0
    if (kind === "fountain") f *= 0.3 + 0.95 * Math.abs(Math.sin(Math.atan2(dy, dx) - NIB_ANGLE));
    else if (kind === "brush") {
      f *= clamp(1.5 - d / 7, 0.3, 1.3);
      const edge = Math.min(i, n - 2 - i); // taper the first/last few segments
      f *= clamp(0.35 + edge * 0.13, 0.35, 1);
    }
    out.push(Math.max(0.3, base * mul * f));
  }
  if (kind === "brush" && out.length > 2) for (let i = 1; i + 1 < out.length; i++) out[i] = (out[i - 1] + 2 * out[i] + out[i + 1]) / 4; // soften jumps (single pass)
  return out;
}

// ---- laser pen ---------------------------------------------------------------------------
export const LASER_TTL = 1400; // ms until a laser dot has faded away
/** Opacity of a laser point of the given age (ms). */
export const laserAlpha = (age: number, ttl = LASER_TTL): number => clamp(1 - age / ttl, 0, 1);
export interface LaserPt { x: number; y: number; t: number }
/** Drop points that have fully faded; returns the same array. */
export function pruneLaser(pts: LaserPt[], now: number, ttl = LASER_TTL): LaserPt[] {
  let k = 0;
  while (k < pts.length && now - pts[k].t >= ttl) k++;
  if (k) pts.splice(0, k);
  return pts;
}
