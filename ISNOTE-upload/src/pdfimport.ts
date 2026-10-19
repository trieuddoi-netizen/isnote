// Import PDF pages as page backgrounds (pdf.js, loaded on demand so the editor starts fast).
export interface PdfPage { jpeg: string; w: number; h: number } // jpeg = data URL, w/h = rendered pixels

const TARGET = 2000; // pixels on the longer side of each rendered page

/** Render every page (up to `max`) of a PDF file to JPEG data URLs. `progress` is called after each page. */
export async function importPdf(bytes: Uint8Array, max = 100, progress?: (done: number, total: number) => void): Promise<PdfPage[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({ data: bytes });
  const pdf = await task.promise;
  const total = Math.min(pdf.numPages, max);
  const out: PdfPage[] = [];
  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const k = Math.min(4, TARGET / Math.max(base.width, base.height));
    const vp = page.getViewport({ scale: k });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    out.push({ jpeg: c.toDataURL("image/jpeg", 0.88), w: c.width, h: c.height });
    page.cleanup();
    progress?.(i, total);
  }
  await pdf.destroy();
  return out;
}
