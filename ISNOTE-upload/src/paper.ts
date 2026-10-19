// Paper: type (plain / ruled / squared / dotted), colour, orientation and line spacing. Pure, no DOM.
export type PaperType = "notebook" | "plain" | "ruled" | "squared" | "dotted";
export const PAPER_TYPES: PaperType[] = ["notebook", "plain", "ruled", "squared", "dotted"];
export interface Paper { type: PaperType; color: string; landscape: boolean; spacing: number }

export const PORTRAIT = { w: 1000, h: 1414 }; // A4 ratio, in page units
export const MIN_SPACING = 12, MAX_SPACING = 120;
export const PAPER_COLORS = ["#ffffff", "#fff8dc", "#eaf4ea", "#e8f0fb", "#fde9ef", "#222831"];

/** Default paper: white notebook page with light-blue rules and a pink margin line on the left (60 units from the edge on a 1000-unit page). */
export const defaultPaper = (): Paper => ({ type: "notebook", color: "#ffffff", landscape: false, spacing: 40 });
export const NOTEBOOK_MARGIN_X = 60;
export const NOTEBOOK_LINE = "#b9d3f0", NOTEBOOK_MARGIN = "#e8a3b4";
export const normPaper = (p?: Partial<Paper>): Paper => {
  const d = defaultPaper();
  const spacing = Number.isFinite(p?.spacing) ? Math.min(MAX_SPACING, Math.max(MIN_SPACING, p!.spacing!)) : d.spacing;
  return { type: PAPER_TYPES.includes(p?.type as PaperType) ? p!.type! : d.type, color: typeof p?.color === "string" ? p.color : d.color, landscape: !!p?.landscape, spacing };
};
export const pageDims = (p?: Paper): { w: number; h: number } => (p?.landscape ? { w: PORTRAIT.h, h: PORTRAIT.w } : { w: PORTRAIT.w, h: PORTRAIT.h });

const lum = (hex: string): number => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};
/** Colour of rules/grid/dots that stays readable on both light and dark paper. */
export const gridColor = (paper: string, type?: PaperType): string => (lum(paper) < 0.45 ? "#5b6575" : type === "notebook" ? NOTEBOOK_LINE : "#b9c6da");
export const isDarkPaper = (paper: string): boolean => lum(paper) < 0.45;

export interface PaperMarks { lines: [number, number, number, number][]; dots: [number, number][]; margins: [number, number, number, number][] }
/** Geometry of the paper pattern in page units. */
export function paperMarks(p: Paper): PaperMarks {
  const { w, h } = pageDims(p);
  const s = p.spacing, lines: PaperMarks["lines"] = [], dots: PaperMarks["dots"] = [];
  const margins: PaperMarks["margins"] = [];
  if (p.type === "notebook") {
    for (let y = s * 1.5; y < h - s / 2; y += s) lines.push([0, y, w, y]);
    margins.push([NOTEBOOK_MARGIN_X, 0, NOTEBOOK_MARGIN_X, h], [w - 24, 0, w - 24, h]);
  } else if (p.type === "ruled") {
    for (let y = s * 2; y < h - s / 2; y += s) lines.push([0, y, w, y]);
    margins.push([s * 2.5, 0, s * 2.5, h]);
  } else if (p.type === "squared") {
    for (let y = s; y < h; y += s) lines.push([0, y, w, y]);
    for (let x = s; x < w; x += s) lines.push([x, 0, x, h]);
  } else if (p.type === "dotted") {
    for (let y = s; y < h; y += s) for (let x = s; x < w; x += s) dots.push([x, y]);
  }
  return { lines, dots, margins };
}
