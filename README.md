# ISNOTE

Free, open-source (MIT) ink notebook: handwriting, LaTeX formulas, function graphs and simple dynamic geometry.
Written from scratch; it shares no code with any other product. Runs in any modern browser and installs on iPad as a PWA.

## Features
- New in v0.3: magenta theme (change `--brand` / `--accent` at the top of `src/style.css`), slim top bar + grouped tool strip with popovers and a contextual bar, blue-ruled notebook paper with a pink margin as the default, nets for every solid (the sphere and spherical cap are approximate gore nets and say so), dynamic-geometry constructions, graph tools, drawing instruments, sheets (tabs), pinch zoom and input modes
- Pen, highlighter, laser and eraser sit together at the start of the tool strip (eraser ▾: whole-stroke eraser or small / medium / large segment eraser that cuts strokes); move/select (Apple Pencil, mouse, or finger via the ☝ toggle)
- Formulas: LaTeX rendered with MathJax, offline
- Graphs: drag a rectangle, enter functions of `x` (`x^2-2`, `sin(x)`, `2x+1`, `1/x`…); a safe parser, no `eval`
- Geometry: points, segments, circles; drag points and everything attached follows
- 16 preset plane shapes and 13 solids; hidden edges are dashed
- Solids rotate freely through 360° on every axis (drag the orange handle; Shift = roll; arrow keys; sliders in ⚙)
- Paint each face of a solid or net separately; show vertex names (A, B, C, A', …)
- Add points (vertices, midpoints, face centres, any point on a face) and join them on a solid: the lines stay attached when it rotates, solid when on a visible face and dashed otherwise
- Unfold a solid into its net (fold lines dashed); solids of revolution from a graph (about Ox or Oy) with volume
- Thinner/thicker lines for any selected object, down to 0.4
- Pens: ballpoint, felt-tip, fountain (angled nib), pencil, brush; smoothing 0–5; Apple Pencil pressure changes the width
- Ink modes: plain ink, ink-to-line, ink-to-shape (a stroke becomes a straight line, circle/ellipse, triangle or rectangle when you lift the pen); laser pointer that fades
- Text boxes (font, size, bold/italic/underline, colour, alignment, bullets), line styles (solid, dashed, dash-dot, arrow, double arrow), fill tool for closed regions
- Selection by rectangle or free shape; copy / cut / paste / duplicate (Ctrl/Cmd + C X V D)
- Paper: plain, ruled, squared, dotted; paper colour, portrait/landscape, line spacing; insert pictures; import PDF pages as page backgrounds (pdf.js, loaded on demand)
- Zoom (buttons, Ctrl/Cmd + wheel), fit width, page list panel with thumbnails, go-to-page box
- Also: hyperbola, parabola, annulus; octahedron, frustum of pyramid, frustum of cone, truncated cylinder, spherical cap
- Geometry constructions that follow dragged points: midpoint, line/ray, perpendicular, parallel, altitude, intersection (line/circle), angle bisector, centroid, orthocentre, circumcentre, incentre, circumcircle, reflection in a line/point, translation, rotation, dilation, polygon, angle measure, right-angle and equal-length marks; hide names, dots or helper (dashed) lines
- Graphs: inequality regions, points on the graph with coordinates and guide lines, quick x-intercepts / y-intercept / extrema / intersections, legend, 1:1 scale, grid step and axis text size
- Instruments (ruler, protractor, set-square, compass): the pen follows their edge; insert-space tool; sheets (named tabs inside a notebook)
- Input modes (auto / pen and finger / pen only / finger only) with palm rejection; two-finger pinch zoom and scroll; draggable line ends; paper changes are undoable
- Multi-page notebooks, undo/redo, autosave (IndexedDB), Vietnamese/English UI
- Save/open `.isnote` (gzip JSON; old `.openink` files still open), export PNG (current page) and PDF (all pages)

## Run
```bash
npm install
npm run dev        # development
npm run build      # static site in dist/
npm test           # unit tests (Node 22.6+)
```

## Install on iPad (no Mac, no Apple developer account)
ISNOTE is a web app (PWA). `npm run build` makes a static site in `dist/`; `release/ISNOTE-web.zip` is the same site zipped.
1. Put the site on any **HTTPS** static host: GitHub Pages (a ready workflow is in `.github/workflows/pages.yml`), Netlify Drop (drag the zip's contents), Cloudflare Pages…
2. On the iPad open the HTTPS address in **Safari** → Share → **Add to Home Screen** → Add. It opens full screen with the ISNOTE icon.
3. Open it once while online: the whole app (including the PDF reader) is cached, and it then works offline.
4. Trying it before hosting: `npm run preview` on the Mac, then open `http://<Mac's address>:4173` in Safari on the same Wi-Fi. That works for testing but is not offline and does not install as a full PWA.

A native App Store/TestFlight build (Capacitor) would need Xcode and an Apple Developer account; it is not set up here.

## Animated unfold (in place)
"Unfold" (selected solid → contextual bar) folds the **same solid** out flat on the page and back; nothing is copied. The solid has a fold value `fold` (0 = flat net, 1 = closed, the default; saved in the `.openink` file and used by PNG/PDF export) with a slider, Play/Pause, Loop and speed (0.5× / 1× / 2×) in the contextual bar. "Copy net" puts a static net beside the solid; old files with separate net or fold objects still open.
- Everything drawn on the solid goes along: painted faces, vertex names, and the points and segments added with "Points & lines on solid". Each point rides rigidly on its face (exact net position at t = 0, exact 3D position at t = 1). A segment lying on a face (or along an edge) unfolds with that face and is solid when the face turns towards the viewer, dashed otherwise; a segment through the inside of the solid cannot lie on the net, so it is dashed and fades out as the model flattens (gone at t = 0).
- Points and segments can be added at any t (picking uses the folded geometry), including on the flat net.
- Rotation (orange handle, Shift = roll, arrows, ⚙), shading, line width and colours work at any t. The flat net faces the viewer; the orientation turns smoothly into the solid's own at t = 1.
- Polyhedra (cube, box, pyramid, tetrahedron, prism, octahedron, frustum of a pyramid): each face turns about its hinge edge by the exterior dihedral angle × t. Cylinder, cone and frustum of a cone: the lateral surface bends continuously and the caps swing about their tangent hinge, marks map through that bending.
- Truncated cylinder, sphere and spherical cap have no animated model ("Unfold" gives their static net). Not done: a "surface path" line that crosses several faces and becomes a polyline on the net.

## Cross-sections (interior planes)
- **Paint a section:** with the paint tool, tap inside a closed planar loop of lines on a solid (e.g. triangle S-A-C, S-B-D, or S-M-C through a mark M on an edge). Loops are found automatically from the lines you drew plus the solid's own edges between marks, and must be coplanar; the smallest loop under the pointer wins over the outer face. Tap again with the same colour to clear it. Hold Alt, or switch on "Paint outer faces only" in the contextual bar, to paint the outer face instead.
- **Define a plane:** surf tool → "Plane through marks": tap 3 or more marks, then Enter (or tap the first mark again). Marks that are not coplanar are refused; missing polygon edges are added as lines.
- Sections are stored on the solid (`sections`), drawn as translucent fills (hidden parts included), follow rotation, shading, undo/redo, save/load, export and the unfold animation: a section lying on one outer face unfolds with it, any other section fades out as the model flattens (opacity 1 at t = 1, 0 at t = 0).

## Auto-rotate (turntable)
Contextual bar (solids, solids of revolution, folded models at any fold value) and settings: play/pause (also **Space** with a 3D object selected), speed 0.25×–4× (1× = one revolution in 10 s), axis (vertical / horizontal / roll / free tumble), direction, and "Export this frame (PNG)". Smooth and frame-rate independent (requestAnimationFrame, delta time, paused while the tab is hidden); it keeps going while you paint or add points, several objects can turn at once, dragging the rotation handle stops that object, and the final angle is saved. The whole run is a single undo step (none if you edited meanwhile).

## Writing / rotate mode, toolbar layout, Apple Pencil
- **R** toggles between your last drawing tool and the Move/rotate tool (the selection is kept); there is also a button in the strip. Shortcuts are ignored while typing in a text box or dialog; press **?** for the list.
- Tapping the active tool again switches it off ("none": drag scrolls, a tap selects, nothing draws); tap again to re-activate. The ▾ next to a tool only opens its options.
- Settings (☰ → ⚙, or hold the grip at the start of the strip): toolbar size 80–160 %, dock top / bottom / left / right, floating (drag the grip with finger or Pencil, drop near an edge to dock), hide / show, reset. Stored in `localStorage`.
- **Pencil double-tap.** Safari and installed PWAs on iPadOS do **not** receive the Apple Pencil 2 barrel double-tap; Apple delivers it only to native apps through `UIPencilInteraction`. OpenInk therefore cannot react to the physical gesture today. What exists: `pencilDoubleTap()` with a setting (eraser and back / previous tool / writing ↔ rotate / next pen colour), triggered by (1) `window.dispatchEvent(new CustomEvent("openink-pencil-double-tap"))`, (2) double-tapping the small quick-switch button at the bottom right (a single tap toggles writing ↔ rotate), (3) the **D** key. Pencil hover shows a ring preview of the tip.
- To get the real barrel gesture you would wrap the built site in a native shell (for example Capacitor) with a small plugin that registers a `UIPencilInteraction` and calls `window.dispatchEvent(new CustomEvent("openink-pencil-double-tap"))` from its delegate. That needs Xcode and an Apple ID (a free one is enough to run on your own iPad for 7 days at a time); it has not been set up here.

## Limits (v0.3)
- PDF import needs the app to have been opened online once to cache pdf.js's worker
- Geometry intersections treat segments as infinite lines; equal-angle arcs exist in the file format but have no toolbar button; insert-space does not move flood fills
- Nets of the sphere and spherical cap are approximate (gores); they carry no vertex labels
- Not yet: LaTeX/graph/instrument long-press editing (double-click with the Move tool), importing other apps' notebooks

## License
MIT, see `LICENSE`.
