// Copy / cut / paste / duplicate helpers: deep-copy objects with fresh ids, keeping geometry references consistent.
import { clone, uid, type Obj } from "./model.ts";

/** Deep copy `objs`, give every copy a new id, remap point references of segments/circles, and shift by (dx,dy). */
export function copyObjects(objs: Obj[], dx = 0, dy = 0): Obj[] {
  const ids = new Map<string, string>();
  for (const o of objs) ids.set(o.id, uid());
  const out: Obj[] = [];
  for (const src of objs) {
    const o = clone(src);
    o.id = ids.get(src.id)!;
    const mapId = (id: string): string | null => ids.get(id) ?? null;
    if (o.t === "gline") {
      const p = mapId(o.p); if (!p) continue;
      o.p = p;
      if (o.q) { const q = mapId(o.q); if (!q) continue; o.q = q; }
      if (o.par) { const q = mapId(o.par); if (!q) continue; o.par = q; }
      if (o.perp) { const q = mapId(o.perp); if (!q) continue; o.perp = q; }
      if (o.bis) { const b = o.bis.map(mapId); if (b.some((x) => !x)) continue; o.bis = b as [string, string, string]; }
    } else if (o.t === "gpoly") {
      const p = o.pts.map(mapId); if (p.some((x) => !x)) continue; o.pts = p as string[];
    } else if (o.t === "gangle") {
      const a = mapId(o.a), b = mapId(o.b), cc = mapId(o.c); if (!a || !b || !cc) continue; o.a = a; o.b = b; o.c = cc;
    } else if (o.t === "gmark") {
      const s = mapId(o.seg); if (!s) continue; o.seg = s;
    } else if (o.t === "gpoint" && o.def) {
      const d = o.def as unknown as Record<string, unknown>;
      let ok = true;
      for (const k of ["a", "b", "c", "p", "l"]) if (typeof d[k] === "string") { const m = mapId(d[k] as string); if (m) d[k] = m; else ok = false; }
      if (!ok) { delete o.def; } // parents were not copied: keep the point where it is, as a free point
    }
    if (o.t === "gseg") {
      if (!ids.has(o.a) || !ids.has(o.b)) continue; // a segment copied without its points is dropped
      o.a = ids.get(o.a)!; o.b = ids.get(o.b)!;
    } else if (o.t === "gcircle") {
      if (!ids.has(o.c) || !ids.has(o.p)) continue;
      o.c = ids.get(o.c)!; o.p = ids.get(o.p)!;
    } else if (o.t === "stroke") { for (let i = 0; i < o.pts.length; i += 2) { o.pts[i] += dx; o.pts[i + 1] += dy; } }
    else if (o.t === "gline" || o.t === "gpoly" || o.t === "gangle" || o.t === "gmark") { /* positions follow their points */ }
    else if (o.t === "gpoint" && o.def) { /* constructed points are recomputed from their (copied) parents */ }
    else if (o.t === "line") { o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; }
    else if (o.t === "fill") { for (let i = 0; i < o.runs.length; i += 3) { o.runs[i] += dy; o.runs[i + 1] += dx; o.runs[i + 2] += dx; } }
    else { (o as { x: number }).x += dx; (o as { y: number }).y += dy; }
    out.push(o);
  }
  return out;
}
