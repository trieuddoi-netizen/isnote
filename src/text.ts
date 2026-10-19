// Text boxes: font strings and word-wrap layout (the measuring function is injected so this stays DOM-free and testable).
import type { TextObj } from "./model.ts";

export const FONT_FAMILY: Record<TextObj["font"], string> = {
  sans: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "'Times New Roman', Georgia, serif",
  mono: "ui-monospace, Menlo, Consolas, monospace",
  hand: "'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive",
};
export type TextStyle = Pick<TextObj, "font" | "size" | "bold" | "italic">;
export const fontCss = (o: TextStyle): string => `${o.italic ? "italic " : ""}${o.bold ? "bold " : ""}${o.size}px ${FONT_FAMILY[o.font]}`;
export const LINE_HEIGHT = 1.3;

export interface TextLine { text: string; bullet: boolean; indent: number; width: number }
export interface TextLayout { lines: TextLine[]; lineH: number; h: number }

/** Break `o.text` into lines that fit `o.w`. Every paragraph (split on \n) gets a bullet when `o.bullets`. */
export function layoutText(o: Pick<TextObj, "text" | "w" | "size" | "bullets">, measure: (s: string) => number): TextLayout {
  const lineH = o.size * LINE_HEIGHT;
  const indent = o.bullets ? o.size * 1.1 : 0;
  const room = Math.max(o.size, o.w - indent);
  const lines: TextLine[] = [];
  for (const para of o.text.split("\n")) {
    const words = para.split(/(\s+)/).filter((s) => s !== "");
    let cur = "", first = true;
    const push = () => { lines.push({ text: cur.replace(/\s+$/, ""), bullet: o.bullets && first, indent, width: measure(cur.replace(/\s+$/, "")) }); first = false; cur = ""; };
    for (const w of words) {
      if (cur && measure(cur + w) > room && w.trim()) push();
      if (!cur && !w.trim() && !first) continue; // no leading blanks on wrapped lines
      cur += w;
      while (measure(cur) > room && cur.length > 1) { // a single word longer than the box: split by characters
        let k = cur.length - 1;
        while (k > 1 && measure(cur.slice(0, k)) > room) k--;
        const rest = cur.slice(k);
        cur = cur.slice(0, k); push(); cur = rest;
      }
    }
    push();
  }
  return { lines, lineH, h: Math.max(lines.length, 1) * lineH };
}

/** x of a line's left edge for the given alignment inside the box. */
export function lineX(o: Pick<TextObj, "x" | "w" | "align">, l: TextLine): number {
  const room = o.w - l.indent;
  const off = o.align === "center" ? (room - l.width) / 2 : o.align === "right" ? room - l.width : 0;
  return o.x + l.indent + Math.max(0, off);
}
