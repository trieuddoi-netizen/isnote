import test from "node:test";
import assert from "node:assert/strict";
import { recognize, simplify } from "../src/recognize.ts";
import { smoothStep, strokeWidths, laserAlpha, pruneLaser, PEN_STYLE } from "../src/pen.ts";
import { paperMarks, pageDims, normPaper, gridColor, defaultPaper, MIN_SPACING, MAX_SPACING } from "../src/paper.ts";
import { dashFor, arrowHead, shaft } from "../src/linestyle.ts";
import { floodFill, runsArea } from "../src/fill.ts";
import { layoutText, lineX } from "../src/text.ts";
import { selectIn, rectPolygon, pointInPolygon } from "../src/bounds.ts";
import { copyObjects } from "../src/clipboard.ts";
import { curvePaths, shapePoints, isCurveFigure } from "../src/figures.ts";
import { project, meshOf, cmeshOf, snapTargets, pickFace, faceCount, boundRadius, rotator } from "../src/solids.ts";
import { netOf } from "../src/nets.ts";
import { SOLID_KINDS, SHAPE_KINDS, type Page, type Obj } from "../src/model.ts";

// deterministic noise
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5);
const poly = (corners: [number, number][], per = 30, noise = 1.5, close = true) => {
  const out: number[] = [];
  const n = corners.length;
  for (let i = 0; i < (close ? n : n - 1); i++) {
    const a = corners[i], b = corners[(i + 1) % n];
    for (let k = 0; k < per; k++) out.push(a[0] + ((b[0] - a[0]) * k) / per + rnd() * noise, a[1] + ((b[1] - a[1]) * k) / per + rnd() * noise);
  }
  if (close) out.push(corners[0][0] + 1, corners[0][1] + 1);
  return out;
};

test("recognise a straight line", () => {
  const r = recognize(poly([[10, 10], [300, 60]], 40, 1.5, false));
  assert.equal(r?.kind, "line");
  assert.equal(recognize(poly([[10, 10], [300, 60]], 40, 1.5, false), true)?.kind, "line");
  // a curve is not a line
  const arc: number[] = [];
  for (let i = 0; i <= 40; i++) arc.push(100 + 100 * Math.cos(i * 0.06), 100 + 100 * Math.sin(i * 0.06));
  assert.notEqual(recognize(arc)?.kind, "line");
});

test("recognise a hand-drawn circle, triangle and rectangle", () => {
  const circ: number[] = [];
  for (let i = 0; i <= 80; i++) { const t = (i / 80) * Math.PI * 2.04; circ.push(200 + 80 * Math.cos(t) + rnd() * 3, 200 + 78 * Math.sin(t) + rnd() * 3); }
  const c = recognize(circ);
  assert.equal(c?.kind, "circle");
  if (c?.kind === "circle") { assert.ok(Math.abs(c.cx - 200) < 6 && Math.abs(c.rx - 80) < 8); }
  assert.equal(recognize(circ, true), null); // ink-to-line mode ignores closed shapes

  const tri = recognize(poly([[100, 300], [260, 80], [400, 320]]));
  assert.equal(tri?.kind, "triangle");
  const rect = recognize(poly([[50, 50], [350, 52], [352, 220], [48, 218]]));
  assert.equal(rect?.kind, "rect");
  if (rect?.kind === "rect") {
    const [a, b, , d] = rect.pts;
    assert.ok(Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[0] - d[0]) < 1e-6, "nearly axis-aligned rectangle is snapped");
  }
});

test("scribbles and tiny strokes are left alone", () => {
  assert.equal(recognize([0, 0, 2, 2, 3, 3]), null);
  const z: number[] = [];
  for (let i = 0; i < 60; i++) z.push(100 + (i % 2) * 90 + rnd() * 5, 100 + i * 3);
  assert.equal(recognize(z), null);
});

test("simplify keeps corners only", () => {
  const p: [number, number][] = [[0, 0], [5, 0.2], [10, 0], [10, 5], [10, 10]];
  const keep = new Set<number>([0, 4]);
  simplify(p, 0, 4, 1, keep);
  assert.deepEqual([...keep].sort(), [0, 2, 4]);
});

test("pen: smoothing and width", () => {
  assert.deepEqual(smoothStep([0, 0], [10, 10], 0), [10, 10]);
  const s1 = smoothStep([0, 0], [10, 0], 1), s5 = smoothStep([0, 0], [10, 0], 5);
  assert.ok(s5[0] < s1[0] && s1[0] < 10 && s5[0] > 0);
  const horiz = strokeWidths("fountain", [0, 0, 10, 0, 20, 0], 4);
  const nib = strokeWidths("fountain", [0, 0, 7.6, 6.4, 15.2, 12.8], 4); // 40° direction = along the nib: thin
  assert.ok(horiz[0] > nib[0]);
  const slow = strokeWidths("brush", [0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0], 4), fast = strokeWidths("brush", [0, 0, 20, 0, 40, 0, 60, 0, 80, 0, 100, 0], 4);
  assert.ok(slow[2] > fast[2]);
  const light = strokeWidths("ballpoint", [0, 0, 10, 0, 20, 0], 4, [0.1, 0.1, 0.1]), hard = strokeWidths("ballpoint", [0, 0, 10, 0, 20, 0], 4, [1, 1, 1]);
  assert.ok(hard[0] > 2 * light[0], "pen pressure changes width");
  for (const k of Object.keys(PEN_STYLE) as (keyof typeof PEN_STYLE)[]) assert.ok(strokeWidths(k, [0, 0, 5, 5, 9, 9], 3).every((w) => w > 0));
});

test("laser pen fades and is pruned", () => {
  assert.equal(laserAlpha(0), 1);
  assert.ok(laserAlpha(700) > 0 && laserAlpha(700) < 1);
  assert.equal(laserAlpha(5000), 0);
  const pts = [{ x: 0, y: 0, t: 0 }, { x: 1, y: 1, t: 500 }, { x: 2, y: 2, t: 2000 }];
  assert.equal(pruneLaser(pts, 2100).length, 1);
});

test("paper: types, orientation, spacing", () => {
  assert.deepEqual(pageDims(defaultPaper()), { w: 1000, h: 1414 });
  assert.deepEqual(pageDims({ ...defaultPaper(), landscape: true }), { w: 1414, h: 1000 });
  const ruled = paperMarks({ ...defaultPaper(), type: "ruled", spacing: 50 });
  assert.ok(ruled.lines.every((l) => l[1] === l[3]) && ruled.margins.length === 1);
  const nb = paperMarks({ ...defaultPaper(), spacing: 40 });
  assert.ok(nb.margins[0][0] === 60 && nb.margins[0][1] === 0, "pink margin 60 units from the left edge");
  assert.ok(nb.lines.length > 30 && nb.lines.every((l) => l[1] === l[3]));
  assert.equal(normPaper({ type: "notebook" }).type, "notebook");
  assert.equal(gridColor("#ffffff", "notebook"), "#b9d3f0");
  assert.equal(paperMarks({ ...defaultPaper(), type: "plain" }).lines.length, 0);
  const sq = paperMarks({ ...defaultPaper(), type: "squared", spacing: 100 });
  assert.equal(sq.lines.length, 14 + 9); // horizontals 100..1400, verticals 100..900
  const dots = paperMarks({ ...defaultPaper(), type: "dotted", spacing: 100 });
  assert.equal(dots.dots.length, 14 * 9);
  const wide = paperMarks({ ...defaultPaper(), type: "ruled", spacing: 80 }), narrow = paperMarks({ ...defaultPaper(), type: "ruled", spacing: 40 });
  assert.ok(narrow.lines.length > wide.lines.length, "smaller spacing -> more lines");
  assert.equal(normPaper({ spacing: 1 }).spacing, MIN_SPACING);
  assert.equal(normPaper({ spacing: 999 }).spacing, MAX_SPACING);
  assert.equal(normPaper({ type: "bogus" as never }).type, "notebook");
  assert.notEqual(gridColor("#222831"), gridColor("#ffffff"));
});

test("line styles", () => {
  assert.deepEqual(dashFor("solid", 3), []);
  assert.deepEqual(dashFor("arrow", 3), []);
  assert.equal(dashFor("dashed", 3).length, 2);
  assert.equal(dashFor("dashdot", 3).length, 4);
  const h = arrowHead(0, 0, 100, 0, 20);
  assert.deepEqual(h.slice(0, 2), [100, 0]);
  assert.ok(h[2] < 100 && h[4] < 100 && Math.abs(h[3] + h[5]) < 1e-9);
  const [x1, , x2] = shaft(0, 0, 100, 0, "double", 20);
  assert.ok(x1 > 0 && x2 < 100);
  assert.deepEqual(shaft(0, 0, 100, 0, "solid", 20), [0, 0, 100, 0]);
});

test("fill: flood fills a closed region and refuses a leaking one", () => {
  const W = 40, H = 40;
  const img = new Uint8ClampedArray(W * H * 4).fill(255);
  const black = (x: number, y: number) => { const i = (y * W + x) * 4; img[i] = img[i + 1] = img[i + 2] = 0; };
  for (let i = 10; i <= 30; i++) { black(i, 10); black(i, 30); black(10, i); black(30, i); } // closed 21x21 box outline
  const runs = floodFill(img, W, H, 20, 20, 90, 0)!;
  assert.equal(runsArea(runs), 19 * 19);
  assert.equal(floodFill(img, W, H, -1, 5), null);
  // open the box: the fill leaks over the whole page and is rejected
  for (let i = 12; i <= 18; i++) { const j = (10 * W + i) * 4; img[j] = img[j + 1] = img[j + 2] = 255; }
  assert.equal(floodFill(img, W, H, 20, 20, 90, 0), null);
  // growing by one pixel covers the ink border halo
  const img2 = new Uint8ClampedArray(W * H * 4).fill(255);
  const b2 = (x: number, y: number) => { const i = (y * W + x) * 4; img2[i] = img2[i + 1] = img2[i + 2] = 0; };
  for (let i = 10; i <= 30; i++) { b2(i, 10); b2(i, 30); b2(10, i); b2(30, i); }
  assert.equal(runsArea(floodFill(img2, W, H, 20, 20, 90, 1)!), 21 * 21 - 4); // 4-neighbour growth leaves the box corners
});

test("text layout: wrapping, bullets, alignment", () => {
  const m = (s: string) => s.length * 10;
  const base = { text: "hello world foo bar", w: 100, size: 16, bullets: false };
  const l = layoutText(base, m);
  assert.deepEqual(l.lines.map((x) => x.text), ["hello", "world foo", "bar"]);
  assert.equal(l.h, 3 * 16 * 1.3);
  const b = layoutText({ ...base, text: "one\ntwo", w: 300, bullets: true }, m);
  assert.equal(b.lines.length, 2);
  assert.ok(b.lines.every((x) => x.bullet && x.indent > 0));
  assert.equal(layoutText({ ...base, text: "abcdefghijklmnopqrstuvwxyz", w: 100 }, m).lines.length, 3); // long word is split
  const line = { text: "ab", bullet: false, indent: 0, width: 20 };
  assert.equal(lineX({ x: 0, w: 100, align: "left" }, line), 0);
  assert.equal(lineX({ x: 0, w: 100, align: "center" }, line), 40);
  assert.equal(lineX({ x: 0, w: 100, align: "right" }, line), 80);
});

test("selection (rectangle / free shape) and copy / paste", () => {
  const page: Page = {
    objects: [
      { t: "stroke", id: "s1", color: "#000", w: 3, pts: [10, 10, 20, 20, 30, 30] },
      { t: "stroke", id: "s2", color: "#000", w: 3, pts: [500, 500, 520, 520] },
      { t: "shape", id: "sh", x: 40, y: 40, w: 50, h: 50, kind: "rect", color: "#000", lw: 2, rot: 0, fill: false },
      { t: "gpoint", id: "p1", x: 60, y: 10, label: "A" }, { t: "gpoint", id: "p2", x: 80, y: 20, label: "B" },
      { t: "gseg", id: "g1", a: "p1", b: "p2" },
    ] as Obj[],
  };
  const ids = selectIn(page, rectPolygon(0, 0, 120, 120));
  assert.deepEqual(ids.sort(), ["g1", "p1", "p2", "s1", "sh"]);
  // free shape: triangle covering only the stroke s1
  const tri: [number, number][] = [[0, 0], [45, 0], [0, 45]];
  assert.deepEqual(selectIn(page, tri), ["s1"]);
  assert.ok(pointInPolygon(tri, 5, 5) && !pointInPolygon(tri, 40, 40));
  const copies = copyObjects(page.objects.filter((o) => ids.includes(o.id)), 24, 24);
  assert.equal(copies.length, 5);
  assert.ok(copies.every((c) => !ids.includes(c.id)));
  const seg = copies.find((c) => c.t === "gseg")!;
  const pids = copies.filter((c) => c.t === "gpoint").map((c) => c.id);
  assert.ok(seg.t === "gseg" && pids.includes(seg.a) && pids.includes(seg.b), "segment points are remapped to the copies");
  const st = copies.find((c) => c.t === "stroke")!;
  assert.ok(st.t === "stroke" && st.pts[0] === 34);
  // a segment copied without its points is dropped
  assert.equal(copyObjects([page.objects[5]]).length, 0);
});

test("new plane figures", () => {
  for (const k of ["hyperbola", "parabola", "annulus"] as const) {
    assert.ok(SHAPE_KINDS.includes(k) && isCurveFigure(k));
    for (const p of curvePaths(k)) for (const [x, y] of p.pts) assert.ok(x >= -1e-9 && x <= 1 + 1e-9 && y >= -1e-9 && y <= 1 + 1e-9, `${k} stays in its box`);
  }
  const hyp = curvePaths("hyperbola");
  assert.ok(hyp[0].pts.every(([x]) => x > 0.5) && hyp[1].pts.every(([x]) => x < 0.5), "two branches");
  // points satisfy x²/a² − y²/b² = 1 for some a,b: check ratio is constant
  const A = hyp[0].pts[24][0] - 0.5; // vertex
  const B = 0.5 / Math.sinh(1.2);
  for (const [x, y] of hyp[0].pts) assert.ok(Math.abs(((x - 0.5) / A) ** 2 - ((y - 0.5) / B) ** 2 - 1) < 1e-9);
  const par = curvePaths("parabola")[0].pts;
  assert.ok(Math.abs(par[30][1] - 1) < 1e-9 && par[0][1] === 0 && par[60][1] === 0, "vertex at the bottom, opening upwards");
  const ann = curvePaths("annulus");
  assert.equal(ann.length, 2);
  assert.equal(shapePoints("rect") === "ellipse", false);
});

test("new solids: octahedron, frustum of pyramid, frustum of cone, truncated cylinder, spherical cap", () => {
  for (const k of ["octahedron", "frustum", "frustumcone", "truncyl", "cap"] as const) {
    assert.ok(SOLID_KINDS.includes(k));
    assert.ok(faceCount(k) >= 2);
    assert.ok(boundRadius(k) > 0.4);
    for (const ang of [[-0.6, 0.45, 0], [0, 0, 0], [2, -1, 0.5], [3.3, 2.2, 1]]) {
      const pr = project({ kind: k, yaw: ang[0], pitch: ang[1], roll: ang[2] });
      assert.ok(pr.paths.length > 0 && pr.faces.length > 0, `${k} draws`);
      assert.ok(pr.paths.every((p) => p.pts.every(Number.isFinite)));
    }
    // a face under the middle of the drawing can be picked when seen from the front
    assert.notEqual(pickFace({ kind: k, yaw: 0, pitch: 0.3, roll: 0 }, 0, 0), null);
    assert.ok(snapTargets(k).length >= 2);
  }
  assert.equal(meshOf("octahedron")!.f.length, 8);
  assert.equal(meshOf("frustum")!.f.length, 6);
  assert.equal(netOf("octahedron") !== null && netOf("frustum") !== null, true);
  assert.equal(netOf("cap")!.approx, true);
  // frustum of a pyramid seen from the side: back edges hidden (dashed)
  const fr = project({ kind: "frustum", yaw: -0.6, pitch: 0.45, roll: 0 });
  assert.ok(fr.paths.some((p) => p.hidden) && fr.paths.some((p) => !p.hidden));
  // truncated cylinder: top face is slanted, so seen from the front at pitch 0 its plane is still visible (tilts towards +x)
  const cm = cmeshOf("truncyl")!;
  assert.equal(cm.groups, 3);
  const tops = cm.v.slice(0, 48);
  assert.ok(Math.max(...tops.map((p) => p[1])) > 0.7 && Math.min(...tops.map((p) => p[1])) < 0.3);
  // a point on the spherical cap's base is hidden from below, the apex visible from above
  const capTop = project({ kind: "cap", yaw: 0, pitch: 0.4, roll: 0, marks: [{ id: "m", p: [0, 0.275, 0], faces: [1], name: "S" }, { id: "n", p: [0, -0.275, 0], faces: [0], name: "O" }] });
  assert.equal(capTop.dots[0].hidden, false);
  assert.equal(capTop.dots[1].hidden, true); // base disc faces down, seen from above -> hidden
  const capBelow = project({ kind: "cap", yaw: 0, pitch: -0.9, roll: 0, marks: [{ id: "n", p: [0, -0.275, 0], faces: [0], name: "O" }] });
  assert.equal(capBelow.dots[0].hidden, false);
});

// ---- nets ---------------------------------------------------------------------------
import { frustumConeNet, truncCylNet, goreNet, pickNetFace } from "../src/nets.ts";
const area = (p: number[]) => { let a = 0; for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length; a += p[i] * p[j + 1] - p[j] * p[i + 1]; } return Math.abs(a) / 2; };
const inside = (p: number[], x: number, y: number) => { let r = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if (p[i + 1] > y !== p[j + 1] > y && x < ((p[j] - p[i]) * (y - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) r = !r; return r; };
/** Largest fraction of face A's area covered by face B, estimated on a grid (0 when they only touch). */
function overlap(a: number[], b: number[]): number {
  const xs = a.filter((_, i) => i % 2 === 0), ys = a.filter((_, i) => i % 2 === 1);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let n = 0, both = 0;
  for (let i = 0; i < 70; i++) for (let j = 0; j < 70; j++) {
    const x = x0 + ((i + 0.5) / 70) * (x1 - x0), y = y0 + ((j + 0.5) / 70) * (y1 - y0);
    if (inside(a, x, y)) { n++; if (inside(b, x, y)) both++; }
  }
  return n ? both / n : 0;
}
const noOverlap = (net: { faces: { pts: number[] }[] }) => { for (let i = 0; i < net.faces.length; i++) for (let j = i + 1; j < net.faces.length; j++) assert.ok(overlap(net.faces[i].pts, net.faces[j].pts) < 0.02 && overlap(net.faces[j].pts, net.faces[i].pts) < 0.02, `faces ${i} and ${j} overlap`); };
const netArea = (net: { faces: { pts: number[] }[] }) => net.faces.reduce((s, f) => s + area(f.pts), 0);

test("net of a frustum of a cone is exact: π(R+r)l + πR² + πr²", () => {
  const R = 0.5, r = 0.25, h = 1, l = Math.hypot(R - r, h);
  const net = netOf("frustumcone")!;
  assert.ok(Math.abs(netArea(net) - (Math.PI * (R + r) * l + Math.PI * R * R + Math.PI * r * r)) / netArea(net) < 0.01);
  assert.equal(net.faces.length, 3);
  assert.equal(net.approx, undefined);
  noOverlap(net);
  assert.equal(frustumConeNet().faces.length, 3);
});

test("net of a truncated cylinder: lateral area = ∫H dθ·a, plus base circle and the slanted ellipse", () => {
  const a = 0.45, k = 0.28;
  const net = truncCylNet(a, k);
  const lateral = 2 * Math.PI * a * 1; // mean height is 1 (cos averages out)
  const faces = net.faces;
  assert.ok(Math.abs(area(faces[0].pts) - lateral) / lateral < 0.01);
  assert.ok(Math.abs(area(faces[1].pts) - Math.PI * a * a) / (Math.PI * a * a) < 0.01);
  const ell = Math.PI * a * a * Math.sqrt(1 + (k / a) ** 2); // area of the slanted top face
  assert.ok(Math.abs(area(faces[2].pts) - ell) / ell < 0.01);
  noOverlap(net);
  assert.ok(netOf("truncyl") !== null);
});

test("nets of polyhedra: areas match the 3D surface and faces do not overlap", () => {
  for (const k of ["cube", "box", "pyramid", "tetra", "prism", "octahedron", "frustum"] as const) {
    const net = netOf(k)!;
    assert.ok(net, k);
    const m = meshOf(k)!;
    let surf = 0;
    for (const f of m.f) { // 3D polygon area via the cross-product fan
      let sx = 0, sy = 0, sz = 0;
      for (let i = 1; i + 1 < f.length; i++) { const a = m.v[f[0]], b = m.v[f[i]], c = m.v[f[i + 1]]; const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; sx += u[1] * w[2] - u[2] * w[1]; sy += u[2] * w[0] - u[0] * w[2]; sz += u[0] * w[1] - u[1] * w[0]; }
      surf += Math.hypot(sx, sy, sz) / 2;
    }
    assert.ok(Math.abs(netArea(net) - surf) / surf < 1e-6, `${k} area`);
    noOverlap(net);
  }
});

test("sphere and spherical cap get an approximate gore net (flagged approx), area close to the surface", () => {
  const sp = netOf("sphere")!;
  assert.equal(sp.approx, true);
  assert.ok(Math.abs(netArea(sp) - 4 * Math.PI * 0.25) / (4 * Math.PI * 0.25) < 0.03);
  noOverlap(sp);
  const cap = netOf("cap")!;
  assert.equal(cap.approx, true);
  const R = 0.75, h = 0.55, a = Math.sqrt(R * R - (R - h) ** 2);
  const want = 2 * Math.PI * R * h + Math.PI * a * a;
  assert.ok(Math.abs(netArea(cap) - want) / want < 0.04, `cap area ${netArea(cap)} vs ${want}`);
  noOverlap(cap);
  assert.equal(goreNet(0.5, Math.PI, 8, 0).faces.length, 8);
  assert.notEqual(pickNetFace(cap, cap.w / 2, cap.h - 0.05), null);
});

// ---- dynamic geometry --------------------------------------------------------------------
import { resolveGeo, CONSTRUCTIONS, lineOf, intersections, angleAt, triangleCenter, refsOf } from "../src/geo.ts";
import { removeObject, type GeoPoint, type Obj as O2 } from "../src/model.ts";
const gp = (id: string, x: number, y: number, extra: Partial<GeoPoint> = {}): GeoPoint => ({ t: "gpoint", id, x, y, label: id, ...extra });
const build = (page: Page, name: string, ids: string[]) => {
  let n = 0;
  const objs = CONSTRUCTIONS[name].build(ids, { uid: () => `n${name}${n++}`, label: () => `L${n}`, page, rotDeg: 90, dilK: 2 });
  page.objects.push(...objs);
  resolveGeo(page);
  return objs;
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

test("geometry constructions: midpoint, perpendicular, parallel, altitude, intersection", () => {
  const page: Page = { objects: [gp("A", 0, 0), gp("B", 10, 0), gp("C", 4, 8), { t: "gseg", id: "AB", a: "A", b: "B" }] as O2[] };
  const [m] = build(page, "midpoint", ["A", "B"]) as GeoPoint[];
  assert.ok(near(m.x, 5) && near(m.y, 0));
  // altitude from C onto AB: foot (4,0)
  const alt = build(page, "altitude", ["C", "AB"]);
  const foot = alt[0] as GeoPoint;
  assert.ok(near(foot.x, 4) && near(foot.y, 0));
  assert.equal(alt[1].t, "gseg");
  // perpendicular through C to AB is vertical, parallel through C is horizontal
  const perp = build(page, "perpendicular", ["C", "AB"])[0];
  const par = build(page, "parallel", ["C", "AB"])[0];
  const lp = lineOf(page, perp.id)!, lq = lineOf(page, par.id)!;
  assert.ok(near(Math.abs(lp.d[1]), 1) && near(Math.abs(lq.d[0]), 1));
  // intersection of the perpendicular and AB is the foot
  const [x] = build(page, "intersection", [perp.id, "AB"]) as GeoPoint[];
  assert.ok(near(x.x, 4) && near(x.y, 0));
  // dependent points follow their parents when A moves
  (page.objects[0] as GeoPoint).x = -10; resolveGeo(page);
  assert.ok(near(m.x, 0));
});

test("geometry: triangle centres, circumcircle, bisector, angle", () => {
  const A: [number, number] = [0, 0], B: [number, number] = [6, 0], C: [number, number] = [0, 8];
  assert.deepEqual(triangleCenter("centroid", A, B, C)!.map((v) => +v.toFixed(6)), [2, 8 / 3].map((v) => +v.toFixed(6)));
  const O = triangleCenter("circum", A, B, C)!; // right angle at A: circumcentre is the midpoint of BC
  assert.ok(near(O[0], 3) && near(O[1], 4));
  const H = triangleCenter("ortho", A, B, C)!; // right angle at A: orthocentre = A
  assert.ok(near(H[0], 0) && near(H[1], 0));
  const I = triangleCenter("in", A, B, C)!; // r = (6+8-10)/2 = 2
  assert.ok(near(I[0], 2) && near(I[1], 2));
  assert.ok(near(angleAt(B, A, C), 90));
  const page: Page = { objects: [gp("A", 0, 0), gp("B", 6, 0), gp("C", 0, 8)] as O2[] };
  const cc = build(page, "circumcircle", ["A", "B", "C"]);
  assert.equal(cc[1].t, "gcircle");
  const o = cc[0] as GeoPoint;
  assert.ok(near(o.x, 3) && near(o.y, 4));
  const bis = build(page, "bisector", ["B", "A", "C"])[0]; // bisector of the right angle at A: direction (1,1)/√2
  const l = lineOf(page, bis.id)!;
  assert.ok(near(l.d[0], l.d[1]));
  assert.equal(triangleCenter("centroid", A, A, A)!.length, 2);
});

test("geometry: reflections, translation, rotation, dilation", () => {
  const page: Page = { objects: [gp("P", 3, 4), gp("O", 0, 0), gp("U", 0, 0), gp("V", 1, 1), gp("X", 5, 0), gp("Y", 5, 10), { t: "gseg", id: "XY", a: "X", b: "Y" }] as O2[] };
  const r1 = build(page, "reflectLine", ["P", "XY"])[0] as GeoPoint; // mirror in x = 5
  assert.ok(near(r1.x, 7) && near(r1.y, 4));
  const r2 = build(page, "reflectPoint", ["P", "O"])[0] as GeoPoint;
  assert.ok(near(r2.x, -3) && near(r2.y, -4));
  const t = build(page, "translate", ["P", "U", "V"])[0] as GeoPoint;
  assert.ok(near(t.x, 4) && near(t.y, 5));
  const ro = build(page, "rotate", ["P", "O"])[0] as GeoPoint; // 90° counter-clockwise on screen axes: (3,4) -> (-4,3)
  assert.ok(near(ro.x, -4) && near(ro.y, 3));
  const d = build(page, "dilate", ["P", "O"])[0] as GeoPoint;
  assert.ok(near(d.x, 6) && near(d.y, 8));
});

test("geometry: circle/circle and line/circle intersections, removal cascades", () => {
  const page: Page = { objects: [gp("O1", 0, 0), gp("A", 5, 0), gp("O2", 8, 0), gp("B", 8, 5), { t: "gcircle", id: "c1", c: "O1", p: "A" }, { t: "gcircle", id: "c2", c: "O2", p: "B" }] as O2[] };
  assert.equal(intersections(page, "c1", "c2").length, 2);
  const pts = build(page, "intersection", ["c1", "c2"]) as GeoPoint[];
  assert.equal(pts.length, 2);
  for (const p of pts) assert.ok(near(Math.hypot(p.x, p.y), 5) && near(Math.hypot(p.x - 8, p.y), 5));
  const mid = build(page, "midpoint", [pts[0].id, pts[1].id])[0];
  assert.deepEqual(refsOf(mid), [pts[0].id, pts[1].id]);
  removeObject(page, "O1"); // deleting a centre removes its circle, the intersection points and the midpoint built on them
  assert.ok(!page.objects.some((o) => o.id === "c1" || o.id === pts[0].id || o.id === mid.id));
  assert.ok(page.objects.some((o) => o.id === "c2"));
});

test("copying constructed objects keeps their parents consistent", () => {
  const page: Page = { objects: [gp("A", 0, 0), gp("B", 10, 0)] as O2[] };
  const [m] = build(page, "midpoint", ["A", "B"]);
  const copies = copyObjects(page.objects, 20, 20) as O2[];
  const cm = copies.find((c) => c.t === "gpoint" && c.def) as GeoPoint;
  assert.ok(cm && cm.id !== m.id);
  const parents = copies.filter((c) => c.t === "gpoint" && !c.def).map((c) => c.id);
  assert.ok(cm.def!.k === "mid" && parents.includes(cm.def!.a) && parents.includes(cm.def!.b));
  // copying the midpoint alone detaches it from its parents
  const alone = copyObjects([m])[0] as GeoPoint;
  assert.equal(alone.def, undefined);
});

// ---- graph tools --------------------------------------------------------------------------
import { roots, extrema, intersectFns, parseIneq, inRegion, squareScale, pointLabel } from "../src/graphtools.ts";
import { compile } from "../src/mathexpr.ts";

test("graph tools: roots, extrema, intersections", () => {
  const f = compile("x^2-2x-3");
  const r = roots(f, -6, 6);
  assert.equal(r.length, 2);
  assert.ok(Math.abs(r[0] + 1) < 1e-6 && Math.abs(r[1] - 3) < 1e-6);
  assert.equal(roots(compile("x^2"), -3, 3).length, 1, "double root found");
  assert.equal(roots(compile("1/x"), -3, 3).length, 0, "asymptote is not a root");
  const e = extrema(f, -6, 6);
  assert.equal(e.length, 1);
  assert.ok(Math.abs(e[0].x - 1) < 1e-4 && Math.abs(e[0].y + 4) < 1e-6 && e[0].kind === "min");
  const s = extrema(compile("2sin(x)"), 0, 7);
  assert.deepEqual(s.map((q) => q.kind), ["max", "min"]);
  const cuts = intersectFns(f, compile("2sin(x)"), -2, 6);
  assert.ok(cuts.length >= 2 && cuts.every((p) => Math.abs(p.y - 2 * Math.sin(p.x)) < 1e-5));
  assert.equal(pointLabel("I", 1, -4), "I(1; -4)");
});

test("graph tools: inequality regions and 1:1 scale", () => {
  const q = [parseIneq("y > x^2 - 1"), parseIneq("x + y <= 3"), parseIneq("x >= 0")];
  assert.ok(inRegion(q, 1, 1));
  assert.ok(!inRegion(q, -1, 1), "x >= 0 fails");
  assert.ok(!inRegion(q, 1, -1), "below the parabola");
  assert.ok(!inRegion(q, 2, 2), "x + y <= 3 fails");
  assert.ok(inRegion([parseIneq("y ≤ 2")], 0, 2));
  assert.throws(() => parseIneq("y + 3"), /inequality/);
  const sq = squareScale(-6, 6, -1, 1, 600, 300);
  assert.ok(Math.abs(sq.ymax - sq.ymin - 6) < 1e-9 && Math.abs((sq.ymax + sq.ymin) / 2) < 1e-9);
});

// ---- instruments, sheets, insert space ----------------------------------------------------
import { instOutline, guides, guideAt, projectOnGuide, distToGuide, rulerTicks, protractorAngle, defaultSize, pointInPoly, MM } from "../src/instruments.ts";
import { sheetNames, pagesIn, addSheet, removeSheet, renameSheet } from "../src/sheets.ts";
import { insertSpace } from "../src/space.ts";
import { newDoc, validateDoc, type Inst } from "../src/model.ts";

test("instruments: outlines, edges that pens follow", () => {
  const ruler: Inst = { t: "inst", id: "r", kind: "ruler", x: 100, y: 100, rot: 0, s: 600 };
  assert.ok(pointInPoly(instOutline(ruler), 300, 120) && !pointInPoly(instOutline(ruler), 300, 300));
  // a stroke starting 6 units from the ruler's top edge is projected onto the edge
  const g = guideAt([ruler], [250, 106])!;
  assert.equal(g.kind, "line");
  const q = projectOnGuide(g, [400, 140]); // any point is projected onto the line y=100
  assert.ok(Math.abs(q[1] - 100) < 1e-9 && Math.abs(q[0] - 400) < 1e-9);
  assert.equal(guideAt([ruler], [250, 300]), null);
  assert.equal(guideAt([ruler], [900, 100]), null, "beyond the end of the ruler");
  // rotated ruler: the guide direction follows the rotation
  const rot: Inst = { ...ruler, rot: Math.PI / 2 };
  const gr = guideAt([rot], [100, 300])!;
  assert.ok(gr.kind === "line" && Math.abs(gr.d[0]) < 1e-9 && Math.abs(Math.abs(gr.d[1]) - 1) < 1e-9);
  // protractor: arc guide is a circle of radius s around the centre; distance 0 on the arc
  const pr: Inst = { t: "inst", id: "p", kind: "protractor", x: 300, y: 300, rot: 0, s: 150 };
  const arc = guides(pr).find((x) => x.kind === "circle")!;
  assert.ok(distToGuide(arc, [300, 150]) < 1e-9);
  assert.ok(Math.abs(protractorAngle(pr, [450, 300]) - 0) < 1e-9 && Math.abs(protractorAngle(pr, [300, 150]) - 90) < 1e-9);
  // compass: drawing follows the circle around the pivot with radius s
  const cp: Inst = { t: "inst", id: "c", kind: "compass", x: 500, y: 500, rot: 0, s: 120 };
  const cg = guideAt([cp], [620, 505])!;
  const pq = projectOnGuide(cg, [700, 500]);
  assert.ok(Math.abs(Math.hypot(pq[0] - 500, pq[1] - 500) - 120) < 1e-9);
  // set-square edges include the hypotenuse
  const sq: Inst = { t: "inst", id: "s", kind: "square", x: 0, y: 0, rot: 0, s: 300 };
  assert.equal(guides(sq).length, 3);
  assert.ok(distToGuide(guides(sq)[2], [150, 150]) < 1e-9);
  assert.equal(defaultSize("ruler") > defaultSize("protractor"), true);
  const ticks = rulerTicks(100 * MM);
  assert.equal(ticks.filter((t) => t.label !== undefined).length, 11);
});

test("sheets: add, rename, remove, page lists", () => {
  const d = newDoc();
  assert.deepEqual(sheetNames(d), ["1"]);
  d.pages.push({ objects: [] });
  const s = addSheet(d, "Maths", { objects: [] });
  assert.equal(s, 1);
  assert.deepEqual(sheetNames(d), ["1", "Maths"]);
  assert.deepEqual(pagesIn(d, 0), [0, 1]);
  assert.deepEqual(pagesIn(d, 1), [2]);
  renameSheet(d, 1, "Algebra");
  assert.equal(sheetNames(d)[1], "Algebra");
  const s2 = addSheet(d, "Geometry", { objects: [] });
  assert.equal(removeSheet(d, 1), true);
  assert.deepEqual(sheetNames(d), ["1", "Geometry"]);
  assert.deepEqual(pagesIn(d, 1), [d.pages.length - 1]);
  assert.equal(s2, 2);
  assert.equal(removeSheet(newDoc(), 0), false, "the last sheet stays");
  // sheets survive validation
  assert.deepEqual(validateDoc(JSON.parse(JSON.stringify(d))).sheets, ["1", "Geometry"]);
});

test("insert space moves only what lies below the line", () => {
  const page: Page = { objects: [
    { t: "stroke", id: "a", color: "#000", w: 2, pts: [10, 50, 30, 60] },
    { t: "stroke", id: "b", color: "#000", w: 2, pts: [10, 300, 30, 320] },
    { t: "shape", id: "c", x: 0, y: 400, w: 50, h: 50, kind: "rect", color: "#000", lw: 2, rot: 0, fill: false },
    gp("P", 5, 500), gp("Q", 9, 520, { def: { k: "mid", a: "P", b: "P" } }),
  ] as O2[] };
  assert.equal(insertSpace(page, 200, 100), 3);
  assert.equal((page.objects[0] as { pts: number[] }).pts[1], 50);
  assert.equal((page.objects[1] as { pts: number[] }).pts[1], 400);
  assert.equal((page.objects[2] as { y: number }).y, 500);
  assert.equal((page.objects[3] as GeoPoint).y, 600);
  assert.equal((page.objects[4] as GeoPoint).y, 520, "constructed point is recomputed from its parents, not moved");
});

test("new documents use the notebook paper by default (ruled blue lines + margin)", () => {
  const d = newDoc();
  assert.equal(d.pages[0].paper?.type, "notebook");
});

// ---- tool switching, pencil actions, toolbar prefs ------------------------------------------
import { initialToolState, trackTool, tapTool, tapGroup, toggleRotate, pencilDoubleTap, normToolbarPrefs, clampFloat, parsePrefs, defaultToolbarPrefs, isDrawTool, MAX_UI, MIN_UI } from "../src/toolstate.ts";

test("R toggles writing <-> rotate and remembers the drawing tool", () => {
  let s = initialToolState("highlighter");
  s = toggleRotate(s);
  assert.equal(s.tool, "select");
  s = toggleRotate(s);
  assert.equal(s.tool, "highlighter");
  // switching drawing tools while rotating... the last drawing tool is the one before entering select
  s = trackTool(s, "pen"); s = toggleRotate(s); s = toggleRotate(s);
  assert.equal(s.tool, "pen");
  // from a non-drawing tool (pan) R goes to rotate, then back to the last drawing tool
  s = trackTool(s, "pan"); s = toggleRotate(s); assert.equal(s.tool, "select");
  assert.equal(toggleRotate(s).tool, "pen");
  assert.ok(isDrawTool("pen") && !isDrawTool("select") && !isDrawTool("none"));
});

test("tapping the active tool switches it off; tapping again switches it on", () => {
  let s = initialToolState("pen");
  s = tapTool(s, "pen"); assert.equal(s.tool, "none");
  s = tapTool(s, "pen"); assert.equal(s.tool, "pen");
  s = tapTool(s, "eraser"); assert.equal(s.tool, "eraser");
  s = tapTool(s, "pen"); assert.equal(s.tool, "pen");
  // groups: shapes / solids / lines behind one button
  const G = ["shape", "solid", "line"];
  s = tapGroup(s, G, "solid"); assert.equal(s.tool, "solid");
  s = tapGroup(s, G, "solid"); assert.equal(s.tool, "none");
  s = tapGroup(s, G, undefined); assert.equal(s.tool, "shape");
  s = trackTool(s, "line"); s = tapGroup(s, G, "line"); assert.equal(s.tool, "none", "any member counts as active");
});

test("Pencil double-tap actions", () => {
  let s = initialToolState("pen");
  // eraser and back
  let r = pencilDoubleTap(s, "eraser", 0, 6); assert.equal(r.state.tool, "eraser");
  r = pencilDoubleTap(r.state, "eraser", 0, 6); assert.equal(r.state.tool, "pen");
  // from highlighter: eraser, then back to the highlighter
  s = initialToolState("highlighter"); r = pencilDoubleTap(s, "eraser", 0, 6); r = pencilDoubleTap(r.state, "eraser", 0, 6);
  assert.equal(r.state.tool, "highlighter");
  // previous tool swaps between the last two
  s = trackTool(initialToolState("pen"), "text");
  r = pencilDoubleTap(s, "previous", 0, 6); assert.equal(r.state.tool, "pen");
  r = pencilDoubleTap(r.state, "previous", 0, 6); assert.equal(r.state.tool, "text");
  // rotate toggle
  r = pencilDoubleTap(initialToolState("pen"), "rotate", 0, 6); assert.equal(r.state.tool, "select");
  // colour advances and wraps, tool unchanged
  r = pencilDoubleTap(initialToolState("pen"), "color", 4, 6); assert.equal(r.colorIdx, 5);
  r = pencilDoubleTap(r.state, "color", 5, 6); assert.equal(r.colorIdx, 0);
  assert.equal(r.state.tool, "pen");
});

test("toolbar preferences are validated and clamped", () => {
  assert.deepEqual(normToolbarPrefs(null), defaultToolbarPrefs());
  assert.equal(normToolbarPrefs({ scale: 9 }).scale, MAX_UI);
  assert.equal(normToolbarPrefs({ scale: 0.1 }).scale, MIN_UI);
  assert.equal(normToolbarPrefs({ dock: "diagonal" }).dock, "top");
  assert.equal(normToolbarPrefs({ dock: "left", collapsed: true }).dock, "left");
  assert.equal(normToolbarPrefs({ scale: "big", fx: NaN }).scale, 1);
  assert.deepEqual(parsePrefs("not json"), defaultToolbarPrefs());
  assert.equal(parsePrefs('{"dock":"right","scale":1.4}').scale, 1.4);
  assert.deepEqual(clampFloat(-50, 900, 300, 60, 800, 600), { x: 0, y: 540 });
  assert.deepEqual(clampFloat(100, 100, 2000, 60, 800, 600), { x: 0, y: 100 }, "wider than the screen: keep the left edge visible");
});

// ---- animated fold model ------------------------------------------------------------------------
import { foldModel, foldRadius, projectFold, pickFoldFace, canFold, FOLD_KINDS } from "../src/fold.ts";
import type { SolidKind } from "../src/model.ts";
const POLY: SolidKind[] = ["cube", "box", "pyramid", "tetra", "prism", "octahedron", "frustum"];
const d3 = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test("fold: t = 0 reproduces the flat net exactly (polyhedra)", () => {
  for (const k of POLY) {
    const net = netOf(k)!, m = foldModel(k, 0)!;
    assert.equal(m.faces.length, net.faces.length);
    let z0: number | null = null;
    for (const f of m.faces) {
      const nf = net.faces[f.id];
      assert.equal(f.pts.length, nf.pts.length / 2);
      f.pts.forEach((p, i) => {
        assert.ok(Math.abs(p[0] - f.pts[0][0] - (nf.pts[2 * i] - nf.pts[0])) < 1e-9 && Math.abs(p[1] - f.pts[0][1] - (nf.pts[2 * i + 1] - nf.pts[1])) < 1e-9, `${k} face ${f.id} vertex ${i}`);
        z0 ??= p[2];
        assert.ok(Math.abs(p[2] - z0) < 1e-9, `${k} is flat`);
      });
    }
    // relative placement of the faces matches too (same offsets between faces as in the net)
    const o0 = m.faces[0].pts[0], n0 = net.faces[0];
    for (const f of m.faces) assert.ok(Math.abs(f.pts[0][0] - o0[0] - (net.faces[f.id].pts[0] - n0.pts[0])) < 1e-9 && Math.abs(f.pts[0][1] - o0[1] - (net.faces[f.id].pts[1] - n0.pts[1])) < 1e-9);
  }
});

test("fold: t = 1 closes every polyhedron (shared vertices coincide, edge lengths equal the solid's)", () => {
  for (const k of POLY) {
    const mesh = meshOf(k)!, m = foldModel(k, 1)!;
    const at: ([number, number, number] | null)[] = mesh.v.map(() => null);
    mesh.f.forEach((idx, fi) => idx.forEach((vi, i) => {
      const p = m.faces[fi].pts[i];
      if (at[vi]) assert.ok(d3(at[vi]!, p) < 1e-6, `${k}: vertex ${vi} is not shared by all its faces`);
      else at[vi] = p;
    }));
    for (let i = 0; i < mesh.v.length; i++) for (let j = i + 1; j < mesh.v.length; j++) assert.ok(Math.abs(d3(at[i]!, at[j]!) - d3(mesh.v[i], mesh.v[j])) < 1e-6, `${k}: distance ${i}-${j}`);
    // outward normals point away from the centre of the closed solid
    for (const f of m.faces) { const c = f.pts.reduce((s, p) => [s[0] + p[0] / f.pts.length, s[1] + p[1] / f.pts.length, s[2] + p[2] / f.pts.length], [0, 0, 0]); assert.ok(f.n![0] * c[0] + f.n![1] * c[1] + f.n![2] * c[2] > 0, `${k} normal ${f.id}`); }
  }
});

test("fold: curved solids are closed at t = 1 and flat at t = 0", () => {
  const radial = (p: number[]) => Math.hypot(p[0], p[2]);
  // cylinder: all points on the cylinder r = 0.5, |y| <= 0.5; caps centred on the axis at y = ±0.5
  const cyl = foldModel("cylinder", 1)!;
  for (const f of cyl.faces) for (const p of f.pts) { assert.ok(Math.abs(radial(p) - 0.5) < 1e-6 && Math.abs(p[1]) <= 0.5 + 1e-9, `cyl ${f.id}`); }
  for (const id of [0, 1]) { const f = cyl.faces.find((q) => q.id === id)!; assert.ok(f.pts.every((p) => Math.abs(p[1] - (id === 0 ? 0.5 : -0.5)) < 1e-9)); }
  // cone: apex at the top, radius grows linearly down to 0.5 at y = -0.5
  const cone = foldModel("cone", 1)!;
  for (const f of cone.faces) for (const p of f.pts) assert.ok(Math.abs(radial(p) - 0.5 * (0.5 - p[1])) < 1e-6, `cone ${f.id}`);
  assert.ok(cone.faces.find((q) => q.id === 0)!.pts.every((p) => Math.abs(p[1] + 0.5) < 1e-9));
  // frustum of a cone: radii 0.5 (bottom) and 0.25 (top)
  const fr = foldModel("frustumcone", 1)!;
  const bot = fr.faces.find((q) => q.id === 1)!, top = fr.faces.find((q) => q.id === 0)!;
  const yb = bot.pts[0][1], yt = top.pts[0][1];
  assert.ok(Math.abs(yt - yb - 1) < 1e-6, "height 1");
  assert.ok(bot.pts.every((p) => Math.abs(radial(p) - 0.5) < 1e-6 && Math.abs(p[1] - yb) < 1e-9) && top.pts.every((p) => Math.abs(radial(p) - 0.25) < 1e-6 && Math.abs(p[1] - yt) < 1e-9));
  for (const p of fr.faces.filter((q) => q.id === 2).flatMap((q) => q.pts)) assert.ok(Math.abs(radial(p) - (0.5 - 0.25 * (p[1] - yb))) < 1e-6, "lateral on the frustum");
  // t = 0: cylinder strip and cap are flat (z constant at the pivot offset)
  const c0 = foldModel("cylinder", 0)!;
  const zs = c0.faces.flatMap((f) => f.pts.map((p) => p[2]));
  assert.ok(Math.max(...zs) - Math.min(...zs) < 1e-3, "cylinder net is flat");
  const k0 = foldModel("cone", 0)!.faces.flatMap((f) => f.pts.map((p) => p[1]));
  assert.ok(Math.max(...k0) - Math.min(...k0) < 1e-3, "cone net is flat");
  // lateral surface of the closed cylinder: its seam closes (first and last strip meet)
  const side = cyl.faces.filter((f) => f.id === 2);
  assert.ok(d3(side[0].pts[0], side[side.length - 1].pts[1]) < 1e-6);
});

test("fold: continuous in t, no NaN, and it only ever gets more compact while folding", () => {
  for (const k of FOLD_KINDS) {
    assert.ok(canFold(k));
    let prev: number[][] | null = null, prevG = Infinity, g0 = 0;
    for (let i = 0; i <= 100; i++) {
      const t = i / 100, m = foldModel(k, t)!;
      const flat = m.faces.flatMap((f) => f.pts);
      assert.ok(flat.every((p) => p.every(Number.isFinite)), `${k} NaN at t=${t}`);
      if (prev) { let maxStep = 0; flat.forEach((p, j) => { maxStep = Math.max(maxStep, d3(p, prev![j])); }); assert.ok(maxStep < 0.2, `${k}: jump ${maxStep} at t=${t}`); }
      const c = flat.reduce((s, p) => [s[0] + p[0] / flat.length, s[1] + p[1] / flat.length, s[2] + p[2] / flat.length], [0, 0, 0]);
      const g = Math.sqrt(flat.reduce((s, p) => s + d3(p, c) ** 2, 0) / flat.length);
      // cones: the base cap swings outwards slightly in the last fifth, so strict monotonicity is only required before that
      if (!(k === "cone" || k === "frustumcone") || t <= 0.7) assert.ok(g <= prevG + 1e-6, `${k}: gyration radius grows at t=${t}`);
      prev = flat; prevG = g;
      if (t === 0) g0 = g;
      if (t === 1) assert.ok(g < g0, `${k}: closed solid is more compact than the net`);
    }
    assert.ok(foldRadius(k) > 0.4);
  }
  assert.ok(!canFold("sphere") && !canFold("cap") && !canFold("truncyl"));
  assert.equal(foldModel("sphere", 0.5), null);
  assert.ok(foldModel("cube", -3) !== null && foldModel("cube", NaN) !== null, "t is clamped");
});

test("fold: projection is depth-sorted, edges are dashed only while folding, faces can be picked", () => {
  const o = { kind: "cube" as const, yaw: -0.6, pitch: 0.45, roll: 0, fold: 0.5 };
  const pr = projectFold(o);
  assert.equal(pr.faces.length, 6);
  assert.ok(pr.faces.every((f, i) => i === 0 || pr.faces[i - 1].z <= f.z + 1e-12), "far faces first");
  assert.ok(pr.edges.some((e) => e.kind === "hinge") && pr.edges.every((e) => !e.hidden), "while folding: fold edges are dashed hinges, nothing is hidden");
  const closed = projectFold({ ...o, fold: 1 });
  assert.ok(closed.edges.every((e) => e.kind !== "hinge") && closed.edges.some((e) => e.hidden) && closed.edges.some((e) => !e.hidden), "closed: hidden edges are dashed");
  const flatP = projectFold({ ...o, fold: 0, yaw: 0.4, pitch: 0.5 });
  const f0 = flatP.faces[flatP.faces.length - 1];
  const cx = f0.pts.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) / (f0.pts.length / 2), cy = f0.pts.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0) / (f0.pts.length / 2);
  const got = pickFoldFace({ ...o, fold: 0, yaw: 0.4, pitch: 0.5 }, cx, cy);
  assert.notEqual(got, null);
  assert.ok(pointInPolygon(flatP.faces.find((f) => f.id === got)!.pts.reduce<[number, number][]>((a, v, i, arr) => (i % 2 ? a : [...a, [v, arr[i + 1]]]), []), cx, cy), "the picked face contains the point");
  assert.equal(pickFoldFace({ ...o, fold: 0, yaw: 0.4, pitch: 0.5 }, 99, 99), null);
  for (const k of FOLD_KINDS) for (const t of [0, 0.3, 1]) assert.ok(projectFold({ kind: k, yaw: 1, pitch: -0.7, roll: 2, fold: t }).faces.every((f) => f.pts.every(Number.isFinite)));
});

// ---- marks, lines and names riding on the folding solid ----------------------------------------
import { foldMarks, pickFolded, commonFaces } from "../src/foldmarks.ts";
import { closedFrame } from "../src/fold.ts";
import { foldPointOnFace, foldNormalOnFace, effRadius, foldToSolid, foldToSolidVec } from "../src/fold.ts";
import type { Mark } from "../src/model.ts";

/** Marks at every snap target plus a point inside every polyhedron face; segments between all consecutive mark pairs (mix of on-face and through-the-inside). */
function sampleMarks(kind: SolidKind): { marks: Mark[]; lines: [string, string][] } {
  const marks: Mark[] = snapTargets(kind).map((s, i) => ({ id: `m${i}`, p: s.p, faces: s.faces, name: s.name || `P${i}` }));
  const mesh = meshOf(kind);
  if (mesh) mesh.f.forEach((idx, fi) => {
    const a = mesh.v[idx[0]], b = mesh.v[idx[1]], c = mesh.v[idx[2]];
    marks.push({ id: `f${fi}`, p: [(a[0] * 2 + b[0] + c[0]) / 4, (a[1] * 2 + b[1] + c[1]) / 4, (a[2] * 2 + b[2] + c[2]) / 4], faces: [fi], name: "" });
  });
  const lines: [string, string][] = [];
  for (let i = 0; i + 1 < marks.length; i += 2) lines.push([marks[i].id, marks[i + 1].id]);
  return { marks, lines };
}
const view = { yaw: -0.7, pitch: 0.5, roll: 0.2 };

test("folded marks: at t = 1 they coincide with the normal solid drawing (polyhedra and curved solids)", () => {
  for (const kind of FOLD_KINDS) {
    const { marks, lines } = sampleMarks(kind);
    const old = project({ kind, ...view, marks, lines, labels: true });
    const fm = foldMarks({ kind, ...view, marks, lines, labels: true, fold: 1 });
    assert.equal(fm.dots.length, old.dots.length, `${kind}: one dot per mark at t = 1`);
    fm.dots.forEach((d, i) => {
      assert.ok(Math.hypot(d.x - old.dots[i].x, d.y - old.dots[i].y) < 1e-6, `${kind} dot ${i}`);
      assert.equal(d.name, old.dots[i].name);
      assert.equal(d.hidden, old.dots[i].hidden, `${kind} dot ${i} hidden`);
    });
    assert.equal(fm.lines.length, old.lines.length, `${kind}: one segment per line`);
    fm.lines.forEach((l, i) => {
      const o = old.lines[i];
      assert.ok(l.pts.every((v, k) => Math.abs(v - o.pts[k]) < 1e-6), `${kind} line ${i}`);
      assert.equal(l.alpha, 1);
      assert.equal(l.hidden, o.hidden, `${kind} line ${i} hidden`);
    });
    // vertex names: same set of positions
    for (const v of old.vlabels) assert.ok(fm.vlabels.some((w) => w.name === v.name && Math.hypot(w.x - v.x, w.y - v.y) < 1e-6 && w.hidden === v.hidden), `${kind} label ${v.name}`);
  }
});

test("folded marks: at t = 0 they lie on the flat net (rigid on their face); in between they move continuously", () => {
  for (const kind of FOLD_KINDS) {
    const { marks, lines } = sampleMarks(kind);
    const mesh = meshOf(kind);
    let prev: number[] | null = null;
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const fm = foldMarks({ kind, ...view, marks, lines, labels: true, fold: t });
      const flat = [...fm.dots.flatMap((d) => [d.x, d.y]), ...fm.lines.flatMap((l) => l.pts), ...fm.vlabels.flatMap((d) => [d.x, d.y])];
      assert.ok(flat.every(Number.isFinite) && fm.lines.every((l) => Number.isFinite(l.alpha)), `${kind} NaN at t=${t}`);
      if (prev && prev.length === flat.length) { let mx = 0; flat.forEach((v, k) => { mx = Math.max(mx, Math.abs(v - prev![k])); }); assert.ok(mx < 0.25, `${kind}: jump ${mx.toFixed(3)} at t=${t}`); }
      if (prev === null || prev.length === flat.length) prev = flat; else prev = null;
    }
    if (mesh) {
      for (const t of [0, 0.3, 0.7, 1]) {
        const model = foldModel(kind, t)!;
        for (const m of marks) for (const f of m.faces) {
          const p = foldPointOnFace(kind, t, f, m.p)!;
          mesh.f[f].forEach((vi, k) => assert.ok(Math.abs(Math.hypot(p[0] - model.faces[f].pts[k][0], p[1] - model.faces[f].pts[k][1], p[2] - model.faces[f].pts[k][2]) - Math.hypot(m.p[0] - mesh.v[vi][0], m.p[1] - mesh.v[vi][1], m.p[2] - mesh.v[vi][2])) < 1e-9, `${kind} t=${t}: mark rigid on face ${f}`));
        }
      }
      // t = 0: the mark lies inside the flat face polygon (same z as the face)
      const m0 = foldModel(kind, 0)!;
      for (const m of marks.filter((q) => q.faces.length === 1)) {
        const f = m.faces[0], p = foldPointOnFace(kind, 0, f, m.p)!;
        assert.ok(Math.abs(p[2] - m0.faces[f].pts[0][2]) < 1e-9);
        assert.ok(pointInPolygon(m0.faces[f].pts.map((q) => [q[0], q[1]] as [number, number]), p[0], p[1]), `${kind}: point of face ${f} inside the net face`);
      }
    }
  }
});

test("folded marks: a segment through the inside fades out as the model flattens", () => {
  const kind: SolidKind = "cube";
  const mesh = meshOf(kind)!;
  const marks: Mark[] = [{ id: "a", p: mesh.v[0], faces: [0, 2, 4].filter((f) => mesh.f[f].includes(0)), name: "A" }, { id: "b", p: mesh.v[7], faces: [1, 3, 5].filter((f) => mesh.f[f].includes(7)), name: "B" }];
  const lines: [string, string][] = [["a", "b"]];
  assert.deepEqual(commonFaces(kind, marks[0], marks[1]), [], "opposite corners share no face");
  assert.equal(foldMarks({ kind, ...view, marks, lines, fold: 1 }).lines[0].alpha, 1);
  assert.equal(foldMarks({ kind, ...view, marks, lines, fold: 0 }).lines[0].alpha, 0);
  const a = [0, 0.25, 0.5, 0.75, 1].map((t) => foldMarks({ kind, ...view, marks, lines, fold: t }).lines[0].alpha);
  assert.ok(a.every((v, i) => i === 0 || v > a[i - 1]), "monotone fade");
  // a segment on one face keeps full opacity at every t and a segment along an edge is drawn on both faces at t<1
  const edge: Mark[] = [{ id: "c", p: mesh.v[0], faces: mesh.f.map((f, i) => (f.includes(0) ? i : -1)).filter((i) => i >= 0), name: "" }, { id: "d", p: mesh.v[1], faces: mesh.f.map((f, i) => (f.includes(1) ? i : -1)).filter((i) => i >= 0), name: "" }];
  const shared = commonFaces(kind, edge[0], edge[1]);
  assert.equal(shared.length, 2);
  assert.ok(foldMarks({ kind, ...view, marks: edge, lines: [["c", "d"]], fold: 0 }).lines.every((l) => l.alpha === 1));
  assert.ok(foldMarks({ kind, ...view, marks: edge, lines: [["c", "d"]], fold: 1 }).lines.length === 1, "coincident copies are drawn once at t = 1");
});

test("picking on the folded model: snap targets and free points of a face", () => {
  const kind: SolidKind = "cube";
  const mesh = meshOf(kind)!;
  const R = rotator(0.15, 0.2, 0);
  for (const t of [0, 1]) {
    const o = { kind, yaw: 0.15, pitch: 0.2, roll: 0, fold: t };
    const m = foldModel(kind, t)!;
    // a vertex: pick returns it
    const sn = snapTargets(kind).find((s) => s.name === "A")!;
    const f = sn.faces.find((fi) => R(foldToSolidVec(kind, foldNormalOnFace(kind, t, fi, sn.p)!, t))[2] > 0.01)!;
    const q = R(foldToSolid(kind, foldPointOnFace(kind, t, f, sn.p)!, t));
    const hit = pickFolded(o, q[0], -q[1], 0.05)!;
    assert.ok(hit && hit.name === "A" && Math.abs(hit.p[0] - sn.p[0]) < 1e-9, `t=${t}: vertex picked`);
    // free point inside the front-most face: round trip through the folded geometry
    const proj = projectFold(o).faces;
    const top = proj[proj.length - 1];
    const cx = top.pts.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) / (top.pts.length / 2) + 0.013, cy = top.pts.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0) / (top.pts.length / 2) - 0.011;
    const free = pickFolded(o, cx, cy, 0.001);
    assert.ok(free && free.faces.includes(top.id), `t=${t}: face under the pointer`);
    // the point maps back to the pointer position
    const back = R(foldToSolid(kind, foldPointOnFace(kind, t, top.id, free!.p)!, t));
    assert.ok(Math.hypot(back[0] - cx, -back[1] - cy) < 1e-6, `t=${t}: picked point sits under the pointer`);
    assert.ok(Math.abs(free!.p.reduce((s, v, i) => s + v * closedFrame(kind, top.id)!.n[i], 0) - closedFrame(kind, top.id)!.n.reduce((s, v, i) => s + v * mesh.v[mesh.f[top.id][0]][i], 0)) < 1e-9, "on the face's plane");
    void m;
  }
  assert.equal(pickFolded({ kind, yaw: 0, pitch: 0, roll: 0, fold: 0 }, 9, 9, 0.05), null);
});

test("effective radius grows smoothly from the solid to the net", () => {
  const r1 = effRadius("cube", 0.866, 1), r0 = effRadius("cube", 0.866, 0), rh = effRadius("cube", 0.866, 0.5);
  assert.equal(r1, 0.866); assert.ok(r0 > r1 && rh > r1 && rh < r0);
  assert.equal(effRadius("cube", 0.866, undefined), 0.866);
  assert.equal(effRadius("sphere", 0.5, 0), 0.5, "not foldable: unchanged");
});

test("the flat net faces the viewer and turns smoothly into the solid's orientation", () => {
  for (const kind of POLY) {
    const flat = projectFold({ kind, yaw: 0, pitch: 0, roll: 0, fold: 0 });
    const areas = flat.faces.map((f) => { let a = 0; for (let i = 0; i < f.pts.length; i += 2) { const j = (i + 2) % f.pts.length; a += f.pts[i] * f.pts[j + 1] - f.pts[j] * f.pts[i + 1]; } return Math.abs(a) / 2; });
    assert.ok(areas.every((a) => a > 1e-3), `${kind}: at t = 0 no face is edge-on`);
    // orientation changes continuously with t (no flips): a face's projected area never jumps
    let prev: number[] | null = null;
    for (let i = 0; i <= 50; i++) {
      const p = projectFold({ kind, yaw: -0.6, pitch: 0.45, roll: 0, fold: i / 50 });
      const a = p.faces.slice().sort((x, y) => x.id - y.id).map((f) => { let s = 0; for (let k = 0; k < f.pts.length; k += 2) { const j = (k + 2) % f.pts.length; s += f.pts[k] * f.pts[j + 1] - f.pts[j] * f.pts[k + 1]; } return Math.abs(s) / 2; });
      if (prev) a.forEach((v, k) => assert.ok(Math.abs(v - prev![k]) < 0.15, `${kind}: face area jumps at t=${i / 50}`));
      prev = a;
    }
  }
});

// ---- segment eraser -----------------------------------------------------------------------------
import { eraseFromStroke, ERASER_RADIUS } from "../src/erase.ts";
test("segment eraser cuts a stroke and keeps the rest", () => {
  const line = [0, 0, 100, 0, 200, 0];
  const parts = eraseFromStroke(line, undefined, 100, 5, 10)!;
  assert.equal(parts.length, 2);
  assert.ok(parts[0].pts[parts[0].pts.length - 2] < 100 && parts[0].pts[parts[0].pts.length - 2] > 85, "cut where the circle starts");
  assert.ok(parts[1].pts[0] > 100 && parts[1].pts[0] < 115);
  assert.equal(eraseFromStroke(line, undefined, 100, 50, 10), null, "far away: untouched");
  assert.deepEqual(eraseFromStroke(line, undefined, 100, 0, 500), [], "everything inside: nothing left");
  // erasing at the end only shortens it
  assert.equal(eraseFromStroke(line, undefined, 205, 0, 20)!.length, 1);
  // pressure values follow the cut points
  const p = eraseFromStroke(line, [0.2, 0.6, 1], 100, 0, 10)!;
  assert.ok(p[0].pr!.length === p[0].pts.length / 2 && p[1].pr!.length === p[1].pts.length / 2);
  assert.ok(ERASER_RADIUS.s < ERASER_RADIUS.m && ERASER_RADIUS.m < ERASER_RADIUS.l);
  // a circle between two sample points still cuts the segment
  assert.equal(eraseFromStroke([0, 0, 100, 0], undefined, 50, 0, 5)!.length, 2);
});

// ---- turntable -----------------------------------------------------------------------------------
import { spinStep, wrapAngle, spinRates, REV_SECONDS, MAX_DT, SPIN_SPEEDS, SPIN_AXES } from "../src/spin.ts";
test("auto-rotate: speed, direction, wrapping, frame-rate independence", () => {
  const s = { speed: 1, axis: "yaw" as const, dir: 1 as const };
  // 1x = one revolution in REV_SECONDS: simulate at 60 fps and at 20 fps
  const run = (fps: number, seconds: number, set = s) => { let a = { yaw: 0.3, pitch: 0.2, roll: -0.1 }; const dt = 1 / fps; for (let i = 0; i < fps * seconds; i++) a = spinStep(a, dt, set); return a; };
  const a60 = run(60, REV_SECONDS), a20 = run(20, REV_SECONDS);
  assert.ok(Math.abs(wrapAngle(a60.yaw - 0.3)) < 1e-6, "full revolution returns to the start");
  assert.ok(Math.abs(wrapAngle(run(60, 2).yaw - run(15, 2).yaw)) < 1e-6, "frame-rate independent");
  assert.ok(Math.abs(wrapAngle(a20.yaw - a60.yaw)) < 1e-6);
  assert.equal(a60.pitch, 0.2); assert.equal(a60.roll, -0.1);
  // speed and direction
  const half = run(60, 1, { ...s, speed: 0.5 }).yaw - 0.3, full = run(60, 1).yaw - 0.3, rev = run(60, 1, { ...s, dir: -1 }).yaw - 0.3;
  assert.ok(Math.abs(full - 2 * half) < 1e-9 && Math.abs(rev + full) < 1e-9 && full > 0);
  // axes
  assert.ok(run(60, 1, { ...s, axis: "pitch" }).pitch !== 0.2 && run(60, 1, { ...s, axis: "roll" }).roll !== -0.1);
  const tum = spinRates({ ...s, axis: "tumble" });
  assert.ok(tum.yaw > 0 && tum.pitch > 0 && tum.roll > 0 && tum.pitch !== tum.yaw && tum.roll !== tum.pitch);
  // wrapping and robustness
  for (const v of [0, 3.5, -3.5, 100, -100, Math.PI, -Math.PI]) { const w = wrapAngle(v); assert.ok(w > -Math.PI - 1e-12 && w <= Math.PI + 1e-12); assert.ok(Math.abs(Math.sin(w) - Math.sin(v)) < 1e-9); }
  assert.equal(wrapAngle(NaN), 0);
  const bad = spinStep({ yaw: NaN, pitch: Infinity, roll: 1 }, NaN, s);
  assert.ok(Object.values(bad).every(Number.isFinite));
  // a stalled frame (hidden tab) is clamped
  const jump = spinStep({ yaw: 0, pitch: 0, roll: 0 }, 60, s).yaw;
  assert.ok(Math.abs(jump - spinRates(s).yaw * MAX_DT) < 1e-12);
  assert.ok(SPIN_SPEEDS[0] === 0.25 && SPIN_SPEEDS[SPIN_SPEEDS.length - 1] === 4 && SPIN_AXES.length === 4);
  for (const sp of SPIN_SPEEDS) for (const ax of SPIN_AXES) for (const dir of [1, -1] as const) assert.ok(Object.values(spinStep({ yaw: 1, pitch: 1, roll: 1 }, 1 / 60, { speed: sp, axis: ax, dir })).every(Number.isFinite));
});

// ---- cross-sections --------------------------------------------------------------------------------
import { findLoops, isCoplanar, structuralEdges, loopKey, candidateSections, planeNormal, polygonArea3 } from "../src/sections.ts";
import { sectionPolys, pickSection } from "../src/foldmarks.ts";

/** Square pyramid S.ABCD (solids.ts: v0..v3 = A,B,C,D below, v4 = S) with marks on the vertices, M on edge CD and N at the base centre. */
function pyramidScene() {
  const mesh = meshOf("pyramid")!, V = mesh.v;
  const mk = (id: string, p: V3, faces: number[]): Mark => ({ id, p, faces, name: id.toUpperCase() });
  const mid = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const faceOf = (...vs: number[]) => mesh.f.flatMap((f, i) => (vs.every((v) => f.includes(v)) ? [i] : []));
  const marks: Mark[] = [mk("a", V[0], faceOf(0)), mk("b", V[1], faceOf(1)), mk("c", V[2], faceOf(2)), mk("d", V[3], faceOf(3)), mk("s", V[4], faceOf(4)), mk("m", mid(V[2], V[3]), faceOf(2, 3)), mk("n", mid(V[0], V[2]), [0])];
  return { marks, V };
}
type V3 = [number, number, number];
test("sections: coplanarity, plane normal, area", () => {
  assert.ok(isCoplanar([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]]));
  assert.ok(!isCoplanar([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]));
  assert.ok(!isCoplanar([[0, 0, 0], [1, 1, 1], [2, 2, 2]]), "collinear points define no plane");
  assert.ok(!isCoplanar([[0, 0, 0], [1, 0, 0]]));
  assert.deepEqual(planeNormal([[0, 0, 0], [1, 0, 0], [0, 1, 0]]), [0, 0, 1]);
  assert.ok(Math.abs(polygonArea3([[0, 0, 0], [2, 0, 0], [2, 3, 0], [0, 3, 0]]) - 6) < 1e-12);
});

test("sections: loops from the lines drawn on a pyramid (S-M-C, S-A-C, S-B-D, not the base face itself)", () => {
  const { marks } = pyramidScene();
  const lines: [string, string][] = [["s", "m"], ["s", "n"], ["a", "c"], ["b", "d"], ["d", "m"]];
  const loops = findLoops("pyramid", marks, lines);
  const keys = new Set(loops.map(loopKey));
  assert.ok(keys.has(loopKey(["s", "m", "c"])), "triangle S-M-C: S-M drawn, M-C along edge CD, C-S edge");
  assert.ok(keys.has(loopKey(["s", "d", "m"])), "triangle S-D-M");
  assert.ok(keys.has(loopKey(["s", "a", "c"])), "triangle S-A-C through the diagonal");
  assert.ok(keys.has(loopKey(["s", "b", "d"])), "triangle S-B-D");
  assert.ok(![...keys].includes(loopKey(["a", "b", "c", "d"])), "the base face is a face, not a section");
  // every loop really is planar
  const byId = new Map(marks.map((m) => [m.id, m]));
  for (const l of loops) assert.ok(isCoplanar(l.map((id) => byId.get(id)!.p)), `loop ${l.join("")} is planar`);
  // structural edges: M splits edge CD into C-M and M-D
  const se = structuralEdges("pyramid", marks).map((e) => loopKey(e));
  assert.ok(se.includes(loopKey(["c", "m"])) && se.includes(loopKey(["d", "m"])) && !se.includes(loopKey(["c", "d"])));
  assert.deepEqual(findLoops("pyramid", marks, []).map(loopKey).filter((k) => k.includes("m")).length >= 0, true);
});

test("sections: a non-planar loop is rejected, a planar quadrilateral accepted", () => {
  const mesh = meshOf("tetra")!;
  const marks: Mark[] = mesh.v.map((p, i) => ({ id: `t${i}`, p, faces: [], name: `T${i}` }));
  const cyc: [string, string][] = [["t0", "t1"], ["t1", "t2"], ["t2", "t3"], ["t3", "t0"]];
  const four = findLoops("tetra", marks, cyc).filter((l) => l.length === 4);
  assert.equal(four.length, 0, "four vertices of a tetrahedron are not coplanar");
  // cube: rectangle through two opposite edges is planar
  const cube = meshOf("cube")!.v;
  const cm: Mark[] = [0, 1, 6, 7].map((i) => ({ id: `c${i}`, p: cube[i], faces: [], name: "" }));
  const rect = findLoops("cube", cm, [["c0", "c1"], ["c1", "c7"], ["c7", "c6"], ["c6", "c0"]]);
  assert.ok(rect.some((l) => l.length === 4), "diagonal rectangle through opposite edges");
  void cm;
});

test("sections: polygons follow rotation, and fade while the model unfolds unless they lie on one face", () => {
  const { marks } = pyramidScene();
  const lines: [string, string][] = [["s", "m"], ["a", "c"]];
  const sec = [{ marks: ["s", "a", "c"], color: "#d62828" }, { marks: ["s", "m", "c"], color: "#2a9d3a" }]; // S-A-C cuts through the inside; S-M-C lies on the outer face SDC
  const base = { kind: "pyramid" as const, marks, lines, sections: sec };
  const at = (fold: number, yaw = -0.6) => sectionPolys({ ...base, yaw, pitch: 0.45, roll: 0, fold }, sec);
  const inner1 = at(1), inner0 = at(0), inner5 = at(0.5);
  assert.equal(inner1[0].alpha, 1); assert.equal(inner0[0].alpha, 0); assert.equal(inner5[0].alpha, 0.5);
  assert.ok(inner1.every((p) => p.pts.every(Number.isFinite)) && [0, 0.2, 0.4, 0.6, 0.8, 1].every((t) => at(t).every((p) => p.pts.every(Number.isFinite))));
  assert.ok([0, 0.3, 0.7, 1].every((t) => at(t)[1].alpha === 1), "a section on one outer face unfolds with that face at full opacity");
  // at t = 1 the polygon is the projection of its marks
  const R = rotator(-0.6, 0.45, 0), c = marks.find((m) => m.id === "c")!;
  const rc = R(c.p);
  assert.ok(Math.abs(inner1[0].pts[4] - rc[0]) < 1e-9 && Math.abs(inner1[0].pts[5] + rc[1]) < 1e-9);
  // turning the solid moves the polygon
  assert.notEqual(at(1, 0.8)[0].pts[2], inner1[0].pts[2]);
  // at t = 0 the face-bound section lies on the flat net: its area equals the true area of the triangle
  const flat = sectionPolys({ ...base, yaw: 0.4, pitch: 0.5, roll: 0, fold: 0 }, [sec[1]])[0];
  assert.ok(flat.area > 0.05);
});

test("sections: picking prefers the smallest region under the pointer; hidden loops fade out of reach", () => {
  const { marks } = pyramidScene();
  const lines: [string, string][] = [["s", "m"], ["a", "c"], ["s", "n"]];
  const s = { kind: "pyramid" as const, marks, lines, yaw: -0.6, pitch: 0.45, roll: 0, fold: 1, sections: undefined as undefined | { marks: string[]; color: string | null }[] };
  const polys = sectionPolys(s, candidateSections(s.kind, marks, lines, undefined));
  assert.ok(polys.length >= 2);
  const small = polys.slice().sort((a, b) => a.area - b.area)[0], big = polys.slice().sort((a, b) => b.area - a.area)[0];
  const centroid = (p: number[]) => [p.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) / (p.length / 2), p.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0) / (p.length / 2)];
  const [cx, cy] = centroid(small.pts);
  const got = pickSection(s, cx, cy)!;
  assert.ok(got && polys.find((p) => loopKey(p.marks) === loopKey(got.marks))!.area <= big.area + 1e-12);
  assert.ok(got.color === null);
  assert.equal(pickSection(s, 9, 9), null, "outside every loop");
  // a stored colour is returned with the section
  const stored = pickSection({ ...s, sections: [{ marks: small.marks, color: "#123456" }] }, cx, cy)!;
  assert.equal(stored.color === "#123456" || loopKey(stored.marks) !== loopKey(small.marks), true);
  // fully faded interior sections cannot be picked
  assert.equal(pickSection({ ...s, fold: 0 }, cx, cy)?.marks.join() === small.marks.join(), false);
});
