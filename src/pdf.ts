// Minimal PDF writer: one JPEG image per page, A4 (595 x 842 pt).
const enc = new TextEncoder();

/** Pages are A4; `landscape[i]` swaps a page to 842 x 595 pt (its JPEG must then be pxH x pxW). */
export function buildPdf(jpegs: Uint8Array[], pxW: number, pxH: number, landscape: boolean[] = []): Uint8Array {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (d: Uint8Array | string) => {
    const b = typeof d === "string" ? enc.encode(d) : d;
    chunks.push(b);
    len += b.length;
  };
  const obj = (n: number, body: string | (() => void)) => {
    offsets[n] = len;
    push(`${n} 0 obj\n`);
    if (typeof body === "string") push(body); else body();
    push("\nendobj\n");
  };
  const n = jpegs.length;
  // Object layout: 1 catalog, 2 pages, then per page i: page=3+3i, content=4+3i, image=5+3i.
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Count ${n} /Kids [${jpegs.map((_, i) => `${3 + 3 * i} 0 R`).join(" ")}] >>`);
  jpegs.forEach((jpg, i) => {
    const p = 3 + 3 * i;
    const W = landscape[i] ? 842 : 595, H = landscape[i] ? 595 : 842;
    const iw = landscape[i] ? pxH : pxW, ih = landscape[i] ? pxW : pxH;
    obj(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`);
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(p + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    obj(p + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
      push(jpg);
      push("\nendstream");
    });
  });
  const total = 3 + 3 * n;
  const xref = len;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let i = 1; i < total; i++) push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
