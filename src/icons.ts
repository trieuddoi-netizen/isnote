// Line-style SVG icons (24x24, currentColor). Drawn for ISNOTE; shapes and solids are generated from their own geometry.
import { curvePaths, isCurveFigure, shapePoints } from "./figures.ts";
import { project } from "./solids.ts";
import type { PenKind, ShapeKind, SolidKind } from "./model.ts";

const P: Record<string, string> = {
  menu: "M4 6h16M4 12h16M4 18h16",
  save: "M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6",
  undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  paste: "M9 4h6v3H9zM7 5.5H5V21h14V5.5h-2M8 12h8M8 16h5",
  newpage: "M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6",
  delpage: "M6 3h8l4 4v14H6zM14 3v4h4M9.5 12l5 5M14.5 12l-5 5",
  settings: "M4 7h9M17 7h3M4 17h3M11 17h9",
  pen: "M4 20l1-4L16 5l3 3L8 19zM14 7l3 3",
  highlighter: "M6 19l-1 2 3-1M7 18l9-9-3-3-9 9zM13 6l3-3 4 4-3 3",
  laser: "M12 9.5v.01M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1",
  eraser: "M4 15l8-8 7 7-5 5H8zM9 10l7 7M10 20h10",
  rectsel: "M5 5h14v14H5z",
  lasso: "M12 5c4.4 0 8 1.8 8 4s-3.6 4-8 4-8-1.8-8-4 3.6-4 8-4zM9 13c-1 2 0 5 3 5",
  pointer: "M6 4l12 7-5 1.5L11 18z",
  hand: "M8 13V7.5a1.5 1.5 0 0 1 3 0V12M11 11V5.5a1.5 1.5 0 0 1 3 0V12M14 11.5V7a1.5 1.5 0 0 1 3 0v6.5M17 11a1.5 1.5 0 0 1 3 0v4c0 4-3 6-6.5 6S8 19 6.5 16l-2-4a1.5 1.5 0 0 1 2.4-1.5L8 12",
  text: "M5 6V5h14v1M12 5v14M9 19h6",
  fill: "M5 12l7-7 7 7-6 6a2 2 0 0 1-3 0zM4 12h15M19 16c1 1.5 1.5 2.5 1.5 3.5a1.5 1.5 0 0 1-3 0c0-1 .5-2 1.5-3.5",
  line: "M5 19 19 5",
  formula: "M17 5H7l6 7-6 7h10",
  graph: "M4 4v16h16M7 16c3-10 6-10 8-2s3 3 4 0",
  geometry: "M5 18 12 5l7 13z",
  shapes: "M3 20l5-9 5 9zM14 4h7v7h-7z",
  instruments: "M4 15 15 4l5 5L9 20zM8 11l2 2M11 8l2 2M14 5l2 2M6 13l1 1",
  chevron: "m7 10 5 5 5-5",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  fit: "M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3",
  pages: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  picture: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5v.01",
  pdf: "M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6",
  png: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4",
  trash: "M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v6M14 11v6",
  copy: "M9 9h11v11H9zM5 15V4h11",
  cut: "M7 17a2.5 2.5 0 1 0 .01 0M7 7a2.5 2.5 0 1 0 .01 0M9 8.5 20 17M9 15.5 20 7",
  duplicate: "M9 9h11v11H9zM5 15V4h11M14.5 12.5v6M11.5 15.5h6",
  left: "m15 5-7 7 7 7", right: "m9 5 7 7-7 7", up: "m5 15 7-7 7 7", down: "m5 9 7 7 7-7",
  ccw: "M4 12a8 8 0 1 0 3-6.2M4 4v4h4", cw: "M20 12a8 8 0 1 1-3-6.2M20 4v4h-4",
  thin: "M4 12h16", thick: "M4 12h16",
  unfold: "M9 3h6v6h6v6h-6v6H9v-6H3V9h6z",
  revolve: "M20 12a8 8 0 1 1-3-6.2M20 4v4h-4",
  paint: "M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2s0-2 1.5-2h2a3 3 0 0 0 3-3c0-6-3.5-11-8-11zM8 11v.01M12 7.5v.01M16 11v.01",
  surf: "M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11zM12 10v.01",
  edit: "M4 20h4L19 9l-4-4L4 16z",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  layers: "m12 4 8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4",
  space: "M4 6h16M4 18h16M12 8v8M9.5 10.5 12 8l2.5 2.5M9.5 13.5 12 16l2.5-2.5",
  touch: "M12 11V5a1.5 1.5 0 0 1 3 0v8l2 .5a2 2 0 0 1 1.5 2L18 20H10l-4-5 1.5-1.5L10 15z",
  // geometry
  point: "M12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0",
  segment: "M5 18 19 6M5 18v.01M19 6v.01",
  ray: "M5 18 20 5M5 18v.01",
  gline: "M3 19 21 5",
  circle: "M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0",
  polygon: "M5 17l3-11 10 3 2 9z",
  midpoint: "M4 12h16M4 9v6M20 9v6M12 10v4",
  perpendicular: "M4 18h16M12 18V4M12 14h4v4",
  parallel: "M4 9h16M4 15h16",
  altitude: "M4 19h16L9 5zM9 5v14M9 15h3.5",
  intersection: "M4 18 20 6M4 6l16 12",
  bisector: "M4 19 20 19M4 19 18 6M4 19 20 12",
  centroid: "M4 19h16L10 5zM10 5l5 14M4 19l8-8M20 19 7 12",
  orthocenter: "M4 19h16L10 5zM10 5v14M4 19l9-8M20 19l-12-8",
  circumcenter: "M4 19h16L10 5zM7 12l-1 5M15 12v5",
  incenter: "M4 19h16L10 5zM4 19l8-8M20 19 11 11M10 5v6",
  circumcircle: "M4 17l8-12 8 12zM12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0",
  reflectLine: "M12 3v18M6 8l-3 4 3 4zM18 8l3 4-3 4z",
  reflectPoint: "M12 12v.01M5 8v.01M19 16v.01M5 8 19 16",
  translate: "M4 18l6-9M14 18l6-9M4 18h10M10 9h10",
  rotate: "M12 12 20 12M12 12l5 5M17 7a7 7 0 0 1 0 10M19 17v-3h-3",
  dilate: "M5 19h6V13H5zM5 19 19 5M14 10h5V5h-5z",
  angle: "M4 19h16M4 19 16 6M9 19a5 5 0 0 0-1-3",
  rightAngle: "M5 5v14h14M5 14h5v5",
  equalMark: "M4 12h16M10 8v8M14 8v8",
  helper: "M4 8h16M4 16h16",
  names: "M7 18l5-13 5 13M9 14h6",
  // instruments
  ruler: "M3 9h18v6H3zM7 9v3M11 9v2M15 9v3M19 9v2",
  protractor: "M3 18h18M3 18a9 9 0 0 1 18 0M12 18v-3",
  square: "M4 19V5l15 14zM8 15V11",
  compass: "M12 4v4M12 8 6 20M12 8l6 12M8 15h8",
  grip: "M9 5v.01M15 5v.01M9 12v.01M15 12v.01M9 19v.01M15 19v.01",
  rotatemode: "M20 12a8 8 0 1 1-3-6.2M20 4v4h-4M12 9l3 3-3 3-3-3z",
  cube: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  play: "M8 5v14l11-7z",
  pause: "M8 5v14M16 5v14",
  loop: "M17 2l3 3-3 3M20 5H8a4 4 0 0 0-4 4v1M7 22l-3-3 3-3M4 19h12a4 4 0 0 0 4-4v-1",
  plane: "M4 16l4-9 12 3-4 9zM8 7l8 3M4 16l12 3",
  outer: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  check: "m5 12 5 5 9-10",
  close: "M6 6l12 12M18 6 6 18",
  more: "M6 12v.01M12 12v.01M18 12v.01",
  help: "M9 9a3 3 0 1 1 4 2.8c-1 .5-1 1.2-1 2.2M12 18v.01",
  sheet: "M4 8h6l2-3h8v14H4z",
};

export type IconName = keyof typeof P;
const DASHED: Record<string, string> = { gline: "", helper: "3 3" };
export function icon(name: string, size = 22, extra = ""): string {
  const d = P[name] ?? P.more;
  const w = name === "thin" ? 1.1 : name === "thick" ? 4.2 : 1.8;
  const fill = name === "laser" ? `<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>` : name === "point" ? `<circle cx="12" cy="12" r="2.8" fill="currentColor" stroke="none"/>` : "";
  const dash = name === "helper" ? ' stroke-dasharray="3 3"' : "";
  void DASHED;
  return `<svg class="svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}><path d="${d}"${dash}/>${fill}</svg>`;
}

/** Pen-kind icons: same barrel, different tips. */
export function penIcon(k: PenKind, size = 22): string {
  const body = "M5 19l1-4 9-9 3 3-9 9z";
  const tip: Record<PenKind, string> = {
    ballpoint: "M13 8l3 3M5 19l3-1",
    felt: "M5 19l1-4M12 9l3 3M4 20h5",
    fountain: "M6 15l-1 4 4-1M10 11l2 2M8 13l3 3",
    pencil: "M6 15l-1 4 4-1M13 8l3 3M6 15l3 3",
    brush: "M6 15c-2 0-2 3-3 4 3 1 5 0 5-2M10 11l5-5 3 3-5 5z",
  };
  return `<svg class="svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${k === "brush" ? "" : body}"/><path d="${tip[k]}"/></svg>`;
}

/** Plane-figure icon generated from the figure's own outline. */
export function shapeIcon(kind: ShapeKind, size = 26): string {
  const S = 20, o = 2;
  const pt = ([x, y]: [number, number]) => `${(o + x * S).toFixed(1)} ${(o + y * S).toFixed(1)}`;
  let d = "";
  if (isCurveFigure(kind)) {
    for (const sp of curvePaths(kind)) d += `M${sp.pts.map(pt).join("L")}${sp.closed ? "Z" : ""}`;
  } else {
    const p = shapePoints(kind);
    if (p === "ellipse") d = kind === "circle" ? `M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0` : `M2 12a10 6.5 0 1 0 20 0a10 6.5 0 1 0-20 0`;
    else d = `M${p.map(pt).join("L")}Z`;
  }
  return `<svg class="svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}
/** Solid icon: the solid's own projection, hidden edges dashed. */
export function solidIcon(kind: SolidKind, size = 28): string {
  const pr = project({ kind, yaw: -0.6, pitch: 0.45, roll: 0 });
  const k = 11 / pr.radius, c = 12;
  const path = (hidden: boolean) => pr.paths.filter((p) => p.hidden === hidden).map((p) => {
    let d = "";
    for (let i = 0; i < p.pts.length; i += 2) d += `${i ? "L" : "M"}${(c + p.pts[i] * k).toFixed(1)} ${(c + p.pts[i + 1] * k).toFixed(1)}`;
    return d;
  }).join("");
  return `<svg class="svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="${path(false)}"/><path d="${path(true)}" stroke-dasharray="1.8 1.8" opacity=".7"/></svg>`;
}
export function styleIcon(style: string): string {
  const dash = style === "dashed" ? ' stroke-dasharray="4 3"' : style === "dashdot" ? ' stroke-dasharray="6 2.5 1 2.5"' : "";
  const head = style === "arrow" || style === "double" ? `<path d="M15 8l5 4-5 4"/>` : "";
  const head2 = style === "double" ? `<path d="M9 8l-5 4 5 4"/>` : "";
  const x1 = style === "double" ? 5 : 3, x2 = style === "arrow" || style === "double" ? 19 : 21;
  return `<svg class="svg" width="28" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M${x1} 12H${x2}"${dash}/>${head}${head2}</svg>`;
}
