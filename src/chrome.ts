// Toolbar markup: slim top bar, grouped tool strip, contextual bar and popovers. Pure string builders; main.ts owns the state and the handlers.
import { LINE_STYLES, PEN_KINDS, SHAPE_KINDS, SOLID_KINDS, type LineStyle, type PenKind, type ShapeKind, type SolidKind, INST_KINDS } from "./model.ts";
import { icon, penIcon, shapeIcon, solidIcon, styleIcon } from "./icons.ts";
import { t, type Key } from "./i18n.ts";
import { MAX_SMOOTH } from "./pen.ts";

export type Tool = "pen" | "highlighter" | "laser" | "eraser" | "select" | "rectsel" | "lasso" | "text" | "fill" | "line" | "formula" | "graph" | "point" | "segment" | "circle" | "shape" | "solid" | "paint" | "surf" | "geo" | "pan" | "inst" | "space" | "gpt" | "none";
export const COLORS = ["#111111", "#d62828", "#1d6fd8", "#2a9d3a", "#e07b00", "#9b4dca"];
export const HL_COLORS = ["#ffe14d", "#6be36b", "#4fd8f5"];
export const WIDTHS = [2, 4.5, 9];
export const SHORTCUTS: Record<string, Tool> = { p: "pen", h: "highlighter", l: "laser", e: "eraser", v: "select", q: "rectsel", t: "text", g: "fill", f: "formula", y: "graph", o: "point", n: "line", s: "shape", k: "solid", m: "pan" };
const keyOf = (tool: string): string => Object.entries(SHORTCUTS).find(([, v]) => v === tool)?.[0]?.toUpperCase() ?? "";

export type InkMode = "ink" | "line" | "shape";
export type InputMode = "auto" | "both" | "pen" | "finger";
export interface ChromeState {
  tool: Tool; penKind: PenKind; color: string; hlColor: string; width: number; smooth: number; pressure: boolean; inkMode: InkMode; lineStyle: LineStyle;
  shapeKind: ShapeKind; solidKind: SolidKind; geoKind: string; inputMode: InputMode; instKind: string;
  title: string; pageIdx: number; pageCount: number; zoomPct: number; fit: boolean; panelOpen: boolean;
  canUndo: boolean; canRedo: boolean; canPaste: boolean;
  sel: { t: string; hasStyle: boolean; style: LineStyle; foldable?: boolean; spinnable?: boolean; solid?: boolean; hasPoints?: boolean } | null; multi: number; geoHint: string;
  dock: string; uiScale: number; collapsed: boolean; pencilAction: string; lastShapes: Tool; lastGeo: Tool; lastSel: Tool; lastInst: Tool;
  foldUi: { t: number; playing: boolean; loop: boolean; speed: number };
  eraserMode: string;
  spin: { playing: boolean; speed: number; axis: string; dir: number }; planeMode: boolean; outerOnly: boolean;
  hideHelpers: boolean; hideNames: boolean; rotDeg: number; dilK: number; sheets: string[]; sheet: number; paperType: string; lang: string;
}

const btn = (id: string, label: string, inner: string, cls = "", extra = ""): string => `<button id="${id}" class="${cls}" title="${label}" aria-label="${label}" ${extra}>${inner}</button>`;
const tip = (key: Key, tool?: string) => { const k = tool ? keyOf(tool) : ""; return k ? `${t(key)} (${k})` : t(key); };

export function topBarHtml(s: ChromeState): string {
  return `<div class="cl">${btn("m-menu", t("menu"), icon("menu"))}${btn("save", `${t("save")} (Ctrl+S)`, icon("save"))}
    ${btn("undo", `${t("undo")} (Ctrl+Z)`, icon("undo"), "", s.canUndo ? "" : "disabled")}${btn("redo", `${t("redo")} (Ctrl+Shift+Z)`, icon("redo"), "", s.canRedo ? "" : "disabled")}
    ${btn("op-paste", `${t("paste")} (Ctrl+V)`, icon("paste"), "", s.canPaste ? "" : "disabled")}${btn("addp", t("addPage"), icon("newpage"))}${btn("m-settings", t("settings"), icon("settings"))}</div>
    ${btn("title-btn", t("title"), `${escapeHtml(s.title)} · ${s.pageIdx + 1} / ${s.pageCount} · ${s.fit ? t("fitWord") + " " : ""}(${s.zoomPct}%)`)}
    <div class="cl">${btn("zout", t("zoomOut"), icon("minus"))}${btn("fitw", t("fitWidth"), icon("fit"))}${btn("zin", t("zoomIn"), icon("plus"))}${btn("panel", t("pageList"), icon("pages"), s.panelOpen ? "on" : "")}</div>`;
}
export const escapeHtml = (v: string): string => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const tbtn = (s: ChromeState, id: Tool, key: Key, ic: string) => btn(`t-${id}`, tip(key, id), ic, `tool${s.tool === id ? " on" : ""}`);
const split = (s: ChromeState, tools: Tool[], pop: string, key: Key, ic: string, label?: string) =>
  btn(`p-${pop}`, label ?? t(key), `${ic}${icon("chevron", 14)}`, `tool split${tools.includes(s.tool) ? " on" : ""}`);

const group = (s: ChromeState, tools: Tool[], toggleId: string, pop: string, ic: string, label: string) =>
  `${btn(toggleId, label, ic, `tool${tools.includes(s.tool) ? " on" : ""}`, 'style="margin-right:-6px"')}${btn(`p-${pop}`, label, icon("chevron", 14), `tool${tools.includes(s.tool) ? " on" : ""}`, 'style="min-width:26px;padding:0 2px"')}`;

export function stripHtml(s: ChromeState): string {
  const penActive = s.tool === "pen";
  const colorDots = COLORS.map((c) => `<button class="dotwrap ${c === s.color && s.tool !== "highlighter" ? "on" : ""}" data-c="${c}" aria-label="${t("color")} ${c}" title="${t("color")}"><span class="dot" style="--c:${c}"></span></button>`).join("");
  const customOn = !COLORS.includes(s.color) && s.tool !== "highlighter";
  const selIcon = s.lastSel === "lasso" ? "lasso" : s.lastSel === "select" ? "pointer" : "rectsel";
  const shapesIcon = s.lastShapes === "solid" ? "cube" : s.lastShapes === "line" ? "line" : "shapes";
  return `${btn("grip", t("moveToolbar"), icon("grip", 18), "grip")}${btn("t-pen", tip("pen", "pen"), `${penIcon(s.penKind)}`, `tool${penActive ? " on" : ""}`, 'style="margin-right:-6px"')}${btn("p-pen", t("penOptions"), icon("chevron", 14), `tool${penActive ? " on" : ""}`, 'style="min-width:26px;padding:0 2px"')}
    ${tbtn(s, "highlighter", "highlighter", icon("highlighter"))}${tbtn(s, "laser", "laser", icon("laser"))}
    ${group(s, ["eraser"], "t-eraser", "erase", icon("eraser"), tip("eraser", "eraser"))}
    <span class="div"></span>${colorDots}<button class="dotwrap ${customOn ? "on" : ""}" id="c-custom" aria-label="${t("customColor")}" title="${t("customColor")}"><span class="dot custom"></span></button><input type="color" id="c-input" value="${s.color}">
    <span class="div"></span>${WIDTHS.map((w, i) => `<button class="dotwrap ${Math.abs(s.width - w) < 0.01 ? "on" : ""}" data-w="${w}" aria-label="${t("width")} ${w}" title="${t("width")}"><span class="wdot" style="width:${5 + i * 4}px;height:${5 + i * 4}px"></span></button>`).join("")}
    <span class="div"></span>${HL_COLORS.map((c) => `<button class="dotwrap ${s.tool === "highlighter" && s.hlColor === c ? "on" : ""}" data-hl="${c}" aria-label="${t("highlighter")}" title="${t("highlighter")}"><span class="hl" style="--c:${c}"></span></button>`).join("")}
    ${btn("dashed", t("dashedLine"), icon("gline", 22, 'stroke-dasharray="3 3"'), s.lineStyle === "dashed" ? "on" : "")}
    <span class="div"></span>${group(s, ["shape", "solid", "line"], "tg-shapes", "shapes", icon(shapesIcon), t("shape"))}
    ${group(s, ["point", "segment", "circle", "geo"], "tg-geo", "geo", icon("geometry"), t("geometry"))}
    ${tbtn(s, "graph", "graph", icon("graph"))}${tbtn(s, "formula", "formula", icon("formula"))}${tbtn(s, "text", "text", icon("text"))}
    ${group(s, ["inst", "space"], "tg-inst", "inst", icon("instruments"), t("instruments"))}
    ${tbtn(s, "fill", "fillTool", icon("fill"))}
    ${group(s, ["rectsel", "lasso", "select"], "tg-select", "select", icon(selIcon), t("selectMenu"))}
    ${btn("rotmode", `${t("rotateMode")} (R)`, icon("rotatemode"), s.tool === "select" ? "on" : "")}
    ${tbtn(s, "pan", "hand", icon("hand"))}`;
}

const styleKey: Record<LineStyle, Key> = { solid: "solid_", dashed: "dashed", dashdot: "dashdot", arrow: "arrowEnd", double: "doubleArrow" };
const rot = (id: string, key: Key, ic: string) => btn(id, t(key), icon(ic));

export function ctxHtml(s: ChromeState): string {
  const parts: string[] = [];
  const sel = s.sel;
  if (s.geoHint) parts.push(`<span class="hint">${escapeHtml(s.geoHint)}</span>`);
  if (s.multi || s.tool === "rectsel" || s.tool === "lasso") parts.push(btn("op-copy", `${t("copy")} (Ctrl+C)`, icon("copy")), btn("op-cut", `${t("cut")} (Ctrl+X)`, icon("cut")), btn("op-paste", `${t("paste")} (Ctrl+V)`, icon("paste")), btn("op-duplicate", `${t("duplicate")} (Ctrl+D)`, icon("duplicate")), btn("op-del", `${t("del")} (Del)`, icon("trash")));
  if (sel) {
    const k = sel.t;
    if (sel.spinnable) {
      const sp = s.spin;
      parts.push(btn("sp-play", t("spinPlay"), icon(sp.playing ? "pause" : "rotatemode"), sp.playing ? "on" : ""), btn("sp-speed", t("spinSpeed"), `<span class="lbl">${sp.speed}×</span>`), btn("sp-axis", `${t("spinAxis")}: ${t(`spin_${sp.axis}` as Key)}`, `<span class="lbl">${t(`spin_${sp.axis}` as Key).slice(0, 8)}</span>`), btn("sp-dir", t("spinDir"), icon(sp.dir > 0 ? "cw" : "ccw")), btn("sp-png", t("exportFrame"), icon("png")), `<span class="div"></span>`);
    }
    if (k === "solid" || k === "revolve" || k === "fold") parts.push(rot("rot-l", "rotL", "left"), rot("rot-r", "rotR", "right"), rot("rot-u", "rotU", "up"), rot("rot-d", "rotD", "down"), rot("rot-ccw", "rotCCW", "ccw"), rot("rot-cw", "rotCW", "cw"), `<span class="div"></span>`);
    if (k === "shape") parts.push(rot("rot-ccw", "rotCCW", "ccw"), rot("rot-cw", "rotCW", "cw"), `<span class="div"></span>`);
    if (sel.foldable) {
      const f = s.foldUi;
      parts.push(`<input id="fold-t" type="range" min="0" max="100" step="1" value="${Math.round(f.t * 100)}" title="${t("foldAmount")}" aria-label="${t("foldAmount")}" style="width:120px">`,
        btn("f-play", f.playing ? t("foldPause") : t("foldPlay"), icon(f.playing ? "pause" : "play"), f.playing ? "on" : ""), btn("f-loop", t("foldLoop"), icon("loop"), f.loop ? "on" : ""), btn("f-speed", t("foldSpeed"), `<span class="lbl">${f.speed}×</span>`), `<span class="div"></span>`);
    }
    if (["solid", "revolve", "shape", "net", "stroke", "graph", "fold"].includes(k)) parts.push(btn("thin", t("thin"), icon("thin")), btn("thick", t("thick"), icon("thick")));
    if (k === "fold") parts.push(btn("t-paint", t("paint"), icon("paint"), s.tool === "paint" ? "on" : ""));
    if (k === "solid") parts.push(`<span class="div"></span>`, btn("t-paint", t("paint"), icon("paint"), s.tool === "paint" ? "on" : ""), btn("paint-outer", t("outerOnly"), icon("outer"), s.outerOnly ? "on" : ""), btn("t-surf", t("surf"), icon("surf"), s.tool === "surf" ? "on" : ""), btn("pl-mode", t("planeMode"), icon("plane"), s.planeMode ? "on" : ""), btn("unfold", t("unfold"), icon("unfold")), btn("netcopy", t("copyNet"), `<span class="lbl">${t("copyNet")}</span>`));
    if (k === "net") parts.push(btn("t-paint", t("paint"), icon("paint"), s.tool === "paint" ? "on" : ""));
    if (k === "graph") parts.push(`<span class="div"></span>`, btn("revolve", t("revolve"), icon("revolve")), btn("g-pt", t("pointOnGraph"), icon("point"), s.tool === "gpt" ? "on" : ""), btn("g-xint", t("xIntercepts"), `<span class="lbl">x∩</span>`), btn("g-yint", t("yIntercept"), `<span class="lbl">y∩</span>`), btn("g-ext", t("extrema"), `<span class="lbl">min/max</span>`), btn("g-cross", t("intersections"), icon("intersection")), btn("g-legend", t("legend"), `<span class="lbl">f(x)</span>`), btn("g-11", t("scale11"), `<span class="lbl">1:1</span>`));
    if (sel.hasStyle) parts.push(`<span class="div"></span>`, ...LINE_STYLES.map((q) => btn(`ls-${q}`, t(styleKey[q]), styleIcon(q), q === sel.style ? "on" : "")));
    if (k === "gpoint") parts.push(btn("gn-name", t("toggleName"), icon("names")), btn("gn-dot", t("toggleDot"), icon("point")));
    if (["gpoint", "gseg", "gline", "gcircle"].includes(k)) parts.push(btn("gn-helper", t("toggleHelper"), icon("helper")));
    if (k === "inst") parts.push(rot("rot-ccw", "rotCCW", "ccw"), rot("rot-cw", "rotCW", "cw"));
    if (!["gseg", "gline", "gcircle", "gangle", "gmark", "gpoly"].includes(k) || k === "gpoint") parts.push(`<span class="div"></span>`);
    if (!["fill"].includes(k)) parts.push(btn("edit", t("edit"), icon("edit")));
    parts.push(btn("del", `${t("del")} (Del)`, icon("trash")));
  }
  return parts.join("");
}

export function sheetsHtml(s: ChromeState): string {
  if (s.sheets.length < 2) return "";
  return s.sheets.map((n, i) => btn(`sh-${i}`, n, escapeHtml(n), i === s.sheet ? "on" : "")).join("") + btn("sh-add", t("newSheet"), icon("plus", 16));
}

const INST_KEY: Record<string, Key> = { ruler: "ruler", protractor: "protractor", square: "instSquare", compass: "compass" };
const grid = (items: string) => `<div class="grid">${items}</div>`;
const geoItem = (s: ChromeState, kind: string, key: Key, ic: string) => btn(`gt-${kind}`, t(key), icon(ic), (["point", "segment", "circle"].includes(kind) ? s.tool === kind : s.tool === "geo" && s.geoKind === kind) ? "on" : "");

export function popHtml(name: string, s: ChromeState): string {
  switch (name) {
    case "pen": return `<h4>${t("penKind")}</h4><div class="seg">${PEN_KINDS.map((k) => btn(`pk-${k}`, t(k), penIcon(k), k === s.penKind ? "on" : "")).join("")}</div>
      <h4>${t("color")}</h4><div class="swatches">${COLORS.map((c) => `<button data-c="${c}" class="${c === s.color ? "on" : ""}" style="--c:${c}" aria-label="${c}"></button>`).join("")}<button id="c-custom2" style="--c:#fff" aria-label="${t("customColor")}">${icon("plus", 14)}</button></div>
      <h4>${t("width")}</h4><div class="row"><input id="w" type="range" min="0.5" max="14" step="0.5" value="${s.width}" aria-label="${t("width")}"><span>${s.width}</span></div>
      <h4>${t("smooth")}</h4><div class="row"><input id="smooth" type="range" min="0" max="${MAX_SMOOTH}" step="1" value="${s.smooth}" aria-label="${t("smooth")}"><span>${s.smooth}</span></div>
      <div class="row">${btn("pressure", t("pressure"), `${icon("touch", 18)} ${t("pressure")}`, s.pressure ? "on" : "")}</div>
      <h4>${t("inkMode")}</h4><div class="seg">${(["ink", "line", "shape"] as const).map((m) => btn(`im-${m}`, t("inkMode"), t(m === "ink" ? "modeInk" : m === "line" ? "modeLine" : "modeShape"), m === s.inkMode ? "on" : "")).join("")}</div>`;
    case "shapes": return `<h4>${t("sectionLines")}</h4><div class="grid">${LINE_STYLES.map((q) => btn(`ln-${q}`, t(styleKey[q]), styleIcon(q), s.tool === "line" && s.lineStyle === q ? "on" : "")).join("")}</div>
      <h4>${t("sectionPlane")}</h4>${grid(SHAPE_KINDS.map((k) => btn(`sk-${k}`, t(k), shapeIcon(k), s.tool === "shape" && s.shapeKind === k ? "on" : "")).join(""))}
      <h4>${t("sectionSolids")}</h4>${grid(SOLID_KINDS.map((k) => btn(`so-${k}`, t(k), solidIcon(k), s.tool === "solid" && s.solidKind === k ? "on" : "")).join(""))}`;
    case "geo": return `<h4>${t("geoBasic")}</h4>${grid(geoItem(s, "point", "point", "point") + geoItem(s, "segment", "segment", "segment") + geoItem(s, "line", "lineGeo", "gline") + geoItem(s, "ray", "ray", "ray") + geoItem(s, "circle", "circle", "circle") + geoItem(s, "polygon", "polygon", "polygon"))}
      <h4>${t("geoConstruct")}</h4>${grid(["midpoint", "perpendicular", "parallel", "altitude", "intersection", "bisector", "centroid", "orthocenter", "circumcenter", "incenter", "circumcircle"].map((k) => geoItem(s, k, k as Key, k)).join(""))}
      <h4>${t("geoTransform")}</h4>${grid(["reflectLine", "reflectPoint", "translate", "rotate", "dilate"].map((k) => geoItem(s, k, k as Key, k)).join(""))}
      <div class="row"><label>${t("angleDeg")} <input id="geo-rot" type="number" value="${s.rotDeg}"></label><label>${t("factor")} <input id="geo-k" type="number" step="0.1" value="${s.dilK}"></label></div>
      <h4>${t("geoMeasure")}</h4>${grid(["angle", "rightAngle", "equalMark"].map((k) => geoItem(s, k, k as Key, k)).join(""))}
      <h4>${t("geoShow")}</h4><div class="row">${btn("gh-names", t("hideNames"), `${icon("names", 18)} ${t("hideNames")}`, s.hideNames ? "on" : "")}${btn("gh-helpers", t("hideHelpers"), `${icon("helper", 18)} ${t("hideHelpers")}`, s.hideHelpers ? "on" : "")}</div>`;
    case "inst": return `<div class="list">${INST_KINDS.map((k) => btn(`in-${k}`, t(k as Key), `${icon(k)} ${t(k as Key)}`)).join("")}${btn("t-space", t("insertSpace"), `${icon("space")} ${t("insertSpace")}`, s.tool === "space" ? "on" : "")}</div>`;
    case "erase": return `<div class="list">${(["stroke", "s", "m", "l"] as const).map((m) => btn(`er-${m}`, t(({ stroke: "eraserStroke", s: "eraserSmall", m: "eraserMedium", l: "eraserLarge" } as const)[m]), `${icon("eraser")} ${t(({ stroke: "eraserStroke", s: "eraserSmall", m: "eraserMedium", l: "eraserLarge" } as const)[m])}`, s.eraserMode === m ? "on" : "")).join("")}${btn("clearpage", t("clearPage"), `${icon("trash")} ${t("clearPage")}`)}</div>`;
    case "select": return `<div class="list">${btn("t-rectsel", tip("rectSel", "rectsel"), `${icon("rectsel")} ${t("rectSel")}`, s.tool === "rectsel" ? "on" : "")}${btn("t-lasso", t("lasso"), `${icon("lasso")} ${t("lasso")}`, s.tool === "lasso" ? "on" : "")}${btn("t-select", tip("select", "select"), `${icon("pointer")} ${t("select")}`, s.tool === "select" ? "on" : "")}</div>`;
    case "menu": return `<div class="list">${btn("new", t("newDoc"), `${icon("newpage")} ${t("newDoc")}`)}${btn("open", t("open"), `${icon("pages")} ${t("open")}`)}${btn("save", t("save"), `${icon("save")} ${t("save")}`)}${btn("png", t("png"), `${icon("png")} ${t("png")}`)}${btn("pdf", t("pdf"), `${icon("pdf")} ${t("pdf")}`)}
      ${btn("pdfin", t("importPdf"), `${icon("pdf")} ${t("importPdf")}`)}${btn("pic", t("insertPicture"), `${icon("picture")} ${t("insertPicture")}`)}${btn("paper", t("paper"), `${icon("pages")} ${t("paper")}`)}${btn("sheet-new", t("newSheet"), `${icon("layers")} ${t("newSheet")}`)}${btn("sheet-ren", t("renameSheet"), `${icon("edit")} ${t("renameSheet")}`)}${btn("sheet-del", t("deleteSheet"), `${icon("trash")} ${t("deleteSheet")}`)}
      ${btn("delp", t("delPage"), `${icon("delpage")} ${t("delPage")}`)}</div>`;
    case "settings": return `<h4>${t("inputMode")}</h4><div class="list">${(["auto", "both", "pen", "finger"] as const).map((m) => btn(`inp-${m}`, t(`input_${m}` as Key), `${icon(m === "finger" ? "touch" : "pen", 18)} ${t(`input_${m}` as Key)}`, s.inputMode === m ? "on" : "")).join("")}</div>
      <h4>${t("pencilDouble")}</h4><div class="list">${(["eraser", "previous", "rotate", "color"] as const).map((a) => btn(`pa-${a}`, t(`pencil_${a}` as Key), t(`pencil_${a}` as Key), s.pencilAction === a ? "on" : "")).join("")}</div>
      <h4>${t("toolbarSettings")}</h4><div class="row"><label>${t("toolbarSize")} <input id="ui-scale" type="range" min="80" max="160" step="5" value="${Math.round(s.uiScale * 100)}"><span>${Math.round(s.uiScale * 100)}%</span></label></div>
      <div class="seg">${(["top", "bottom", "left", "right", "float"] as const).map((d) => btn(`dock-${d}`, t(`dock_${d}` as Key), t(`dock_${d}` as Key), s.dock === d ? "on" : "")).join("")}</div>
      <div class="seg" style="margin-top:6px">${btn("ui-hide", t("hideToolbar"), t("hideToolbar"))}${btn("ui-reset", t("resetToolbar"), t("resetToolbar"))}${btn("help-keys", t("shortcutsHelp"), `${icon("help", 18)} ${t("shortcutsHelp")}`)}</div>
      <h4>${t("autoRotate")}</h4><div class="seg">${btn("sp-speed", t("spinSpeed"), `${s.spin.speed}×`)}${btn("sp-axis", t("spinAxis"), t(`spin_${s.spin.axis}` as Key))}${btn("sp-dir", t("spinDir"), icon(s.spin.dir > 0 ? "cw" : "ccw", 18))}</div>
      <h4>${t("general")}</h4><div class="list">${btn("pressure", t("pressure"), `${icon("touch", 18)} ${t("pressure")}`, s.pressure ? "on" : "")}${btn("lang", t("lang"), `${icon("globe", 18)} ${t("lang")}`)}${btn("theme", t("themeToggle"), `${icon("settings", 18)} ${t("themeToggle")}`)}</div>`;
  }
  return "";
}
