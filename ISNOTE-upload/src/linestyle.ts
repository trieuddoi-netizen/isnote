// Line styles: dash patterns and arrow heads. Pure, no DOM.
import type { LineStyle } from "./model.ts";

/** Canvas dash pattern for a style at line width `w` (solid/arrows are continuous). */
export function dashFor(style: LineStyle | undefined, w: number): number[] {
  const u = Math.max(w, 1.5);
  if (style === "dashed") return [u * 4, u * 3];
  if (style === "dashdot") return [u * 5, u * 2.5, u * 0.6, u * 2.5];
  return [];
}
export const arrowSize = (w: number): number => Math.max(12, w * 4.5);
export const hasStartArrow = (s: LineStyle | undefined) => s === "double";
export const hasEndArrow = (s: LineStyle | undefined) => s === "arrow" || s === "double";

/** Triangle of an arrow head with its tip at (x2,y2), pointing away from (x1,y1): [tipx,tipy, ax,ay, bx,by]. */
export function arrowHead(x1: number, y1: number, x2: number, y2: number, size: number): number[] {
  const a = Math.atan2(y2 - y1, x2 - x1), spread = Math.PI / 7;
  return [x2, y2, x2 - size * Math.cos(a - spread), y2 - size * Math.sin(a - spread), x2 - size * Math.cos(a + spread), y2 - size * Math.sin(a + spread)];
}
/** Shorten the shaft so a thick line does not poke through the arrow tip. */
export function shaft(x1: number, y1: number, x2: number, y2: number, style: LineStyle | undefined, size: number): [number, number, number, number] {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 1e-9) return [x1, y1, x2, y2];
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len, cut = Math.min(size * 0.7, len / 2);
  return [hasStartArrow(style) ? x1 + ux * cut : x1, hasStartArrow(style) ? y1 + uy * cut : y1, hasEndArrow(style) ? x2 - ux * cut : x2, hasEndArrow(style) ? y2 - uy * cut : y2];
}
