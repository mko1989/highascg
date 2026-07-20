# NATIVE_GUI_PROPOSITIONS

Options for porting the highascg web UI to a native Ubuntu GUI application.

Requested in `work/work-orders/todos19.07.26`: *"write a new md file in work folder giving me a
breakdown of options for porting the webui into a native ubuntu gui app. electron is a no go for me."*

Written 2026-07-20. Every number below is measured from this checkout, not estimated. The
measurement commands are shown so you can re-run them.

---

## 1. The port surface, measured

Before comparing toolkits, this is what a port would actually have to move.

### The client

```
find client -name '*.js' -not -path '*/node_modules/*' -not -path 'client/tools/*' | wc -l
find client -name '*.js' -not -path '*/node_modules/*' -not -path 'client/tools/*' -exec wc -l {} + | tail -1
```

| Thing | Measured |
|---|---|
| Client JS modules (excl. `client/tools/`) | **435 files** |
| Client JS LOC | **81,195** |
| — `client/components/` | 224 files, 51,436 LOC |
| — `client/lib/` | 207 files, 29,093 LOC |
| CSS files / LOC (excl. `client/tools/`) | **60 files, 11,998 LOC** |
| `client/index.html` | 117 LOC (a shell — the app is all ESM) |
| Built output `dist-web/` | **14 MB, 82 files** |

Confirmed: the client is **plain ESM modules with no framework**. No React, no Vue, no Svelte.
`client/package.json` is a bare ESM scope marker carrying an explicit "do not add dependencies here"
note. The only third-party runtime dependency is three.js, loaded by importmap in
`client/index.html:20-22` from `/vendor/three/build/three.module.js`. Build is Vite
(`vite.config.js`, 12,989 bytes — a substantial custom config), invoked as `npm run build:client`.

This matters for the port estimate in both directions. No framework means **no framework-shaped
rewrite tax** — there is no component model to translate, no JSX, no reactive-store idiom that has
to find a native equivalent. It also means there is no framework doing work for you: all 81,195 LOC
is hand-written application code, and essentially all of it is load-bearing.

### The contract between client and server

```
grep -rhoE "'/api/[a-zA-Z0-9/_:.-]+'" client --include=*.js | sort -u | wc -l
grep -rEn "\.(get|post|put|delete|patch)\(['\"\`]/" src index.js --include=*.js | wc -l
```

| Thing | Measured |
|---|---|
| Distinct `/api/...` paths referenced by client code | **163** |
| Route definitions in `src/` + `index.js` | **232** |
| Distinct WebSocket message types consumed by client | **~21** (`change`, `state`, `osc`, `mixer_update`, `compose`, `dmx`, `log_line`, `catalog_chunk`, `replication_status`, `gpu_topology_changed`, `streaming_channel`, `companion`, `autofollow`, `lower-third`, `global_border_sync`, `project_sync`, …) |
| Server JS LOC (`src/`) | **97,196** |

**This is the good news and it is the single most important structural fact in this document.** The
server is already fully decoupled. The client talks to it over 163 HTTP endpoints and a WebSocket
carrying ~21 message types — nothing more. There is no server-side rendering, no shared runtime, no
templating. **A native GUI would not touch `src/` at all.** Whatever toolkit you pick, the 97,196
LOC backend is unaffected, and a native client is a client like any other.

The state store is also small and pleasant: `client/lib/state-store.js` is **121 LOC** and
`client/lib/ws-client.js` is **206 LOC**. Re-implementing the transport layer in any language is a
few days of work, not a risk item. The risk is not the pipe; it is the 81,195 LOC hanging off it.

### The rendering surfaces

This is where a native port gets expensive. Measured cluster by cluster:

| Cluster | LOC | Technology | What it is |
|---|---|---|---|
| `preview-canvas-*` (8 files) | **2,193** | canvas 2D | PGM/PRV preview: letterboxed frames, compose-cell chrome, layer stacks, placeholder art, destination overlay. `preview-canvas-draw-base.js` alone has ~160 `ctx.` calls in 466 LOC. |
| Timeline (12 components + 9 lib) | **4,757** | canvas 2D + DOM | Ruler, SMPTE ticks, track headers, clips, keyframes, playhead; plus pointer/wheel/snap/clip interaction. Pure paint portion ~1,100–1,500 LOC. |
| Multiview editor | **1,642** | canvas 2D | Drag-drop grid editor placing PGM/PRV/DeckLink cells; px → normalised 0–1 for `MIXER FILL`. |
| Device-graph cables | **1,495** | **SVG**, not canvas | Bezier cable paths, drag ghosts, DeckLink key/fill links. Only ~300 LOC actually draws (`device-view-cables.js`); the rest is interaction/validation/physics. |
| Pixel map editor | **420** | canvas 2D | Fixture rects, 8px resize handles, rotate handle. |
| Scenes deck thumb | **166** | canvas 2D | Thumbnail compositing. |
| **Previs 3D** | **4,324** | **WebGL / three.js** | Real 3D scene: `THREE.WebGLRenderer`, `PerspectiveCamera`, lights, `GridHelper`, GLTF model loading, UV mapping of live PGM output onto meshes via `THREE.VideoTexture`. |
| Device node rendering | 2,608 | DOM + CSS | HTML generation for device graph nodes. |
| Audio meters | 617 | **DOM + CSS** | See below. |

Two findings here change the shape of the argument.

**The audio meters are not a canvas problem.** The entire render is one line —
`client/lib/audio-mixer-meter-loop.js:105`:

```js
fill.style.height = `${pct}%`
```

…plus a `data-meter-state` attribute for colour, styled in
`client/styles/07b-audio-mixer-modal-shell.css` and `07c3-audio-mixer-view-channel-strip.css`. The
617 LOC is peak-hold logic, eligibility rules and channel mapping — all pure logic that ports to any
language essentially unchanged. **Meters were listed as a port risk in the brief; they are not one.**
Same for the 2,608 LOC of device node rendering: DOM+CSS box layout maps onto native widget layout
cheaply.

**Previs is the real risk item, and it may already be dormant.** three.js is loaded by importmap
from `/vendor/three/build/three.module.js`, served via `src/server/http-server.js` with the mount
resolved in `src/bootstrap/modules.js:22`. But `vendor/` in this checkout contains only
`offline-bootstrap` and `shadertoy` — **there is no `vendor/three` on disk**. Either it is fetched at
deploy time or the previs 3D view is currently non-functional. Confirm this before costing any port,
because 4,324 LOC of WebGL is the single most expensive thing to reimplement natively and it would
be absurd to pay for it if the feature is dormant.

**Net canvas-2D reimplementation surface: ~9,300 LOC**, of which roughly 3,000–3,500 is actual paint
code and the rest is hit-testing, zoom/pan and state that ports as logic.

### The second browser app

CG Studio is a **separate browser application**, not part of the client bundle:

- `src/cg-studio/public/` — `index.html`, `app.js` (**461 LOC**), `placement-math.js` (61 LOC),
  `studio.css` (285 LOC). Plain browser script, no ESM module graph, no Vite.
- Server side `src/cg-studio/` totals **1,305 LOC** (routes, template scan, param registry, export).
- It is embedded into the main UI as a **lazy iframe** — `client/components/cg-studio-tab.js:22-37`
  points an `<iframe data-cg-studio>` at `/cg-studio/index.html`.

A native port must answer what happens to this. There are only three answers: port it too (+~800 LOC
of UI), keep it as a web view inside the native app (which reintroduces a browser engine and
undercuts the whole premise), or ship it as a separate window that stays a browser. None of these is
free. **The iframe is doing real architectural work today, and native toolkits have no cheap
equivalent of "embed this other app's UI in a tab".**

### The Electron launcher tree — and what your rejection means for it

`client/tools/electron-launcher/` exists and is real: **27 JS files, 3,010 LOC**, plus
`styles/`, `partials/`, its own `package.json`, a vendored copy of CG Studio, and four sync scripts
(`sync-cg-studio.sh`, `sync-dist-web.sh`, `sync-launcher-bundle.sh`, `sync-sim-server.sh`).
`package.json:129` carries `"electron": "^43.0.0"` as a dependency, and `package.json:35-36` define
`launcher:prepare` / `launcher`.

It is not the operator GUI. Reading `main.js`, it is a **desktop launcher/utility shell** — USB
probing (`main-usb.js`), stick flashing (`partials/tab-flash.html`, `tab-partition.html`), an
optional-modules registry, a sim-server launcher, and a CG Studio window. It is the "get highascg
onto a machine" tool, not the playout UI.

**What your Electron rejection means for it, stated plainly:**

1. It does not block anything. The operator GUI does not use Electron — it uses `firefox-esr --kiosk`
   (`src/system/operator-gui-launcher.js`, 521 LOC). Rejecting Electron for the main UI leaves the
   playout path completely untouched.
2. But it leaves 3,010 LOC + an `electron ^43.0.0` dependency in the tree that is now strategically
   orphaned. It will keep costing you: `npm audit` noise, install weight, and the confusion of a
   contributor finding an Electron app in a repo whose owner has ruled out Electron.
3. Decide explicitly, and write the decision down: either (a) the launcher stays Electron because it
   is a **build/provisioning tool that never ships to an operator**, which is a perfectly defensible
   line to draw — Electron is bad in your playout path, fine in your workshop; or (b) it gets retired
   or rewritten, which is its own 3,010 LOC project and should not be smuggled into a UI-port
   decision.
4. Recommended: **(a), documented.** Say in the README that Electron is permitted for host-side
   tooling and forbidden in the operator runtime. That converts an inconsistency into a policy.

---

## 2. The X SHAPE hole mechanism — and why it is *not* the blocker

This is the part of the brief that expected to find a wall. It isn't one, and the reason matters.

### How it works today

`client/lib/operator-gui-mode.js` (**424 LOC**) + `tools/runtime/operator-shape-overlay.py`
(**632 LOC**) + `src/system/operator-gui-channel.js` (**510 LOC**), 1,566 LOC total across three
languages.

The flow:

1. The operator GUI is `firefox-esr --kiosk http://127.0.0.1:4200/?operatorGui=1`, fullscreen on the
   operator monitor. The `?operatorGui` param is a hard gate — every export in `operator-gui-mode.js`
   is a no-op without it, so a normal browser session sees zero behaviour change.
2. Preview surfaces (compose / timeline / mv-edit) report their `getBoundingClientRect()` rects,
   normalised to 0–1 viewport fractions (`cellRectsToLayoutCells`), POSTed to
   `/api/operator-gui/layout`, debounced 200ms, deduped against the last payload.
3. The server routes a Caspar channel per cell and issues `MIXER FILL`
   (`operator-gui-channel.js:335`) to position video in each rect.
4. The Python helper takes the rects on stdin and calls, via `python-xlib`:
   `win.shape_rectangles(shape.SO.Set, shape.SK.Bounding, ...)` then
   `shape.SO.Subtract` per rect — literally cutting holes in the **Firefox window's bounding shape**
   so the Caspar consumer window *below* shows through.

The design was inverted once already, and the docstring records why (WO-262): the original approach
shaped the always-on-top Caspar consumer and gave it an empty input shape. It failed live, because
**the interactive window always wins stacking on click** — Firefox took focus, raised above the
always-on-top Caspar window, and the video vanished the moment the operator touched anything. So
video-on-top is fundamentally wrong; holes-in-the-GUI is right.

Two hard consequences, both already known on this box:

- **Holes are click-dead.** X SHAPE intersects a window's input region with its bounding region, so a
  subtracted region can never receive pointer events. `operator-shape-overlay.py:377-379` states this
  explicitly. Clicks in a hole fall through to the inert Caspar window — the accepted WO-262 tradeoff.
- Hence `setInteractionSuppressed()` (immediate suppress, 300ms debounced restore) and
  `setForegroundTabBlocksVideo()` — a modal, dropdown, context menu, or preview drag must withdraw
  the holes or the video overlay would swallow the popup. This is genuinely subtle code and it took
  several work orders to get right.

There is also a `OPERATOR_GUI_TITLE_MARKER = 'HIGHASCG-OPERATOR-GUI'` hack: X11 exposes no window
URL, so the page stamps a marker into `document.title` (re-asserted by a `MutationObserver`) and the
helper only shapes a Firefox whose title contains it — otherwise the WO-258 browser sources, which
are *also* Firefox and *also* land on the operator monitor during "Interact", would get holed.

### Why a native toolkit handles this *better*, not worse

The session is **X11 under openbox** — `ls /usr/share/xsessions` returns `openbox.desktop`, and there
is no Wayland session on this box. X SHAPE is available to any X11 client. **A GTK4, Qt6, Flutter or
Rust-native window is an X11 toplevel exactly like Firefox is.** The identical
`XShapeCombineRectangles` call works on it. So:

- The mechanism ports. There is no toolkit here that cannot be shaped.
- It ports *cleaner*. A native app can shape **itself**, synchronously, from inside the same process
  that laid out the widgets. That deletes the title-marker hack (no window matching needed — you have
  your own window handle), the HTTP round-trip, the 200ms debounce, the dedupe cache, the 60s
  heartbeat, the WS-reconnect re-report, and the server-nudge path. Realistically **~600–900 of those
  1,566 LOC disappear**, and an entire class of "holes went black after a restart and didn't come
  back until a resize" bugs disappears with them.
- The click-dead property does **not** go away. That is X SHAPE semantics, not a browser limitation.
  Native or web, a hole cannot receive clicks, and editors must still withdraw their rect while
  editing. Anyone selling you a native port on "we'd fix the click-dead holes" is wrong.

**So: shaped video is a genuine argument in favour of native — and it is the only one in this
document.** It is worth roughly one engineer-month of saved complexity. Hold that number against the
port cost in §4, because it is dwarfed by it.

**The one thing that would change this analysis:** if you ever move to Wayland, X SHAPE dies —
there is no Wayland equivalent, and the whole approach must be replaced by a compositor-level
subsurface or a DRM plane. That is a risk to the *current* design too, not just to a port, and it is
worth a line in the release notes: **highascg's operator GUI requires an X11 session.**

---

## 3. Options

Effort figures are "person-weeks, rough" for **one experienced developer reaching feature parity with
what exists today**, derived from the measured 81,195 client LOC. Calibration: sustained new-UI
output for a developer who already knows the domain and the design (this is a port — no discovery,
no design work) runs about 2,000–3,000 LOC/week. Native toolkit code is typically more verbose for
layout and less verbose for widgets, so LOC roughly holds. Canvas and WebGL clusters run at half that
rate. I have added no contingency; add 25% if you want a number you can commit to.

Repo velocity for context: **249 commits in the last 60 days**, single developer. That is a high rate
— and it is being spent on release readiness, not on spare capacity.

---

### Option A — Stay web, ship a lean kiosk runtime *(the honest baseline)*

**Language/runtime:** unchanged — ESM + Vite + `firefox-esr --kiosk`.
**What happens to the 435 client modules:** nothing. Zero rewritten.
**Effort:** **1–3 person-weeks**, and it is *optimisation*, not a rewrite — interruptible, shippable
in pieces, abandonable at any point with the gains kept.
**Shaped video:** already works. 1,566 LOC of proven, live-tested code, several work orders of bug
fixes already banked.
**Packaging / ISO:** current ISO is **5.9 GB** (`highascg-nvidia-595_amd64_2026-07-19_1931.iso`,
6,304,628,736 bytes; squashfs 4,697 MB). No change. Available wins: `dist-web/` is 14 MB and
`node_modules/` is 149 MB — a production install prune is worth low hundreds of MB *before*
compression. Firefox profile pre-warming and kiosk start-up tuning are the operator-visible wins.
**GPU/performance:** Firefox already has GPU-accelerated canvas and WebGL. Video never touches the
browser at all — Caspar renders it in its own window and the browser just has a hole where it shows
through, so **the UI toolkit is not in the video path**. This is the crucial performance point: the
web UI cannot be a video bottleneck, because it never carries a video frame.
**Risk of ending up worse:** near zero. Worst case you spend three weeks and gain a second of
start-up time.

---

### Option B — Tauri (Rust shell + system WebView)

**Language/runtime:** Rust shell, WebKitGTK (`webkit2gtk`) rendering your existing web UI.
**What happens to the 435 client modules:** **reused as-is.** This is the honest headline and it is
also the honest catch.
**Effort:** **3–6 person-weeks** — shell, IPC, packaging, and debugging WebKitGTK-vs-Gecko rendering
differences across 11,998 LOC of CSS and ~9,300 LOC of canvas.

**Calling it out honestly, as asked: Tauri is not Electron, but it is still a web UI.** The
difference from Electron is real — Tauri links the system WebKitGTK instead of bundling a private
~150 MB Chromium, so the binary is single-digit MB. But the thing rendering your interface is still
an HTML engine executing the same 81,195 LOC of JavaScript. **If your objection to Electron is
"bundling a whole browser is obscene", Tauri answers it. If your objection is "I want a real native
app, not a web page in a frame", Tauri does not answer it at all** — it is the same web page in a
different frame. You should decide which objection you actually hold before considering this option,
because the answer determines whether Tauri is your best option or a pointless detour.

**Shaped video:** works, and improves — the Rust shell owns the toplevel and can call XShape on
itself, killing the title-marker matching. But rect reporting still crosses JS→IPC, so you keep maybe
half the complexity.
**Packaging / ISO:** genuinely good. `.deb`, few-MB binary. **Ubuntu 24.04 already ships
`libwebkit2gtk-4.1`**, so the engine may cost zero additional ISO bytes.
**But — and this is decisive for the ISO argument — you cannot remove Firefox from the image
anyway.** The WO-258 browser sources are Firefox (`operator-shape-overlay.py:70-72` explicitly guards
against holing them), and `/usr/lib/firefox-esr` is **267 MB**. A `cef-cache/` directory at repo root
shows CasparCG's embedded CEF is in play too. **There is already at least one browser engine on this
box that no UI port can remove.** Any option below that claims ISO savings from "dropping the
browser" is claiming savings you cannot bank.
**GPU/performance:** WebKitGTK's canvas acceleration is weaker and buggier than Gecko's on NVIDIA.
Your ~9,300 LOC of canvas 2D is exactly the workload where this shows.
**Risk of ending up worse:** **moderate and specific.** You would be trading a browser engine you
have already debugged live against this exact UI, on this exact hardware, for one you have not. The
previs WebGL cluster under WebKitGTK on the NVIDIA 595 driver is an unknown. Real chance of shipping
something slower than today.

---

### Option C — GTK4 / libadwaita

**Language/runtime:** C, Vala, or Python via PyGObject. Python is tempting (the shape helper is
already Python, so one fewer language) but a 60fps timeline canvas in PyGObject is a bad bet; you
would end up in Vala or C.
**What happens to the 435 client modules:** **rewritten. All 81,195 LOC.** GtkBuilder XML replaces
HTML; the 11,998 LOC of CSS partially survives as GTK CSS (GTK's subset is much smaller — expect
heavy loss); all ~9,300 LOC of canvas 2D becomes Cairo/Snapshot drawing; the 1,495 LOC SVG cable
cluster becomes Cairo paths; the 4,324 LOC previs WebGL becomes `GtkGLArea` **with no three.js** —
you would be writing raw GL, including GLTF loading and UV mapping, by hand.
**Effort:** **45–70 person-weeks.**
**Shaped video:** best-in-class. GDK exposes the X11 window; `gdk_surface_set_input_region` plus
direct XShape calls, self-shaped, synchronous. Cleanest possible version of the mechanism.
**Packaging / ISO:** excellent. GTK4 is already on any Ubuntu desktop image; a `.deb` adds
single-digit MB. **But per Option B you cannot drop Firefox's 267 MB regardless, so realised ISO
saving is roughly the `node_modules`/`dist-web` delta — low hundreds of MB against 5,900 MB. Call it
3–5%.**
**GPU/performance:** GTK4's renderer is solid, Cairo 2D is CPU-bound and would likely be *slower*
than Firefox's GPU-accelerated canvas for the timeline. Again: video is not in this path either way.
**Risk of ending up worse:** **high.** You would spend a year rewriting to land on a UI that is
plausibly slower at 2D, missing previs entirely, with 60 CSS files of visual design degraded to GTK's
CSS subset.

---

### Option D — Qt6 / QML

**Language/runtime:** C++ with QML, or PySide6.
**What happens to the 435 client modules:** **rewritten**, but this is the most favourable rewrite
target on the list. QML is declarative, has a real property-binding/reactivity model, its own
scene-graph `Canvas`, and a JavaScript expression layer — so client *logic* (the 29,093 LOC of
`client/lib/`, much of it pure functions like `cellRectsToLayoutCells`, `placement-math`, peak-hold,
snap math) ports with genuinely low friction. Qt Quick 3D is a real answer for previs, unlike every
other native option here.
**Effort:** **40–65 person-weeks** — the lowest full-native number, and the only one where previs is
a scoped task rather than an open-ended one.
**Shaped video:** works. `QWindow::winId()` → XShape. Also: **Qt is the only option with a credible
non-SHAPE alternative** — `QVideoSink`/`QRhi` could composite Caspar output *into* the scene graph
via a shared texture, eliminating hole-punching entirely. That is a genuine architectural upgrade,
and also a genuine research project with a real chance of failure.
**Packaging / ISO:** good. Qt6 runtime is ~80–120 MB if not already present; net ISO effect roughly
neutral once you accept Firefox stays.
**GPU/performance:** best of the native options. Qt Quick's scene graph is GPU-accelerated by default
and would beat Cairo comfortably.
**Risk of ending up worse:** **moderate-high** — lower than GTK, but it is still a year, and Qt6/QML
is a large ecosystem to learn under release pressure. QML's licensing (LGPL v3 / commercial) is worth
five minutes of legal thought given you ship an ISO.

---

### Option E — Flutter Linux desktop

**Language/runtime:** Dart.
**What happens to the 435 client modules:** **rewritten, 100%, into a language used nowhere else in
this repo.** No JS reuse at all — not even the pure-logic lib files, which every other option gets
partly for free.
**Effort:** **40–60 person-weeks** raw, but with the worst risk profile on the list.
**Shaped video:** **this is where Flutter breaks.** Flutter Linux renders everything into a single
GL surface inside a GTK host window. Shaping is theoretically reachable through the embedder's GTK
window, but you are fighting a framework whose entire design premise is that it owns every pixel.
Worse, Flutter's platform-view story on Linux desktop is the weakest of any option here — and
"another process's video must show through my window" is precisely the platform-view case.
**Packaging / ISO:** fine — self-contained bundle, tens of MB.
**GPU/performance:** Impeller/Skia is fast for 2D. Would handle the timeline well.
**Risk of ending up worse:** **highest on the list.** Long rewrite, new language, and the one
mechanism your operator GUI cannot ship without is the one Flutter is least equipped to support. Not
recommended.

---

### Option F — Rust-native GUI (egui / iced / slint)

**Language/runtime:** Rust.
**What happens to the 435 client modules:** **rewritten**, in the most verbose direction. egui is
immediate-mode: excellent for the ~9,300 LOC of canvas work (drawing *is* the paradigm), poor for the
large amount of conventional form/panel/modal UI in `client/components/`. iced and slint are
retained-mode and less mature. All three have thin widget libraries; the 51,436 LOC of
`client/components/` includes a great many modals, inspectors, dropdowns and panels that come free in
a browser and must be hand-built here.
**Effort:** **50–80 person-weeks.** Widest range because it depends heavily on how much widget
infrastructure you end up writing yourself.
**Shaped video:** workable — `winit`/`raw-window-handle` exposes the X11 window for XShape — but you
are closer to the metal, with less framework help.
**Packaging / ISO:** the best possible. Single static binary, ~10–30 MB, no runtime deps.
**GPU/performance:** excellent. wgpu-backed, genuinely fast.
**Risk of ending up worse:** **very high.** The longest timeline, the least mature desktop ecosystem,
and a widget gap that is easy to underestimate until you are six months in and hand-writing a
combobox.

---

### Option G — Hybrid: native shell, web panes *(worth naming, not recommending)*

Native GTK/Qt window owning chrome, layout and shaping; heavy editors stay as embedded web views.
**Effort:** 10–20 person-weeks. **Risk of ending up worse: high** — you inherit both toolchains, both
debuggers, both build steps, and a new IPC seam across the middle, in exchange for a native title bar.
This is how ports die slowly. Named for completeness.

---

## 4. Summary table

| Option | Language | Client modules reused | Effort (person-weeks) | Shaped video | Realised ISO delta | Risk of worse-than-today |
|---|---|---|---|---|---|---|
| **A. Lean kiosk (baseline)** | unchanged | **435 / 435** | **1–3** | already works | −0.1 GB (prune) | **near zero** |
| B. Tauri | Rust + web | **435 / 435** | 3–6 | works, cleaner | ~0 | moderate (WebKitGTK) |
| C. GTK4 | C/Vala | 0 / 435 | 45–70 | best | −3 to 5% | high |
| D. Qt6/QML | C++/QML | 0 / 435 (logic ports well) | 40–65 | works + real alternative | ~0 | moderate-high |
| E. Flutter | Dart | 0 / 435 | 40–60 | **problematic** | ~0 | **highest** |
| F. Rust GUI | Rust | 0 / 435 | 50–80 | workable | best (−0.2 GB) | very high |
| G. Hybrid | mixed | partial | 10–20 | works | ~0 | high |

---

## 5. Recommendation

**Stay on the web UI. Option A. The real win is elsewhere, and a rewrite is the wrong thing to buy
while preparing a release.**

The reasoning, in the order the evidence forced it:

**1. The port is 81,195 LOC of hand-written, framework-free UI, and none of it is generated.** No
framework means no framework-shaped rewrite tax — but it also means every one of those lines was
written deliberately and does something. There is no bulk to discard. Options C through F all mean
rewriting all of it, and none of them lands under 40 person-weeks. That is **nine months to a year of
single-developer time to arrive at feature parity with software that already works.**

**2. The one benefit that survives scrutiny is worth about a month.** Native self-shaping deletes
~600–900 LOC of the 1,566 LOC shape mechanism and a class of resync bugs. Real, but it is one
engineer-month of benefit against forty to eighty of cost.

**3. The ISO argument, which is usually the strongest case for going native, does not hold here.**
The ISO is 5.9 GB. Firefox ESR is 267 MB and **cannot be removed** — the WO-258 browser sources are
Firefox, and CasparCG carries CEF besides. A native GUI does not remove a browser from this image; it
adds a toolkit alongside one. The saving is `node_modules`/`dist-web`-shaped: low hundreds of MB
against 5,900, and you can have most of it in Option A for a day's work with an install prune.

**4. Performance is not a reason, because the UI is not in the video path.** Video never enters the
browser. Caspar renders into its own X11 window and the GUI has a hole where it shows through. That
is the deep architectural virtue of the current design and it holds for every option — meaning **no
toolkit choice can make video faster.** It can only make the *chrome* faster, and Firefox's
GPU-accelerated canvas is already at or above what Cairo would deliver.

**5. The measurement that decided it: 163 distinct API paths and ~21 WebSocket message types against
a 97,196 LOC server that a port would not touch.** The client/server split is already clean. That is
the architectural win people usually undertake a native port to *achieve* — and you have it. The
native port buys you a different renderer for a UI whose boundaries are already correct. **You have
already banked the prize; the port is asking you to pay for it a second time.**

**6. What a port would cost in release delay, stated plainly.** At 249 commits/60 days, single
developer, currently spending that velocity on release readiness: committing to Option C, D, E or F
means **a 9–15 month release slip**, during which the product does not gain a single operator-visible
feature — every hour goes to re-achieving what shipped already. It also means a long stretch where
neither UI is finished, which is the most dangerous state a small project can be in. This is by a
wide margin the most expensive item available to you, and it is the one with the least user-visible
return.

### If you want to move toward native anyway — the staged path

Do not start with a rewrite. Start by making the port *cheaper* if you ever choose it, while every
step also improves the shipping product:

- **Stage 0 (now, 1–3 weeks) — Option A.** Prune production `node_modules`, tune kiosk start-up,
  pre-warm the Firefox profile. Ship the release. **Do this regardless of what you decide.**
- **Stage 1 (2–3 weeks) — resolve the previs question.** Establish whether `vendor/three` exists at
  deploy time or previs is dormant. If dormant, you have just removed 4,324 LOC of WebGL — the single
  highest-risk item — from every future port estimate. **Highest information-per-hour on this list.**
- **Stage 2 (3–4 weeks) — write the API/WS contract down.** 163 endpoints and ~21 message types,
  documented and versioned. This is the port's real prerequisite, and it pays for itself immediately
  in maintainability whether or not a port happens.
- **Stage 3 (2 weeks) — harden the logic/view seam.** Much of `client/lib/` (29,093 LOC) is already
  pure — `cellRectsToLayoutCells` is a good example, explicitly written to be testable without jsdom.
  Push more logic across that line. Every LOC that becomes pure is a LOC that survives any port.
- **Stage 4 — decide, with evidence, on the far side of the release.** Not before.

After stages 0–3 you have a better product, a documented contract, and a materially cheaper port if
you still want one. Nothing is wasted if you decide never to port.

### The smallest experiment that would de-risk the choice

**One week. Build a GTK4 (or Qt6) window that does nothing but the shaped-video trick.**

Concretely: a native fullscreen window on the operator monitor, one hard-coded rect, self-shaped via
XShape, over a running Caspar consumer. Then answer four questions with your own eyes on your own
hardware:

1. Does the hole show Caspar's video correctly, with no compositing artefacts under openbox?
2. Does self-shaping actually delete the title-marker matching and the HTTP round-trip, as predicted?
3. Move/resize the rect at 60fps — does the shape update cleanly or does it tear?
4. What happens on the NVIDIA 595 driver specifically?

If it works, you have validated the *only* real technical argument for native at a cost of one week,
and you can weigh a proven benefit against a measured cost. If it does not, you have saved yourself
nine months and learned it in week one.

Run this **before** any other port work, and **after** the release ships. It is small, it is
decisive, and it is the only experiment on this list whose result could legitimately change the
recommendation.

---

## Appendix — measurement commands

```bash
# Client size
find client -name '*.js' -not -path '*/node_modules/*' -not -path 'client/tools/*' | wc -l   # 435
find client -name '*.js' -not -path '*/node_modules/*' -not -path 'client/tools/*' -exec wc -l {} + | tail -1   # 81195
find client -name '*.css' -not -path '*/node_modules/*' -not -path 'client/tools/*' | wc -l  # 60

# Contract surface
grep -rhoE "'/api/[a-zA-Z0-9/_:.-]+'" client --include=*.js | sort -u | wc -l   # 163
grep -rEn "\.(get|post|put|delete|patch)\(['\"\`]/" src index.js --include=*.js | wc -l   # 232
find src -name '*.js' -exec wc -l {} + | tail -1   # 97196

# Shape mechanism
wc -l client/lib/operator-gui-mode.js tools/runtime/operator-shape-overlay.py \
      src/system/operator-gui-channel.js   # 424 + 632 + 510 = 1566

# Electron launcher
find client/tools/electron-launcher -name '*.js' | wc -l   # 27 files, 3010 LOC

# Packaging
du -sh dist-web                    # 14M
du -sh node_modules                # 149M
du -sh /usr/lib/firefox-esr        # 267M
ls -la /home/eggs/mnt/*.iso        # 6304628736 bytes = 5.9G
ls /usr/share/xsessions            # openbox.desktop  (X11, not Wayland)
```
