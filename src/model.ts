// Document model. Coordinates are in "page units": every page is PAGE_W x PAGE_H, scaled to the screen when drawn.
export const PAGE_W = 1000;
export const PAGE_H = 1414; // A4 ratio

import { defaultPaper, type Paper } from "./paper.ts";
import { lineOf, refsOf } from "./geo.ts";
import { instOutline, pointInPoly } from "./instruments.ts";
export type PenKind = "ballpoint" | "felt" | "fountain" | "pencil" | "brush";
export const PEN_KINDS: PenKind[] = ["ballpoint", "felt", "fountain", "pencil", "brush"];
export type LineStyle = "solid" | "dashed" | "dashdot" | "arrow" | "double";
export const LINE_STYLES: LineStyle[] = ["solid", "dashed", "dashdot", "arrow", "double"];
export interface Stroke { t: "stroke"; id: string; color: string; w: number; pts: number[]; hl?: boolean; pen?: PenKind; pr?: number[]; dash?: LineStyle } // pts = x,y,x,y...; pr = pressure per point
/** Straight line / segment with a style (dashed, dash-dot, arrow, double arrow). */
export interface Line { t: "line"; id: string; x1: number; y1: number; x2: number; y2: number; color: string; w: number; style: LineStyle }
export type TextFont = "sans" | "serif" | "mono" | "hand";
export type TextAlign = "left" | "center" | "right";
/** Text box: wraps inside width `w`; `bullets` puts a bullet on every paragraph. */
export interface TextObj { t: "text"; id: string; x: number; y: number; w: number; text: string; font: TextFont; size: number; bold: boolean; italic: boolean; underline: boolean; color: string; align: TextAlign; bullets: boolean }
/** Picture (data URL) placed on the page. */
export interface ImageObj { t: "image"; id: string; x: number; y: number; w: number; h: number; src: string }
/** Flood-filled region, stored as scanline runs [y, x0, x1, y, x0, x1, ...] in page units. */
export interface Fill { t: "fill"; id: string; color: string; runs: number[] }
export interface Formula { t: "formula"; id: string; x: number; y: number; latex: string; color: string; size: number }
export interface Graph { t: "graph"; id: string; x: number; y: number; w: number; h: number; xmin: number; xmax: number; ymin: number; ymax: number; fns: string[]; lw?: number; shade?: { fn: number; a: number; b: number };
  legend?: boolean; names?: string[]; ineqs?: string[]; pts?: GraphPt[]; gx?: number; gy?: number; fs?: number } // gx/gy: grid step (0/undefined = auto), fs: axis text size
/** Marked point on a graph: lies on function `fn` at abscissa x, drawn with its coordinates and dashed guide lines to the axes. */
export interface GraphPt { fn: number; x: number; name?: string; guides?: boolean }
/** How a constructed point is computed from other objects (re-evaluated whenever the page is drawn, so it follows dragged parents). */
export type GeoDef =
  | { k: "mid"; a: string; b: string }
  | { k: "foot"; p: string; l: string }
  | { k: "inter"; a: string; b: string; i: number }
  | { k: "cen"; type: "centroid" | "ortho" | "circum" | "in"; a: string; b: string; c: string }
  | { k: "reflL"; p: string; l: string }
  | { k: "reflP"; p: string; c: string }
  | { k: "trans"; p: string; a: string; b: string }
  | { k: "rot"; p: string; c: string; deg: number }
  | { k: "dil"; p: string; c: string; f: number };
export interface GeoPoint { t: "gpoint"; id: string; x: number; y: number; label: string; def?: GeoDef; hideName?: boolean; hideDot?: boolean; helper?: boolean }
export interface GeoSeg { t: "gseg"; id: string; a: string; b: string; helper?: boolean }
/** Infinite line (or ray) through point p: towards q, parallel/perpendicular to another line, or the bisector of angle a-b-c (b = vertex). */
export interface GeoLine { t: "gline"; id: string; p: string; q?: string; par?: string; perp?: string; bis?: [string, string, string]; ray?: boolean; helper?: boolean }
export interface GeoPoly { t: "gpoly"; id: string; pts: string[]; fill?: boolean }
/** Angle at vertex b between rays ba and bc: arc with its measure, a right-angle square, or `n` equal-angle arcs. */
export interface GeoAngle { t: "gangle"; id: string; a: string; b: string; c: string; mark: "arc" | "right" | "equal"; n?: number }
/** Tick marks (n = 1..3) on a segment to show equal lengths. */
export interface GeoMark { t: "gmark"; id: string; seg: string; n: number }
export interface GeoCircle { t: "gcircle"; id: string; c: string; p: string; helper?: boolean }
export type ShapeKind = "rect" | "square" | "triangle" | "rtriangle" | "circle" | "ellipse" | "pentagon" | "hexagon" | "star" | "rhombus" | "trapezoid" | "parallelogram" | "arrow" | "hyperbola" | "parabola" | "annulus";
export const SHAPE_KINDS: ShapeKind[] = ["rect", "square", "triangle", "rtriangle", "circle", "ellipse", "pentagon", "hexagon", "star", "rhombus", "trapezoid", "parallelogram", "arrow", "hyperbola", "parabola", "annulus"];
/** Preset 2D shape in the box (x,y,w,h), rotated by `rot` radians around the box centre. */
export interface Shape { t: "shape"; id: string; x: number; y: number; w: number; h: number; kind: ShapeKind; color: string; lw: number; rot: number; fill: boolean; ls?: LineStyle }

export type SolidKind = "cube" | "box" | "pyramid" | "tetra" | "prism" | "cone" | "cylinder" | "sphere" | "octahedron" | "frustum" | "frustumcone" | "truncyl" | "cap";
export const SOLID_KINDS: SolidKind[] = ["cube", "box", "pyramid", "tetra", "prism", "cone", "cylinder", "sphere", "octahedron", "frustum", "frustumcone", "truncyl", "cap"];
/** 3D solid drawn in the square (x,y,s,s); yaw/pitch/roll in radians. */
export interface Mark { id: string; p: [number, number, number]; faces: number[]; name: string }
/** Planar polygon through ≥3 marks of a solid (a cross-section); `color` is its fill. */
export interface Section { marks: string[]; color: string | null }
export interface Solid {
  t: "solid"; id: string; x: number; y: number; s: number; kind: SolidKind; color: string; lw: number; yaw: number; pitch: number; roll: number; shade: boolean;
  faceColors?: (string | null)[]; // painted faces, indexed by face id (see solids.ts)
  marks?: Mark[]; lines?: [string, string][]; // points/segments anchored in 3D on the solid
  labels?: boolean; // show vertex names (A, B, C, A', ...)
  sections?: Section[]; // painted / defined cross-sections (planar polygons through marks)
  fold?: number; // 0 = flat net, 1 (default) = closed solid: everything drawn on the solid unfolds with it
}
/** The unfolded net of a solid, drawn flat in the box (x,y,w,h). */
export interface Net { t: "net"; id: string; x: number; y: number; w: number; h: number; kind: SolidKind; color: string; lw: number; faceColors?: (string | null)[] }
/** Solid of revolution: y=f(x) on [a,b] spun about Ox, or radius=f(y) on [a,b] spun about Oy. Drawn in the square (x,y,s,s). */
export interface Revolve { t: "revolve"; id: string; x: number; y: number; s: number; expr: string; a: number; b: number; axis: "x" | "y"; color: string; lw: number; yaw: number; pitch: number; roll: number; rings: number }

export type InstKind = "ruler" | "protractor" | "square" | "compass";
export const INST_KINDS: InstKind[] = ["ruler", "protractor", "square", "compass"];
/** Drawing instrument at (x,y), rotated by `rot`; `s` = length (ruler, set-square) or radius (protractor, compass). Pen strokes started on its edge follow the edge. */
export interface Inst { t: "inst"; id: string; kind: InstKind; x: number; y: number; rot: number; s: number }

/** Animated fold model of a solid's net: `fold` = 0 is the flat net, 1 the closed solid; rotates in 3D like a solid. */
export interface Fold { t: "fold"; id: string; x: number; y: number; s: number; kind: SolidKind; color: string; lw: number; yaw: number; pitch: number; roll: number; shade: boolean; fold: number; faceColors?: (string | null)[] }

export type Obj = Fold | Inst | Stroke | Line | TextObj | ImageObj | Fill | Formula | Graph | GeoPoint | GeoSeg | GeoCircle | GeoLine | GeoPoly | GeoAngle | GeoMark | Shape | Solid | Net | Revolve;

export interface Page { objects: Obj[]; paper?: Paper; bg?: string; sheet?: number; hideHelpers?: boolean; hideNames?: boolean } // bg = background picture (data URL), e.g. an imported PDF page
export interface Doc { format: "OpenInk"; version: 1; title: string; pages: Page[]; sheets?: string[] } // sheets = tab names; Page.sheet indexes them (default 0)

let counter = 0;
export const uid = (): string => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const newDoc = (): Doc => ({ format: "OpenInk", version: 1, title: "Untitled", pages: [{ objects: [], paper: defaultPaper() }] });
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function validateDoc(d: unknown): Doc {
  const o = d as Doc;
  if (!o || o.format !== "OpenInk" || !Array.isArray(o.pages) || o.pages.length === 0) throw new Error("Not an ISNOTE notebook");
  for (const p of o.pages) if (!p || !Array.isArray(p.objects)) throw new Error("Corrupt page");
  return { format: "OpenInk", version: 1, title: String(o.title ?? "Untitled"), pages: o.pages, ...(Array.isArray(o.sheets) && o.sheets.length ? { sheets: o.sheets.map(String) } : {}) };
}

export function findPoint(page: Page, id: string): GeoPoint | undefined {
  return page.objects.find((o): o is GeoPoint => o.t === "gpoint" && o.id === id);
}

/** Remove an object and everything that depends on it (segments/circles of a deleted point). */
export function removeObject(page: Page, id: string): void {
  const dead = new Set([id]);
  for (let changed = true; changed;) { // anything built from a removed object goes with it (repeat: dependants of dependants)
    changed = false;
    for (const o of page.objects) if (!dead.has(o.id) && refsOf(o).some((r) => dead.has(r))) { dead.add(o.id); changed = true; }
  }
  page.objects = page.objects.filter((o) => !dead.has(o.id));
}

const dist2 = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax, dy = by - ay;
  const l = dx * dx + dy * dy;
  const t = l === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l));
  const cx = ax + t * dx, cy = ay + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
};

export interface Size { w: number; h: number }
/** Bounding-box size of a formula; set by the renderer once the SVG is known. */
export const formulaSize = new Map<string, Size>();
/** Measured size of text boxes; set by the renderer. */
export const textSize = new Map<string, Size>();

/** Hit-test an object at page point (x,y) with tolerance r. */
export function hit(page: Page, o: Obj, x: number, y: number, r: number): boolean {
  switch (o.t) {
    case "stroke": {
      const rr = (r + o.w / 2) ** 2;
      const p = o.pts;
      if (p.length === 2) return (x - p[0]) ** 2 + (y - p[1]) ** 2 <= rr;
      for (let i = 0; i + 3 < p.length; i += 2) if (dist2(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= rr) return true;
      return false;
    }
    case "formula": {
      const s = formulaSize.get(o.id) ?? { w: 80, h: 40 };
      return x >= o.x - r && x <= o.x + s.w + r && y >= o.y - r && y <= o.y + s.h + r;
    }
    case "line": return dist2(x, y, o.x1, o.y1, o.x2, o.y2) <= (r + o.w / 2) ** 2;
    case "fill": {
      const iy = Math.floor(y);
      for (let i = 0; i < o.runs.length; i += 3) if (o.runs[i] === iy && x >= o.runs[i + 1] && x <= o.runs[i + 2] + 1) return true;
      return false;
    }
    case "text": {
      const s = textSize.get(o.id) ?? { w: o.w, h: o.size * 1.3 };
      return x >= o.x - r && x <= o.x + Math.max(o.w, s.w) + r && y >= o.y - r && y <= o.y + s.h + r;
    }
    case "image":
    case "graph":
      return x >= o.x - r && x <= o.x + o.w + r && y >= o.y - r && y <= o.y + o.h + r;
    case "shape": {
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2, c = Math.cos(-o.rot), s = Math.sin(-o.rot);
      const lx = (x - cx) * c - (y - cy) * s, ly = (x - cx) * s + (y - cy) * c; // into the shape's own frame
      return Math.abs(lx) <= o.w / 2 + r && Math.abs(ly) <= o.h / 2 + r;
    }
    case "solid": case "revolve": case "fold":
      return x >= o.x - r && x <= o.x + o.s + r && y >= o.y - r && y <= o.y + o.s + r;
    case "net":
      return x >= o.x - r && x <= o.x + o.w + r && y >= o.y - r && y <= o.y + o.h + r;
    case "gpoint":
      return (x - o.x) ** 2 + (y - o.y) ** 2 <= (r + 6) ** 2;
    case "inst": return pointInPoly(instOutline(o), x, y, r);
    case "gline": {
      const l = lineOf(page, o.id);
      if (!l) return false;
      const t = (x - l.p[0]) * l.d[0] + (y - l.p[1]) * l.d[1];
      if (o.ray && t < -r) return false;
      return Math.abs((x - l.p[0]) * l.d[1] - (y - l.p[1]) * l.d[0]) <= r;
    }
    case "gpoly": {
      const ps = o.pts.map((i) => findPoint(page, i));
      if (ps.some((p) => !p)) return false;
      return ps.some((p, i) => { const q = ps[(i + 1) % ps.length]!; return dist2(x, y, p!.x, p!.y, q.x, q.y) <= r * r; });
    }
    case "gangle": case "gmark": return false;
    case "gseg": {
      const a = findPoint(page, o.a), b = findPoint(page, o.b);
      return !!a && !!b && dist2(x, y, a.x, a.y, b.x, b.y) <= r * r;
    }
    case "gcircle": {
      const c = findPoint(page, o.c), p = findPoint(page, o.p);
      if (!c || !p) return false;
      return Math.abs(Math.hypot(x - c.x, y - c.y) - Math.hypot(p.x - c.x, p.y - c.y)) <= r;
    }
  }
}

export function moveObject(page: Page, o: Obj, dx: number, dy: number): void {
  switch (o.t) {
    case "stroke": for (let i = 0; i < o.pts.length; i += 2) { o.pts[i] += dx; o.pts[i + 1] += dy; } break;
    case "line": o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; break;
    case "fill": for (let i = 0; i < o.runs.length; i += 3) { o.runs[i] += dy; o.runs[i + 1] += dx; o.runs[i + 2] += dx; } break;
    case "gpoint": if (!o.def) { o.x += dx; o.y += dy; } break; // constructed points follow their parents
    case "text": case "image": case "formula": case "graph": case "shape": case "solid": case "net": case "revolve": case "fold": o.x += dx; o.y += dy; break;
    case "gseg": case "gcircle": case "gpoly": {
      // Moving a segment/circle/polygon moves the (free) points it is built from.
      const ids = o.t === "gseg" ? [o.a, o.b] : o.t === "gcircle" ? [o.c, o.p] : o.pts;
      for (const id of ids) { const p = findPoint(page, id); if (p && !p.def) { p.x += dx; p.y += dy; } }
      break;
    }
    case "inst": o.x += dx; o.y += dy; break;
    case "gline": case "gangle": case "gmark": break; // follow their points
  }
}
