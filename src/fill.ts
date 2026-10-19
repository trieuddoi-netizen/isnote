// Fill tool: flood-fill a closed region of a raster and return it as scanline runs. Pure (works on RGBA bytes).
/** Flood-fill from (sx,sy). Pixels within `tol` (sum of |dr|+|dg|+|db|) of the seed colour are filled.
 *  Returns runs [y,x0,x1, ...] (x1 inclusive) or null when the seed is outside the raster or the area is the whole page. */
export function floodFill(data: Uint8ClampedArray, w: number, h: number, sx: number, sy: number, tol = 90, grow = 1, maxFraction = 0.85): number[] | null {
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const px = (x: number, y: number) => (y * w + x) * 4;
  const s = px(sx, sy);
  const r0 = data[s], g0 = data[s + 1], b0 = data[s + 2];
  const like = (x: number, y: number) => {
    const i = px(x, y);
    return Math.abs(data[i] - r0) + Math.abs(data[i + 1] - g0) + Math.abs(data[i + 2] - b0) <= tol;
  };
  const mask = new Uint8Array(w * h);
  const stack: number[] = [sx, sy];
  let count = 0;
  while (stack.length) {
    const y = stack.pop()!, x = stack.pop()!;
    if (mask[y * w + x] || !like(x, y)) continue;
    let l = x, r = x;
    while (l > 0 && !mask[y * w + l - 1] && like(l - 1, y)) l--;
    while (r < w - 1 && !mask[y * w + r + 1] && like(r + 1, y)) r++;
    for (let i = l; i <= r; i++) mask[y * w + i] = 1;
    count += r - l + 1;
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= h) continue;
      let inRun = false;
      for (let i = l; i <= r; i++) {
        const ok = !mask[ny * w + i] && like(i, ny);
        if (ok && !inRun) { stack.push(i, ny); inRun = true; } else if (!ok) inRun = false;
      }
    }
  }
  if (count > maxFraction * w * h) return null; // leaking: the region is not closed
  let m = mask;
  for (let k = 0; k < grow; k++) { // cover the anti-aliased halo next to the ink
    const n = new Uint8Array(m);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) {
      if (x > 0) n[y * w + x - 1] = 1; if (x < w - 1) n[y * w + x + 1] = 1;
      if (y > 0) n[(y - 1) * w + x] = 1; if (y < h - 1) n[(y + 1) * w + x] = 1;
    }
    m = n;
  }
  const runs: number[] = [];
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!m[y * w + x]) { x++; continue; }
      const a = x;
      while (x < w && m[y * w + x]) x++;
      runs.push(y, a, x - 1);
    }
  }
  return runs;
}
export const runsArea = (runs: number[]): number => { let a = 0; for (let i = 0; i < runs.length; i += 3) a += runs[i + 2] - runs[i + 1] + 1; return a; };
