// Outlines of the preset plane figures in the unit square. Pure geometry (no DOM) so it can be unit-tested.
import type { ShapeKind } from "./model.ts";

export interface SubPath { pts: [number, number][]; closed: boolean; dashed?: boolean }
/** Default ratio inner radius / outer radius of an annulus. */
export const ANNULUS_RATIO = 0.55;

const arc = (cx: number, cy: number, rx: number, ry: number, n = 64): [number, number][] =>
  Array.from({ length: n }, (_, i) => [cx + rx * Math.cos((2 * Math.PI * i) / n), cy + ry * Math.sin((2 * Math.PI * i) / n)]);

/** Polygon outline of a preset shape, "ellipse" for circles/ellipses (drawn with the canvas ellipse primitive). */
export function shapePoints(kind: ShapeKind): [number, number][] | "ellipse" {
  switch (kind) {
    case "rect": case "square": return [[0, 0], [1, 0], [1, 1], [0, 1]];
    case "triangle": return [[0.5, 0], [1, 1], [0, 1]];
    case "rtriangle": return [[0, 0], [1, 1], [0, 1]];
    case "circle": case "ellipse": return "ellipse";
    case "pentagon": return Array.from({ length: 5 }, (_, i) => [0.5 + 0.5 * Math.sin((2 * Math.PI * i) / 5), 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 5)]);
    case "hexagon": return Array.from({ length: 6 }, (_, i) => [0.5 + 0.5 * Math.cos((2 * Math.PI * i) / 6), 0.5 + 0.5 * Math.sin((2 * Math.PI * i) / 6)]);
    case "star": return Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? 0.2 : 0.5; return [0.5 + r * Math.sin((Math.PI * i) / 5), 0.5 - r * Math.cos((Math.PI * i) / 5)]; });
    case "rhombus": return [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
    case "trapezoid": return [[0.22, 0], [0.78, 0], [1, 1], [0, 1]];
    case "parallelogram": return [[0.25, 0], [1, 0], [0.75, 1], [0, 1]];
    case "arrow": return [[0, 0.3], [0.58, 0.3], [0.58, 0], [1, 0.5], [0.58, 1], [0.58, 0.7], [0, 0.7]];
    default: return "ellipse"; // curve figures use curvePaths()
  }
}

/** Is the figure made of curves described by curvePaths() rather than a simple polygon/ellipse? */
export const isCurveFigure = (k: ShapeKind): boolean => k === "hyperbola" || k === "parabola" || k === "annulus";

/**
 * Sub-paths of a curve figure inside the unit square (y grows downwards).
 * - hyperbola x²/a² − y²/b² = 1: two branches x = ½ ± A·cosh t, y = ½ + B·sinh t reaching the box sides, with dashed asymptotes
 * - parabola: opens upwards (y = 1 − u², vertex at the bottom centre) with its axis of symmetry dashed
 * - annulus: outer and inner ellipse (ratio ANNULUS_RATIO), filled with the even-odd rule
 */
export function curvePaths(kind: ShapeKind): SubPath[] {
  if (kind === "annulus") return [{ pts: arc(0.5, 0.5, 0.5, 0.5), closed: true }, { pts: arc(0.5, 0.5, 0.5 * ANNULUS_RATIO, 0.5 * ANNULUS_RATIO), closed: true }];
  if (kind === "parabola") {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 60; i++) { const u = -1 + (2 * i) / 60; pts.push([0.5 + u * 0.5, 1 - u * u]); }
    return [{ pts, closed: false }, { pts: [[0.5, 0], [0.5, 1]], closed: false, dashed: true }];
  }
  if (kind === "hyperbola") {
    const T = 1.2, A = 0.5 / Math.cosh(T), B = 0.5 / Math.sinh(T), right: [number, number][] = [], left: [number, number][] = [];
    for (let i = 0; i <= 48; i++) {
      const t = -T + (2 * T * i) / 48;
      right.push([0.5 + A * Math.cosh(t), 0.5 + B * Math.sinh(t)]);
      left.push([0.5 - A * Math.cosh(t), 0.5 + B * Math.sinh(t)]);
    }
    const dx = 0.5 / (B / A); // the asymptotes y-½ = ±(B/A)(x-½) leave the box at the top/bottom
    return [{ pts: right, closed: false }, { pts: left, closed: false }, { pts: [[0.5 - dx, 0], [0.5 + dx, 1]], closed: false, dashed: true }, { pts: [[0.5 - dx, 1], [0.5 + dx, 0]], closed: false, dashed: true }];
  }
  return [];
}
