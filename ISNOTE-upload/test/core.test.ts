import test from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/mathexpr.ts";
import { encodeDoc, decodeDoc } from "../src/storage.ts";
import { buildPdf } from "../src/pdf.ts";
import { newDoc, removeObject, hit, type Page } from "../src/model.ts";

const ev = (s: string, x = 0) => compile(s)(x);

test("math expressions", () => {
  assert.equal(ev("1+2*3"), 7);
  assert.equal(ev("2^3^2"), 512); // right-associative
  assert.equal(ev("-x^2", 3), -9);
  assert.equal(ev("2x+1", 4), 9); // implicit multiplication
  assert.equal(ev("3(x+1)", 1), 6);
  assert.ok(Math.abs(ev("sin(pi/2)") - 1) < 1e-12);
  assert.ok(Math.abs(ev("sinx", Math.PI / 2) - 1) < 1e-12);
  assert.equal(ev("sqrt(16)+abs(-2)"), 6);
  assert.ok(Math.abs(ev("2e") - 2 * Math.E) < 1e-12);
  assert.throws(() => compile("2+"), /Unexpected end/);
  assert.throws(() => compile("foo(x)"), /Unknown name/);
  assert.throws(() => compile("(1+2"), /Missing \)/);
  assert.throws(() => compile("1; process.exit()"), /Unexpected/);
});

test("document roundtrip (gzip) and validation", async () => {
  const d = newDoc();
  d.pages[0].objects.push({ t: "stroke", id: "a", color: "#000", w: 3, pts: [0, 0, 5, 5] });
  const back = await decodeDoc(await encodeDoc(d));
  assert.deepEqual(back, d);
  await assert.rejects(decodeDoc(new TextEncoder().encode("{}")), /Not an ISNOTE/);
  await assert.rejects(decodeDoc(new TextEncoder().encode("garbage")), /Not an ISNOTE/);
});

test("geometry dependencies are removed with their points", () => {
  const page: Page = { objects: [
    { t: "gpoint", id: "A", x: 0, y: 0, label: "A" }, { t: "gpoint", id: "B", x: 10, y: 0, label: "B" },
    { t: "gseg", id: "s", a: "A", b: "B" }, { t: "gcircle", id: "c", c: "B", p: "A" },
  ] };
  assert.ok(hit(page, page.objects[2], 5, 1, 3));
  removeObject(page, "A");
  assert.deepEqual(page.objects.map((o) => o.id), ["B"]);
});

test("pdf structure", () => {
  const pdf = buildPdf([new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 10, 14);
  const s = new TextDecoder("latin1").decode(pdf);
  assert.match(s, /^%PDF-1\.4/);
  assert.match(s, /\/Count 2/);
  assert.match(s, /%%EOF\n$/);
  const xrefAt = +/startxref\n(\d+)/.exec(s)![1];
  assert.equal(s.slice(xrefAt, xrefAt + 4), "xref");
  // every xref offset must point at "N 0 obj"
  const entries = [...s.slice(xrefAt).matchAll(/(\d{10}) 00000 n/g)].map((m) => +m[1]);
  entries.forEach((off, i) => assert.equal(s.slice(off, off + 7), `${i + 1} 0 obj`));
});

import { project, rotator } from "../src/solids.ts";
import { SOLID_KINDS } from "../src/model.ts";

test("cube hidden edges: 12 edges, exactly 3 hidden in a generic view", () => {
  const p = project({ kind: "cube", yaw: -0.6, pitch: 0.45, roll: 0 });
  assert.equal(p.paths.length, 12);
  assert.equal(p.paths.filter((q) => q.hidden).length, 3);
  assert.equal(p.faces.length, 3);
});

test("every solid fits its bounding radius for random orientations", () => {
  for (const kind of SOLID_KINDS) for (let i = 0; i < 40; i++) {
    const p = project({ kind, yaw: i * 0.37, pitch: i * 0.91, roll: i * 0.53 });
    assert.ok(p.paths.length > 0, kind);
    for (const q of p.paths) for (let k = 0; k < q.pts.length; k += 2)
      assert.ok(Math.hypot(q.pts[k], q.pts[k + 1]) <= p.radius + 1e-9, `${kind} out of bounds`);
  }
});

test("rotation is orthonormal and cylinder/cone/sphere have outlines", () => {
  const R = rotator(0.7, -0.4, 1.1);
  const v = R([1, 2, 3]);
  assert.ok(Math.abs(Math.hypot(...v) - Math.hypot(1, 2, 3)) < 1e-12);
  const cyl = project({ kind: "cylinder", yaw: 0.5, pitch: 0.4, roll: 0 });
  assert.equal(cyl.paths.filter((q) => q.pts.length === 4 && !q.hidden).length, 2); // two silhouette lines
  assert.ok(cyl.paths.some((q) => q.hidden)); // hidden back arc of the base
  const cone = project({ kind: "cone", yaw: 0.5, pitch: 0.4, roll: 0 });
  assert.equal(cone.paths.filter((q) => q.pts.length === 4 && !q.hidden).length, 2);
  const top = project({ kind: "cylinder", yaw: 0, pitch: Math.PI / 2, roll: 0 }); // looking straight down the axis
  assert.ok(top.paths.every((q) => !q.hidden || q.pts.length > 4));
  assert.ok(project({ kind: "sphere", yaw: 0.3, pitch: 0.3, roll: 0 }).paths.length >= 3);
});

import { netOf } from "../src/nets.ts";
import { meshOf, snapTargets, pickFace, pickSnap, facePoint, facesAt, invRotator } from "../src/solids.ts";
import { revolveVolume, projectRevolve } from "../src/revolve.ts";

const area = (p: number[]) => { let a = 0; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += p[j] * p[i + 1] - p[i] * p[j + 1]; return Math.abs(a) / 2; };
function overlap(a: number[], b: number[]): boolean { // convex polygons, separating-axis test (strict overlap only)
  for (const poly of [a, b]) for (let i = 0; i < poly.length; i += 2) {
    const j = (i + 2) % poly.length, nx = -(poly[j + 1] - poly[i + 1]), ny = poly[j] - poly[i];
    const proj = (q: number[]) => { let lo = Infinity, hi = -Infinity; for (let k = 0; k < q.length; k += 2) { const d = q[k] * nx + q[k + 1] * ny; lo = Math.min(lo, d); hi = Math.max(hi, d); } return [lo, hi]; };
    const [a0, a1] = proj(a), [b0, b1] = proj(b), eps = 1e-6 * Math.hypot(nx, ny);
    if (a1 <= b0 + eps || b1 <= a0 + eps) return false;
  }
  return true;
}

test("nets of polyhedra: right face count, area = surface area, no overlaps", () => {
  for (const kind of ["cube", "box", "pyramid", "tetra", "prism"] as const) {
    const m = meshOf(kind)!, net = netOf(kind)!;
    assert.equal(net.faces.length, m.f.length, kind);
    // surface area from the 3D mesh (triangulated fan)
    let surface = 0;
    for (const f of m.f) { for (let k = 1; k + 1 < f.length; k++) { const a = m.v[f[0]], b = m.v[f[k]], c = m.v[f[k + 1]]; const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; surface += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2; } }
    assert.ok(Math.abs(net.faces.reduce((s, f) => s + area(f.pts), 0) - surface) < 1e-9, `${kind} area`);
    for (let i = 0; i < net.faces.length; i++) for (let j = i + 1; j < net.faces.length; j++) assert.ok(!overlap(net.faces[i].pts, net.faces[j].pts), `${kind} faces ${i},${j} overlap`);
    // a net of a convex polyhedron has exactly (faces-1) fold edges, each counted on both sides
    assert.equal(net.faces.reduce((s, f) => s + f.fold.filter(Boolean).length, 0), 2 * (m.f.length - 1), `${kind} folds`);
  }
  assert.equal(netOf("sphere")!.approx, true); // approximate gore net
  const cyl = netOf("cylinder")!, cone = netOf("cone")!;
  assert.equal(cyl.faces.length, 3); assert.equal(cone.faces.length, 2);
  assert.ok(Math.abs(area(cyl.faces[0].pts) - 2 * Math.PI * 0.5) < 1e-9); // rectangle = lateral area
  const l = Math.hypot(0.5, 1);
  assert.ok(Math.abs(area(cone.faces[0].pts) - Math.PI * 0.5 * l) < 1e-2); // sector ≈ π r l
});

test("volume of revolution", () => {
  assert.ok(Math.abs(revolveVolume("1", 0, 2) - 2 * Math.PI) < 1e-6); // cylinder r=1, h=2
  assert.ok(Math.abs(revolveVolume("x", 0, 1) - Math.PI / 3) < 1e-6); // cone
  assert.ok(Math.abs(revolveVolume("sqrt(1-x^2)", -1, 1) - (4 * Math.PI) / 3) < 2e-3); // sphere
  assert.throws(() => revolveVolume("2+", 0, 1));
  for (const axis of ["x", "y"] as const) {
    const p = projectRevolve({ expr: "sqrt(x)", a: 0, b: 4, axis, yaw: 0.5, pitch: 0.4, roll: 0.2, rings: 6 })!;
    assert.ok(p.paths.length > 6);
    for (const q of p.paths) for (let k = 0; k < q.pts.length; k += 2) assert.ok(Math.hypot(q.pts[k], q.pts[k + 1]) <= p.radius + 1e-6, "inside bound");
  }
  assert.equal(projectRevolve({ expr: "0", a: 0, b: 1, axis: "x", yaw: 0, pitch: 0, roll: 0, rings: 3 }), null);
});

test("360° rotation: inverse rotation round-trips for any angles", () => {
  for (const [y, p, r] of [[0.3, 4.1, -5.9], [6.2, -3.3, 2.2], [-1, 0, 7]]) {
    const R = rotator(y, p, r), I = invRotator(y, p, r), v: [number, number, number] = [0.3, -0.7, 1.1];
    const back = I(R(v));
    assert.ok(back.every((c, i) => Math.abs(c - v[i]) < 1e-12));
  }
});

test("picking faces and points on a rotated cube", () => {
  const s = { kind: "cube" as const, yaw: -0.6, pitch: 0.45, roll: 0 };
  assert.ok(pickFace(s, 0, 0) !== null);
  assert.equal(pickFace(s, 5, 5), null);
  const targets = snapTargets("cube");
  assert.equal(targets.filter((t) => t.name).length, 8); // 8 named vertices
  assert.equal(targets.length, 8 + 12 + 6);
  const R = rotator(s.yaw, s.pitch, s.roll);
  const v = targets.find((t) => t.name === "A")!, q = R(v.p);
  assert.equal(pickSnap(s, q[0], -q[1], 0.05)!.name, "A");
  // a point picked on a face lies on that face's plane in 3D and maps back to the same screen position
  const f = pickFace(s, 0.1, -0.1)!, p = facePoint(s, f, 0.1, -0.1)!;
  assert.ok(facesAt("cube", p).includes(f));
  const back = R(p);
  assert.ok(Math.abs(back[0] - 0.1) < 1e-9 && Math.abs(-back[1] + 0.1) < 1e-9);
});

test("lines drawn on a solid are solid when on a visible face and dashed otherwise, and follow rotation", () => {
  const T = snapTargets("cube");
  const mk = (name: string) => { const t = T.find((x) => x.name === name)!; return { id: name, p: t.p, faces: t.faces, name }; };
  const hiddenOf = (yaw: number, pitch: number, a: string, b: string) => {
    const pr = project({ kind: "cube", yaw, pitch, roll: 0, marks: [mk(a), mk(b)], lines: [[a, b]] });
    return pr.lines[0].hidden;
  };
  // space diagonal A–C' goes through the inside: always dashed
  for (const yaw of [-0.6, 0.4, 2.5, 4]) assert.equal(hiddenOf(yaw, 0.45, "A", "C'"), true);
  // A–C is a diagonal of one face: solid exactly when that face is turned towards the viewer
  const face = facesAt("cube", mk("A").p).filter((f) => facesAt("cube", mk("C").p).includes(f));
  assert.ok(face.length >= 1);
  const seen = new Set<boolean>();
  for (const pitch of [0.45, -0.45]) for (let i = 0; i < 24; i++) seen.add(hiddenOf(i * 0.27, pitch, "A", "C")); // A–C lies on the bottom face: visible only from below
  assert.deepEqual([...seen].sort(), [false, true]); // visible from some angles, hidden from others
});

test("painting: faces are reported with their ids, and curved solids expose their faces", () => {
  assert.ok(project({ kind: "cylinder", yaw: 0.5, pitch: 0.5, roll: 0 }).faces.some((f) => f.id === 2));
  assert.ok(project({ kind: "cylinder", yaw: 0.5, pitch: 0.5, roll: 0 }).faces.some((f) => f.id === 0)); // top cap seen from above
  assert.ok(project({ kind: "cone", yaw: 0.5, pitch: -0.5, roll: 0 }).faces.some((f) => f.id === 0)); // base seen from below
  assert.equal(pickFace({ kind: "sphere", yaw: 0, pitch: 0, roll: 0 }, 0, 0), 0);
});
