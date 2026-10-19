import "./style.css";
import { LINE_STYLES, PEN_KINDS, SHAPE_KINDS, SOLID_KINDS, clone, findPoint, hit, moveObject, newDoc, removeObject, uid, type Doc, type GeoPoint, type Graph, type ImageObj, type Line, type LineStyle, type Mark, type Net, type Obj, type Page, type PenKind, type Revolve, type Shape, type ShapeKind, type Solid, type SolidKind, type Stroke, type TextObj } from "./model.ts";
import { THEME, drawPage, handlesOf, preloadImages, solidScale } from "./render.ts";
import { PAPER_COLORS, PAPER_TYPES, defaultPaper, normPaper, pageDims, type Paper, type PaperType } from "./paper.ts";
import { smoothPressure, MAX_SMOOTH, LASER_TTL, laserAlpha, pruneLaser, smoothStep, type LaserPt } from "./pen.ts";
import { recognize } from "./recognize.ts";
import { floodFill } from "./fill.ts";
import { boundsOf, rectPolygon, selectIn } from "./bounds.ts";
import { copyObjects } from "./clipboard.ts";
import { FONT_FAMILY } from "./text.ts";
import { importPdf } from "./pdfimport.ts";
import * as solidsApi from "./solids.ts";
import { boundRadius, facePoint, facesAt, pickFace, pickSnap, type V3 } from "./solids.ts";
import { netOf, pickNetFace } from "./nets.ts";
import { revolveVolume } from "./revolve.ts";
import { compile } from "./mathexpr.ts";
import { loadFormulaImage, renderSvg } from "./formula.ts";
import { decodeDoc, deliverFile, encodeDoc, loadLocal, pickFile, saveLocal } from "./storage.ts";
import { buildPdf } from "./pdf.ts";
import { getLang, setLang, t, type Key } from "./i18n.ts";
import { icon } from "./icons.ts";
import { COLORS, HL_COLORS, SHORTCUTS, WIDTHS, ctxHtml, popHtml, sheetsHtml, stripHtml, topBarHtml, type ChromeState, type InputMode, type InkMode, type Tool } from "./chrome.ts";
import { CONSTRUCTIONS, matches, resolveGeo, type Need } from "./geo.ts";
import { INST_KINDS, type Inst, type InstKind, type GeoLine } from "./model.ts";
import { defaultSize, dragInst, guideAt, projectOnGuide, type Guide } from "./instruments.ts";
import { insertSpace } from "./space.ts";
import { addSheet, pagesIn, removeSheet, renameSheet, sheetNames, sheetOf } from "./sheets.ts";
import { initialToolState, normToolbarPrefs, parsePrefs, defaultToolbarPrefs, clampFloat, isPencilAction, pencilDoubleTap as pencilRule, tapGroup, tapTool, toggleRotate, trackTool, type Dock, type PencilAction, type ToolbarPrefs, type ToolState } from "./toolstate.ts";
import { canFold, effRadius, pickFoldFace, foldRadius } from "./fold.ts";
import { pickFolded, pickSection } from "./foldmarks.ts";
import { isCoplanar } from "./sections.ts";
import { loopKey } from "./sections.ts";
import { SPIN_AXES, SPIN_SPEEDS, spinStep, type SpinAxis, type SpinSettings } from "./spin.ts";
import { type Fold } from "./model.ts";
import { ERASER_RADIUS, eraseFromStroke, type EraserMode } from "./erase.ts";
import { evalFn, extrema, intersectFns, parseIneq, roots, squareScale } from "./graphtools.ts";

let shapeKind: ShapeKind = "triangle";
let solidKind: SolidKind = "cube";

let doc: Doc = newDoc();
let pageIdx = 0;
let tool: Tool = "pen";
let color = COLORS[0];
let hlColor = HL_COLORS[0];
let inputMode: InputMode = (() => { try { const v = localStorage.getItem("openink-input"); if (v === "auto" || v === "both" || v === "pen" || v === "finger") return v; } catch { /* ignore */ } return "pen"; })(); // default: the pencil writes, a finger only scrolls (palm rejection)
let geoKind = "midpoint";
let geoPicks: string[] = [];
let geoRotDeg = 90, geoDilK = 2;
let instKind: InstKind = "ruler";
let sheetIdx = 0;
let ts: ToolState = initialToolState("pen"); // tool history: previous tool, last drawing tool
let prefs: ToolbarPrefs = (() => { try { return parsePrefs(localStorage.getItem("openink-toolbar")); } catch { return defaultToolbarPrefs(); } })();
let pencilAction: PencilAction = (() => { try { const v = localStorage.getItem("openink-pencil"); if (isPencilAction(v)) return v; } catch { /* ignore */ } return "eraser"; })();
let colorIdx = 0;
let planeMode = false, outerOnly = false; // surf tool: define a section from marks / paint tool: outer faces only
let planePicks: string[] = [], planeSolid: string | null = null;
let spinSettings: SpinSettings = (() => { try { const v = JSON.parse(localStorage.getItem("openink-spin") ?? "null"); if (v && SPIN_SPEEDS.includes(v.speed) && SPIN_AXES.includes(v.axis) && (v.dir === 1 || v.dir === -1)) return v; } catch { /* ignore */ } return { speed: 1, axis: "yaw", dir: 1 }; })();
const spinners = new Map<string, SpinSettings>(); // objects that are turning right now
let spinSnap: Snap | null = null, spinUndoLen = 0, spinRaf = 0, spinLast = 0;
let eraserMode: EraserMode = (() => { try { const v = localStorage.getItem("openink-eraser"); if (v === "stroke" || v === "s" || v === "m" || v === "l") return v; } catch { /* ignore */ } return "stroke"; })();
let hover: { x: number; y: number } | null = null; // Pencil hover position (page units)
let lastShapes: Tool = "shape", lastGeo: Tool = "point", lastSel: Tool = "select", lastInst: Tool = "inst";
let popName: string | null = null;
let guide: Guide | null = null; // instrument edge the current stroke follows
let spaceDrag: { y0: number; y1: number } | null = null;
let width = 3;
let selected: string | null = null;
let dirty = false;
let pendingPoint: string | null = null; // first click of segment/circle
let rubber: { x: number; y: number } | null = null;
let pendingMark: { id: string; mark: string } | null = null; // first point of a line being drawn on a solid
let penKind: PenKind = "ballpoint";
let smoothLevel = 2;
let pressureOn = true;
let inkMode: InkMode = "ink";
let lineStyle: LineStyle = "solid";
let multi: string[] = []; // ids selected with the rectangle / free-shape tools
let clipboard: Obj[] = [];
let selPath: [number, number][] | null = null; // selection outline being drawn
let userZoom: number | null = null; // css px per page unit; null = fit
let panelOpen = false;
let lasers: LaserPt[][] = [];
let lastSmooth: [number, number] | null = null;
let lastSig = "";
let rawPts: number[] = []; // unsmoothed pen points of the current stroke (used to recognise shapes)
type Snap = { page: number; objects: Obj[]; paper?: Paper; bg?: string };
const undoStack: Snap[] = [];
const redoStack: Snap[] = [];

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const app = $("#app");
app.innerHTML = `
  <div id="chrome"><header id="top"></header><div id="dk-top" class="dock"></div><div id="sheets" hidden></div><div id="ctx" hidden></div></div>
  <div id="work"><div id="dk-left" class="dock"></div><div id="main"><aside id="pages" hidden></aside><div id="stage"><canvas id="cv"></canvas></div></div><div id="dk-right" class="dock"></div></div>
  <div id="dk-bottom" class="dock"></div>
  <button id="strip-fab" hidden></button><button id="quick" hidden></button>
  <div id="toast" role="status"></div>
  <dialog id="dlg"></dialog>`;
const stage = $("#stage");
const cv = $<HTMLCanvasElement>("#cv");
const ctx = cv.getContext("2d")!;
const bar = $("#chrome");
const strip = document.createElement("div");
strip.id = "strip";
$("#dk-top").appendChild(strip);
const popEl = document.createElement("div");
popEl.className = "pop"; popEl.hidden = true;
app.appendChild(popEl);
const dlg = $<HTMLDialogElement>("#dlg");
let scale = 1;
let raf = 0;

const page = (): Page => doc.pages[pageIdx];
const PORTRAIT_W = pageDims().w, PORTRAIT_H = pageDims().h;
const PW = () => pageDims(page().paper).w;
const pressureOf = (e: PointerEvent): number => Math.round((e.pressure > 0 ? e.pressure : 0.5) * 100) / 100;

function toast(msg: string) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

function schedule() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const sig = `${tool}|${selected}|${multi.length}|${curStyle()}|${undoStack.length}|${redoStack.length}|${geoPicks.length}|${spinners.size}|${spinSettings.speed}${spinSettings.axis}${spinSettings.dir}|${planeMode}${outerOnly}|${anim ? 1 : 0}|${foldLoop}|${foldSpeed}`; // keep the contextual bar and undo/redo state in step with the selection
    if (sig !== lastSig) { lastSig = sig; refreshBar(); }
    const px = cv.width / pageDims(page().paper).w;
    drawPage(ctx, page(), px, { selected, multi, pending: pendingMark, onAsync: schedule });
    overlay(px);
    if (pendingPoint && rubber) {
      const a = findPoint(page(), pendingPoint);
      if (a) {
        ctx.save();
        ctx.setTransform(cv.width / PW(), 0, 0, cv.width / PW(), 0, 0);
        ctx.strokeStyle = THEME.accent; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
        ctx.beginPath();
        if (tool === "segment") { ctx.moveTo(a.x, a.y); ctx.lineTo(rubber.x, rubber.y); }
        else ctx.arc(a.x, a.y, Math.hypot(rubber.x - a.x, rubber.y - a.y), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  });
}

const fitScale = () => Math.min((stage.clientWidth - 24) / pageDims(page().paper).w, 0.96);
function layout() {
  const d = pageDims(page().paper);
  scale = Math.max(0.1, Math.min(4, userZoom ?? fitScale()));
  const cssW = d.w * scale, cssH = d.h * scale;
  // Keep the canvas bitmap within what browsers allow when zoomed in a lot.
  const dpr = Math.min(window.devicePixelRatio || 1, 3, 8192 / Math.max(cssW, cssH));
  cv.style.width = `${cssW}px`;
  cv.style.height = `${cssH}px`;
  cv.width = Math.round(cssW * dpr);
  cv.height = Math.round(cssH * dpr);
  refreshTop();
  schedule();
}
function setZoom(z: number | null) { userZoom = z; layout(); }

/** Transient things drawn above the page: selection outline, rubber-band rectangle, laser trails. */
function overlay(px: number) {
  ctx.save();
  ctx.setTransform(px, 0, 0, px, 0, 0);
  if (selPath && selPath.length > 1) {
    ctx.strokeStyle = THEME.accent; ctx.lineWidth = 1.5 / (scale || 1); ctx.setLineDash([6 / scale, 4 / scale]);
    ctx.fillStyle = "rgba(47,123,245,0.08)";
    ctx.beginPath(); selPath.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  if (hover && !drag && (tool === "pen" || tool === "highlighter" || tool === "eraser")) {
    const r = (tool === "eraser" ? 14 : tool === "highlighter" ? width * 4 : width) / 2 + 1;
    ctx.strokeStyle = THEME.accent; ctx.lineWidth = 1.5 / (scale || 1); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(hover.x, hover.y, Math.max(r, 2), 0, Math.PI * 2); ctx.stroke();
  }
  for (const id of geoPicks) { const q = findPoint(page(), id); if (q) { ctx.strokeStyle = THEME.accent; ctx.lineWidth = 2 / (scale || 1); ctx.beginPath(); ctx.arc(q.x, q.y, 11, 0, Math.PI * 2); ctx.stroke(); } }
  if (spaceDrag) {
    ctx.fillStyle = "rgba(216,27,138,0.12)"; ctx.strokeStyle = THEME.accent; ctx.lineWidth = 1.5 / (scale || 1);
    ctx.fillRect(0, Math.min(spaceDrag.y0, spaceDrag.y1), PW(), Math.abs(spaceDrag.y1 - spaceDrag.y0));
    ctx.beginPath(); ctx.moveTo(0, spaceDrag.y0); ctx.lineTo(PW(), spaceDrag.y0); ctx.stroke();
  }
  if (lineDrag) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(lineDrag.x1, lineDrag.y1); ctx.lineTo(lineDrag.x2, lineDrag.y2); ctx.stroke();
  }
  const now = performance.now();
  ctx.setLineDash([]); ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const tr of lasers) {
    pruneLaser(tr, now);
    for (let i = 1; i < tr.length; i++) {
      const a = laserAlpha(now - tr[i].t);
      ctx.strokeStyle = `rgba(255,40,40,${a})`; ctx.lineWidth = 7 * (0.4 + 0.6 * a);
      ctx.shadowColor = `rgba(255,60,60,${a})`; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.moveTo(tr[i - 1].x, tr[i - 1].y); ctx.lineTo(tr[i].x, tr[i].y); ctx.stroke();
    }
    if (tr.length === 1) { ctx.fillStyle = `rgba(255,40,40,${laserAlpha(now - tr[0].t)})`; ctx.beginPath(); ctx.arc(tr[0].x, tr[0].y, 5, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
  lasers = lasers.filter((t) => t.length > 0);
  if (lasers.length) requestAnimationFrame(() => schedule());
}
let lineDrag: { x1: number; y1: number; x2: number; y2: number } | null = null;

function toPage(e: PointerEvent | MouseEvent): { x: number; y: number } {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
}

// ---- history -------------------------------------------------------------
const takeSnap = (idx: number): Snap => ({ page: idx, objects: clone(doc.pages[idx].objects), paper: doc.pages[idx].paper ? { ...doc.pages[idx].paper! } : undefined, bg: doc.pages[idx].bg });
function snapshot() {
  undoStack.push(takeSnap(pageIdx));
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  markDirty();
}
function undoRedo(from: typeof undoStack, to: typeof undoStack) {
  const s = from.pop();
  if (!s || s.page >= doc.pages.length) return;
  to.push(takeSnap(s.page));
  const pg = doc.pages[s.page];
  pg.objects = s.objects;
  if (s.paper) pg.paper = s.paper; else delete pg.paper; // paper settings are part of undo/redo too
  if (s.bg) pg.bg = s.bg; else delete pg.bg;
  pageIdx = s.page;
  selected = null; multi = [];
  markDirty();
  layout();
  refreshBar();
}
let saveTimer = 0;
function markDirty() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveLocal(doc), 800);
  if (panelOpen) refreshPanel();
}

// ---- dialogs -------------------------------------------------------------
function ask(html: string, mount: (root: HTMLDialogElement) => (() => boolean) | void): Promise<boolean> {
  return new Promise((resolve) => {
    dlg.innerHTML = `<form method="dialog">${html}<div class="row end"><button value="cancel" class="ghost">${t("cancel")}</button><button value="ok" class="primary">${t("ok")}</button></div></form>`;
    const validate = mount(dlg);
    const form = dlg.querySelector("form")!;
    const done = (ok: boolean) => { dlg.close(); resolve(ok); };
    form.addEventListener("submit", (ev) => {
      const ok = (ev.submitter as HTMLButtonElement | null)?.value === "ok";
      if (ok && validate && !validate()) { ev.preventDefault(); return; }
      done(ok);
    });
    dlg.addEventListener("cancel", () => resolve(false), { once: true });
    dlg.showModal();
  });
}

async function editFormula(existing?: { latex: string; size: number }): Promise<{ latex: string; size: number } | null> {
  let out: { latex: string; size: number } | null = null;
  const ok = await ask(
    `<h3>${t("editFormula")}</h3><label>${t("latex")}<textarea id="f-src" rows="3" spellcheck="false" placeholder="\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}"></textarea></label>
     <div id="f-prev" class="preview"></div><label>${t("size")} <input id="f-size" type="number" min="12" max="200" value="${existing?.size ?? 48}"></label>`,
    (root) => {
      const src = root.querySelector<HTMLTextAreaElement>("#f-src")!;
      const prev = root.querySelector<HTMLElement>("#f-prev")!;
      const size = root.querySelector<HTMLInputElement>("#f-size")!;
      src.value = existing?.latex ?? "";
      let valid = false, seq = 0;
      const upd = async () => {
        const my = ++seq;
        try { const svg = await renderSvg(src.value); if (my === seq) { prev.innerHTML = svg; valid = true; } }
        catch { if (my === seq) { prev.textContent = src.value.trim() ? t("invalid") : ""; valid = false; } }
      };
      src.addEventListener("input", () => void upd());
      void upd();
      setTimeout(() => src.focus(), 50);
      return () => { out = { latex: src.value.trim(), size: Math.max(12, Math.min(200, +size.value || 48)) }; return valid; };
    },
  );
  return ok ? out : null;
}

type GraphEdit = Pick<Graph, "fns" | "xmin" | "xmax" | "ymin" | "ymax"> & Partial<Pick<Graph, "legend" | "ineqs" | "gx" | "gy" | "fs">>;
async function editGraph(g: Partial<Graph>): Promise<GraphEdit | null> {
  let out: GraphEdit | null = null;
  const num = (id: string, v: number) => `<label class="inl">${id} <input id="g-${id}" type="number" step="any" value="${v}"></label>`;
  const ok = await ask(
    `<h3>${t("editGraph")}</h3><label>${t("functions")}<textarea id="g-fns" rows="4" spellcheck="false" placeholder="x^2 - 2x&#10;sin(x)"></textarea></label>
     <div class="row">${num("xmin", g.xmin ?? -6)}${num("xmax", g.xmax ?? 6)}${num("ymin", g.ymin ?? -4)}${num("ymax", g.ymax ?? 4)}</div>
     <label>${t("ineqs")}<textarea id="g-ineq" rows="2" spellcheck="false" placeholder="y > x^2 - 1&#10;x + y <= 3"></textarea></label>
     <div class="row"><label class="inl">${t("gridStep")} <input id="g-gx" type="number" step="any" min="0" value="${g.gx ?? 0}"><input id="g-gy" type="number" step="any" min="0" value="${g.gy ?? 0}"></label>
     <label class="inl">${t("axisSize")} <input id="g-fs" type="number" min="8" max="40" value="${g.fs ?? 12}"></label>
     <label class="inl"><input id="g-leg" type="checkbox" ${g.legend ? "checked" : ""}> ${t("legend")}</label></div><p id="g-err" class="err"></p>`,
    (root) => {
      const ta = root.querySelector<HTMLTextAreaElement>("#g-fns")!;
      ta.value = (g.fns ?? ["x^2 - 2"]).join("\n");
      const tq = root.querySelector<HTMLTextAreaElement>("#g-ineq")!;
      tq.value = (g.ineqs ?? []).join("\n");
      const val = (k: string) => +root.querySelector<HTMLInputElement>(`#g-${k}`)!.value;
      return () => {
        const fns = ta.value.split("\n").map((s) => s.trim()).filter(Boolean);
        try { fns.forEach((f) => compile(f)); } catch { root.querySelector("#g-err")!.textContent = t("fnError"); return false; }
        const ineqs = tq.value.split("\n").map((s) => s.trim()).filter(Boolean);
        try { ineqs.forEach((q) => parseIneq(q)); } catch { root.querySelector("#g-err")!.textContent = t("fnError"); return false; }
        const r: GraphEdit = { fns, xmin: val("xmin"), xmax: val("xmax"), ymin: val("ymin"), ymax: val("ymax"), ineqs: ineqs.length ? ineqs : undefined, gx: val("gx") || undefined, gy: val("gy") || undefined, fs: val("fs") === 12 ? undefined : val("fs") || undefined, legend: root.querySelector<HTMLInputElement>("#g-leg")!.checked || undefined };
        if (!(r.xmax > r.xmin && r.ymax > r.ymin)) return false;
        out = r;
        return true;
      };
    },
  );
  return ok ? out : null;
}

// ---- geometry helpers -----------------------------------------------------
function nextLabel(): string {
  const used = new Set(page().objects.filter((o): o is GeoPoint => o.t === "gpoint").map((o) => o.label));
  for (let i = 0; i < 26 * 4; i++) {
    const l = String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : "");
    if (!used.has(l)) return l;
  }
  return "P";
}
function pointAt(x: number, y: number, create: boolean): string | null {
  const near = [...page().objects].reverse().find((o): o is GeoPoint => o.t === "gpoint" && (o.x - x) ** 2 + (o.y - y) ** 2 < 18 ** 2);
  if (near) return near.id;
  if (!create) return null;
  const p: GeoPoint = { t: "gpoint", id: uid(), x, y, label: nextLabel() };
  page().objects.push(p);
  return p.id;
}
function topHit(x: number, y: number): Obj | undefined {
  const objs = page().objects;
  const r = 10;
  // Geometry points win over everything so they stay draggable.
  const pt = [...objs].reverse().find((o) => o.t === "gpoint" && hit(page(), o, x, y, r));
  return pt ?? [...objs].reverse().find((o) => hit(page(), o, x, y, r));
}

/** Page point -> the solid's unit screen space (see solids.ts), plus the unit->page scale k. */
function toUnit(o: Solid, x: number, y: number) {
  const k = solidScale(o.s, effRadius(o.kind, boundRadius(o.kind), o.fold));
  return { u: (x - (o.x + o.s / 2)) / k, v: (y - (o.y + o.s / 2)) / k, k };
}

// ---- pointer input --------------------------------------------------------
let drag: null | { kind: "stroke"; obj: Obj & { t: "stroke" } } | { kind: "erase" } | { kind: "move"; obj: Obj; last: { x: number; y: number }; moved: boolean }
  | { kind: "pan"; x: number; y: number; top: number; left: number; moved: boolean; tap: boolean } | { kind: "rect"; x: number; y: number }
  | { kind: "laser"; trail: LaserPt[] } | { kind: "sel"; x: number; y: number; free: boolean } | { kind: "movemulti"; last: { x: number; y: number }; moved: boolean }
  | { kind: "line"; x: number; y: number } | { kind: "space" }
  | { kind: "handle"; obj: Shape | Solid | Graph | Net | Revolve | ImageObj | TextObj | Line | Inst | Fold; which: "rot" | "size"; moved: boolean; last: { x: number; y: number } } = null;
let dragRect: { x: number; y: number; w: number; h: number } | null = null;

function eraseAt(x: number, y: number) {
  if (eraserMode !== "stroke") { eraseSegments(x, y, ERASER_RADIUS[eraserMode]); return; }
  const r = 14;
  const victims = page().objects.filter((o) => o.t !== "gpoint" && hit(page(), o, x, y, r));
  if (victims.length) { victims.forEach((v) => removeObject(page(), v.id)); schedule(); }
}

/** Segment eraser: cut pen strokes where the circle touches them (the rest stays as separate strokes); other objects go whole when touched. */
function eraseSegments(x: number, y: number, r: number) {
  const pg = page();
  let changed = false;
  for (const v of pg.objects.filter((o) => o.t !== "stroke" && o.t !== "gpoint" && hit(pg, o, x, y, r))) { removeObject(pg, v.id); changed = true; }
  const next: Obj[] = [];
  for (const o of pg.objects) {
    const parts = o.t === "stroke" ? eraseFromStroke(o.pts, o.pr, x, y, r + o.w / 2) : null;
    if (!parts || o.t !== "stroke") { next.push(o); continue; }
    changed = true;
    parts.forEach((p, i) => next.push({ ...o, id: i === 0 ? o.id : uid(), pts: p.pts, pr: p.pr }));
  }
  if (changed) { pg.objects = next; schedule(); }
}

// ---- input modes, palm rejection, pinch zoom ----------------------------------------------------
const touches = new Map<number, { x: number; y: number }>();
let lastPenTime = 0;
let gesture: { dist: number; cx: number; cy: number; scale: number; left: number; top: number } | null = null;
const INK_TOOLS = new Set<Tool>(["pen", "highlighter", "laser", "eraser", "fill"]);
function startGesture() {
  const [a, b] = [...touches.values()];
  gesture = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, scale, left: stage.scrollLeft, top: stage.scrollTop };
  // Two fingers: whatever the first finger started drawing is cancelled.
  if (drag && drag.kind === "stroke") { const st = drag.obj; page().objects = page().objects.filter((o) => o !== st); undoStack.pop(); }
  if (drag && (drag.kind === "laser" || drag.kind === "line" || drag.kind === "sel" || drag.kind === "rect")) { lineDrag = null; selPath = null; dragRect = null; }
  drag = null; guide = null; schedule();
}
function moveGesture() {
  if (!gesture || touches.size < 2) return;
  const [a, b] = [...touches.values()];
  const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
  const r = cv.getBoundingClientRect();
  const before = { x: (gesture.cx - r.left) / scale, y: (gesture.cy - r.top) / scale }; // page point under the fingers when the gesture began
  const z = Math.max(0.1, Math.min(4, gesture.scale * (dist / gesture.dist)));
  if (Math.abs(z - scale) > 0.002) { userZoom = z; layout(); }
  const r2 = cv.getBoundingClientRect();
  // keep that page point under the (moving) fingers: two-finger scroll + zoom about the centre
  stage.scrollLeft += r2.left + before.x * scale - cx;
  stage.scrollTop += r2.top + before.y * scale - cy;
  gesture.cx = cx; gesture.cy = cy; gesture.dist = dist; gesture.scale = scale;
  void a; void b;
}
/** May this pointer draw (true) or should it scroll the page (false)? Returns null to ignore it completely. */
function pointerRole(e: PointerEvent): "draw" | "pan" | null {
  if (e.pointerType === "pen") { lastPenTime = performance.now(); return inputMode === "finger" ? null : "draw"; }
  if (e.pointerType === "touch") {
    if (palmLike(e)) return null;
    if (inputMode === "both" || inputMode === "finger") return "draw";
    if (inputMode === "pen") return "pan";
    return INK_TOOLS.has(tool) ? "pan" : "draw"; // auto: finger scrolls when the tool would ink, otherwise it works like the pen
  }
  return "draw";
}

/** Palm rejection: while the Pencil is touching or hovering (and shortly after), or for a large contact patch, touches are ignored completely. */
let penDown = false;
const PALM_MS = 1600;
function palmLike(e: PointerEvent): boolean {
  if (e.pointerType !== "touch" || inputMode === "finger") return false;
  return penDown || performance.now() - lastPenTime < PALM_MS || e.width > 40 || e.height > 40;
}
cv.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "pen") { // the pen wins: anything a resting hand started is dropped
    lastPenTime = performance.now(); penDown = true;
    if (touches.size || gesture || (drag && drag.kind === "pan")) { touches.clear(); gesture = null; if (drag && drag.kind === "pan") drag = null; }
  }
  if (e.pointerType === "touch" && palmLike(e)) return;
  if (e.pointerType === "touch") {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) { cv.setPointerCapture(e.pointerId); startGesture(); return; }
    if (touches.size > 2) return;
  }
  const role = pointerRole(e);
  if (role === null) return;
  if (role === "pan" || tool === "pan" || tool === "none") {
    drag = { kind: "pan", x: e.clientX, y: e.clientY, top: stage.scrollTop, left: stage.scrollLeft, moved: false, tap: tool === "pan" || tool === "none" }; // hand / no tool: drag scrolls, a tap selects
    cv.setPointerCapture(e.pointerId);
    return;
  }
  cv.setPointerCapture(e.pointerId);
  const p = toPage(e);
  switch (tool) {
    case "pen": case "highlighter": {
      snapshot();
      const obj: Stroke = { t: "stroke", id: uid(), color, w: tool === "highlighter" ? width * 4 : width, pts: [p.x, p.y], hl: tool === "highlighter" };
      if (tool === "pen") {
        if (penKind !== "ballpoint") obj.pen = penKind;
        if (pressureOn && e.pointerType === "pen") obj.pr = [pressureOf(e)];
      }
      guide = guideAt(page().objects.filter((o): o is Inst => o.t === "inst"), [p.x, p.y]);
      if (guide) { const q = projectOnGuide(guide, [p.x, p.y]); obj.pts = [q[0], q[1]]; }
      if (tool === "highlighter") obj.color = hlColor;
      lastSmooth = [obj.pts[0], obj.pts[1]]; rawPts = [obj.pts[0], obj.pts[1]];
      page().objects.push(obj);
      drag = { kind: "stroke", obj };
      break;
    }
    case "laser": {
      const trail: LaserPt[] = [{ x: p.x, y: p.y, t: performance.now() }];
      lasers.push(trail);
      drag = { kind: "laser", trail };
      schedule();
      break;
    }
    case "rectsel": case "lasso": {
      if (multi.length) {
        const o = topHit(p.x, p.y);
        if (o && multi.includes(o.id)) { drag = { kind: "movemulti", last: p, moved: false }; break; }
      }
      multi = []; selected = null;
      selPath = [[p.x, p.y]];
      drag = { kind: "sel", x: p.x, y: p.y, free: tool === "lasso" };
      refreshBar();
      break;
    }
    case "line": drag = { kind: "line", x: p.x, y: p.y }; lineDrag = { x1: p.x, y1: p.y, x2: p.x, y2: p.y }; break;
    case "text": {
      void (async () => {
        const r = await editText();
        if (!r) return;
        snapshot();
        const o: TextObj = { t: "text", id: uid(), x: p.x, y: p.y, ...r };
        page().objects.push(o);
        selected = o.id;
        schedule();
      })();
      break;
    }
    case "fill": void fillAt(p.x, p.y); break;
    case "space": drag = { kind: "space" }; spaceDrag = { y0: p.y, y1: p.y }; break;
    case "inst": {
      const size = defaultSize(instKind);
      const o: Inst = { t: "inst", id: uid(), kind: instKind, x: instKind === "compass" ? p.x : p.x - size / 2, y: instKind === "protractor" ? p.y + size / 2 : p.y - 30, rot: 0, s: size };
      snapshot(); page().objects.push(o); selected = o.id; tool = "select"; refreshBar(); schedule(); toast(t("instHint"));
      break;
    }
    case "gpt": void addGraphPoint(p.x, p.y); break;
    case "geo": geoClick(p.x, p.y); break;
    case "eraser": snapshot(); drag = { kind: "erase" }; eraseAt(p.x, p.y); break;
    case "select": {
      const cur = selected ? page().objects.find((x) => x.id === selected) : undefined;
      const hs = cur ? handlesOf(cur) : null;
      if (cur && hs && (cur.t === "shape" || cur.t === "solid" || cur.t === "graph" || cur.t === "net" || cur.t === "revolve" || cur.t === "image" || cur.t === "text" || cur.t === "line" || cur.t === "inst" || cur.t === "fold")) {
        const near = (h: { x: number; y: number }) => (h.x - p.x) ** 2 + (h.y - p.y) ** 2 <= 22 ** 2;
        const which = near(hs.size) ? "size" : !Number.isNaN(hs.rot.x) && near(hs.rot) ? "rot" : null;
        if (which) { if (which === "rot") stopSpin(cur.id); drag = { kind: "handle", obj: cur, which, moved: false, last: p }; break; }
      }
      if (multi.length) {
        const mo = topHit(p.x, p.y);
        if (mo && multi.includes(mo.id)) { drag = { kind: "movemulti", last: p, moved: false }; break; }
        multi = [];
      }
      const o = topHit(p.x, p.y);
      const before = styleTarget() !== null;
      selected = o?.id ?? null;
      if (o) drag = { kind: "move", obj: o, last: p, moved: false };
      if (before || styleTarget()) refreshBar();
      schedule();
      break;
    }
    case "formula": {
      void (async () => {
        const r = await editFormula();
        if (!r) return;
        snapshot();
        const f = { t: "formula" as const, id: uid(), x: p.x, y: p.y, latex: r.latex, color, size: r.size };
        page().objects.push(f);
        selected = f.id;
        schedule();
      })();
      break;
    }
    case "paint": {
      const o = [...page().objects].reverse().find((q): q is Solid | Net | Fold => (q.t === "solid" || q.t === "net" || q.t === "fold") && hit(page(), q, p.x, p.y, 0));
      if (!o) break;
      if (o.t === "solid" && !e.altKey && !outerOnly && (o.marks?.length ?? 0) >= 3) { // an interior section under the pointer wins over the outer face
        const { u, v } = toUnit(o, p.x, p.y);
        const sec = pickSection({ ...o, fold: o.fold ?? 1 }, u, v);
        if (sec) {
          snapshot();
          const key = loopKey(sec.marks), list = (o.sections ??= []), i = list.findIndex((q) => loopKey(q.marks) === key);
          if (i >= 0) { if (list[i].color === color) list.splice(i, 1); else list[i].color = color; } else list.push({ marks: sec.marks, color });
          schedule();
          break;
        }
      }
      let face: number | null = null;
      if (o.t === "fold") { const k = solidScale(o.s, foldRadius(o.kind)); face = pickFoldFace(o, (p.x - (o.x + o.s / 2)) / k, (p.y - (o.y + o.s / 2)) / k); }
      else if (o.t === "solid") { const { u, v } = toUnit(o, p.x, p.y); face = o.fold !== undefined && o.fold < 0.9999 && canFold(o.kind) ? pickFoldFace({ ...o, fold: o.fold }, u, v) : pickFace(o, u, v); }
      else {
        const net = netOf(o.kind);
        if (net) { const k = Math.min(o.w / net.w, o.h / net.h); face = pickNetFace(net, (p.x - (o.x + (o.w - net.w * k) / 2)) / k, (p.y - (o.y + (o.h - net.h * k) / 2)) / k); }
      }
      if (face === null) break;
      snapshot();
      const fc = (o.faceColors ??= []);
      fc[face] = fc[face] === color ? null : color;
      schedule();
      break;
    }
    case "surf": {
      const o = [...page().objects].reverse().find((q): q is Solid => q.t === "solid" && hit(page(), q, p.x, p.y, 0));
      if (!o) break;
      const { u, v, k } = toUnit(o, p.x, p.y);
      let target: { p: V3; faces: number[]; name: string } | null = null;
      if (o.fold !== undefined && o.fold < 0.9999 && canFold(o.kind)) target = pickFolded({ ...o, fold: o.fold }, u, v, 18 / k); // on the folded geometry
      else {
        target = pickSnap(o, u, v, 18 / k);
        if (!target) {
          const f = pickFace(o, u, v);
          const q = f === null ? null : facePoint(o, f, u, v);
          if (q) target = { p: q, faces: facesAt(o.kind, q).length ? facesAt(o.kind, q) : [f!], name: "" };
        }
      }
      if (!target) break;
      snapshot();
      const marks = (o.marks ??= []);
      const tp = target.p;
      let m: Mark | undefined = marks.find((q) => Math.hypot(q.p[0] - tp[0], q.p[1] - tp[1], q.p[2] - tp[2]) < 1e-4);
      if (!m) {
        const used = new Set(marks.map((q) => q.name));
        const auto = [..."MNPQRTUVWXYZ"].find((c) => !used.has(c)) ?? "K";
        m = { id: uid(), p: tp, faces: target.faces, name: target.name || auto };
        marks.push(m);
      }
      if (planeMode) { // collect the corners of a section instead of joining marks by lines
        if (planeSolid !== o.id) { planePicks = []; planeSolid = o.id; }
        if (planePicks.length >= 3 && m.id === planePicks[0]) closePlane(o);
        else { if (!planePicks.includes(m.id)) planePicks.push(m.id); pendingMark = { id: o.id, mark: m.id }; toast(`${t("planeMode")}: ${planePicks.length}`); }
        schedule();
        break;
      }
      if (!pendingMark || pendingMark.id !== o.id) pendingMark = { id: o.id, mark: m.id };
      else if (pendingMark.mark !== m.id) {
        const a = pendingMark.mark, b = m.id;
        const lines = (o.lines ??= []);
        if (!lines.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) lines.push([a, b]);
        pendingMark = null;
      }
      schedule();
      break;
    }
    case "graph": case "shape": case "solid": drag = { kind: "rect", x: p.x, y: p.y }; dragRect = { x: p.x, y: p.y, w: 0, h: 0 }; break;
    case "point": {
      snapshot();
      pointAt(p.x, p.y, true);
      schedule();
      break;
    }
    case "segment": case "circle": {
      snapshot();
      const id = pointAt(p.x, p.y, true)!;
      if (!pendingPoint) { pendingPoint = id; rubber = p; }
      else if (id !== pendingPoint) {
        page().objects.push(tool === "segment" ? { t: "gseg", id: uid(), a: pendingPoint, b: id } : { t: "gcircle", id: uid(), c: pendingPoint, p: id });
        pendingPoint = null; rubber = null;
      }
      schedule();
      break;
    }
  }
});

cv.addEventListener("pointermove", (e) => {
  if (e.pointerType === "pen") lastPenTime = performance.now(); // hovering counts as "pen in use"
  if (e.pointerType === "touch" && !touches.has(e.pointerId) && palmLike(e)) return;
  if (e.pointerType === "touch" && touches.has(e.pointerId)) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture) { moveGesture(); return; }
  }
  if (!drag) {
    if (e.pointerType === "pen") { hover = toPage(e); schedule(); } // Pencil hover: preview of the pen tip
    if (pendingPoint) { rubber = toPage(e); schedule(); }
    return;
  }
  if (drag.kind === "pan") { if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) drag.moved = true; stage.scrollTop = drag.top - (e.clientY - drag.y); stage.scrollLeft = drag.left - (e.clientX - drag.x); return; }
  const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
  const list = events.length ? events : [e];
  for (const ev of list) {
    const p = toPage(ev);
    if (drag.kind === "stroke") {
      const pts = drag.obj.pts;
      const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
      const q = guide ? projectOnGuide(guide, [p.x, p.y]) : [p.x, p.y]; // instruments: the pen follows the edge
      const sm = smoothStep(lastSmooth ?? [lx, ly], [q[0], q[1]], guide ? 0 : smoothLevel);
      lastSmooth = sm; rawPts.push(q[0], q[1]);
      if ((sm[0] - lx) ** 2 + (sm[1] - ly) ** 2 >= 1.2) { pts.push(sm[0], sm[1]); { const pr = drag.obj.pr; if (pr) pr.push(smoothPressure(pr[pr.length - 1] ?? 0.5, pressureOf(ev))); } }
    } else if (drag.kind === "laser") drag.trail.push({ x: p.x, y: p.y, t: performance.now() });
    else if (drag.kind === "sel") {
      if (drag.free) selPath!.push([p.x, p.y]); else selPath = rectPolygon(drag.x, drag.y, p.x, p.y);
    } else if (drag.kind === "movemulti") {
      if (!drag.moved) { drag.moved = true; snapshot(); }
      moveMulti(p.x - drag.last.x, p.y - drag.last.y);
      drag.last = p;
    } else if (drag.kind === "space") { spaceDrag!.y1 = p.y;
    } else if (drag.kind === "line") {
      let x2 = p.x, y2 = p.y;
      if (ev.shiftKey) { const a = Math.round(Math.atan2(y2 - drag.y, x2 - drag.x) / (Math.PI / 12)) * (Math.PI / 12), l = Math.hypot(x2 - drag.x, y2 - drag.y); x2 = drag.x + l * Math.cos(a); y2 = drag.y + l * Math.sin(a); }
      lineDrag = { x1: drag.x, y1: drag.y, x2, y2 };
    } else if (drag.kind === "erase") eraseAt(p.x, p.y);
    else if (drag.kind === "move") {
      if (!drag.moved) { drag.moved = true; snapshot(); }
      moveObject(page(), drag.obj, p.x - drag.last.x, p.y - drag.last.y);
      drag.last = p;
    } else if (drag.kind === "rect") {
      dragRect = { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) };
    } else if (drag.kind === "handle") {
      if (!drag.moved) { drag.moved = true; snapshot(); }
      applyHandle(drag.obj, drag.which, p, drag.last, e.shiftKey);
      drag.last = p;
    }
  }
  schedule();
  if (dragRect) {
    // Rubber-band rectangle for the graph tool.
    requestAnimationFrame(() => {
      if (!dragRect) return;
      const s = cv.width / pageDims(page().paper).w;
      ctx.save(); ctx.setTransform(s, 0, 0, s, 0, 0); ctx.strokeStyle = THEME.accent; ctx.setLineDash([6, 4]); ctx.lineWidth = 2;
      ctx.strokeRect(dragRect.x, dragRect.y, dragRect.w, dragRect.h); ctx.restore();
    });
  }
});

function endDrag(e: PointerEvent) {
  if (e.pointerType === "pen") { penDown = false; lastPenTime = performance.now(); }
  if (e.pointerType === "touch") { touches.delete(e.pointerId); if (touches.size < 2) gesture = null; }
  const d = drag;
  drag = null;
  guide = null;
  if (!d) return;
  if (d.kind === "pan" && d.tap && !d.moved) { // tap with the hand / no tool: select (or deselect) the object under the finger
    const p = toPage(e);
    const o = topHit(p.x, p.y);
    selected = o?.id ?? null; multi = [];
    refreshBar(); schedule();
  }
  if (d.kind === "space" && spaceDrag) {
    const sd = spaceDrag; spaceDrag = null;
    const dy = sd.y1 - sd.y0;
    if (Math.abs(dy) > 6) { snapshot(); insertSpace(page(), sd.y0, dy); }
    schedule();
  }
  if (d.kind === "stroke") finishStroke(d.obj);
  if (d.kind === "sel") {
    const poly = selPath && selPath.length > 2 ? selPath : null;
    selPath = null;
    multi = poly ? selectIn(page(), poly) : [];
    refreshBar(); schedule();
  }
  if (d.kind === "line" && lineDrag) {
    const l = lineDrag;
    lineDrag = null;
    if (Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 8) {
      snapshot();
      const o: Line = { t: "line", id: uid(), x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, color, w: width, style: lineStyle };
      page().objects.push(o);
    }
    markDirty(); schedule();
  }
  if (d.kind === "movemulti") markDirty();
  if (d.kind === "rect" && dragRect && (tool === "shape" || tool === "solid")) {
    const r = dragRect;
    dragRect = null;
    const click = r.w < 30 && r.h < 30;
    snapshot();
    let obj: Shape | Solid;
    if (tool === "shape") {
      const square = shapeKind === "square" || shapeKind === "circle" || shapeKind === "annulus";
      let { x, y, w, h } = r;
      if (click) { w = square ? 170 : 220; h = square ? 170 : 160; x = d.x - w / 2; y = d.y - h / 2; }
      else if (square) { w = h = Math.max(w, h); }
      obj = { t: "shape", id: uid(), x, y, w, h, kind: shapeKind, color, lw: width, rot: 0, fill: false };
      if (lineStyle === "dashed" || lineStyle === "dashdot") obj.ls = lineStyle;
    } else {
      const s = click ? 240 : Math.max(r.w, r.h);
      obj = { t: "solid", id: uid(), x: click ? d.x - s / 2 : r.x, y: click ? d.y - s / 2 : r.y, s, kind: solidKind, color, lw: width, yaw: -0.6, pitch: 0.45, roll: 0, shade: false };
    }
    page().objects.push(obj);
    selected = obj.id;
    tool = "select";
    refreshBar();
    toast(t("rotHint"));
    schedule();
  } else if (d.kind === "rect" && dragRect) {
    const r = dragRect;
    dragRect = null;
    if (r.w > 60 && r.h > 60) {
      void (async () => {
        const g = await editGraph({});
        if (!g) { schedule(); return; }
        snapshot();
        const obj: Graph = { t: "graph", id: uid(), x: r.x, y: r.y, w: r.w, h: r.h, ...g };
        page().objects.push(obj);
        selected = obj.id;
        schedule();
      })();
    } else schedule();
  }
  if (d.kind === "stroke" || d.kind === "move" || d.kind === "handle") markDirty();
  void e;
}

/** Drag a rotate/resize handle. Shapes rotate in the plane; 3D objects rotate freely (drag = turn/tilt, Shift+drag = roll). */
function applyHandle(o: Shape | Solid | Graph | Net | Revolve | ImageObj | TextObj | Line | Inst | Fold, which: "rot" | "size", p: { x: number; y: number }, last: { x: number; y: number }, shift: boolean) {
  if (o.t === "line") { // drag one end; Shift snaps the angle to 15°
    const fx = which === "rot" ? o.x2 : o.x1, fy = which === "rot" ? o.y2 : o.y1;
    let nx = p.x, ny = p.y;
    if (shift) { const a = Math.round(Math.atan2(ny - fy, nx - fx) / (Math.PI / 12)) * (Math.PI / 12), l = Math.hypot(nx - fx, ny - fy); nx = fx + l * Math.cos(a); ny = fy + l * Math.sin(a); }
    if (which === "rot") { o.x1 = nx; o.y1 = ny; } else { o.x2 = nx; o.y2 = ny; }
    return;
  }
  if (o.t === "inst") { dragInst(o, which, [p.x, p.y]); return; }
  if (which === "size") {
    if (o.t === "shape") {
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2, c = Math.cos(-o.rot), s = Math.sin(-o.rot);
      const lx = (p.x - cx) * c - (p.y - cy) * s, ly = (p.x - cx) * s + (p.y - cy) * c;
      o.w = Math.max(24, Math.abs(lx) * 2);
      o.h = Math.max(24, Math.abs(ly) * 2);
      if (shift || o.kind === "square" || o.kind === "circle") o.w = o.h = Math.max(o.w, o.h);
      o.x = cx - o.w / 2; o.y = cy - o.h / 2;
    } else if (o.t === "solid" || o.t === "revolve" || o.t === "fold") o.s = Math.max(60, Math.max(p.x - o.x, p.y - o.y));
    else if (o.t === "image") { const r = o.h / o.w; o.w = Math.max(30, p.x - o.x); o.h = o.w * r; }
    else if (o.t === "text") o.w = Math.max(60, p.x - o.x);
    else { o.w = Math.max(100, p.x - o.x); o.h = Math.max(80, p.y - o.y); }
  } else if (o.t === "image" || o.t === "text") {
    return;
  } else if (o.t === "shape") {
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    let a = Math.atan2(p.y - cy, p.x - cx) + Math.PI / 2;
    const step = Math.PI / 12; // snap to 15° when close
    const q = Math.round(a / step) * step;
    if (shift || Math.abs(a - q) < 0.05) a = q;
    o.rot = a;
  } else if (o.t === "solid" || o.t === "revolve" || o.t === "fold") {
    if (shift) o.roll += (p.x - last.x) * 0.012;
    else { o.yaw += (p.x - last.x) * 0.012; o.pitch += (p.y - last.y) * 0.012; }
  }
}

const STEP = Math.PI / 12; // 15°
/** Turn the selected object by one step: yaw (left/right), pitch (up/down) or roll (in the plane). */
function rotateSelected(dyaw: number, dpitch: number, droll: number) {
  const o = selected ? page().objects.find((x) => x.id === selected) : undefined;
  if (!o) return;
  stopSpin(o.id);
  if (o.t === "shape") { snapshot(); o.rot += droll; }
  else if (o.t === "solid" || o.t === "revolve" || o.t === "fold") { snapshot(); o.yaw += dyaw; o.pitch += dpitch; o.roll += droll; }
  else return;
  schedule();
}

/** Thinner / thicker lines for the selected object. */
function scaleLines(f: number) {
  const o = selected ? page().objects.find((x) => x.id === selected) : undefined;
  if (!o) return;
  const cl = (v: number) => Math.round(Math.min(24, Math.max(0.4, v * f)) * 100) / 100;
  if (o.t === "stroke") { snapshot(); o.w = cl(o.w); }
  else if (o.t === "graph") { snapshot(); o.lw = cl(o.lw ?? 2.2); }
  else if (o.t === "shape" || o.t === "solid" || o.t === "net" || o.t === "revolve" || o.t === "fold") { snapshot(); o.lw = cl(o.lw); }
  else return;
  schedule();
}

/** "Unfold": the selected solid folds out flat in place (everything drawn on it goes along); press again to fold it back. Kinds without an animated model get a static net beside them. */
function unfoldSelected() {
  const o = selected ? page().objects.find((x) => x.id === selected) : undefined;
  if (!o || (o.t !== "solid" && o.t !== "fold")) return toast(t("pickSolid"));
  if (anim && anim.id === o.id) return stopFold();
  if (canFold(o.kind)) { const f = o.fold ?? 1; snapshot(); playFold(o.id, f > 0.02 ? -1 : 1, false); return; }
  if (o.t === "solid") { toast(t("noFold")); copyNet(); }
}
/** A static flat net beside the selected solid (also the fallback for solids without an animated model). */
function copyNet() {
  const o = selected ? page().objects.find((x) => x.id === selected) : undefined;
  if (!o || o.t !== "solid") return toast(t("pickSolid"));
  const net = netOf(o.kind);
  if (!net) return toast(t("noNet"));
  snapshot();
  let w = Math.min(o.s * 1.7, 420), h = (w * net.h) / net.w;
  if (h > o.s * 1.7) { h = o.s * 1.7; w = (h * net.w) / net.h; }
  const right = o.x + o.s + 30;
  const n: Net = { t: "net", id: uid(), x: right + w <= PW() - 10 ? right : Math.max(10, o.x), y: right + w <= PW() - 10 ? o.y : o.y + o.s + 30, w, h, kind: o.kind, color: o.color, lw: o.lw, faceColors: o.faceColors ? clone(o.faceColors) : undefined };
  page().objects.push(n);
  selected = n.id;
  schedule();
}

// ---- fold animation --------------------------------------------------------------------------------
let anim: { id: string; dir: 1 | -1; loop: boolean } | null = null;
let foldLoop = false, foldSpeed = 1;
let animRaf = 0, animLast = 0;
const foldOf = (id: string): Solid | Fold | null => { const o = page().objects.find((q) => q.id === id); return o && (o.t === "fold" || (o.t === "solid" && canFold(o.kind))) ? o : null; };
function playFold(id: string, dir: 1 | -1, loop: boolean) {
  anim = { id, dir, loop };
  animLast = performance.now();
  if (!animRaf) animRaf = requestAnimationFrame(animStep);
  refreshBar();
}
function stopFold() { if (anim) { anim = null; markDirty(); refreshBar(); } }
function animStep(now: number) {
  animRaf = 0;
  if (!anim) return;
  const o = foldOf(anim.id);
  if (!o) { anim = null; refreshBar(); return; }
  const dt = Math.min(0.1, (now - animLast) / 1000);
  animLast = now;
  let v = (o.fold ?? 1) + anim.dir * dt * foldSpeed * 0.4; // 2.5 s for a full fold at 1×
  if (v >= 1 || v <= 0) {
    v = v >= 1 ? 1 : 0;
    if (anim.loop) anim.dir = anim.dir === 1 ? -1 : 1; else { anim = null; markDirty(); refreshBar(); }
  }
  o.fold = v;
  const sl = document.getElementById("fold-t") as HTMLInputElement | null;
  if (sl) sl.value = String(Math.round(v * 100));
  schedule();
  if (anim) animRaf = requestAnimationFrame(animStep);
}

cv.addEventListener("pointerleave", () => { if (hover) { hover = null; schedule(); } });
cv.addEventListener("pointerup", endDrag);
cv.addEventListener("pointercancel", endDrag);

async function editSelected(o: Obj) {
  if (o.t === "formula") {
    const r = await editFormula({ latex: o.latex, size: o.size });
    if (r) { snapshot(); o.latex = r.latex; o.size = r.size; schedule(); }
  } else if (o.t === "graph") {
    const r = await editGraph(o);
    if (r) { snapshot(); Object.assign(o, r); schedule(); }
  } else if (o.t === "text") {
    const r = await editText(o);
    if (r) { snapshot(); Object.assign(o, r); schedule(); }
  } else if (o.t === "shape" || o.t === "solid" || o.t === "net" || o.t === "fold") await editObject3(o);
  else if (o.t === "revolve") await editRevolve(o);
}

cv.addEventListener("dblclick", (e) => {
  if (tool !== "select") return;
  const p = toPage(e);
  const o = topHit(p.x, p.y);
  if (o) void editSelected(o);
});

const deg = (r: number) => Math.round((r * 180) / Math.PI);
const rad = (d: number) => (d * Math.PI) / 180;
const slider = (id: string, label: string, v: number, min: number, max: number, step = 1) =>
  `<label>${label}: <output id="o-${id}-v">${v}</output><input id="o-${id}" type="range" min="${min}" max="${max}" step="${step}" value="${v}" style="width:100%"></label>`;

/** Property dialog for a shape, solid or net. Angles are free over ±360°. Live preview; Cancel reverts everything. */
async function editObject3(o: Shape | Solid | Net | Fold) {
  const before = clone(o);
  const check = (id: string, label: string, on: boolean) => `<label class="inl"><input id="o-${id}" type="checkbox" ${on ? "checked" : ""}> ${label}</label>`;
  const body = o.t === "solid"
    ? (canFold(o.kind) ? slider("fold", t("foldAmount"), Math.round((o.fold ?? 1) * 100), 0, 100) : "") + slider("yaw", t("yaw"), deg(o.yaw), -360, 360) + slider("pitch", t("pitch"), deg(o.pitch), -360, 360) + slider("roll", t("roll"), deg(o.roll), -360, 360) +
      check("shade", t("shade"), o.shade) + check("labels", t("labels"), !!o.labels) + `<div class="row"><button type="button" id="o-clear" class="ghost">${t("clearMarks")}</button></div>`
    : o.t === "fold" ? slider("fold", t("foldAmount"), Math.round(o.fold * 100), 0, 100) + slider("yaw", t("yaw"), deg(o.yaw), -360, 360) + slider("pitch", t("pitch"), deg(o.pitch), -360, 360) + slider("roll", t("roll"), deg(o.roll), -360, 360) + check("shade", t("shade"), o.shade)
    : o.t === "shape" ? slider("rot", t("rotation"), deg(o.rot), -360, 360) + check("fill", t("fill"), o.fill) : "";
  const ok = await ask(`<h3>${t(o.t === "solid" ? "solid" : o.t === "net" ? "unfold" : o.t === "fold" ? "foldModel" : "shape")}</h3>${body}${slider("lw", t("lineWidth"), o.lw, 0.5, 14, 0.5)}`, (root) => {
    const q = <T extends HTMLInputElement>(id: string) => root.querySelector<T>(`#o-${id}`)!;
    const sync = () => {
      for (const el of root.querySelectorAll<HTMLInputElement>("input[type=range]")) root.querySelector(`#${el.id}-v`)!.textContent = el.value;
      o.lw = +q("lw").value;
      if (o.t === "solid") { if (canFold(o.kind)) { anim = null; o.fold = +q("fold").value / 100; } o.yaw = rad(+q("yaw").value); o.pitch = rad(+q("pitch").value); o.roll = rad(+q("roll").value); o.shade = q("shade").checked; o.labels = q("labels").checked; }
      else if (o.t === "fold") { anim = null; o.fold = +q("o-fold".slice(2)).value / 100; o.yaw = rad(+q("yaw").value); o.pitch = rad(+q("pitch").value); o.roll = rad(+q("roll").value); o.shade = q("shade").checked; }
      else if (o.t === "shape") { o.rot = rad(+q("rot").value); o.fill = q("fill").checked; }
      schedule();
    };
    root.addEventListener("input", sync);
    root.querySelector("#o-clear")?.addEventListener("click", () => { if (o.t === "solid") { o.marks = []; o.lines = []; o.sections = []; pendingMark = null; schedule(); } });
  });
  if (ok) { const after = clone(o); Object.assign(o, before); snapshot(); Object.assign(o, after); markDirty(); }
  else Object.assign(o, before);
  schedule();
}

/** Dialog for a solid of revolution. With `fns` (creation from a graph) the function can be picked from the graph. Returns true on OK. */
async function editRevolve(o: Revolve, fns?: string[], isNew = false): Promise<boolean> {
  const before = clone(o);
  const ok = await ask(
    `<h3>${t("revolve")}</h3>
     ${fns ? `<label>${t("fnFrom")}<select id="r-fn">${fns.map((f, i) => `<option value="${i}">${f.replace(/</g, "&lt;")}</option>`).join("")}</select></label>` : ""}
     <label>${t("expr")} <input id="r-expr" value="${o.expr.replace(/"/g, "&quot;")}" style="width:100%" spellcheck="false"></label>
     <div class="row"><label class="inl">${t("from")} <input id="r-a" type="number" step="any" value="${o.a}"></label><label class="inl">${t("to")} <input id="r-b" type="number" step="any" value="${o.b}"></label></div>
     <label class="inl"><input type="radio" name="r-axis" value="x" ${o.axis === "x" ? "checked" : ""}> ${t("axisX")}</label><br>
     <label class="inl"><input type="radio" name="r-axis" value="y" ${o.axis === "y" ? "checked" : ""}> ${t("axisY")}</label>
     <p id="r-vol" class="preview" style="min-height:0"></p><p id="r-err" class="err"></p>
     ${slider("rings", t("rings"), o.rings, 0, 30)}${slider("yaw", t("yaw"), deg(o.yaw), -360, 360)}${slider("pitch", t("pitch"), deg(o.pitch), -360, 360)}${slider("roll", t("roll"), deg(o.roll), -360, 360)}${slider("lw", t("lineWidth"), o.lw, 0.5, 14, 0.5)}`,
    (root) => {
      const q = <T extends HTMLInputElement>(id: string) => root.querySelector<T>(`#${id}`)!;
      const sync = () => {
        for (const el of root.querySelectorAll<HTMLInputElement>("input[type=range]")) root.querySelector(`#${el.id}-v`)!.textContent = el.value;
        o.expr = q("r-expr").value; o.a = +q("r-a").value; o.b = +q("r-b").value;
        o.axis = (root.querySelector<HTMLInputElement>("input[name=r-axis]:checked")?.value ?? "x") as "x" | "y";
        o.rings = +q("o-rings").value; o.yaw = rad(+q("o-yaw").value); o.pitch = rad(+q("o-pitch").value); o.roll = rad(+q("o-roll").value); o.lw = +q("o-lw").value;
        try { root.querySelector("#r-vol")!.textContent = `${t("volume")} ≈ ${(+revolveVolume(o.expr, o.a, o.b).toPrecision(6))}`; root.querySelector("#r-err")!.textContent = ""; }
        catch { root.querySelector("#r-vol")!.textContent = ""; root.querySelector("#r-err")!.textContent = t("fnError"); }
        schedule();
      };
      root.addEventListener("input", sync);
      root.querySelector<HTMLSelectElement>("#r-fn")?.addEventListener("change", (e) => { q("r-expr").value = fns![+(e.target as HTMLSelectElement).value]; sync(); });
      sync();
      return () => { try { revolveVolume(o.expr, o.a, o.b); return o.b !== o.a; } catch { return false; } };
    },
  );
  if (ok) { if (isNew) markDirty(); else { const after = clone(o); Object.assign(o, before); snapshot(); Object.assign(o, after); markDirty(); } }
  else Object.assign(o, before);
  schedule();
  return ok;
}

/** Turn the selected graph's function into a solid of revolution placed next to it. */
async function revolveSelected() {
  const g = selected ? page().objects.find((x) => x.id === selected) : undefined;
  if (!g || g.t !== "graph") return toast(t("pickGraph"));
  const idx = g.shade?.fn ?? 0;
  const right = g.x + g.w + 30, s = 260;
  const o: Revolve = { t: "revolve", id: uid(), x: right + s <= PW() - 10 ? right : g.x, y: right + s <= PW() - 10 ? g.y : g.y + g.h + 30, s, expr: g.fns[idx] ?? "x", a: Math.max(0, g.xmin), b: g.xmax, axis: "x", color, lw: Math.min(width, 2.5), yaw: -0.6, pitch: 0.45, roll: 0, rings: 8 };
  snapshot();
  page().objects.push(o);
  const ok = await editRevolve(o, g.fns, true);
  if (!ok) { undoStack.pop(); page().objects = page().objects.filter((x) => x !== o); schedule(); return; }
  g.shade = { fn: Math.max(0, g.fns.indexOf(o.expr)), a: o.a, b: o.b };
  selected = o.id;
  schedule();
}

// ---- ink modes / selection / fill ---------------------------------------------------------
/** Pen lifted: in "ink to line / shape" modes try to turn the stroke into a clean object. */
function finishStroke(st: Stroke) {
  lastSmooth = null;
  const rn = rawPts.length;
  if (rn >= 2 && smoothLevel > 0 && st.pts.length >= 2 && (st.pts[st.pts.length - 2] !== rawPts[rn - 2] || st.pts[st.pts.length - 1] !== rawPts[rn - 1])) { // smoothing lags: end exactly where the pen lifted
    st.pts.push(rawPts[rn - 2], rawPts[rn - 1]); st.pr?.push(st.pr[st.pr.length - 1]);
  }
  if (tool !== "pen" || inkMode === "ink") return;
  const r = recognize(rawPts, inkMode === "line");
  if (!r) return;
  const objs = page().objects;
  const i = objs.indexOf(st);
  if (i < 0) return;
  let n: Obj;
  if (r.kind === "line") n = { t: "line", id: st.id, x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, color: st.color, w: st.w, style: lineStyle };
  else if (r.kind === "circle") {
    const round = Math.abs(r.rx - r.ry) < 0.12 * Math.max(r.rx, r.ry);
    const rr = (r.rx + r.ry) / 2;
    n = round ? { t: "shape", id: st.id, kind: "circle", x: r.cx - rr, y: r.cy - rr, w: 2 * rr, h: 2 * rr, color: st.color, lw: st.w, rot: 0, fill: false }
      : { t: "shape", id: st.id, kind: "ellipse", x: r.cx - r.rx, y: r.cy - r.ry, w: 2 * r.rx, h: 2 * r.ry, color: st.color, lw: st.w, rot: 0, fill: false };
  } else {
    const pts = r.pts.flatMap(([x, y]) => [x, y]);
    pts.push(pts[0], pts[1]);
    n = { t: "stroke", id: st.id, color: st.color, w: st.w, pts, dash: lineStyle === "dashed" || lineStyle === "dashdot" ? lineStyle : undefined };
  }
  objs[i] = n;
  schedule();
}

const selectedIds = (): string[] => (multi.length ? multi : selected ? [selected] : []);
function moveMulti(dx: number, dy: number) {
  for (const id of multi) {
    const o = page().objects.find((q) => q.id === id);
    if (o && o.t !== "gseg" && o.t !== "gcircle") moveObject(page(), o, dx, dy); // segments follow their points
  }
}
function copySel() {
  const ids = new Set(selectedIds());
  const objs = page().objects.filter((o) => ids.has(o.id));
  if (!objs.length) return;
  clipboard = copyObjects(objs);
  toast(t("copy"));
}
function cutSel() { copySel(); deleteSelected(); }
function pasteSel(offset = 28) {
  if (!clipboard.length) return;
  snapshot();
  const copies = copyObjects(clipboard, offset, offset);
  for (const c of copies) {
    if (c.t === "gpoint") c.label = nextLabel();
    if (c.t === "fill") page().objects.unshift(c); else page().objects.push(c);
  }
  clipboard = copyObjects(clipboard, offset, offset); // the next paste lands further along
  multi = copies.map((c) => c.id);
  selected = multi.length === 1 ? multi[0] : null;
  if (multi.length === 1) multi = [];
  refreshBar(); schedule();
}
function duplicateSel() { const keep = clipboard; copySel(); pasteSel(); clipboard = keep.length ? keep : clipboard; }

/** Fill the closed region under (x,y): rasterise the page without its paper pattern, flood-fill, store the runs. */
async function fillAt(x: number, y: number) {
  const pg = page();
  const probe: Page = { objects: pg.objects, paper: { ...normPaper(pg.paper), type: "plain" }, bg: pg.bg };
  const c = await renderToCanvas(probe, 1);
  const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  const runs = floodFill(data, c.width, c.height, x, y);
  if (!runs || !runs.length) return toast(t("fillFail"));
  snapshot();
  let i = 0;
  while (page().objects[i]?.t === "fill") i++;
  page().objects.splice(i, 0, { t: "fill", id: uid(), color, runs });
  schedule();
}

// ---- text, paper, pictures, PDF ----------------------------------------------------------
type TextProps = Omit<TextObj, "t" | "id" | "x" | "y">;
async function editText(ex?: TextObj): Promise<TextProps | null> {
  let out: TextProps | null = null;
  const fonts = (Object.keys(FONT_FAMILY) as (keyof typeof FONT_FAMILY)[]);
  const fkey: Record<string, Key> = { sans: "fontSans", serif: "fontSerif", mono: "fontMono", hand: "fontHand" };
  const chk = (id: string, label: string, on: boolean) => `<label class="inl"><input id="x-${id}" type="checkbox" ${on ? "checked" : ""}> ${label}</label>`;
  const ok = await ask(`<h3>${t("text")}</h3><label>${t("textHint")}<textarea id="x-text" rows="4"></textarea></label>
    <div class="row"><label class="inl">${t("font")} <select id="x-font">${fonts.map((f) => `<option value="${f}" ${(ex?.font ?? "sans") === f ? "selected" : ""}>${t(fkey[f])}</option>`).join("")}</select></label>
    <label class="inl">${t("size")} <input id="x-size" type="number" min="8" max="300" value="${ex?.size ?? 32}"></label>
    <label class="inl">${t("boxWidth")} <input id="x-w" type="number" min="60" max="1400" value="${Math.round(ex?.w ?? 420)}"></label></div>
    <div class="row">${chk("bold", t("bold"), !!ex?.bold)}${chk("italic", t("italic"), !!ex?.italic)}${chk("under", t("underline"), !!ex?.underline)}${chk("bul", t("bullets"), !!ex?.bullets)}</div>
    <div class="row"><label class="inl"><input type="radio" name="x-al" value="left" ${(ex?.align ?? "left") === "left" ? "checked" : ""}> ${t("alignL")}</label>
    <label class="inl"><input type="radio" name="x-al" value="center" ${ex?.align === "center" ? "checked" : ""}> ${t("alignC")}</label>
    <label class="inl"><input type="radio" name="x-al" value="right" ${ex?.align === "right" ? "checked" : ""}> ${t("alignR")}</label>
    <label class="inl">${t("color")} <input id="x-color" type="color" value="${ex?.color ?? color}"></label></div>`, (root) => {
    const q = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#x-${id}`) as T;
    q<HTMLTextAreaElement>("text").value = ex?.text ?? "";
    setTimeout(() => q("text").focus(), 50);
    return () => {
      const text = q<HTMLTextAreaElement>("text").value;
      if (!text.trim()) return false;
      out = {
        text, font: q<HTMLSelectElement>("font").value as TextObj["font"], size: Math.max(8, Math.min(300, +q<HTMLInputElement>("size").value || 32)), w: Math.max(60, +q<HTMLInputElement>("w").value || 420),
        bold: q<HTMLInputElement>("bold").checked, italic: q<HTMLInputElement>("italic").checked, underline: q<HTMLInputElement>("under").checked, bullets: q<HTMLInputElement>("bul").checked,
        align: (root.querySelector<HTMLInputElement>("input[name=x-al]:checked")?.value ?? "left") as TextObj["align"], color: q<HTMLInputElement>("color").value,
      };
      return true;
    };
  });
  return ok ? out : null;
}

async function editPaper() {
  const cur = normPaper(page().paper);
  let out: { paper: Paper; all: boolean } | null = null;
  let dropBg = false;
  const tkey: Record<PaperType, Key> = { notebook: "notebook", plain: "plain", ruled: "ruled", squared: "squared", dotted: "dotted" };
  const ok = await ask(`<h3>${t("paper")}</h3>
    <div class="row">${PAPER_TYPES.map((p) => `<label class="inl"><input type="radio" name="p-type" value="${p}" ${cur.type === p ? "checked" : ""}> ${t(tkey[p])}</label>`).join("")}</div>
    <div class="row">${PAPER_COLORS.map((c) => `<label class="inl"><input type="radio" name="p-col" value="${c}" ${cur.color.toLowerCase() === c ? "checked" : ""}><span class="sw" style="--c:${c};display:inline-block;width:22px;height:22px"></span></label>`).join("")}
      <label class="inl"><input id="p-cc" type="color" value="${cur.color}" aria-label="${t("paperColor")}"></label></div>
    <div class="row"><label class="inl"><input type="radio" name="p-or" value="p" ${cur.landscape ? "" : "checked"}> ${t("portrait")}</label>
    <label class="inl"><input type="radio" name="p-or" value="l" ${cur.landscape ? "checked" : ""}> ${t("landscape")}</label></div>
    ${slider("sp", t("spacing"), cur.spacing, 12, 120, 2)}
    <label class="inl"><input id="p-all" type="checkbox"> ${t("applyAll")}</label>${page().bg ? `<br><label class="inl"><input id="p-nobg" type="checkbox"> ${t("clearBg")}</label>` : ""}`, (root) => {
    root.addEventListener("input", () => { const sp = root.querySelector<HTMLInputElement>("#o-sp")!; root.querySelector("#o-sp-v")!.textContent = sp.value; });
    root.querySelectorAll<HTMLInputElement>("input[name=p-col]").forEach((r) => r.addEventListener("change", () => { root.querySelector<HTMLInputElement>("#p-cc")!.value = r.value; }));
    return () => {
      const v = (n: string) => root.querySelector<HTMLInputElement>(`input[name=${n}]:checked`)?.value;
      out = { paper: normPaper({ type: v("p-type") as PaperType, color: root.querySelector<HTMLInputElement>("#p-cc")!.value, landscape: v("p-or") === "l", spacing: +root.querySelector<HTMLInputElement>("#o-sp")!.value }), all: root.querySelector<HTMLInputElement>("#p-all")!.checked };
      dropBg = !!root.querySelector<HTMLInputElement>("#p-nobg")?.checked;
      return true;
    };
  });
  if (!ok || !out) return;
  const o = out as { paper: Paper; all: boolean };
  snapshot(); // paper changes are undoable
  if (dropBg) delete page().bg;
  for (const pg of o.all ? doc.pages : [page()]) pg.paper = { ...o.paper };
  markDirty(); layout(); refreshBar(); refreshPanel();
}

const readDataUrl = (f: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
/** Decode a picture file; large ones are scaled down (and re-encoded) so notebooks stay small. */
async function loadPicture(f: File): Promise<{ src: string; w: number; h: number }> {
  const url = await readDataUrl(f);
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("bad image")); i.src = url; });
  const k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
  if (k === 1 && f.size < 1.5e6) return { src: url, w: img.naturalWidth, h: img.naturalHeight };
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  const png = /png|gif|webp|svg/.test(f.type);
  return { src: c.toDataURL(png ? "image/png" : "image/jpeg", 0.9), w: c.width, h: c.height };
}
async function insertPicture(given?: File) {
  const f = given ?? await pickFile("image/*");
  if (!f) return;
  try {
    const pic = await loadPicture(f);
    const w = Math.min(PW() * 0.6, pic.w), h = (w * pic.h) / pic.w;
    snapshot();
    const o: ImageObj = { t: "image", id: uid(), x: (PW() - w) / 2, y: Math.max(30, stage.scrollTop / scale + 30), w, h, src: pic.src };
    page().objects.push(o);
    selected = o.id; tool = "select";
    refreshBar(); schedule();
  } catch { toast(t("imgFailed")); }
}
async function importPdfFile(given?: File) {
  const f = given ?? await pickFile(".pdf,application/pdf");
  if (!f) return;
  toast(t("pdfBusy"));
  try {
    const pages = await importPdf(new Uint8Array(await f.arrayBuffer()), 100, (d, n) => toast(`${t("pdfBusy")} ${d}/${n}`));
    if (!pages.length) throw new Error("empty");
    const blank = !page().objects.length && !page().bg;
    const base = normPaper(page().paper);
    pages.forEach((pp, i) => {
      const pg: Page = i === 0 && blank ? page() : { objects: [], sheet: sheetOf(page()) };
      pg.paper = { ...base, type: "plain", landscape: pp.w > pp.h };
      pg.bg = pp.jpeg;
      if (pg !== page()) { doc.pages.splice(pageIdx + i + (blank ? 0 : 1), 0, pg); }
    });
    if (!blank) pageIdx++;
    selected = null; multi = [];
    markDirty(); refreshBar(); layout(); refreshPanel();
    toast(`${t("pdfPages")}: ${pages.length}`);
  } catch { toast(t("pdfFailed")); }
}

// ---- page list panel / navigation -----------------------------------------------------------
const panel = $("#pages");
let panelTimer = 0;
function refreshPanel() {
  panel.hidden = !panelOpen;
  if (!panelOpen) return;
  clearTimeout(panelTimer);
  panelTimer = window.setTimeout(() => {
    const list = pagesIn(doc, sheetIdx);
    panel.innerHTML = list.map((gi, n) => `<button class="thumb ${gi === pageIdx ? "on" : ""}" data-p="${gi}" aria-label="${t("goPage")} ${n + 1}"><canvas width="110" height="156"></canvas><span>${n + 1}</span></button>`).join("");
    panel.querySelectorAll<HTMLCanvasElement>("canvas").forEach((cnv, n) => {
      const pg = doc.pages[list[n]], d = pageDims(pg.paper);
      const k = Math.min(110 / d.w, 156 / d.h);
      cnv.width = Math.round(d.w * k); cnv.height = Math.round(d.h * k);
      drawPage(cnv.getContext("2d")!, pg, k, { onAsync: () => { /* thumbnails refresh with the next change */ } });
    });
  }, 250);
}
panel.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button.thumb");
  if (b) gotoPage(+b.dataset.p!);
});
function gotoPage(i: number) {
  if (!(i >= 0 && i < doc.pages.length)) return;
  stopSpin();
  pageIdx = i; sheetIdx = sheetOf(doc.pages[i]); selected = null; multi = []; selPath = null; geoPicks = [];
  layout(); refreshBar(); refreshPanel();
}
/** Go to the n-th page (1-based) of the current sheet. */
function gotoPos(n: number) { const l = pagesIn(doc, sheetIdx); if (n >= 1 && n <= l.length) gotoPage(l[n - 1]); }
function stepPage(d: number) { const l = pagesIn(doc, sheetIdx), i = l.indexOf(pageIdx) + d; if (i >= 0 && i < l.length) gotoPage(l[i]); }

// ---- commands ---------------------------------------------------------------
function deleteSelected() {
  const ids = selectedIds();
  if (!ids.length) return;
  snapshot();
  for (const id of ids) removeObject(page(), id);
  selected = null; multi = [];
  refreshBar(); schedule();
}

async function confirmDiscard(msg: string): Promise<boolean> {
  return ask(`<p>${msg}</p>`, () => undefined);
}

async function fileName(ext: string): Promise<string> {
  return `${(doc.title || "notebook").replace(/[^\w\-. ]+/g, "_")}.${ext}`;
}

async function saveDoc() {
  try {
    await deliverFile(new Blob([(await encodeDoc(doc)) as BlobPart], { type: "application/octet-stream" }), await fileName("isnote"));
    dirty = false;
    await saveLocal(doc);
    toast(t("saved"));
  } catch (e) { toast(String((e as Error).message)); }
}

async function openDoc() {
  const f = await pickFile(".isnote,.openink,application/gzip,application/json,application/octet-stream");
  if (!f) return;
  try {
    doc = await decodeDoc(new Uint8Array(await f.arrayBuffer()));
    pageIdx = 0; selected = null; multi = []; undoStack.length = 0; redoStack.length = 0;
    refreshBar(); layout(); refreshPanel();
  } catch { toast(t("openFailed")); }
}

async function renderToCanvas(pg: Page, s: number): Promise<HTMLCanvasElement> {
  const c = document.createElement("canvas");
  const d = pageDims(pg.paper);
  c.width = Math.round(d.w * s);
  c.height = Math.round(d.h * s);
  const ctx2 = c.getContext("2d")!;
  await preloadImages(pg);
  await Promise.all(pg.objects.flatMap((o) => (o.t === "formula" ? [loadFormulaImage(o.latex, o.color, o.size)] : [])));
  drawPage(ctx2, pg, s, { onAsync: () => {} });
  return c;
}
const toBlob = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), type, q));

async function exportPng() {
  try { await deliverFile(await toBlob(await renderToCanvas(page(), 2), "image/png"), await fileName("png").then((n) => n.replace(".png", `-${pageIdx + 1}.png`))); }
  catch { toast(t("exportFailed")); }
}
async function exportPdf() {
  try {
    const s = 1.6;
    const jpegs: Uint8Array[] = [];
    for (const pg of doc.pages) jpegs.push(new Uint8Array(await (await toBlob(await renderToCanvas(pg, s), "image/jpeg", 0.9)).arrayBuffer()));
    await deliverFile(new Blob([buildPdf(jpegs, Math.round(PORTRAIT_W * s), Math.round(PORTRAIT_H * s), doc.pages.map((pg) => !!pg.paper?.landscape)) as BlobPart], { type: "application/pdf" }), await fileName("pdf"));
  } catch { toast(t("exportFailed")); }
}

// ---- toolbar (markup comes from chrome.ts) ---------------------------------------------------
/** The selected object whose line style can be changed (line, shape, stroke), if any. */
function styleTarget(): Line | Shape | Stroke | null {
  const o = tool === "select" && selected ? page().objects.find((q) => q.id === selected) : undefined;
  return o && (o.t === "line" || o.t === "shape" || o.t === "stroke") ? o : null;
}
function curStyle(): LineStyle {
  const o = styleTarget();
  if (!o) return lineStyle;
  return o.t === "line" ? o.style : (o.t === "shape" ? o.ls : o.dash) ?? "solid";
}
function applyStyle(k: LineStyle) {
  lineStyle = k;
  const o = styleTarget();
  if (o) {
    snapshot();
    if (o.t === "line") o.style = k;
    else { const d = k === "dashed" || k === "dashdot" ? k : undefined; if (o.t === "shape") o.ls = d; else o.dash = d; }
  }
  refreshBar(); schedule();
}

function geoHint(): string {
  if (tool !== "geo") return "";
  if (geoKind === "polygon") return `${t("polygon")}: ${geoPicks.length} — Enter / ${geoPicks.length >= 3 ? "↺ 1st" : "…"}`;
  const c = CONSTRUCTIONS[geoKind];
  return c ? `${t(geoKind as Key)} — ${t("geoPick")} ${geoPicks.length + 1}/${c.needs.length}` : "";
}
function chromeState(): ChromeState {
  const o = selected ? page().objects.find((q) => q.id === selected) : undefined;
  const st = styleTarget();
  const list = pagesIn(doc, sheetIdx);
  return {
    tool, penKind, color, hlColor, width, smooth: smoothLevel, pressure: pressureOn, inkMode, lineStyle: curStyle(), shapeKind, solidKind, geoKind, inputMode, instKind,
    title: doc.title || "Untitled", pageIdx: Math.max(0, list.indexOf(pageIdx)), pageCount: list.length, zoomPct: Math.round(scale * 100), fit: userZoom === null, panelOpen,
    canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, canPaste: clipboard.length > 0,
    sel: o ? { t: o.t, hasStyle: !!st, style: curStyle(), spinnable: o.t === "solid" || o.t === "revolve" || o.t === "fold", foldable: (o.t === "solid" && canFold(o.kind)) || o.t === "fold" } : null, multi: multi.length, geoHint: geoHint(),
    dock: prefs.dock, uiScale: prefs.scale, collapsed: prefs.collapsed, pencilAction, lastShapes, lastGeo, lastSel, lastInst,
    foldUi: { t: o && (o.t === "fold" || o.t === "solid") ? o.fold ?? 1 : 1, playing: !!anim && anim.id === selected, loop: foldLoop, speed: foldSpeed },
    eraserMode, spin: { playing: !!selected && spinners.has(selected), ...spinSettings }, planeMode, outerOnly,
    hideHelpers: !!page().hideHelpers, hideNames: !!page().hideNames, rotDeg: geoRotDeg, dilK: geoDilK, sheets: sheetNames(doc), sheet: sheetIdx, paperType: page().paper?.type ?? "plain", lang: getLang(),
  };
}
function refreshTop() { $("#top").innerHTML = topBarHtml(chromeState()); }
/** Remember tool history (previous tool, last drawing tool, last member of each tool group). */
function syncTool() {
  ts = trackTool(ts, tool);
  if (["shape", "solid", "line"].includes(tool)) lastShapes = tool;
  if (["point", "segment", "circle", "geo"].includes(tool)) lastGeo = tool;
  if (["rectsel", "lasso", "select"].includes(tool)) lastSel = tool;
  if (["inst", "space"].includes(tool)) lastInst = tool;
}
/** Apply scale, dock position and collapsed state of the toolbar. */
function applyPrefs() {
  const root = document.documentElement;
  root.style.setProperty("--ui", String(prefs.scale));
  const host = prefs.dock === "float" ? document.body : $(`#dk-${prefs.dock}`);
  if (strip.parentElement !== host) host.appendChild(strip);
  const vertical = prefs.dock === "left" || prefs.dock === "right";
  strip.classList.toggle("v", vertical);
  strip.classList.toggle("float", prefs.dock === "float");
  strip.hidden = prefs.collapsed;
  const fab = $("#strip-fab");
  fab.hidden = !prefs.collapsed;
  fab.title = t("showToolbar"); fab.setAttribute("aria-label", t("showToolbar")); fab.innerHTML = icon("menu");
  if (prefs.dock === "float") {
    const r = clampFloat(prefs.fx, prefs.fy, strip.offsetWidth || 600, strip.offsetHeight || 56, window.innerWidth, window.innerHeight);
    strip.style.left = `${r.x}px`; strip.style.top = `${r.y}px`;
  } else { strip.style.left = ""; strip.style.top = ""; }
  const q = $("#quick");
  q.hidden = false; q.title = t("quickSwitch"); q.setAttribute("aria-label", t("quickSwitch")); q.innerHTML = icon("rotatemode", 20);
}
function savePrefs() { try { localStorage.setItem("openink-toolbar", JSON.stringify(prefs)); } catch { /* ignore */ } }

function refreshBar() {
  syncTool();
  const s = chromeState();
  $("#top").innerHTML = topBarHtml(s);
  strip.innerHTML = stripHtml(s);
  applyPrefs();
  const sh = $("#sheets"), shHtml = sheetsHtml(s);
  sh.innerHTML = shHtml; sh.hidden = !shHtml;
  const c = $("#ctx"), cHtml = ctxHtml(s);
  c.innerHTML = cHtml; c.hidden = !cHtml;
  cv.classList.toggle("pan", tool === "pan");
  if (popName) renderPop();
  if (panelOpen) refreshPanel();
}

// popovers
let popAnchor: HTMLElement | null = null;
const POP_OF: Record<string, string> = { "m-menu": "menu", "m-settings": "settings", "p-pen": "pen", "p-shapes": "shapes", "p-geo": "geo", "p-inst": "inst", "p-erase": "erase", "p-select": "select" };
function renderPop() {
  if (!popName || !popAnchor) return;
  popEl.innerHTML = popHtml(popName, chromeState());
  popEl.hidden = false;
  const anchor = document.getElementById(popAnchor.id) ?? popAnchor;
  const r = anchor.getBoundingClientRect();
  const w = Math.min(popEl.offsetWidth || 320, window.innerWidth - 16);
  const inStrip = !!anchor.closest("#strip");
  popEl.style.bottom = "auto";
  if (inStrip && prefs.dock === "left") { popEl.style.left = `${r.right + 6}px`; popEl.style.top = `${Math.max(8, Math.min(r.top, window.innerHeight - 220))}px`; popEl.style.maxHeight = `${Math.max(200, window.innerHeight - r.top - 16)}px`; }
  else if (inStrip && prefs.dock === "right") { popEl.style.left = `${Math.max(8, r.left - w - 6)}px`; popEl.style.top = `${Math.max(8, Math.min(r.top, window.innerHeight - 220))}px`; popEl.style.maxHeight = `${Math.max(200, window.innerHeight - r.top - 16)}px`; }
  else if (inStrip && (prefs.dock === "bottom" || r.top > window.innerHeight / 2)) { popEl.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`; popEl.style.top = "auto"; popEl.style.bottom = `${window.innerHeight - r.top + 6}px`; popEl.style.maxHeight = `${Math.max(200, r.top - 16)}px`; }
  else { popEl.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`; popEl.style.top = `${r.bottom + 6}px`; popEl.style.bottom = "auto"; popEl.style.maxHeight = `${Math.max(200, window.innerHeight - r.bottom - 16)}px`; }
}
function closePop() { popName = null; popAnchor = null; popEl.hidden = true; }
document.addEventListener("pointerdown", (e) => {
  if (popName && !popEl.contains(e.target as Node) && !(e.target as HTMLElement).closest?.("#chrome button, #strip button, #strip-fab")) closePop();
}, true);
const KEEP_OPEN = /^(sp-speed|sp-axis|sp-dir|er-|pk-|im-|pressure|inp-|gh-|lang|theme|c-custom2|pa-|dock-|ui-reset)/;

function nextLabelAvoiding(extra: string[]): string {
  const used = new Set([...page().objects.filter((o): o is GeoPoint => o.t === "gpoint").map((o) => o.label), ...extra]);
  for (let i = 0; i < 26 * 4; i++) {
    const l = String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : "");
    if (!used.has(l)) return l;
  }
  return "P";
}
/** Click of the geometry construction tool: collect the objects a construction needs, then build it. */
function geoClick(x: number, y: number) {
  const pg = page();
  snapshot();
  if (geoKind === "polygon") {
    const id = pointAt(x, y, true)!;
    if (geoPicks.length >= 3 && id === geoPicks[0]) { finishPolygon(); return; }
    if (!geoPicks.includes(id)) geoPicks.push(id);
    refreshBar(); schedule(); return;
  }
  const c = CONSTRUCTIONS[geoKind];
  if (!c) return;
  const need: Need = c.needs[geoPicks.length];
  let id: string | null = null;
  if (need === "point") id = pointAt(x, y, true);
  else {
    const o = [...pg.objects].reverse().find((q) => matches(need, q) && hit(pg, q, x, y, 12));
    id = o?.id ?? null;
    if (!id) { undoStack.pop(); toast(`${t("geoPick")}: ${need === "line" ? t("segment") : t("circle")}`); return; }
  }
  geoPicks.push(id!);
  if (geoPicks.length === c.needs.length) {
    const extra: string[] = [];
    const objs = c.build(geoPicks, { uid, label: () => { const l = nextLabelAvoiding(extra); extra.push(l); return l; }, page: pg, rotDeg: geoRotDeg, dilK: geoDilK });
    pg.objects.push(...objs);
    resolveGeo(pg);
    geoPicks = [];
    selected = objs[objs.length - 1]?.id ?? null;
  }
  refreshBar(); schedule();
}
function finishPolygon() {
  if (geoPicks.length < 3) return;
  page().objects.push({ t: "gpoly", id: uid(), pts: [...geoPicks] });
  geoPicks = [];
  refreshBar(); schedule();
}

// graph helpers
const graphOf = (): Graph | null => { const o = selected ? page().objects.find((q) => q.id === selected) : undefined; return o && o.t === "graph" ? o : null; };
async function addGraphPoint(px: number, py: number) {
  const g = [...page().objects].reverse().find((q): q is Graph => q.t === "graph" && hit(page(), q, px, py, 0));
  if (!g) return toast(t("pickGraph"));
  const mx = g.xmin + ((px - g.x) / g.w) * (g.xmax - g.xmin), my = g.ymax - ((py - g.y) / g.h) * (g.ymax - g.ymin);
  let best = -1, bd = Infinity;
  g.fns.forEach((src, i) => { const v = evalFn(src, mx); if (Number.isFinite(v) && Math.abs(v - my) < bd) { bd = Math.abs(v - my); best = i; } });
  if (best < 0) return;
  snapshot();
  (g.pts ??= []).push({ fn: best, x: Math.round(mx * 100) / 100, name: String.fromCharCode(65 + (g.pts?.length ?? 0) % 26) });
  schedule();
}
function graphAction(kind: string) {
  const g = graphOf();
  if (!g) return toast(t("pickGraph"));
  snapshot();
  const pts = (g.pts ??= []);
  const add = (fn: number, x: number) => { if (!pts.some((q) => q.fn === fn && Math.abs(q.x - x) < 1e-4)) pts.push({ fn, x: Math.round(x * 1e6) / 1e6, name: String.fromCharCode(65 + (pts.length % 26)) }); };
  const f = (i: number) => (x: number) => evalFn(g.fns[i], x);
  if (kind === "xint") g.fns.forEach((_, i) => roots(f(i), g.xmin, g.xmax).forEach((x) => add(i, x)));
  else if (kind === "yint") { if (g.xmin <= 0 && g.xmax >= 0) g.fns.forEach((_, i) => { if (Number.isFinite(f(i)(0))) add(i, 0); }); }
  else if (kind === "ext") g.fns.forEach((_, i) => extrema(f(i), g.xmin, g.xmax).forEach((e) => add(i, e.x)));
  else if (kind === "cross") for (let i = 0; i < g.fns.length; i++) for (let j = i + 1; j < g.fns.length; j++) intersectFns(f(i), f(j), g.xmin, g.xmax).forEach((p) => add(i, p.x));
  else if (kind === "legend") g.legend = !g.legend;
  else if (kind === "11") { const r = squareScale(g.xmin, g.xmax, g.ymin, g.ymax, g.w, g.h); g.ymin = r.ymin; g.ymax = r.ymax; }
  schedule();
}

function toggleOnSelected(key: "hideName" | "hideDot" | "helper") {
  const o = selected ? page().objects.find((q) => q.id === selected) : undefined;
  if (!o) return;
  snapshot();
  const r = o as unknown as Record<string, boolean>;
  r[key] = !r[key];
  schedule();
}

async function askText(title: string, value: string): Promise<string | null> {
  let out: string | null = null;
  const ok = await ask(`<h3>${title}</h3><label><input id="at-v" type="text" value="${value.replace(/"/g, "&quot;")}"></label>`, (root) => {
    const el = root.querySelector<HTMLInputElement>("#at-v")!;
    setTimeout(() => { el.focus(); el.select(); }, 50);
    return () => { out = el.value.trim(); return !!out; };
  });
  return ok ? out : null;
}

function switchSheet(i: number) {
  const list = pagesIn(doc, i);
  if (!list.length) return;
  sheetIdx = i;
  gotoPage(list[0]);
}

// ---- sections (planes through marks) ------------------------------------------------------------------
function closePlane(o: Solid) {
  const ids = planePicks, marks = o.marks ?? [];
  const pts = ids.map((id) => marks.find((m) => m.id === id)?.p).filter((p): p is V3 => !!p);
  if (pts.length < 3) return toast(t("planeHint"));
  if (!isCoplanar(pts)) { toast(t("planeNotFlat")); planePicks = []; pendingMark = null; schedule(); return; }
  snapshot();
  const lines = (o.lines ??= []);
  ids.forEach((a, i) => { const b = ids[(i + 1) % ids.length]; if (!lines.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) lines.push([a, b]); }); // the polygon's edges as lines, if missing
  const list = (o.sections ??= []), key = loopKey(ids), j = list.findIndex((q) => loopKey(q.marks) === key);
  if (j >= 0) list[j].color = color; else list.push({ marks: [...ids], color });
  planePicks = []; pendingMark = null;
  toast(t("planeAdded"));
  schedule();
}

// ---- auto-rotate (turntable) ---------------------------------------------------------------------------
const foldOrSpin = (id: string): boolean => { const o = page().objects.find((q) => q.id === id); return !!o && (o.t === "solid" || o.t === "revolve" || o.t === "fold"); };
function saveSpin() {
  try { localStorage.setItem("openink-spin", JSON.stringify(spinSettings)); } catch { /* ignore */ }
  if (selected && spinners.has(selected)) spinners.set(selected, { ...spinSettings });
  refreshBar();
}
function startSpin(id: string) {
  if (!spinners.size) { spinSnap = takeSnap(pageIdx); spinUndoLen = undoStack.length; spinLast = performance.now(); }
  spinners.set(id, { ...spinSettings });
  if (!spinRaf) spinRaf = requestAnimationFrame(spinFrame);
  refreshBar();
}
/** Stop one object (or all). The pre-rotation state becomes one undo step, but only if nothing else was edited meanwhile. */
function stopSpin(id?: string) {
  if (!spinners.size && !spinSnap) return;
  if (id) spinners.delete(id); else spinners.clear();
  if (!spinners.size) {
    if (spinSnap && undoStack.length === spinUndoLen) { undoStack.push(spinSnap); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; }
    spinSnap = null;
    markDirty();
  }
  refreshBar();
}
function toggleSpin() {
  if (!selected || !foldOrSpin(selected)) return toast(t("pickSolid"));
  if (spinners.has(selected)) stopSpin(selected); else startSpin(selected);
}
function spinFrame(now: number) {
  spinRaf = 0;
  if (!spinners.size) return;
  const dt = (now - spinLast) / 1000;
  spinLast = now;
  if (!document.hidden) {
    for (const [id, st] of spinners) {
      const o = page().objects.find((q) => q.id === id);
      if (!o || (o.t !== "solid" && o.t !== "revolve" && o.t !== "fold")) { spinners.delete(id); continue; }
      Object.assign(o, spinStep(o, dt, st));
    }
    schedule();
  }
  if (spinners.size) spinRaf = requestAnimationFrame(spinFrame); else stopSpin(); // (also commits the undo step when the last object vanished)
}
document.addEventListener("visibilitychange", () => { spinLast = performance.now(); });

// ---- writing <-> rotate mode, Pencil double-tap, toolbar dragging ----------------------------------
function toggleRotateMode() {
  ts = toggleRotate(trackTool(ts, tool));
  tool = ts.tool as Tool; // the selection is kept while switching
  pendingPoint = null; rubber = null; geoPicks = [];
  refreshBar(); schedule();
  toast(tool === "select" ? t("rotHint") : t("pen"));
}
/** What an Apple Pencil double-tap does (setting `pencilAction`). Safari/PWAs never receive the barrel double-tap, so this is triggered by
 *  the "openink-pencil-double-tap" event (for a native wrapper), the quick-switch button (double-tap) and the D key. */
function pencilDoubleTap() {
  colorIdx = Math.max(0, COLORS.indexOf(color));
  const r = pencilRule(trackTool(ts, tool), pencilAction, colorIdx, COLORS.length);
  ts = r.state; tool = ts.tool as Tool;
  if (pencilAction === "color") { colorIdx = r.colorIdx; color = COLORS[colorIdx]; if (tool === "highlighter") tool = "pen"; }
  refreshBar(); schedule();
  toast(t(`pencil_${pencilAction}` as Key));
}
window.addEventListener("openink-pencil-double-tap", () => pencilDoubleTap());
window.addEventListener("isnote-pencil-double-tap", () => pencilDoubleTap());
let quickTimer = 0, quickLast = 0;
function quickTap() {
  const now = performance.now();
  if (now - quickLast < 350) { clearTimeout(quickTimer); quickLast = 0; pencilDoubleTap(); return; }
  quickLast = now;
  quickTimer = window.setTimeout(() => { quickLast = 0; toggleRotateMode(); }, 360); // single tap: writing <-> rotate
}
function setDock(d: Dock) {
  if (d === "float" && prefs.dock !== "float") { const r = strip.getBoundingClientRect(); prefs.fx = Math.max(8, r.left || 40); prefs.fy = Math.max(60, r.top || 120); }
  prefs.dock = d; prefs.collapsed = false; savePrefs(); refreshBar();
}
async function showShortcuts() {
  const rows: [string, string][] = [["R", t("rotateMode")], ["D", t("pencilDouble")], ["Ctrl/Cmd + Z / Shift+Z", `${t("undo")} / ${t("redo")}`], ["Ctrl/Cmd + C X V D", `${t("copy")} / ${t("cut")} / ${t("paste")} / ${t("duplicate")}`], ["Ctrl/Cmd + + / −", t("zoomIn") + " / " + t("zoomOut")], ["Del", t("del")], ["Esc", t("cancel")], ["Enter", t("polygon")]];
  for (const [k, v] of Object.entries(SHORTCUTS)) rows.push([k.toUpperCase(), t(({ pen: "pen", highlighter: "highlighter", laser: "laser", eraser: "eraser", select: "select", rectsel: "rectSel", text: "text", fill: "fillTool", formula: "formula", graph: "graph", point: "point", line: "lineTool", shape: "shape", solid: "solid", pan: "hand" } as Record<string, Key>)[v] ?? "pen")]);
  await ask(`<h3>${t("shortcutsHelp")}</h3><table style="width:100%;border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:3px 8px 3px 0;white-space:nowrap"><kbd>${k}</kbd></td><td>${v}</td></tr>`).join("")}</table>`, () => undefined);
}
// Drag the strip by its grip (finger or Pencil): it floats; drop near a screen edge to dock it there. Hold the grip to open the toolbar settings.
{
  let g: { sx: number; sy: number; fx: number; fy: number; moved: boolean; timer: number } | null = null;
  document.addEventListener("pointerdown", (e) => {
    const grip = (e.target as HTMLElement).closest?.("#grip");
    if (!grip) return;
    e.preventDefault();
    const r = strip.getBoundingClientRect();
    g = { sx: e.clientX, sy: e.clientY, fx: r.left, fy: r.top, moved: false, timer: window.setTimeout(() => { if (g && !g.moved) { g.moved = true; g = null; popName = "settings"; popAnchor = document.getElementById("grip"); renderPop(); } }, 550) };
    (grip as HTMLElement).setPointerCapture?.(e.pointerId);
  });
  document.addEventListener("pointermove", (e) => {
    if (!g) return;
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(dx, dy) > 8) { g.moved = true; clearTimeout(g.timer); if (prefs.dock !== "float") { prefs.fx = g.fx; prefs.fy = g.fy; prefs.dock = "float"; applyPrefs(); } }
    if (g.moved) { const c = clampFloat(g.fx + dx, g.fy + dy, strip.offsetWidth, strip.offsetHeight, window.innerWidth, window.innerHeight); prefs.fx = c.x; prefs.fy = c.y; strip.style.left = `${c.x}px`; strip.style.top = `${c.y}px`; }
  });
  const end = (e: PointerEvent) => {
    if (!g) return;
    clearTimeout(g.timer);
    const was = g; g = null;
    if (!was.moved) return;
    const m = 36;
    if (e.clientX < m) prefs.dock = "left"; else if (e.clientX > window.innerWidth - m) prefs.dock = "right"; else if (e.clientY > window.innerHeight - m) prefs.dock = "bottom"; else if (e.clientY < 70) prefs.dock = "top";
    savePrefs(); refreshBar();
  };
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);
}

app.addEventListener("click", async (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest("#chrome, #strip, .pop, #strip-fab, #quick")) return;
  const b = target.closest("button");
  if (!b) return;
  const id = b.id;
  if (POP_OF[id]) { if (popName === POP_OF[id]) closePop(); else { popName = POP_OF[id]; popAnchor = b; renderPop(); } return; }
  const handled = await handleAction(b, id);
  if (handled !== false && popName && !KEEP_OPEN.test(id) && !b.dataset.c && !b.closest(".swatches")) closePop();
  if (popName) renderPop();
});

async function handleAction(b: HTMLElement, id: string): Promise<boolean | void> {
  if (id.startsWith("t-")) {
    // Tapping the active tool in the strip switches it off ("none"); inside a popover it just selects the tool.
    ts = trackTool(ts, tool);
    ts = b.closest(".pop") ? trackTool(ts, id.slice(2)) : tapTool(ts, id.slice(2));
    tool = ts.tool as Tool; pendingPoint = null; rubber = null; pendingMark = null; geoPicks = [];
    if (tool !== "rectsel" && tool !== "lasso" && tool !== "select") multi = [];
    if (tool === "surf") toast(t("surfHint")); if (tool === "paint") toast(t("paintHint")); if (tool === "space") toast(t("spaceHint"));
    refreshBar(); schedule(); return;
  }
  if (id === "tg-shapes" || id === "tg-geo" || id === "tg-inst" || id === "tg-select") {
    const g: Record<string, [Tool[], Tool]> = { "tg-shapes": [["shape", "solid", "line"], lastShapes], "tg-geo": [["point", "segment", "circle", "geo"], lastGeo], "tg-inst": [["inst", "space"], lastInst], "tg-select": [["rectsel", "lasso", "select"], lastSel] };
    ts = tapGroup(trackTool(ts, tool), g[id][0], g[id][1]);
    tool = ts.tool as Tool; geoPicks = []; if (!["rectsel", "lasso", "select"].includes(tool)) multi = [];
    refreshBar(); schedule(); return;
  }
  if (id === "rotmode") { toggleRotateMode(); return; }
  if (id === "grip") return false;
  if (id.startsWith("pa-")) { pencilAction = id.slice(3) as PencilAction; try { localStorage.setItem("openink-pencil", pencilAction); } catch { /* ignore */ } refreshBar(); return; }
  if (id.startsWith("dock-")) { setDock(id.slice(5) as Dock); return; }
  if (id === "ui-hide") { prefs.collapsed = true; savePrefs(); closePop(); refreshBar(); return; }
  if (id === "ui-reset") { prefs = defaultToolbarPrefs(); savePrefs(); refreshBar(); return; }
  if (id === "help-keys") { closePop(); void showShortcuts(); return; }
  if (id === "strip-fab") { prefs.collapsed = false; savePrefs(); refreshBar(); return; }
  if (id === "quick") { quickTap(); return; }
  if (id === "c-custom" || id === "c-custom2") { $<HTMLInputElement>("#c-input").click(); return false; }
  if (id.startsWith("pk-")) { penKind = id.slice(3) as PenKind; tool = "pen"; refreshBar(); return; }
  if (id.startsWith("im-")) { inkMode = id.slice(3) as InkMode; refreshBar(); return; }
  if (id.startsWith("ls-")) { applyStyle(id.slice(3) as LineStyle); return; }
  if (id.startsWith("ln-")) { lineStyle = id.slice(3) as LineStyle; tool = "line"; refreshBar(); return; }
  if (id.startsWith("sk-")) { shapeKind = id.slice(3) as ShapeKind; tool = "shape"; multi = []; refreshBar(); return; }
  if (id.startsWith("so-")) { solidKind = id.slice(3) as SolidKind; tool = "solid"; multi = []; refreshBar(); return; }
  if (id.startsWith("in-")) { instKind = id.slice(3) as InstKind; tool = "inst"; refreshBar(); toast(t(({ ruler: "ruler", protractor: "protractor", square: "instSquare", compass: "compass" } as Record<string, Key>)[instKind])); return; }
  if (id.startsWith("gt-")) {
    const k = id.slice(3); geoPicks = [];
    if (k === "point" || k === "segment" || k === "circle") tool = k; else { tool = "geo"; geoKind = k; }
    refreshBar(); schedule(); return;
  }
  if (id.startsWith("er-")) { eraserMode = id.slice(3) as EraserMode; try { localStorage.setItem("openink-eraser", eraserMode); } catch { /* ignore */ } tool = "eraser"; refreshBar(); return; }
  if (id === "pl-mode") { planeMode = !planeMode; planePicks = []; if (planeMode) { tool = "surf"; toast(t("planeHint")); } refreshBar(); schedule(); return; }
  if (id === "paint-outer") { outerOnly = !outerOnly; refreshBar(); return; }
  if (id === "sp-play") { toggleSpin(); return; }
  if (id === "sp-speed") { spinSettings = { ...spinSettings, speed: SPIN_SPEEDS[(SPIN_SPEEDS.indexOf(spinSettings.speed) + 1) % SPIN_SPEEDS.length] }; saveSpin(); return; }
  if (id === "sp-axis") { spinSettings = { ...spinSettings, axis: SPIN_AXES[(SPIN_AXES.indexOf(spinSettings.axis) + 1) % SPIN_AXES.length] as SpinAxis }; saveSpin(); return; }
  if (id === "sp-dir") { spinSettings = { ...spinSettings, dir: spinSettings.dir === 1 ? -1 : 1 }; saveSpin(); return; }
  if (id === "sp-png") { void exportPng(); return; }
  if (id.startsWith("inp-")) { inputMode = id.slice(4) as InputMode; try { localStorage.setItem("openink-input", inputMode); } catch { /* ignore */ } refreshBar(); return; }
  if (id.startsWith("sh-") && id !== "sh-add") { switchSheet(+id.slice(3)); return; }
  if (id.startsWith("op-")) { const k = id.slice(3); if (k === "copy") copySel(); else if (k === "cut") cutSel(); else if (k === "paste") pasteSel(); else if (k === "duplicate") duplicateSel(); else deleteSelected(); refreshBar(); return; }
  if (b.dataset.c) {
    color = b.dataset.c;
    if (tool === "highlighter") tool = "pen";
    const o = tool === "select" && selected && page().objects.find((x) => x.id === selected);
    if (o && (o.t === "stroke" || o.t === "formula" || o.t === "shape" || o.t === "solid" || o.t === "net" || o.t === "revolve" || o.t === "fold" || o.t === "line" || o.t === "text" || o.t === "fill")) { snapshot(); o.color = color; }
    refreshBar(); schedule(); return;
  }
  if (b.dataset.w) { width = +b.dataset.w; const o = tool === "select" && selected && page().objects.find((x) => x.id === selected); if (o && (o.t === "stroke" || o.t === "line")) { snapshot(); o.w = width; schedule(); } refreshBar(); return; }
  if (b.dataset.hl) { hlColor = b.dataset.hl; tool = "highlighter"; refreshBar(); return; }
  switch (id) {
    case "undo": undoRedo(undoStack, redoStack); break;
    case "redo": undoRedo(redoStack, undoStack); break;
    case "del": deleteSelected(); break;
    case "rot-l": rotateSelected(-STEP, 0, 0); break;
    case "rot-r": rotateSelected(STEP, 0, 0); break;
    case "rot-u": rotateSelected(0, -STEP, 0); break;
    case "rot-d": rotateSelected(0, STEP, 0); break;
    case "rot-ccw": rotateSelected(0, 0, -STEP); break;
    case "rot-cw": rotateSelected(0, 0, STEP); break;
    case "thin": scaleLines(0.7); break;
    case "thick": scaleLines(1 / 0.7); break;
    case "unfold": unfoldSelected(); break;
    case "netcopy": copyNet(); break;
    case "f-play": { const o = selected ? foldOf(selected) : null; if (o) { if (anim && anim.id === o.id) stopFold(); else playFold(o.id, (o.fold ?? 1) > 0.5 ? -1 : 1, foldLoop); } break; }
    case "f-loop": foldLoop = !foldLoop; if (anim) anim.loop = foldLoop; refreshBar(); break;
    case "f-speed": foldSpeed = foldSpeed === 1 ? 2 : foldSpeed === 2 ? 0.5 : 1; refreshBar(); break;
    case "revolve": void revolveSelected(); break;
    case "edit": { const o = selected ? page().objects.find((x) => x.id === selected) : undefined; if (o) void editSelected(o); break; }
    case "dashed": if (styleTarget()) applyStyle(curStyle() === "dashed" ? "solid" : "dashed"); else { lineStyle = lineStyle === "dashed" ? "solid" : "dashed"; refreshBar(); } break;
    case "gn-name": toggleOnSelected("hideName"); break;
    case "gn-dot": toggleOnSelected("hideDot"); break;
    case "gn-helper": toggleOnSelected("helper"); break;
    case "gh-names": snapshot(); page().hideNames = !page().hideNames; refreshBar(); schedule(); break;
    case "gh-helpers": snapshot(); page().hideHelpers = !page().hideHelpers; refreshBar(); schedule(); break;
    case "g-pt": tool = "gpt"; refreshBar(); toast(t("pointOnGraph")); break;
    case "g-xint": graphAction("xint"); break;
    case "g-yint": graphAction("yint"); break;
    case "g-ext": graphAction("ext"); break;
    case "g-cross": graphAction("cross"); break;
    case "g-legend": graphAction("legend"); break;
    case "g-11": graphAction("11"); break;
    case "clearpage": if (page().objects.length && (await confirmDiscard(t("clearPage") + "?"))) { snapshot(); page().objects = []; selected = null; multi = []; refreshBar(); schedule(); } break;
    case "addp": { const np: Page = { objects: [], paper: page().paper ? { ...page().paper! } : undefined, sheet: sheetOf(page()) }; doc.pages.splice(pageIdx + 1, 0, np); pageIdx++; selected = null; multi = []; markDirty(); layout(); refreshBar(); break; }
    case "delp": if (pagesIn(doc, sheetIdx).length > 1 && (await confirmDiscard(t("confirmDelPage")))) { doc.pages.splice(pageIdx, 1); const l = pagesIn(doc, sheetIdx); pageIdx = l.find((i) => i >= pageIdx) ?? l[l.length - 1]; markDirty(); layout(); refreshBar(); } break;
    case "new": if (!dirty || (await confirmDiscard(t("confirmNew")))) { doc = newDoc(); pageIdx = 0; sheetIdx = 0; selected = null; multi = []; undoStack.length = 0; redoStack.length = 0; dirty = false; void saveLocal(doc); layout(); refreshBar(); refreshPanel(); } break;
    case "panel": panelOpen = !panelOpen; refreshBar(); refreshPanel(); layout(); break;
    case "zin": setZoom(scale * 1.25); break;
    case "zout": setZoom(scale / 1.25); break;
    case "fitw": setZoom(null); userZoom = (stage.clientWidth - 24) / PW(); layout(); refreshTop(); break;
    case "paper": void editPaper(); break;
    case "pic": void insertPicture(); break;
    case "pdfin": void importPdfFile(); break;
    case "pressure": pressureOn = !pressureOn; refreshBar(); break;
    case "open": void openDoc(); break;
    case "save": void saveDoc(); break;
    case "png": void exportPng(); break;
    case "pdf": void exportPdf(); break;
    case "lang": setLang(getLang() === "vi" ? "en" : "vi"); refreshBar(); break;
    case "theme": { const r = document.documentElement; const dark = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; r.dataset.theme = dark ? "light" : "dark"; try { localStorage.setItem("openink-theme", r.dataset.theme); } catch { /* ignore */ } syncTheme(); schedule(); refreshBar(); break; }
    case "title-btn": { const n = await askText(t("title"), doc.title); if (n !== null) { doc.title = n; markDirty(); refreshTop(); } break; }
    case "sheet-new": case "sh-add": { const n = await askText(t("sheetName"), `${sheetNames(doc).length + 1}`); if (n) { const first: Page = { objects: [], paper: page().paper ? { ...page().paper! } : undefined }; sheetIdx = addSheet(doc, n, first); pageIdx = doc.pages.length - 1; selected = null; multi = []; markDirty(); layout(); refreshBar(); refreshPanel(); } break; }
    case "sheet-ren": { const n = await askText(t("renameSheet"), sheetNames(doc)[sheetIdx]); if (n) { renameSheet(doc, sheetIdx, n); markDirty(); refreshBar(); } break; }
    case "sheet-del": if (sheetNames(doc).length > 1 && (await confirmDiscard(t("deleteSheet") + "?"))) { removeSheet(doc, sheetIdx); sheetIdx = Math.max(0, sheetIdx - 1); pageIdx = pagesIn(doc, sheetIdx)[0] ?? 0; markDirty(); layout(); refreshBar(); refreshPanel(); } break;
    default: return false;
  }
}
app.addEventListener("keydown", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === "goto" && e.key === "Enter") { gotoPos(+el.value); el.value = ""; }
});
app.addEventListener("pointerdown", (e) => { if ((e.target as HTMLElement).id === "fold-t") snapshot(); }); // one undo step per slider drag
app.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === "w") { width = +el.value; el.nextElementSibling && (el.nextElementSibling.textContent = el.value); }
  else if (el.id === "smooth") { smoothLevel = +el.value; el.nextElementSibling && (el.nextElementSibling.textContent = el.value); }
  else if (el.id === "fold-t") { const o = selected ? foldOf(selected) : null; if (o) { anim = null; o.fold = +el.value / 100; markDirty(); schedule(); } }
  else if (el.id === "ui-scale") { prefs.scale = +el.value / 100; savePrefs(); document.documentElement.style.setProperty("--ui", String(prefs.scale)); el.nextElementSibling && (el.nextElementSibling.textContent = `${el.value}%`); }
  else if (el.id === "geo-rot") geoRotDeg = +el.value || 0;
  else if (el.id === "geo-k") geoDilK = +el.value || 1;
  else if (el.id === "c-input") { color = el.value; if (tool === "highlighter") tool = "pen"; refreshBar(); }
});

window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input,textarea,select,dialog,[contenteditable]")) return;
  if (dlg.open) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? undoRedo(redoStack, undoStack) : undoRedo(undoStack, redoStack); }
  else if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void saveDoc(); }
  else if (mod && e.key.toLowerCase() === "c") { e.preventDefault(); copySel(); }
  else if (mod && e.key.toLowerCase() === "x") { e.preventDefault(); cutSel(); }
  else if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); pasteSel(); }
  else if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateSel(); }
  else if (mod && (e.key === "+" || e.key === "=")) { e.preventDefault(); setZoom(scale * 1.25); }
  else if (mod && e.key === "-") { e.preventDefault(); setZoom(scale / 1.25); }
  else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
  else if (!mod && !e.altKey && !e.repeat && e.key.toLowerCase() === "r") { toggleRotateMode(); }
  else if (!mod && !e.altKey && !e.repeat && e.key.toLowerCase() === "d") { pencilDoubleTap(); }
  else if (!mod && e.key === "?") { void showShortcuts(); }
  else if (e.key === "Enter" && tool === "surf" && planeMode) { const so = page().objects.find((q) => q.id === planeSolid); if (so && so.t === "solid") closePlane(so); }
  else if (e.key === " " && selected && foldOrSpin(selected)) { e.preventDefault(); toggleSpin(); }
  else if (e.key === "Enter" && tool === "geo" && geoKind === "polygon") finishPolygon();
  else if (!mod && !e.altKey && SHORTCUTS[e.key.toLowerCase()] && !e.key.startsWith("Arrow")) { tool = SHORTCUTS[e.key.toLowerCase()]; geoPicks = []; if (tool !== "rectsel" && tool !== "lasso" && tool !== "select") multi = []; refreshBar(); schedule(); }
  else if (e.key === "Escape") { closePop(); geoPicks = []; pendingPoint = null; rubber = null; pendingMark = null; selected = null; multi = []; selPath = null; refreshBar(); schedule(); }
  else if (e.key.startsWith("Arrow") && selected) { e.preventDefault(); rotateSelected(e.key === "ArrowLeft" ? -STEP : e.key === "ArrowRight" ? STEP : 0, e.key === "ArrowUp" ? -STEP : e.key === "ArrowDown" ? STEP : 0, 0); }
});
window.addEventListener("resize", () => layout());
// Ctrl/Cmd + wheel (and trackpad pinch) zooms the page.
stage.addEventListener("wheel", (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, { passive: false });
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); } });

// ---- boot ----------------------------------------------------------------------
/** Pick up the theme (saved light/dark choice) and give the canvas the same accent colour as the CSS. */
function syncTheme() {
  try { const th = localStorage.getItem("openink-theme"); if (th === "light" || th === "dark") document.documentElement.dataset.theme = th; } catch { /* ignore */ }
  const a = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  if (a) THEME.accent = a;
}
syncTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { syncTheme(); schedule(); });
refreshBar();
layout();
void loadLocal().then((d) => { if (d) { doc = d; pageIdx = 0; sheetIdx = sheetOf(d.pages[0]); refreshBar(); layout(); refreshPanel(); } });
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./sw.js").catch(() => {});
// Test hook (dev/preview only inspects state; not used by the UI).
(window as unknown as { __openink: unknown }).__openink = { get doc() { return doc; }, schedule, refreshBar, playFold, get anim() { return anim; }, pencilDoubleTap, toggleRotateMode, get tool() { return tool; }, solids: solidsApi, insertPicture, importPdfFile };
