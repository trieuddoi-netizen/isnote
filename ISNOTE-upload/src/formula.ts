// LaTeX -> SVG image via MathJax (pure JS, runs offline in the browser). Results are cached per (latex,color).
export interface FormulaImage { img: HTMLImageElement; w: number; h: number }

let ready: Promise<{ convert: (latex: string) => { svg: string; vw: number; vh: number } }> | undefined;

function load() {
  return (ready ||= (async () => {
    const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }] = await Promise.all([
      import("@mathjax/src/js/mathjax.js"),
      import("@mathjax/src/js/input/tex.js"),
      import("@mathjax/src/js/output/svg.js"),
      import("@mathjax/src/js/adaptors/liteAdaptor.js"),
      import("@mathjax/src/js/handlers/html.js"),
    ]);
    // Literal specifiers so the bundler includes each TeX package.
    await Promise.all([
      import("@mathjax/src/js/input/tex/base/BaseConfiguration.js"),
      import("@mathjax/src/js/input/tex/ams/AmsConfiguration.js"),
      import("@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js"),
      import("@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js"),
      import("@mathjax/src/js/input/tex/color/ColorConfiguration.js"),
      import("@mathjax/src/js/input/tex/cancel/CancelConfiguration.js"),
      import("@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js"),
    ]);
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const doc = mathjax.document("", {
      InputJax: new TeX({
        packages: ["base", "ams", "newcommand", "boldsymbol", "color", "cancel", "textmacros"],
        formatError: (_j: unknown, err: unknown) => { throw err; },
      }),
      OutputJax: new SVG({ fontCache: "local" }),
    });
    return {
      convert(latex: string) {
        const node = doc.convert(latex, { display: true });
        const svg = adaptor.firstChild(node) as unknown as Parameters<typeof adaptor.getAttribute>[0];
        const vb = String(adaptor.getAttribute(svg, "viewBox") || "").split(/\s+/).map(Number);
        if (vb.length !== 4 || vb.some((n) => !Number.isFinite(n))) throw new Error("Could not render formula");
        adaptor.setAttribute(svg, "xmlns", "http://www.w3.org/2000/svg");
        return { svg: adaptor.outerHTML(svg), vw: vb[2], vh: vb[3] };
      },
    };
  })());
}

const cache = new Map<string, FormulaImage | Promise<FormulaImage | null>>();

/** Raw SVG markup (for the live preview in the editor dialog). Throws on invalid LaTeX. */
export async function renderSvg(latex: string): Promise<string> {
  const src = latex.trim();
  if (!src) throw new Error("Empty formula");
  return (await load()).convert(src).svg;
}

/** Resolves once the formula image is ready (or null if the LaTeX is invalid). Used before exporting. */
export async function loadFormulaImage(latex: string, color: string, size: number): Promise<FormulaImage | null> {
  const key = `${size}|${color}|${latex}`;
  if (!cache.has(key)) formulaImage(latex, color, size, () => {});
  const v = cache.get(key);
  return v instanceof Promise ? v : (v ?? null);
}

/** Image for drawing on the canvas, sized for `size` page units per em. Returns null while loading or on error. */
export function formulaImage(latex: string, color: string, size: number, onReady: () => void): FormulaImage | null {
  const key = `${size}|${color}|${latex}`;
  const hit = cache.get(key);
  if (hit && !(hit instanceof Promise)) return hit;
  if (!hit) {
    const p = (async () => {
      try {
        const { svg, vw, vh } = (await load()).convert(latex.trim());
        const w = (vw / 1000) * size, h = (vh / 1000) * size;
        const root = /^<svg[^>]*>/.exec(svg)![0];
        const newRoot = root.replace(/\s(width|height|style)="[^"]*"/g, "").replace("<svg", `<svg width="${w}" height="${h}" style="color:${color}"`);
        const sized = newRoot + svg.slice(root.length);
        const img = new Image();
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
        await img.decode();
        const res = { img, w, h };
        cache.set(key, res);
        onReady();
        return res;
      } catch {
        cache.set(key, Promise.resolve(null));
        return null;
      }
    })();
    cache.set(key, p);
  }
  return null;
}
