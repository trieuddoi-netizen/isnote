// Insert-space tool: push everything below a horizontal line down (or up) to make room. Pure.
import { moveObject, type Page } from "./model.ts";
import { boundsOf } from "./bounds.ts";

/** Move every object whose top edge is at or below `y` by `dy`. Constructed points and segments follow their parents, so only free objects move. Returns how many moved. */
export function insertSpace(page: Page, y: number, dy: number): number {
  let n = 0;
  for (const o of page.objects) {
    if (o.t === "fill" || o.t === "gseg" || o.t === "gcircle" || o.t === "gline" || o.t === "gpoly" || o.t === "gangle" || o.t === "gmark") continue; // follow their points
    if (o.t === "gpoint" && o.def) continue;
    const b = boundsOf(o, page);
    if (!b) continue;
    if (b[1] >= y) { moveObject(page, o, 0, dy); n++; }
  }
  return n;
}
