// Tool switching rules (draw <-> rotate, tap-to-deactivate, Apple Pencil double-tap actions) and toolbar layout preferences. Pure, no DOM.
export type ToolName = string; // the Tool union lives in chrome.ts; these rules only need names
export const NONE = "none";
/** Tools that are not "drawing": moving, selecting, panning. */
const NON_DRAW = new Set(["select", "rectsel", "lasso", "pan", NONE, "paint", "surf", "gpt", "inst", "space"]);
export const isDrawTool = (t: ToolName): boolean => !NON_DRAW.has(t);

export interface ToolState { tool: ToolName; prev: ToolName; lastDraw: ToolName; eraserFrom: ToolName | null }
export const initialToolState = (tool: ToolName = "pen"): ToolState => ({ tool, prev: tool, lastDraw: isDrawTool(tool) ? tool : "pen", eraserFrom: null });

/** Record that `tool` is now active: remembers the previous tool and the last drawing tool. */
export function trackTool(s: ToolState, tool: ToolName): ToolState {
  if (tool === s.tool) return s;
  return { ...s, tool, prev: s.tool, lastDraw: isDrawTool(tool) ? tool : s.lastDraw };
}

/** Tapping a tool button: the active tool switches off ("none"), any other tool switches on. */
export function tapTool(s: ToolState, tapped: ToolName): ToolState {
  return trackTool(s, s.tool === tapped ? NONE : tapped);
}
/** Same for a group of related tools behind one button (shapes, geometry, selection): `last` is the member used most recently. */
export function tapGroup(s: ToolState, group: ToolName[], last: ToolName | undefined): ToolState {
  return group.includes(s.tool) ? trackTool(s, NONE) : trackTool(s, last && group.includes(last) ? last : group[0]);
}

/** R: writing <-> rotate (Move) mode. Leaves the drawing tool you were using and returns to it. */
export function toggleRotate(s: ToolState): ToolState {
  if (s.tool === "select") return trackTool(s, isDrawTool(s.lastDraw) ? s.lastDraw : "pen");
  return trackTool(s, "select");
}

export type PencilAction = "eraser" | "previous" | "rotate" | "color";
export const PENCIL_ACTIONS: PencilAction[] = ["eraser", "previous", "rotate", "color"];
export interface PencilResult { state: ToolState; colorIdx: number }
/** What a Pencil double-tap does. `colorIdx` is the index into the pen colours; "color" advances it (wrapping). */
export function pencilDoubleTap(s: ToolState, action: PencilAction, colorIdx: number, colorCount: number): PencilResult {
  switch (action) {
    case "eraser":
      if (s.tool === "eraser") { const back = s.eraserFrom ?? s.lastDraw; return { state: { ...trackTool(s, isDrawTool(back) && back !== "eraser" ? back : "pen"), eraserFrom: null }, colorIdx }; }
      return { state: { ...trackTool(s, "eraser"), eraserFrom: s.tool }, colorIdx };
    case "previous": return { state: trackTool(s, s.prev === s.tool ? s.lastDraw : s.prev), colorIdx };
    case "rotate": return { state: toggleRotate(s), colorIdx };
    case "color": return { state: s, colorIdx: (colorIdx + 1) % Math.max(1, colorCount) };
  }
}
export const isPencilAction = (v: unknown): v is PencilAction => PENCIL_ACTIONS.includes(v as PencilAction);

// ---- toolbar layout ----------------------------------------------------------------------------
export type Dock = "top" | "bottom" | "left" | "right" | "float";
export const DOCKS: Dock[] = ["top", "bottom", "left", "right", "float"];
export interface ToolbarPrefs { scale: number; dock: Dock; fx: number; fy: number; collapsed: boolean }
export const MIN_UI = 0.8, MAX_UI = 1.6;
export const defaultToolbarPrefs = (): ToolbarPrefs => ({ scale: 1, dock: "top", fx: 40, fy: 120, collapsed: false });
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
/** Validate stored preferences (anything may have been written to localStorage). */
export function normToolbarPrefs(v: unknown): ToolbarPrefs {
  const d = defaultToolbarPrefs();
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    scale: Math.min(MAX_UI, Math.max(MIN_UI, num(o.scale, d.scale))),
    dock: DOCKS.includes(o.dock as Dock) ? (o.dock as Dock) : d.dock,
    fx: num(o.fx, d.fx), fy: num(o.fy, d.fy), collapsed: o.collapsed === true,
  };
}
/** Keep a floating toolbar of size w×h inside the viewport (a strip may be larger than the screen: keep its top-left visible). */
export function clampFloat(x: number, y: number, w: number, h: number, vw: number, vh: number): { x: number; y: number } {
  const maxX = Math.max(0, vw - Math.min(w, vw)), maxY = Math.max(0, vh - Math.min(h, vh));
  return { x: Math.min(maxX, Math.max(0, x)), y: Math.min(maxY, Math.max(0, y)) };
}
export const parsePrefs = (raw: string | null): ToolbarPrefs => { try { return normToolbarPrefs(raw ? JSON.parse(raw) : null); } catch { return defaultToolbarPrefs(); } };
