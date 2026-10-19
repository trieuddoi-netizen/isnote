import { findPoint, formulaSize, textSize, type Fold, type Inst, type Graph, type ImageObj, type Line, type Net, type Obj, type Page, type PenKind, type Revolve, type Shape, type Solid, type Stroke, type TextObj } from "./model.ts";
import { curvePaths, isCurveFigure, shapePoints } from "./figures.ts";
import { boundsOf } from "./bounds.ts";
import { PEN_STYLE, strokeWidths } from "./pen.ts";
import { arrowHead, arrowSize, dashFor, hasEndArrow, hasStartArrow, shaft } from "./linestyle.ts";
import { fontCss, layoutText, lineX } from "./text.ts";
import { NOTEBOOK_MARGIN, gridColor, pageDims, paperMarks } from "./paper.ts";
import { angleAt, circleOf, lineOf, resolveGeo } from "./geo.ts";
import { MM, RULER_H, instHandleLocal, instToWorld, protractorTicks, rulerTicks } from "./instruments.ts";
import { evalFn, parseIneq, inRegion, pointLabel } from "./graphtools.ts";
import { compile } from "./mathexpr.ts";
import { formulaImage } from "./formula.ts";
import { boundRadius, project, type Path } from "./solids.ts";
import { netOf } from "./nets.ts";
import { projectRevolve } from "./revolve.ts";
import { canFold, effRadius, projectFold } from "./fold.ts";
import { foldMarks, sectionPolys } from "./foldmarks.ts";
import { t } from "./i18n.ts";

export { shapePoints };

function drawShape(ctx: CanvasRenderingContext2D, o: Shape) {
  ctx.save();
  ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
  ctx.rotate(o.rot);
  ctx.translate(-o.w / 2, -o.h / 2);
  ctx.strokeStyle = o.color; ctx.lineWidth = o.lw; ctx.lineJoin = "round";
  ctx.setLineDash(dashFor(o.ls, o.lw));
  if (isCurveFigure(o.kind)) {
    const subs = curvePaths(o.kind);
    if (o.kind === "annulus") {
      ctx.beginPath();
      for (const sp of subs) { sp.pts.forEach(([px, py], i) => (i ? ctx.lineTo(px * o.w, py * o.h) : ctx.moveTo(px * o.w, py * o.h))); ctx.closePath(); }
      if (o.fill) { ctx.globalAlpha = 0.18; ctx.fillStyle = o.color; ctx.fill("evenodd"); ctx.globalAlpha = 1; }
      ctx.stroke();
    } else {
      for (const sp of subs) {
        ctx.beginPath();
        sp.pts.forEach(([px, py], i) => (i ? ctx.lineTo(px * o.w, py * o.h) : ctx.moveTo(px * o.w, py * o.h)));
        if (sp.dashed) { ctx.save(); ctx.lineWidth = Math.max(0.8, o.lw * 0.6); ctx.setLineDash([6, 5]); ctx.stroke(); ctx.restore(); }
        else ctx.stroke();
      }
    }
    ctx.restore();
    return;
  }
  const pts = shapePoints(o.kind);
  ctx.beginPath();
  if (pts === "ellipse") ctx.ellipse(o.w / 2, o.h / 2, o.w / 2, o.h / 2, 0, 0, Math.PI * 2);
  else { pts.forEach(([px, py], i) => (i ? ctx.lineTo(px * o.w, py * o.h) : ctx.moveTo(px * o.w, py * o.h))); ctx.closePath(); }
  if (o.fill) { ctx.globalAlpha = 0.18; ctx.fillStyle = o.color; ctx.fill(); ctx.globalAlpha = 1; }
  ctx.stroke();
  ctx.restore();
}

const PAINT_ALPHA = 0.5;
const LINE_COLOR = "#d62828";

/** Stroke a set of unit-space paths: visible solid, hidden dashed. `k` converts unit space to page units. */
function strokePaths(ctx: CanvasRenderingContext2D, paths: Path[], color: string, lw: number, k: number) {
  ctx.strokeStyle = color;
  for (const hidden of [true, false]) {
    ctx.lineWidth = (hidden ? lw * 0.8 : lw) / k;
    ctx.setLineDash(hidden ? [7 / k, 6 / k] : []);
    ctx.beginPath();
    for (const p of paths) {
      if (p.hidden !== hidden) continue;
      ctx.moveTo(p.pts[0], p.pts[1]);
      for (let i = 2; i < p.pts.length; i += 2) ctx.lineTo(p.pts[i], p.pts[i + 1]);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function fillPoly(ctx: CanvasRenderingContext2D, pts: number[], color: string, alpha: number) {
  ctx.globalAlpha = alpha; ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) (i ? ctx.lineTo(pts[i], pts[i + 1]) : ctx.moveTo(pts[i], pts[i + 1]));
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
}

/** Screen scale of a solid: unit space -> page units. Shared with hit-testing in main.ts. */
export const solidScale = (size: number, radius: number) => (size / 2 / radius) * 0.96;

function drawSolid(ctx: CanvasRenderingContext2D, o: Solid, pendingMark?: string | null) {
  if (o.fold !== undefined && o.fold < 0.9999 && canFold(o.kind)) { drawSolidFolded(ctx, o, pendingMark); return; }
  const pr = project(o);
  const k = solidScale(o.s, pr.radius);
  ctx.save();
  ctx.translate(o.x + o.s / 2, o.y + o.s / 2);
  ctx.scale(k, k);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  const byFace = new Map<number, number[][]>(); // a face may be built from many polygons (smooth solids): fill them in one go
  for (const f of pr.faces) (byFace.get(f.id) ?? byFace.set(f.id, []).get(f.id)!).push(f.pts);
  for (const [id, polys] of byFace) {
    const c = o.faceColors?.[id] ?? (o.shade ? o.color : null);
    if (!c) continue;
    ctx.globalAlpha = o.faceColors?.[id] ? PAINT_ALPHA : 0.14; ctx.fillStyle = c;
    ctx.beginPath();
    for (const pts of polys) { for (let i = 0; i < pts.length; i += 2) (i ? ctx.lineTo(pts[i], pts[i + 1]) : ctx.moveTo(pts[i], pts[i + 1])); ctx.closePath(); }
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  drawSections(ctx, o, 1, k);
  strokePaths(ctx, pr.paths, o.color, o.lw, k);
  strokePaths(ctx, pr.lines, LINE_COLOR, Math.max(o.lw, 1.5), k);
  const fs = 17 / k;
  ctx.font = `italic ${fs}px serif`;
  for (const d of pr.dots) {
    ctx.fillStyle = LINE_COLOR; ctx.globalAlpha = d.hidden ? 0.45 : 1;
    ctx.beginPath(); ctx.arc(d.x, d.y, (d.hidden ? 3.2 : 4) / k, 0, Math.PI * 2); ctx.fill();
    if (d.name) { ctx.fillStyle = "#26151f"; ctx.fillText(d.name, d.x + 6 / k, d.y - 6 / k); }
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#26151f"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const d of pr.vlabels) { ctx.globalAlpha = d.hidden ? 0.5 : 1; ctx.fillText(d.name, d.x, d.y); }
  ctx.globalAlpha = 1;
  if (pendingMark) {
    const m = o.marks?.find((q) => q.id === pendingMark);
    const d = m && pr.dots.find((_, i) => o.marks![i] === m);
    if (d) { ctx.strokeStyle = THEME.accent; ctx.lineWidth = 2 / k; ctx.beginPath(); ctx.arc(d.x, d.y, 9 / k, 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.restore();
}

function drawNet(ctx: CanvasRenderingContext2D, o: Net) {
  const net = netOf(o.kind);
  if (!net) return;
  const k = Math.min(o.w / net.w, o.h / net.h);
  ctx.save();
  ctx.translate(o.x + (o.w - net.w * k) / 2, o.y + (o.h - net.h * k) / 2);
  ctx.scale(k, k);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  for (const f of net.faces) { const c = o.faceColors?.[f.id]; if (c) fillPoly(ctx, f.pts, c, PAINT_ALPHA); }
  ctx.strokeStyle = o.color;
  for (const dashed of [false, true]) {
    ctx.lineWidth = o.lw / k;
    ctx.setLineDash(dashed ? [6 / k, 5 / k] : []);
    ctx.beginPath();
    for (const f of net.faces) {
      const n = f.pts.length / 2;
      for (let i = 0; i < n; i++) {
        if (f.fold[i] !== dashed) continue;
        const j = (i + 1) % n;
        ctx.moveTo(f.pts[2 * i], f.pts[2 * i + 1]); ctx.lineTo(f.pts[2 * j], f.pts[2 * j + 1]);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
  if (net.approx) { ctx.save(); ctx.fillStyle = "#b45309"; ctx.font = "italic 15px system-ui, sans-serif"; ctx.fillText(t("approxNet"), o.x, o.y + o.h + 16); ctx.restore(); }
}

type FoldBody = Pick<Fold, "kind" | "color" | "lw" | "shade" | "faceColors" | "yaw" | "pitch" | "roll" | "fold">;
/** Faces back to front with translucent fills, then edges; `k` = unit space -> page units. The context is already centred and scaled. */
function drawFoldBody(ctx: CanvasRenderingContext2D, o: FoldBody, k: number) {
  const pr = projectFold(o);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  for (let i = 0; i < pr.faces.length;) { // consecutive faces of one face id are filled in one go (no double blending between their pieces)
    const id = pr.faces[i].id;
    const c = o.faceColors?.[id] ?? null;
    ctx.beginPath();
    let j = i;
    for (; j < pr.faces.length && pr.faces[j].id === id; j++) { const p = pr.faces[j].pts; for (let q = 0; q < p.length; q += 2) (q ? ctx.lineTo(p[q], p[q + 1]) : ctx.moveTo(p[q], p[q + 1])); ctx.closePath(); }
    ctx.globalAlpha = c ? 0.5 : o.shade ? 0.26 : 0.12;
    ctx.fillStyle = c ?? o.color;
    ctx.fill();
    i = j;
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = o.color;
  for (const e of pr.edges) {
    ctx.beginPath(); ctx.moveTo(e.pts[0], e.pts[1]); ctx.lineTo(e.pts[2], e.pts[3]);
    if (e.kind === "faint") { ctx.globalAlpha = 0.35; ctx.lineWidth = Math.max(0.5, o.lw * 0.4) / k; ctx.setLineDash([]); }
    else { ctx.globalAlpha = 1; ctx.lineWidth = (e.hidden ? o.lw * 0.8 : o.lw) / k; ctx.setLineDash(e.hidden || e.kind === "hinge" ? [7 / k, 6 / k] : []); }
    ctx.stroke();
  }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
}

/** Painted cross-sections: translucent fills in the polygon's projected shape, hidden parts included (they are inside the solid). Unit space; `fold` fades interior sections while unfolding. */
function drawSections(ctx: CanvasRenderingContext2D, o: Solid, fold: number, k: number) {
  const secs = (o.sections ?? []).filter((s) => s.color);
  if (!secs.length) return;
  for (const p of sectionPolys({ ...o, fold }, secs)) {
    if (p.alpha <= 0.001) continue;
    ctx.beginPath();
    for (let i = 0; i < p.pts.length; i += 2) (i ? ctx.lineTo(p.pts[i], p.pts[i + 1]) : ctx.moveTo(p.pts[i], p.pts[i + 1]));
    ctx.closePath();
    ctx.globalAlpha = 0.42 * p.alpha; ctx.fillStyle = p.color!; ctx.fill();
    ctx.globalAlpha = 0.9 * p.alpha; ctx.strokeStyle = p.color!; ctx.lineWidth = Math.max(1, o.lw * 0.7) / k; ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** A solid that is (partly) unfolded: the same object, drawn as the folding model, with its painted faces, names, points and segments riding on their faces. */
function drawSolidFolded(ctx: CanvasRenderingContext2D, o: Solid, pendingMark?: string | null) {
  const k = solidScale(o.s, effRadius(o.kind, boundRadius(o.kind), o.fold));
  const fo = { ...o, fold: o.fold ?? 1 };
  ctx.save();
  ctx.translate(o.x + o.s / 2, o.y + o.s / 2);
  ctx.scale(k, k);
  drawFoldBody(ctx, fo, k);
  drawSections(ctx, o, fo.fold, k);
  const fm = foldMarks(fo);
  ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.strokeStyle = LINE_COLOR;
  for (const l of fm.lines) {
    ctx.globalAlpha = l.alpha;
    ctx.lineWidth = Math.max(o.lw, 1.5) * (l.hidden ? 0.8 : 1) / k;
    ctx.setLineDash(l.hidden ? [7 / k, 6 / k] : []);
    ctx.beginPath(); ctx.moveTo(l.pts[0], l.pts[1]); ctx.lineTo(l.pts[2], l.pts[3]); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.font = `italic ${17 / k}px serif`;
  for (const d of fm.dots) {
    ctx.fillStyle = LINE_COLOR; ctx.globalAlpha = d.hidden ? 0.45 : 1;
    ctx.beginPath(); ctx.arc(d.x, d.y, (d.hidden ? 3.2 : 4) / k, 0, Math.PI * 2); ctx.fill();
    if (d.name) { ctx.fillStyle = "#26151f"; ctx.fillText(d.name, d.x + 6 / k, d.y - 6 / k); }
  }
  ctx.fillStyle = "#26151f"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const d of fm.vlabels) { ctx.globalAlpha = d.hidden ? 0.5 : 1; ctx.fillText(d.name, d.x, d.y); }
  ctx.globalAlpha = 1;
  if (pendingMark) { const d = fm.dots.find((q) => q.id === pendingMark); if (d) { ctx.strokeStyle = THEME.accent; ctx.lineWidth = 2 / k; ctx.beginPath(); ctx.arc(d.x, d.y, 9 / k, 0, Math.PI * 2); ctx.stroke(); } }
  ctx.restore();
}

/** Legacy separate fold object (older files): faces back to front with translucent fills, then edges (fold edges dashed while folding, hidden edges dashed once closed). */
function drawFold(ctx: CanvasRenderingContext2D, o: Fold) {
  const k = solidScale(o.s, projectFold(o).radius);
  ctx.save();
  ctx.translate(o.x + o.s / 2, o.y + o.s / 2);
  ctx.scale(k, k);
  drawFoldBody(ctx, o, k);
  ctx.restore();
}

function drawRevolve(ctx: CanvasRenderingContext2D, o: Revolve) {
  const pr = projectRevolve(o);
  if (!pr) return;
  const k = solidScale(o.s, pr.radius);
  ctx.save();
  ctx.translate(o.x + o.s / 2, o.y + o.s / 2);
  ctx.scale(k, k);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  strokePaths(ctx, pr.paths, o.color, o.lw, k);
  ctx.restore();
}

/** Colour of selection outlines and handles; set from the CSS variable --accent at start-up. */
export const THEME = { accent: "#d81b8a" };

export interface Handles { rot: { x: number; y: number }; size: { x: number; y: number } }
/** Interactive handles of the selected object, in page coordinates (null when it has none). */
export function handlesOf(o: Obj): Handles | null {
  if (o.t === "shape") {
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2, c = Math.cos(o.rot), s = Math.sin(o.rot);
    const at = (lx: number, ly: number) => ({ x: cx + lx * c - ly * s, y: cy + lx * s + ly * c });
    return { rot: at(0, -(o.h / 2 + 30)), size: at(o.w / 2, o.h / 2) };
  }
  if (o.t === "solid" || o.t === "revolve" || o.t === "fold") return { rot: { x: o.x + o.s / 2, y: o.y - 30 }, size: { x: o.x + o.s, y: o.y + o.s } };
  if (o.t === "inst") { const h = instHandleLocal(o); const a = instToWorld(o, h.rot), b = instToWorld(o, h.size); return { rot: { x: a[0], y: a[1] }, size: { x: b[0], y: b[1] } }; }
  if (o.t === "line") return { rot: { x: o.x1, y: o.y1 }, size: { x: o.x2, y: o.y2 } };
  if (o.t === "image") return { rot: { x: NaN, y: NaN }, size: { x: o.x + o.w, y: o.y + o.h } };
  if (o.t === "text") { const h = textSize.get(o.id)?.h ?? o.size * 1.3; return { rot: { x: NaN, y: NaN }, size: { x: o.x + o.w, y: o.y + h } }; }
  if (o.t === "graph" || o.t === "net") return { rot: { x: NaN, y: NaN }, size: { x: o.x + o.w, y: o.y + o.h } };
  return null;
}

export interface DrawOpts { selected?: string | null; multi?: string[]; pending?: { id: string; mark: string } | null; onAsync: () => void }

const GRAPH_COLORS = ["#d62828", "#1d6fd8", "#2a9d3a", "#9b4dca", "#e07b00"];

function drawStroke(ctx: CanvasRenderingContext2D, o: Stroke) {
  const { pts, color } = o;
  const hl = !!o.hl;
  const pen: PenKind = o.pen ?? "ballpoint";
  const st = PEN_STYLE[pen];
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  if (hl) { ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = "multiply"; }
  else if (st.alpha < 1) ctx.globalAlpha = st.alpha;
  if (o.dash && o.dash !== "solid") ctx.setLineDash(dashFor(o.dash, o.w));
  const plain = hl || (pen === "ballpoint" && !o.pr); // classic smooth path
  if (pts.length === 2) {
    ctx.beginPath();
    ctx.arc(pts[0], pts[1], (hl ? o.w : o.w * st.mul) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (plain || pen === "felt" || pen === "pencil") {
    // Constant-width pens are drawn as one path (so translucent pens do not darken at joints).
    const w = hl || pen === "ballpoint" ? o.w : (strokeWidths(pen, pts, o.w, o.pr).reduce((a, b) => a + b, 0) / (pts.length / 2 - 1));
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i + 1 < pts.length; i += 2) {
        const mx = (pts[i - 2] + pts[i]) / 2, my = (pts[i - 1] + pts[i + 1]) / 2;
        ctx.quadraticCurveTo(pts[i - 2], pts[i - 1], mx, my);
      }
      ctx.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
    };
    ctx.lineWidth = w;
    path(); ctx.stroke();
    if (pen === "pencil") { // graphite grain: a speckled second pass
      ctx.globalAlpha = 0.3; ctx.lineWidth = w * 1.1; ctx.setLineDash([1, 2.2]); ctx.translate(0.5, 0.4); path(); ctx.stroke();
    }
  } else {
    // Variable width (fountain, brush, or any pen with pressure): one round-capped segment per width.
    // Drawn as a chain of quadratic curves through the segment midpoints (like the constant-width pens), so corners are rounded and thickness changes gently.
    const ws = strokeWidths(pen, pts, o.w, o.pr), n = pts.length / 2;
    const mx = (i: number) => (pts[2 * i] + pts[2 * i + 2]) / 2, my = (i: number) => (pts[2 * i + 1] + pts[2 * i + 3]) / 2;
    const piece = (fx: number, fy: number, cx: number, cy: number, tx: number, ty: number, w: number) => { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(fx, fy); ctx.quadraticCurveTo(cx, cy, tx, ty); ctx.stroke(); };
    if (n === 2) piece(pts[0], pts[1], (pts[0] + pts[2]) / 2, (pts[1] + pts[3]) / 2, pts[2], pts[3], ws[0]);
    else {
      piece(pts[0], pts[1], (pts[0] + mx(0)) / 2, (pts[1] + my(0)) / 2, mx(0), my(0), ws[0]);
      for (let j = 1; j + 1 < n; j++) piece(mx(j - 1), my(j - 1), pts[2 * j], pts[2 * j + 1], mx(j), my(j), (ws[j - 1] + ws[j]) / 2);
      piece(mx(n - 2), my(n - 2), (mx(n - 2) + pts[2 * n - 2]) / 2, (my(n - 2) + pts[2 * n - 1]) / 2, pts[2 * n - 2], pts[2 * n - 1], ws[n - 2]);
    }
  }
  ctx.restore();
}

function drawLine(ctx: CanvasRenderingContext2D, o: Line) {
  ctx.save();
  ctx.strokeStyle = o.color; ctx.fillStyle = o.color; ctx.lineWidth = o.w; ctx.lineCap = "round"; ctx.lineJoin = "round";
  const size = arrowSize(o.w);
  const [ax, ay, bx, by] = shaft(o.x1, o.y1, o.x2, o.y2, o.style, size);
  ctx.setLineDash(dashFor(o.style, o.w));
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  ctx.setLineDash([]);
  const head = (h: number[]) => { ctx.beginPath(); ctx.moveTo(h[0], h[1]); ctx.lineTo(h[2], h[3]); ctx.lineTo(h[4], h[5]); ctx.closePath(); ctx.fill(); ctx.stroke(); };
  if (hasEndArrow(o.style)) head(arrowHead(o.x1, o.y1, o.x2, o.y2, size));
  if (hasStartArrow(o.style)) head(arrowHead(o.x2, o.y2, o.x1, o.y1, size));
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, o: TextObj) {
  ctx.save();
  ctx.font = fontCss(o);
  ctx.textBaseline = "top";
  const lay = layoutText(o, (s) => ctx.measureText(s).width);
  ctx.fillStyle = o.color; ctx.strokeStyle = o.color;
  ctx.lineWidth = Math.max(1, o.size / 16);
  lay.lines.forEach((l, i) => {
    const y = o.y + i * lay.lineH + (lay.lineH - o.size) / 2;
    const x = lineX(o, l);
    if (l.bullet) ctx.fillText("•", o.x + (o.align === "left" ? 0 : Math.max(0, x - o.x - l.indent)) + o.size * 0.2, y);
    ctx.fillText(l.text, x, y);
    if (o.underline && l.text) { ctx.beginPath(); ctx.moveTo(x, y + o.size * 1.05); ctx.lineTo(x + l.width, y + o.size * 1.05); ctx.stroke(); }
  });
  textSize.set(o.id, { w: Math.max(o.w, ...lay.lines.map((l) => l.width + l.indent)), h: lay.h });
  ctx.restore();
}

const imageCache = new Map<string, HTMLImageElement | "loading" | "error">();
/** Returns the decoded image, or null while it is still loading (then `onAsync` is called when ready). */
export function getImage(src: string, onAsync: () => void): HTMLImageElement | null {
  const c = imageCache.get(src);
  if (c && c !== "loading" && c !== "error") return c;
  if (!c) {
    imageCache.set(src, "loading");
    const img = new Image();
    img.onload = () => { imageCache.set(src, img); onAsync(); };
    img.onerror = () => imageCache.set(src, "error");
    img.src = src;
  }
  return null;
}
/** Resolve once every picture on the page (background and inserted) is decoded; used before exporting. */
export function preloadImages(pg: Page): Promise<void> {
  const srcs = [pg.bg, ...pg.objects.map((o) => (o.t === "image" ? o.src : undefined))].filter((x): x is string => !!x);
  return Promise.all(srcs.map((src) => new Promise<void>((res) => { if (getImage(src, res)) res(); }))).then(() => undefined);
}
function drawImageObj(ctx: CanvasRenderingContext2D, o: ImageObj, onAsync: () => void) {
  const img = getImage(o.src, onAsync);
  if (img) ctx.drawImage(img, o.x, o.y, o.w, o.h);
  else { ctx.fillStyle = "#e3e6ea"; ctx.fillRect(o.x, o.y, o.w, o.h); }
}

function niceStep(range: number): number {
  const raw = range / 8;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

export function drawGraph(ctx: CanvasRenderingContext2D, g: Graph) {
  const { x, y, w, h } = g;
  const sx = (v: number) => x + ((v - g.xmin) / (g.xmax - g.xmin)) * w;
  const sy = (v: number) => y + h - ((v - g.ymin) / (g.ymax - g.ymin)) * h;
  ctx.save();
  ctx.fillStyle = "#fff";
  ctx.fillRect(x, y, w, h);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const fs = g.fs ?? 12;
  ctx.font = `${fs}px system-ui, sans-serif`;
  const gx = g.gx && g.gx > 0 ? g.gx : niceStep(g.xmax - g.xmin), gy = g.gy && g.gy > 0 ? g.gy : niceStep(g.ymax - g.ymin);
  ctx.lineWidth = 1;
  for (let v = Math.ceil(g.xmin / gx) * gx; v <= g.xmax; v += gx) {
    ctx.strokeStyle = "#e3e6ea";
    ctx.beginPath(); ctx.moveTo(sx(v), y); ctx.lineTo(sx(v), y + h); ctx.stroke();
  }
  for (let v = Math.ceil(g.ymin / gy) * gy; v <= g.ymax; v += gy) {
    ctx.strokeStyle = "#e3e6ea";
    ctx.beginPath(); ctx.moveTo(x, sy(v)); ctx.lineTo(x + w, sy(v)); ctx.stroke();
  }
  if (g.ineqs?.length) { // region where every inequality holds, sampled on a coarse grid
    const qs = g.ineqs.flatMap((s) => { try { return [parseIneq(s)]; } catch { return []; } });
    if (qs.length) {
      ctx.fillStyle = "rgba(216,27,138,0.25)";
      const cell = 4;
      for (let py = 0; py < h; py += cell) for (let px = 0; px < w; px += cell) {
        const mx = g.xmin + ((px + cell / 2) / w) * (g.xmax - g.xmin), my = g.ymax - ((py + cell / 2) / h) * (g.ymax - g.ymin);
        if (inRegion(qs, mx, my)) ctx.fillRect(x + px, y + py, cell, cell);
      }
    }
  }
  ctx.strokeStyle = "#222"; ctx.fillStyle = "#444"; ctx.lineWidth = 1.5;
  const ax = Math.min(Math.max(sx(0), x), x + w), ay = Math.min(Math.max(sy(0), y), y + h);
  ctx.beginPath(); ctx.moveTo(x, ay); ctx.lineTo(x + w, ay); ctx.moveTo(ax, y); ctx.lineTo(ax, y + h); ctx.stroke();
  const fix = (v: number) => String(+v.toPrecision(6));
  for (let v = Math.ceil(g.xmin / gx) * gx; v <= g.xmax; v += gx) if (Math.abs(v) > gx / 1e3) ctx.fillText(fix(v), sx(v) + 2, Math.min(ay + 13, y + h - 3));
  for (let v = Math.ceil(g.ymin / gy) * gy; v <= g.ymax; v += gy) if (Math.abs(v) > gy / 1e3) ctx.fillText(fix(v), Math.min(ax + 3, x + w - 30), sy(v) - 3);
  if (g.shade && g.fns[g.shade.fn]) {
    // Region between the curve and the x-axis (the region that is spun to make a solid of revolution).
    try {
      const f = compile(g.fns[g.shade.fn]);
      ctx.fillStyle = GRAPH_COLORS[g.shade.fn % GRAPH_COLORS.length]; ctx.globalAlpha = 0.22;
      ctx.beginPath(); ctx.moveTo(sx(g.shade.a), sy(0));
      const n = 160;
      for (let i = 0; i <= n; i++) { const v = g.shade.a + ((g.shade.b - g.shade.a) * i) / n, y = f(v); ctx.lineTo(sx(v), sy(Number.isFinite(y) ? y : 0)); }
      ctx.lineTo(sx(g.shade.b), sy(0)); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    } catch { /* invalid expression: nothing to shade */ }
  }
  g.fns.forEach((src, i) => {
    let f: (n: number) => number;
    try { f = compile(src); } catch { return; }
    ctx.strokeStyle = GRAPH_COLORS[i % GRAPH_COLORS.length];
    ctx.lineWidth = g.lw ?? 2.2;
    ctx.beginPath();
    let pen = false, prev = NaN;
    const N = Math.max(200, Math.floor(w * 2));
    const jump = h * 1.5;
    for (let k = 0; k <= N; k++) {
      const v = f(g.xmin + ((g.xmax - g.xmin) * k) / N);
      if (!Number.isFinite(v)) { pen = false; continue; }
      const py = sy(v), px = x + (w * k) / N;
      if (pen && Math.abs(py - prev) > jump) pen = false; // asymptote
      if (pen) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      pen = true; prev = py;
    }
    ctx.stroke();
  });
  // points on the graph: dot, dashed guides to the axes and the coordinates
  for (const q of g.pts ?? []) {
    const yv = evalFn(g.fns[q.fn] ?? "", q.x);
    if (!Number.isFinite(yv)) continue;
    const col = GRAPH_COLORS[q.fn % GRAPH_COLORS.length], px = sx(q.x), py = sy(yv);
    if (q.guides !== false) {
      ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, ay); ctx.moveTo(px, py); ctx.lineTo(ax, py); ctx.stroke(); ctx.restore();
    }
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#26151f"; ctx.font = `italic ${fs + 1}px serif`;
    ctx.fillText(pointLabel(q.name, q.x, yv), px + 7, py - 7);
  }
  if (g.legend) {
    ctx.font = `${fs}px system-ui, sans-serif`;
    const rows = g.fns.map((src, i) => g.names?.[i] || `y = ${src}`);
    const bw = Math.max(...rows.map((s) => ctx.measureText(s).width)) + 44, bh = rows.length * (fs + 8) + 8;
    ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.strokeStyle = "#c9d0dc"; ctx.lineWidth = 1;
    ctx.fillRect(x + 8, y + 8, bw, bh); ctx.strokeRect(x + 8, y + 8, bw, bh);
    rows.forEach((s, i) => {
      const yy = y + 8 + 8 + i * (fs + 8) + fs / 2;
      ctx.strokeStyle = GRAPH_COLORS[i % GRAPH_COLORS.length]; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x + 14, yy); ctx.lineTo(x + 34, yy); ctx.stroke();
      ctx.fillStyle = "#26151f"; ctx.fillText(s, x + 40, yy + fs / 3);
    });
  }
  ctx.restore();
  ctx.strokeStyle = "#222"; ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
}

function geoStroke(ctx: CanvasRenderingContext2D, helper: boolean) {
  ctx.save();
  ctx.strokeStyle = helper ? "#8a7a84" : "#26151f"; ctx.lineWidth = helper ? 1.6 : 2.5; ctx.lineJoin = "round"; ctx.lineCap = "round";
  if (helper) ctx.setLineDash([6, 5]);
}

function drawAngle(ctx: CanvasRenderingContext2D, page: Page, o: { a: string; b: string; c: string; mark: "arc" | "right" | "equal"; n?: number }) {
  const a = findPoint(page, o.a), b = findPoint(page, o.b), c = findPoint(page, o.c);
  if (!a || !b || !c) return;
  const a1 = Math.atan2(a.y - b.y, a.x - b.x), a2 = Math.atan2(c.y - b.y, c.x - b.x);
  let diff = a2 - a1;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff <= -Math.PI) diff += 2 * Math.PI;
  ctx.save();
  ctx.strokeStyle = "#c0392b"; ctx.fillStyle = "#c0392b"; ctx.lineWidth = 2;
  if (o.mark === "right" || Math.abs(Math.abs(diff) - Math.PI / 2) < 0.002 && o.mark !== "equal") {
    const u = [Math.cos(a1) * 18, Math.sin(a1) * 18], v = [Math.cos(a2) * 18, Math.sin(a2) * 18];
    if (o.mark === "right") { ctx.beginPath(); ctx.moveTo(b.x + u[0], b.y + u[1]); ctx.lineTo(b.x + u[0] + v[0], b.y + u[1] + v[1]); ctx.lineTo(b.x + v[0], b.y + v[1]); ctx.stroke(); ctx.restore(); return; }
  }
  const n = o.mark === "equal" ? o.n ?? 1 : 1;
  for (let i = 0; i < n; i++) { ctx.beginPath(); ctx.arc(b.x, b.y, 24 + i * 6, a1, a1 + diff, diff < 0); ctx.stroke(); }
  if (o.mark === "arc") {
    const mid = a1 + diff / 2, deg = angleAt([a.x, a.y], [b.x, b.y], [c.x, c.y]);
    ctx.font = "italic 17px serif"; ctx.fillStyle = "#26151f"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(`${+deg.toFixed(1)}°`, b.x + Math.cos(mid) * 46, b.y + Math.sin(mid) * 46);
  }
  ctx.restore();
}

function drawInst(ctx: CanvasRenderingContext2D, o: Inst) {
  ctx.save();
  ctx.translate(o.x, o.y); ctx.rotate(o.rot);
  ctx.strokeStyle = "#6b5a2a"; ctx.fillStyle = "rgba(255, 226, 140, 0.45)"; ctx.lineWidth = 1.4; ctx.lineJoin = "round";
  ctx.font = "11px system-ui, sans-serif"; ctx.textAlign = "center";
  if (o.kind === "ruler") {
    ctx.fillRect(0, 0, o.s, RULER_H); ctx.strokeRect(0, 0, o.s, RULER_H);
    ctx.beginPath();
    for (const tk of rulerTicks(o.s)) { ctx.moveTo(tk.x, 0); ctx.lineTo(tk.x, tk.h * 0.9); }
    ctx.stroke(); ctx.fillStyle = "#4a3f1c";
    for (const tk of rulerTicks(o.s)) if (tk.label !== undefined && tk.label > 0) ctx.fillText(String(tk.label), tk.x, 34);
    void MM;
  } else if (o.kind === "square") {
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(o.s, 0); ctx.lineTo(0, o.s); ctx.closePath(); ctx.fill(); ctx.stroke();
    const k = o.s * 0.28; ctx.beginPath(); ctx.moveTo(k, k * 0.4); ctx.lineTo(o.s - k * 1.7, k * 0.4); ctx.lineTo(k, o.s - k * 1.7); ctx.closePath(); ctx.stroke();
  } else if (o.kind === "protractor") {
    ctx.beginPath(); ctx.moveTo(-o.s, 0); ctx.arc(0, 0, o.s, Math.PI, 2 * Math.PI); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    for (const tk of protractorTicks()) { const a = -(tk.deg * Math.PI) / 180; ctx.moveTo(Math.cos(a) * o.s, Math.sin(a) * o.s); ctx.lineTo(Math.cos(a) * (o.s - tk.h), Math.sin(a) * (o.s - tk.h)); }
    ctx.stroke(); ctx.fillStyle = "#4a3f1c";
    for (const tk of protractorTicks()) if (tk.label !== undefined) { const a = -(tk.deg * Math.PI) / 180; ctx.fillText(String(tk.label), Math.cos(a) * (o.s - 28), Math.sin(a) * (o.s - 28) + 4); }
    ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.moveTo(0, -8); ctx.lineTo(0, 8); ctx.stroke();
  } else {
    ctx.strokeStyle = "#444"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fillStyle = "#e7e7ee"; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(o.s, 0); ctx.stroke();
    ctx.beginPath(); ctx.arc(o.s, 0, 5, 0, Math.PI * 2); ctx.fillStyle = "#c0392b"; ctx.fill();
    ctx.setLineDash([3, 5]); ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.arc(0, 0, o.s, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

export function drawObject(ctx: CanvasRenderingContext2D, page: Page, o: Obj, opts: DrawOpts) {
  switch (o.t) {
    case "stroke": drawStroke(ctx, o); break;
    case "line": drawLine(ctx, o); break;
    case "text": drawText(ctx, o); break;
    case "image": drawImageObj(ctx, o, opts.onAsync); break;
    case "fill": ctx.fillStyle = o.color; for (let i = 0; i < o.runs.length; i += 3) ctx.fillRect(o.runs[i + 1], o.runs[i], o.runs[i + 2] - o.runs[i + 1] + 1, 1.5); break; // 1.5 high: rows overlap, so no hairline gaps at fractional zoom
    case "formula": {
      const fi = formulaImage(o.latex, o.color, o.size, opts.onAsync);
      if (fi) { ctx.drawImage(fi.img, o.x, o.y, fi.w, fi.h); formulaSize.set(o.id, { w: fi.w, h: fi.h }); }
      else { ctx.fillStyle = "#999"; ctx.font = "16px sans-serif"; ctx.fillText("…", o.x, o.y + 16); }
      break;
    }
    case "graph": drawGraph(ctx, o); break;
    case "shape": drawShape(ctx, o); break;
    case "solid": drawSolid(ctx, o, opts.pending?.id === o.id ? opts.pending.mark : null); break;
    case "net": drawNet(ctx, o); break;
    case "revolve": drawRevolve(ctx, o); break;
    case "fold": drawFold(ctx, o); break;
    case "gseg": {
      if (o.helper && page.hideHelpers) break;
      const a = findPoint(page, o.a), b = findPoint(page, o.b);
      if (a && b) { geoStroke(ctx, !!o.helper); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore(); }
      break;
    }
    case "gcircle": {
      if (o.helper && page.hideHelpers) break;
      const c = findPoint(page, o.c), p = findPoint(page, o.p);
      if (c && p) { geoStroke(ctx, !!o.helper); ctx.beginPath(); ctx.arc(c.x, c.y, Math.hypot(p.x - c.x, p.y - c.y), 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
      break;
    }
    case "gline": {
      if (o.helper && page.hideHelpers) break;
      const l = lineOf(page, o.id);
      if (l) { const far = 5000; geoStroke(ctx, !!o.helper); ctx.beginPath(); ctx.moveTo(l.p[0] - (o.ray ? 0 : l.d[0] * far), l.p[1] - (o.ray ? 0 : l.d[1] * far)); ctx.lineTo(l.p[0] + l.d[0] * far, l.p[1] + l.d[1] * far); ctx.stroke(); ctx.restore(); }
      break;
    }
    case "gpoly": {
      const ps = o.pts.map((i) => findPoint(page, i));
      if (ps.length > 2 && ps.every((p) => p)) {
        geoStroke(ctx, false); ctx.beginPath(); ps.forEach((p, i) => (i ? ctx.lineTo(p!.x, p!.y) : ctx.moveTo(p!.x, p!.y))); ctx.closePath();
        if (o.fill) { ctx.globalAlpha = 0.12; ctx.fillStyle = "#26151f"; ctx.fill(); ctx.globalAlpha = 1; }
        ctx.stroke(); ctx.restore();
      }
      break;
    }
    case "gangle": drawAngle(ctx, page, o); break;
    case "gmark": {
      const sg = page.objects.find((q) => q.id === o.seg);
      const ln = sg?.t === "gseg" ? [findPoint(page, sg.a), findPoint(page, sg.b)] : null;
      if (ln && ln[0] && ln[1]) {
        const mx = (ln[0].x + ln[1].x) / 2, my = (ln[0].y + ln[1].y) / 2, d = Math.hypot(ln[1].x - ln[0].x, ln[1].y - ln[0].y) || 1, ux = (ln[1].x - ln[0].x) / d, uy = (ln[1].y - ln[0].y) / d;
        ctx.save(); ctx.strokeStyle = "#26151f"; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.beginPath();
        for (let i = 0; i < o.n; i++) { const off = (i - (o.n - 1) / 2) * 7, cx = mx + ux * off, cy = my + uy * off; ctx.moveTo(cx - uy * 8, cy + ux * 8); ctx.lineTo(cx + uy * 8, cy - ux * 8); }
        ctx.stroke(); ctx.restore();
      }
      break;
    }
    case "inst": drawInst(ctx, o); break;
    case "gpoint": {
      if (o.helper && page.hideHelpers) break;
      if (!o.hideDot) { ctx.fillStyle = o.def ? "#d81b8a" : "#c0392b"; ctx.beginPath(); ctx.arc(o.x, o.y, 5, 0, Math.PI * 2); ctx.fill(); }
      if (!o.hideName && !page.hideNames) { ctx.fillStyle = "#26151f"; ctx.font = "italic 20px serif"; ctx.fillText(o.label, o.x + 8, o.y - 8); }
      break;
    }
  }
}

function drawSelection(ctx: CanvasRenderingContext2D, sel: Obj, b: [number, number, number, number]) {
  ctx.strokeStyle = THEME.accent; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
  if (sel.t === "shape") {
    ctx.save();
    ctx.translate(sel.x + sel.w / 2, sel.y + sel.h / 2); ctx.rotate(sel.rot);
    ctx.strokeRect(-sel.w / 2 - 4, -sel.h / 2 - 4, sel.w + 8, sel.h + 8);
    ctx.restore();
  } else ctx.strokeRect(b[0] - 4, b[1] - 4, b[2] + 8, b[3] + 8);
  ctx.setLineDash([]);
  const h = handlesOf(sel);
  if (!h) return;
  const dot = (p: { x: number; y: number }, fill: string) => {
    ctx.fillStyle = fill; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  };
  if (!Number.isNaN(h.rot.x)) {
    ctx.strokeStyle = THEME.accent; ctx.lineWidth = 1.5;
    if (sel.t === "line") { dot(h.rot, THEME.accent); dot(h.size, THEME.accent); return; } // both ends are draggable
    let from = { x: h.rot.x, y: h.rot.y + 30 };
    if (sel.t === "shape") { const c = Math.cos(sel.rot), s = Math.sin(sel.rot); from = { x: h.rot.x - 30 * s, y: h.rot.y + 30 * c }; }
    else if (sel.t === "inst") { from = { x: sel.x, y: sel.y }; }
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(h.rot.x, h.rot.y); ctx.stroke();
    dot(h.rot, sel.t === "solid" || sel.t === "revolve" || sel.t === "fold" || sel.t === "inst" ? "#e07b00" : THEME.accent);
  }
  dot(h.size, "#2a9d3a");
}

export function drawPaper(ctx: CanvasRenderingContext2D, page: Page, onAsync: () => void) {
  const { w, h } = pageDims(page.paper);
  const color = page.paper?.color ?? "#ffffff";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  if (page.paper && page.paper.type !== "plain") {
    const m = paperMarks(page.paper), gc = gridColor(color, page.paper.type);
    ctx.strokeStyle = gc; ctx.lineWidth = 1; ctx.beginPath();
    for (const [x1, y1, x2, y2] of m.lines) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
    ctx.stroke();
    if (m.margins.length) { ctx.strokeStyle = page.paper.type === "notebook" ? NOTEBOOK_MARGIN : "#e29a9a"; ctx.lineWidth = 1.3; ctx.beginPath(); for (const g of m.margins) { ctx.moveTo(g[0], g[1]); ctx.lineTo(g[2], g[3]); } ctx.stroke(); }
    if (m.dots.length) { ctx.fillStyle = gc; ctx.beginPath(); for (const [x, y] of m.dots) { ctx.moveTo(x + 1.8, y); ctx.arc(x, y, 1.8, 0, Math.PI * 2); } ctx.fill(); }
  }
  if (page.bg) {
    const img = getImage(page.bg, onAsync);
    if (img) { const k = Math.min(w / img.width, h / img.height), iw = img.width * k, ih = img.height * k; ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih); }
  }
}

/** Draw a whole page (paper + background + objects) at `scale` device pixels per page unit. */
export function drawPage(ctx: CanvasRenderingContext2D, page: Page, scale: number, opts: DrawOpts) {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  resolveGeo(page);
  drawPaper(ctx, page, opts.onAsync);
  for (const o of page.objects) drawObject(ctx, page, o, opts);
  for (const id of opts.multi ?? []) {
    const o = page.objects.find((q) => q.id === id), b = o ? boundsOf(o, page) : null;
    if (b) { ctx.strokeStyle = THEME.accent; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]); ctx.strokeRect(b[0] - 3, b[1] - 3, b[2] + 6, b[3] + 6); ctx.setLineDash([]); }
  }
  const sel = opts.selected ? page.objects.find((o) => o.id === opts.selected) : null;
  const b = sel ? boundsOf(sel, page) : null;
  if (sel && b && sel.t !== "fill") drawSelection(ctx, sel, b);
  ctx.restore();
}
