// Sheets: named tabs inside one notebook. Every page belongs to a sheet (Page.sheet, default 0); Doc.sheets lists the names.
import type { Doc, Page } from "./model.ts";

export const sheetNames = (d: Doc): string[] => (d.sheets && d.sheets.length ? d.sheets : ["1"]);
export const sheetOf = (p: Page): number => p.sheet ?? 0;
/** Indices (into doc.pages) of the pages of sheet `s`, in order. */
export const pagesIn = (d: Doc, s: number): number[] => d.pages.flatMap((p, i) => (sheetOf(p) === s ? [i] : []));

/** Add an empty sheet with one page; returns its index. */
export function addSheet(d: Doc, name: string, firstPage: Page): number {
  d.sheets = [...sheetNames(d), name];
  const idx = d.sheets.length - 1;
  d.pages.push({ ...firstPage, sheet: idx });
  return idx;
}
export function renameSheet(d: Doc, s: number, name: string): void {
  const n = [...sheetNames(d)];
  if (s >= 0 && s < n.length && name.trim()) { n[s] = name.trim(); d.sheets = n; }
}
/** Remove sheet `s` with its pages (the last sheet cannot be removed); later sheets are renumbered. Returns false if refused. */
export function removeSheet(d: Doc, s: number): boolean {
  const n = sheetNames(d);
  if (n.length <= 1 || s < 0 || s >= n.length) return false;
  d.pages = d.pages.filter((p) => sheetOf(p) !== s);
  for (const p of d.pages) if (sheetOf(p) > s) p.sheet = sheetOf(p) - 1;
  d.sheets = n.filter((_, i) => i !== s);
  return true;
}
