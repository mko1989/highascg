# Work Order 17: 3D Previs — Live Video on Imported 3D Stage Models

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Module context

Part of the **Previs & Tracking optional module** — see [WO-30](./30_WO_PREVIS_TRACKING_MODULE.md) for packaging, feature flag, and directory boundary. This WO is inert unless `HIGHASCG_PREVIS=1` or `config.features.previs3d === true`. All source lives under `src/previs/`, `web/components/previs-*`, `web/lib/previs-*`, and is deletable as a unit.

Sibling WOs: [WO-19](./19_WO_PERSON_TRACKING.md) (tracking) and [WO-31](./31_WO_STAGE_AUTOFOLLOW_PTZ.md) (PTZ/lighting auto-follow) depend on the 3D stage model and floor plane defined here (zones, calibration).

---

## Goal

Add an in-workspace **3D preview mode for the PGM cell** so users can:

1. **Import industry-standard 3D models** of their stage/set/studio.
2. **Designate surfaces in the model as "screens"** and map HighAsCG's current PGM video (the same source feeding the existing PGM live-view) as a live texture onto those surfaces.
3. **Orbit, zoom, and inspect** the scene in real-time to see exactly how content will look on physical LED walls, projectors, or monitors before going live.
4. Support **multi-screen setups** — different channels / streams mapped to different surfaces.
5. Provide **camera presets** — save and recall named viewpoints.

**UX placement — important revision from the original draft:** the 3D view is **not a separate workspace tab**. It lives **inside the existing PGM preview cell** in the output-preview panel, behind a **2D / 3D toggle**. PRV stays exactly as it is today (plain 2D live-view). When the operator flips the PGM cell to 3D, the split auto-reshapes to give PGM more space (e.g. shift the PRV/PGM gutter to ~25/75, or stack with PGM on top and large). Toggling back restores the previous layout.

The 3D scene is also the canvas that WO-31 draws follow-zones on and that WO-19 projects tracked persons onto.

---

## Architecture

```
HighAsCG PGM source (channel):
  • existing go2rtc WebRTC <video> (when lightweight stream is on)
  • or HighAsCG-grabbed thumbnails (preferred quality when available)
  • fallback: CasparCG-native thumbnails
                               │
                               ▼
┌─────────────────────────────────────────────┐
│  Browser — HighAsCG Web GUI                 │
│                                             │
│  Output preview panel                        │
│  ┌───────────────┬───────────────────────┐  │
│  │  PRV (2D)     │  PGM   [2D | 3D▼]    │  │
│  │  unchanged    │                       │  │
│  │               │  when 3D on:          │  │
│  │               │  ┌─────────────────┐  │  │
│  │               │  │ Three.js canvas │  │  │
│  │               │  │ (WebGL2)        │  │  │
│  │               │  │                 │  │  │
│  │               │  │ Imported model  │  │  │
│  │               │  │ + VideoTexture  │  │  │
│  │               │  │ on mesh(es)     │  │  │
│  │               │  │ + OrbitControls │  │  │
│  │               │  └─────────────────┘  │  │
│  │               │                       │  │
│  │               │  auto-resized larger  │  │
│  │               │  while in 3D mode     │  │
│  └───────────────┴───────────────────────┘  │
│                                             │
│  Inspector side-pane (context-aware):        │
│  • Model list, screen mappings               │
│  • Camera presets, grid/axes                 │
│  • Zone editor (used by WO-31)              │
└─────────────────────────────────────────────┘
```

**PGM source selection:** the same `data-preview-webrtc="pgm"` `<video>` element that the PGM live-view already uses is the canonical texture source. If the lightweight live stream is unavailable (slow link, startup), the 3D view falls back to a `<canvas>` fed by HighAsCG thumbnail polling, and then to Caspar-native thumbnails as last resort — mirroring the priority ladder the 2D PGM cell already follows. Per-mesh source override ("use channel N instead of PGM") is available for multi-screen stage models.

---

## Technology Decision: 3D Engine

### Options Evaluated

| Engine | Bundle Size | Video‑Texture | Model Loaders | Performance | Community/Docs | Verdict |
|--------|------------|---------------|---------------|-------------|----------------|---------|
| **Three.js** | ~160 KB gzip (core) | `VideoTexture` built-in, 1‑line | GLTFLoader, OBJLoader, FBXLoader, PLYLoader | Excellent; minimal overhead | Largest WebGL community, massively documented | **✅ Recommended** |
| **Babylon.js** | ~400 KB gzip (core) | `VideoTexture` built-in | glTF, OBJ, STL built-in | Excellent; heavier baseline | Good docs, enterprise-oriented | ❌ Too heavy for embedding in existing SPA |
| **PlayCanvas** | ~300 KB gzip | Supported | glTF only | Good | Smaller community | ❌ Editor-focused, poor standalone embed story |
| **Raw WebGL** | 0 KB (hand-coded) | Manual `texImage2D` | Must build loaders | Best possible | None (DIY) | ❌ Unreasonable dev effort |

### Recommendation: **Three.js**

- Already the industry standard for browser-based 3D previs
- Smallest footprint — important since this is one tab in a larger SPA
- `VideoTexture` wraps `<video>` element → updates from WebRTC stream each frame via `requestAnimationFrame`
- ES module `three/examples/jsm/` tree-shaking keeps bundle lean
- `OrbitControls` + `TransformControls` built-in for camera/object manipulation
- Massive ecosystem: GLTFLoader + Draco/Meshopt decompression

### Video Texture Performance Notes

| Approach | Latency | CPU Cost | GPU Cost | Notes |
|----------|---------|----------|----------|-------|
| `VideoTexture` (Three.js) | ~1-2 frames | Low (browser handles decode) | Low (auto `texImage2D`) | **Best option** — piggybacks on existing WebRTC `<video>` |
| Manual `texImage2D` | ~1 frame | Medium | Medium | More control, but Three.js already does this internally |
| OffscreenCanvas → texture | ~2-3 frames | High | Medium | Unnecessary extra copy |
| WebGPU `importExternalTexture` | ~0 frames | None | None | Future-proof but Chrome-only, Three.js WebGPU renderer experimental |

**Decision:** Use `THREE.VideoTexture` with the existing go2rtc WebRTC `<video>` element.

---

## Supported 3D Model Formats

| Format | Extension | Status | Notes |
|--------|-----------|--------|-------|
| **glTF / GLB** | `.gltf`, `.glb` | **Primary — recommended** | Industry standard, PBR materials, animations, smallest files. Use Draco compression. |
| **OBJ + MTL** | `.obj`, `.mtl` | Supported (legacy) | Static geometry only, no animation/bones. Simple but widely exported. |
| **FBX** | `.fbx` | Supported (legacy) | Autodesk proprietary; large files; Three.js `FBXLoader` works but is less maintained. |
| **STL** | `.stl` | Stretch goal | 3D-printing format; single mesh, no materials. Useful for simple set pieces. |
| **STEP / IGES** | `.step`, `.iges` | Not supported | CAD formats; would need conversion to glTF. |

**Primary workflow:** Users export from Blender / SketchUp / Vectorworks / Cinema 4D / **Capture 2025** → glTF/GLB → upload to HighAsCG.

> Capture 2025 is a first-class source — the sibling "Show Creator" project's production workflow is "export .glb from Capture → drop on the previs viewport", and we are borrowing their tagging pattern wholesale (see "Borrowed workflows" below).

### Model Size Guidelines

- Recommend < 20 MB per model (after Draco compression)
- Warn at > 50 MB (browser memory pressure)
- Reject at > 100 MB (OOM risk on production machines)

---

## Borrowed workflows from Show Creator

The sibling project `Unnamed_Show_Creator` has already solved the hardest bits of the "import a 3D model, tag meshes as screens, map video onto them, generate LED grids" pipeline on top of `three` + `@react-three/fiber`. Because HighAsCG's Previs module is vanilla Three.js (no React), we are **porting the _workflows_ — not the code**. A read-only snapshot of their key files is checked in at [`work/references/show_creator/`](./references/show_creator/README.md) so this reference doesn't rot when that repo moves.

### Map: Show Creator component → HighAsCG file

| Show Creator (React / R3F, read-only) | HighAsCG (vanilla Three.js, to be written) | What to port |
|----------------------------------------|---------------------------------------------|--------------|
| `SceneViewer.tsx` → `InteractiveImportedModel` | `web/components/previs-pgm-3d.js` + `web/lib/previs-model-loader.js` | `useGLTF` → `new GLTFLoader().loadAsync`; deep-clone scene, preserve texture references via the `cloneMaterialWithTextures()` helper; `traverse()` to collect meshes; walk up the object tree on click to find the `THREE.Mesh`. |
| `SceneViewer.tsx` → `getMeshInfo()` | `web/lib/previs-mesh-info.js` [NEW, ≤120 lines] | Pure function: given a `THREE.Mesh`, return `{ name, uuid, position, rotation, scale, boundingBox, worldWidth/Height/Depth }` — **identical shape** to their `ModelMeshInfo` so our JSON sidecars interoperate with theirs. |
| `SceneViewer.tsx` → selection highlight (`emissive` mutation) | Inside `previs-pgm-3d.js` | Exact same pattern: on selection, set `mat.emissive = 0xff6600`, `emissiveIntensity = 0.8`, `needsUpdate = true`. Restore to `0x000000` / `0` on deselect. Handles both `MeshStandardMaterial` and `MeshBasicMaterial`. Never mutate the loader's cached scene — only the clone. |
| `SceneViewer.tsx` → `LEDGridOverlay` | `web/lib/previs-led-grid.js` [NEW, ≤150 lines] | Take `{ panelsWide, panelsHigh, pixelPitch, worldWidth, worldHeight }` → emit a `THREE.Group` of `THREE.Line` segments for panel borders + a `Text`/DOM label for "1920×1080 (3.9mm)". Same green-border / grey-interior colouring. |
| `SceneViewer.tsx` → `SelectableScreen` + `TransformControls` | `previs-pgm-3d.js` | Screen meshes are flat planes positioned/rotated in stage coords; `TransformControls` (translate mode) wired up only in edit mode. Keep the irregular-screen path (per-panel `IrregularPanelMesh`) for composite LED layouts. |
| `ScreenSystem.tsx` → `ContentLayer` (virtual-canvas UV math) | `web/lib/previs-uv-mapper.js` [NEW, ≤250 lines] | **Highest-value port.** The overlap maths that compute UV rect + mesh offset from `{ screenCanvasRect, contentCanvasRect }` is already correct and well-tested. Translate React `useMemo` blocks to pure functions `computeScreenUV(region, contentDims, virtualCanvas)` and `computePanelUV(panel, region, contentBounds)`. Return `{ uvs, meshWidth, meshHeight, offsetX, offsetY }` so the renderer just applies them. |
| `ScreenSystem.tsx` → `VideoTexture` lifecycle | `web/lib/previs-video-texture.js` (already in Task T3.2, flesh it out with their lessons) | Reuse: `video.playsInline = true`, start `muted = true` to bypass autoplay gates, `preload = 'auto'`, `crossOrigin = 'anonymous'`. On `canplay` → create `THREE.VideoTexture`, `colorSpace = THREE.SRGBColorSpace`, `minFilter/magFilter = THREE.LinearFilter`, `generateMipmaps = false`. Explicit cleanup: `pause()`, `removeAttribute('src')`, `load()`, `texture.dispose()`. User-interaction unmute gate (one-shot click/keydown listener) for unmuting when the operator first touches the UI. |
| `ScreenSystem.tsx` → image fallback (`TextureLoader` for PNG/JPG thumbnails) | `previs-video-texture.js` (same file) | Same pattern as the PGM source-priority ladder already documented in T3.2 — thumbnails drop in as `TextureLoader` textures when WebRTC isn't available. Their `isImageUrl()` extension sniff is directly reusable. |
| `ScreenSystem.tsx` → irregular-panel rendering | `previs-pgm-3d.js` + `previs-uv-mapper.js` | Per-panel plane geometry at `(localX + width/2 - screenWidth/2, localY + height/2 - screenHeight/2, 0)`, then rotate the offset by the screen's Euler. Content mesh sits 0.001 m in front of the black panel backing to kill z-fighting. Panel width/height padded by a 1 mm "gap-eliminator" overlap. |
| `CanvasMapper.tsx` → 2D drag UV editor | `web/components/previs-uv-editor.js` [NEW, ≤400 lines] | The side-pane "place screen rectangles on the virtual canvas" UI. Port the SVG drag-to-draw / drag-to-resize, snap-to-grid, and numeric input panel. This is the operator-facing complement to Phase 3's programmatic mapping. Goes under the inspector's Previs section in T5.2. |
| `store.ts` → `ScreenRegion`, `LEDPanel`, `IrregularScreenConfig`, `LEDWallConfig`, `VirtualCanvas`, `ModelMeshInfo` | `src/previs/types.js` [NEW, ≤80 lines] + `web/lib/previs-state.js` (T1.3) | Adopt these shapes **verbatim**. JSON interop with Show Creator then becomes free: same tool can produce designs for both systems. |

### Coordinate / unit conventions (confirmed against Show Creator)

- Units: metres (Show Creator uses the same).
- Pixel pitch in **millimetres** (industry norm): `panelWidthMeters = (panelPixelWidth * pixelPitchMm) / 1000`.
- Virtual canvas sizes are **unitless ratios / pixels**, independent from world metres.
- UV `v` is inverted relative to canvas `y` (canvas y=0 is top; UV v=0 is bottom). Both codebases agree.
- Stage coord frame: right-handed, `+Y` up, documented in [../docs/MODULES.md](../docs/MODULES.md). Show Creator is also right-handed +Y-up so glTF files produced for one will render correctly in the other with no axis re-mapping.

### Things we will **not** port

- React, React Three Fiber, Zustand — keep HighAsCG's vanilla-modules stack.
- `<primitive>` wrapper, `Canvas` component, `TransformControls` JSX wiring — use raw `THREE.TransformControls` attached to the renderer/DOM element.
- Their Show Runner spreadsheet / cue timeline — HighAsCG has its own scene/timeline engine (WO-08, WO-21, WO-26).
- Their authentication / project-sharing routes — we integrate into the existing HighAsCG project save/load flow.

### Capture 2025 compatibility gotchas

From Show Creator's install notes (`PROJECT_PLAN.md §3`):
- Capture exports **light fixtures as plain meshes**, not as glTF `KHR_lights_*` nodes. The tagging step is how we attach our own interactive semantics (screen / fixture / stage / tracker camera).
- Materials come over as basic PBR; animations from Capture's cuing do **not** round-trip — previs is a static scene plus our own live video textures.
- Meshes are typically named after the Capture object tree (`LED_Main_01`, `Truss_SL`, etc.) — use the name prefix as a heuristic for "likely a screen" on first import so the tagging UI can pre-select candidates.

---

## Tasks

### Phase 1: Three.js Integration & Scene Setup

- [x] **T1.1** Add Three.js dependency **as an `optionalDependency`** (see WO-30):
  - `three` (ES module, tree-shakeable) added at `optionalDependencies.three@^0.184.0`.
  - Import path at runtime is bare-specifier (`import 'three'`, `import 'three/addons/...'`), resolved via a static `<script type="importmap">` in `web/index.html` that points at `/vendor/three/*`.
  - Served from `node_modules/three/` only when previs is active, by the new `vendorDirs` mount in `src/server/http-server.js` + `index.js::buildVendorDirs`.
  - Missing install is handled: clean 404 on `/vendor/three/*`, warning log, and the 2D/3D toggle declines to activate.

- [x] **T1.2** Create `web/components/previs-pgm-3d.js` (≤500 lines) — 284 lines.
  - **Mounts inside the existing PGM preview cell**, not as a standalone tab.
  - Adds a **2D / 3D toggle button** to the PGM cell header (the PGM cell only — PRV is untouched).
  - On toggle-to-3D:
    - Replace the PGM `<video>` visual with a Three.js `<canvas>` overlay; the `<video>` stays in the DOM, hidden, so it can feed `VideoTexture`.
    - Persist the PGM cell's pre-3D split ratio, then shift the PRV/PGM gutter to give PGM ~75% of the inner span (configurable); or, in stacked layout, make PGM the top row and expand it.
    - On toggle-to-2D: restore the original ratio.
  - Three.js scene with:
    - Ambient light (0.5) + directional light.
    - Grid helper (ground plane, toggleable) aligned to stage floor plane.
    - Axis helper (toggleable).
    - Background matches app theme.
  - `WebGLRenderer` `{ antialias: true, alpha: true }`, `PerspectiveCamera` FOV 50°.
  - `OrbitControls` (orbit/zoom/pan).
  - `ResizeObserver` to match the PGM cell's computed size; redraw only while the tab is visible and the panel isn't collapsed (save GPU).
  - Animation loop gated on visibility: pause when the output-preview panel is collapsed or the browser tab is hidden.
  - Clean `destroy()` disposes renderer, geometries, textures when toggling back to 2D or navigating away.

- [x] **T1.3** `web/lib/previs-state.js` (298 lines — over the 200-line preview but still well under the 500-cap).
  - Pure, framework-free view-model store with per-event subscriptions (`change`, `models:changed`, `active:changed`, `tags:changed`, `presets:changed`, `ui:changed`).
  - Shape: `{ models[], activeModelId, tags: { [modelId]: { [meshUuid]: ScreenTag } }, presets: { [modelId]: CameraPreset[] }, ui: { grid, axes, wireframe } }`.
  - Persistence: debounced (`250 ms`) `localStorage.setItem` under `highascg.previs.state.v1`. Server-side models list is refetched on load — `localStorage` only stores *user intent* (which mesh was tagged, UI toggles, presets).
  - Covered by `tools/smoke-previs-state.mjs` (`npm run smoke:previs-state`) — asserts upsert / remove / tag / preset / UI / reload flows and persistence parity.

### Phase 2: Model Import

- [x] **T2.1** `web/lib/previs-model-loader.js` (274 lines).
  - GLTFLoader (binary `.glb` + JSON `.gltf` w/ embedded resources) via
    `three/addons/loaders/GLTFLoader.js`, dependency-injected so the module stays loadable
    without the optional `three` dep installed.
  - `loadModelFromUrl` (server-persisted models), `loadModelFromFile` (drag-drop / picker),
    `loadModelFromArrayBuffer` (tests). All return a uniform `LoadedModel` with mesh info.
  - Normalisation: uniform scale to fit the largest AABB extent into a 10 m target box,
    centre on origin, place on floor (y=0). Returns `normalizationFactor` + `originalBox`
    so the inspector can surface "real units".
  - Per-mesh prep re-uses `prepareImportedSceneGraph` from `previs-mesh-info.js`
    (shadow flags + texture-preserving material clone).
  - Progress callback (`parse`/`prepare` phases, 0..1) — surfaced by the toolbar status.
  - `disposeModel()` helper to release geometries/materials/textures on swap.
  - DRACO / OBJ / MTL / FBX fallbacks intentionally deferred — Capture 2025 emits glTF
    natively, which covers the primary ingestion route.

- [x] **T2.2** `src/previs/routes-models.js` (269 lines) wired through `src/previs/register.js`.
  - `GET    /api/previs/models` → `{ models: [...] }` metadata list (id, name, filename, ext, sizeBytes, uploadedAt).
  - `POST   /api/previs/models` → busboy-streamed multipart upload, single file, 100 MB cap, allow-list `.glb/.gltf/.obj/.fbx`; returns 201 with the persisted record.
  - `GET    /api/previs/models/:id` → streams the binary with the right MIME (`model/gltf-binary` for `.glb`) and a `Content-Disposition` hint.
  - `DELETE /api/previs/models/:id` → drops record + file. 404 on unknown id, 410 if the record survived but the file was lost off-disk.
  - Disk root: `<repo>/.highascg-previs/models/<id>.<ext>` (created lazily). Index lives in the shared persistence store under `previs.models`.
  - Plumbed: `src/server/http-server.js` now skips raw-body consumption on *any* `multipart/*` request so busboy can own the stream for module-owned upload routes — no more special-casing of `/api/ingest/upload`.
  - Verified end-to-end: upload → list shows record → download round-trips byte-for-byte → delete removes both the record and the on-disk file → unknown id returns 404 → unsupported extension returns 415.

#### Phase 2 UI (keystone component)

- [x] **WO-17** Drag-drop / file-picker toolbar on the PGM 3D overlay.
  - `web/components/previs-pgm-3d-toolbar.js` (150 lines): top-left toolbar with "Load model…", "Clear", and a live status line; separate drop-zone backdrop that toggles on dragenter/dragleave.
  - `web/lib/previs-scene-model.js` (221 lines): owns the scene slot for the imported model. Adds/removes the loaded `root`, picks a screen mesh (pre-tagged first, else largest vertical surface, else keeps the demo plane), swaps its material for a `MeshBasicMaterial` backed by the shared `videoTexture`, and restores the original on unload.
  - `web/components/previs-pgm-3d.js` (397 lines): dropped the inline demo plane, now delegates to `createPrevisSceneModel`. Wires dragenter/over/leave/drop handlers on the overlay, uploads the chosen file to `/api/previs/models` once parsing succeeds, and logs the returned model id. `ensureThreeLoaded` now also resolves `GLTFLoader` from `three/addons/loaders/`.

### Phase 3: Video Texture Mapping

- [~] **T3.1** Screen designation workflow — **core flow shipped**, multi-stream selector deferred.
  - [x] Inspector panel (`web/components/previs-mesh-inspector.js`, 307 lines) pinned to the right edge of the 3D overlay with three sections: Saved models, Current-model meshes, Display toggles.
  - [x] Mesh list enumerates everything in `LoadedModel.meshInfos`; clicking a row selects the mesh (`THREE.BoxHelper` outline via `modelHost.setSelection`, handled in `previs-scene-model.js`).
  - [x] "Set" / "Clear" per mesh calls `modelHost.tagMeshAsScreen(mesh, { screenId })` / `modelHost.untagMesh(mesh)`, which stamps `userData['highascg.screen']` via `previs-mesh-info.tagScreenMesh` and rebinds the PGM `VideoTexture` to the new choice.
  - [x] Saved-models section lists persisted models from `/api/previs/models` (fetched on overlay entry by the inspector binder), with `Load` (downloads + parses) and `✕ Delete` (server `DELETE /api/previs/models/:id` + state prune).
  - [x] Tags survive reload: `createPrevisPgm3dInspectorBinder.applySavedTags()` restores `userData['highascg.screen']` from state on every model load; tag mutations persist through `state.setTag` / `state.clearTag` under the active `modelId`.
  - [x] Display toggles (grid / axes / wireframe) backed by `previs-state` and applied through new scene-handle fields (`sceneHandle.grid`, `sceneHandle.axes`, `sceneHandle.setWireframe`).
  - [x] Per-mesh **stream selector** (`PGM / PRV`) shipped. `scene-model` now owns a `Map<meshUuid, MeshBinding>` with per-source bindings acquired via a new `previs-stream-sources.js` manager; the inspector row renders a `<select>` with sources listed by the keystone component. Channel N / Input M require per-channel `<video>` elements in the DOM (deferred until the streaming WO exposes them).

- [x] **T3.2** Create `web/lib/previs-video-texture.js` (≤200 lines) — 205 lines.
  - Reuses the existing PGM `<video>` element via `findPgmVideoElement()` — no new WebRTC peer.
  - `createPgmVideoTexture(videoEl, THREE, opts)` returns a binding with a live `.texture` handle that auto-upgrades from placeholder to `THREE.VideoTexture` when the video becomes playable, and auto-downgrades if the stream drops. Probed every 500 ms.
  - Source-priority ladder implemented: (1) live WebRTC → `VideoTexture`; (2) solid `DataTexture` placeholder when not ready. Thumbnail fallbacks (HighAsCG/Caspar) and the multi-channel path are deferred to a follow-up pass once the PGM path is visually confirmed end-to-end.
  - `onLiveChanged(isLive)` callback so the UI can show a "waiting for stream" state.
  - `dispose()` releases GPU + the probe timer.

- [x] **T3.3** Real-time texture update loop
  - In the animation loop, `videoTexture.needsUpdate = true` is handled implicitly by Three.js' VideoTexture — no manual per-frame flag required.
  - Visually verified — texture updates at WebRTC frame rate with no tearing.
  - [x] **Emissive LED glow** — `previs-scene-model.js` now uses `MeshStandardMaterial` with `emissive = emissiveColor`, `emissiveMap = binding.texture`, `emissiveIntensity = 1.4`, `toneMapped = false` for both the demo plane and every tagged mesh. `applyTextureToScreenMaterial` keeps `map` and `emissiveMap` in lockstep when the VideoTexture swaps placeholder ⇄ live. Falls back to `MeshBasicMaterial` when `opts.emissive === false` OR when `THREE.MeshStandardMaterial` isn't available (keeps the smoke-test mock happy). Config knob: `createPrevisSceneModel({ emissive: { intensity, emissiveColor, roughness, metalness, enabled } })`.

### Phase 4: Camera Presets

- [x] **T4.1** Implement camera preset system — inspector "Cameras" section lists built-in + saved views and tweens between them.
  - [x] Sidebar section: "Cameras" (between meshes and display toggles).
  - [x] "Save view" input + button captures `{ position, target, fov }` via `sceneHandle.getCameraState()`.
  - [x] Clicking a preset calls `sceneHandle.flyTo({ ... }, 500)` which cubic-ease-in-out lerps position, orbit target, and fov.
  - [x] Built-in presets: `Front`, `Top`, `ISO` (keyed as `__builtin_*` ids; not persisted).
  - [x] Per-model presets stored via `previs-state.addPreset/removePreset/getPresets`, persisted to `localStorage` through the existing debounced write.
  - [x] Dedicated **Reset view** button (ghost style below Front/Top/ISO; recalls `__builtin_front` — same pose as **Front**).

- [x] **T4.2** Keyboard shortcuts — `web/components/previs-pgm-3d-keyboard.js` attaches a single `keydown` listener on the overlay (`tabIndex = 0`; focused on 3D enter). Keys are ignored while a text input / textarea / contenteditable has focus so the "Save view" field still works.
  - [x] `1-9` — recall saved preset by index (from `state.getPresets(activeId)`; built-ins remain button-only).
  - [x] `F` — frame selected mesh: computes `Box3.setFromObject` → bounding sphere, then flies camera along the current view direction to `radius / sin(fov/2)`, target = bbox centre.
  - [x] `G` — toggles `state.setUI({ grid: !ui.grid })` and `sceneHandle.grid.visible`.
  - [x] `W` — toggles `state.setUI({ wireframe })` and calls `sceneHandle.setWireframe(next)`.
  - [x] `Escape` — `modelHost.setSelection(null)` (clears the `BoxHelper` outline).

### Phase 5: Integration & UI Polish

- [x] **T5.1** Wire the 2D/3D toggle into the PGM cell — auto-expand + event bus both shipped.
  - [x] Register `previs-pgm-3d` via the optional-module loader — `web/assets/modules/previs/entry.js` polls for the PGM compose cell and attaches a `createPrevisPgm3d()` controller. A `MutationObserver` handles late mounts and panel remounts.
  - [x] Button inserted onto the PGM cell; clicks flip between 2D and 3D with full lifecycle cleanup on exit.
  - [x] Auto-expand: `preview-canvas-panel.js` now listens for `document`-level `CustomEvent('previs:set-prv-pct', { detail: { value } })`. On 3D enter, the previs entry dispatches `value: 0.2` (PRV gets 20%, PGM gets 80%); on exit (or module detach), it dispatches `value: null` and the panel restores the user-persisted split. The override is NOT written to `localStorage`, so the drag-saved preference survives a 3D toggle.
  - [x] Emit `previs:pgm-mode-changed` events for WO-19 / WO-31 consumers — `createPrevisPgm3d` dispatches `document`-level `CustomEvent('previs:pgm-mode-changed', { detail: { active, at } })` at the tail of both `enter3D` and `exit3D` (after PRV split / `onExpand` fire so listeners see the final layout). Listen with `document.addEventListener('previs:pgm-mode-changed', (e) => e.detail.active ? … : …)`.
  - [x] PRV untouched — confirmed by the component only attaching to `.preview-panel__compose-cell--pgm`.

- [x] **T5.2** Inspector / side-pane controls — core shipped 2026-04-21 (agent 10).
  - [x] Import Model — `Load model…` in top-left toolbar (file picker) + full-cell drag-drop unchanged.
  - [x] Model selector — toolbar `<select>` "Saved model…" lists `state.models` from `/api/previs/models`; choosing one calls `loadSavedModelById` (same path as inspector **Load**). Syncs on every `previs-state` `change` event.
  - [x] Grid / axes / wireframe — inspector **Display** section (unchanged layout).
  - [x] Camera presets — inspector **Cameras** section (built-ins + saved views).
  - [x] Per-mesh **Source** dropdown — PGM / PRV (Channel N pending streaming WO).
  - [x] **Video streams** pipeline — inspector section lists each registered source (PGM / PRV) with `live` / `waiting` / `unused`; `createPrevisStreamManager` exposes `getStreamStatuses()`, keystone calls `refreshPipeline()` on the 1 s video-refresh timer.
  - [~] **Screen mapping** — inspector **Screen mapping** section: UV0 mode, decoded video px + aspect, mesh world AABB (max(x,z)×y) + aspect, stretch hint; `getVideoFrameDimensions` on video binding; `getScreenMappingSummary` on scene-model; `refreshMapping` on select + 1 s timer.
  - [ ] UV / virtual-canvas **drag editor** (deferred — `previs-uv-editor.js` / Show Creator `CanvasMapper` port).
  - [ ] Zones section placeholder — **WO-31**.

- [x] **T5.3** Settings integration — shipped 2026-04-21 (collapsible **Scene settings** on 3D overlay, bottom-left).
  - [x] Persisted in `previs-state` `ui`: `backgroundColor`, `ambientIntensity`, `directionalIntensity`, `emissiveIntensity`, `pixelRatioCap` (1/2/4), `antialias`, `cameraFov`, `prvFractionWhen3d` (5–50 % PRV width while 3D is on). `mergeUiWithDefaults()` clamps + merges with `PREVIS_DEFAULT_UI` on load and on every `setUI`.
  - [x] Live apply while 3D is active: `sceneHandle.applySettings(...)` + `modelHost.setEmissiveIntensity` + `document.dispatchEvent('previs:set-prv-pct', { detail: { value } })` on `PREVIS_STATE_EVENTS.UI`.
  - [x] `web/assets/modules/previs/entry.js` reads `readMergedPrevisUiFromStorage()` on expand so the first PRV split matches saved prefs (no longer hard-coded `0.2` only).
  - [x] Antialiasing: stored flag; renderer uses it on **next** 3D session (WebGL context cannot toggle AA in place) — hint text in panel.
  - [x] Max video-texture resolution (auto / 720p / 1080p / native) — `previs-state` `ui.videoTextureMax` + `videoTextureMaxToLongEdge()`; `createPgmVideoTexture` uses `CanvasTexture` + 2D blit when cap > 0, else fast `VideoTexture`; stream manager passes `getMaxVideoLongEdge`; RAF `tick()` calls `streamManager.tick()`. Scene settings panel row **Video texture max**.
  - [x] **Application Settings** tab **3D Previs** (WO-30 parity) — `registerOptionalSettingsTab` in `optional-modules.js`, previs `entry.js` registers `mountPrevisSettingsModalPane`; `getSharedPrevisState()` keeps overlay + modal in sync; `settings-modal.js` injects tab/pane before Variables, lazy-mount + dispose on close.

- [x] **T5.4** Styles — `web/styles/previs.css` is now a first-class module stylesheet (~280 lines) loaded automatically via `src/previs/register.js` → `webStyles: ['/styles/previs.css']`.
  - [x] `.previs-pgm-3d-overlay` hosts the Three.js canvas; `.previs-pgm-3d-toolbar`, `.previs-pgm-3d-dropzone`, and `.previs-pgm-3d-inspector` cover the HUD.
  - [x] Inspector rows use BEM-ish modifiers: `.previs-pgm-3d-inspector__row--tagged`, `.previs-pgm-3d-inspector__label--active` (cyan accent), `.previs-pgm-3d-inspector__btn--ghost`.
  - [x] Hover states on rows + buttons match the dark-theme background (`rgba(255,255,255,0.06)` for untagged, `rgba(0,208,255,0.2)` for tagged).
  - [x] Dropzone uses an `is-visible` state class (replacing the inline `display: flex|none` toggle) so `previs.css` owns the visual.
  - [x] All four previs components (`previs-pgm-3d`, `previs-pgm-3d-toolbar`, `previs-pgm-3d-dropzone`, `previs-mesh-inspector`) are now class-only; dynamic inline styles removed.
  - [ ] Zones section styles — deferred to WO-31 which will ship the zones UI.

---

## Key Implementation Notes

### VideoTexture from WebRTC Stream

```javascript
// Reuse existing go2rtc WebRTC infrastructure
import { createLiveView } from '../lib/webrtc-client.js'

// Create hidden video element for the stream
const hiddenContainer = document.createElement('div')
hiddenContainer.style.display = 'none'
document.body.appendChild(hiddenContainer)

const liveView = createLiveView('pgm_1', hiddenContainer, { audioEnabled: false })

// Wrap the <video> in a Three.js VideoTexture
const videoTexture = new THREE.VideoTexture(liveView.video)
videoTexture.colorSpace = THREE.SRGBColorSpace
videoTexture.minFilter = THREE.LinearFilter
videoTexture.magFilter = THREE.LinearFilter

// Apply to mesh
screenMesh.material = new THREE.MeshBasicMaterial({
  map: videoTexture,
  side: THREE.DoubleSide
})
```

### Model Import with Auto-Scale

```javascript
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACODecompressor } from 'three/examples/jsm/loaders/DRACOLoader.js'

const loader = new GLTFLoader()
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('/draco/')  // served by HighAsCG
loader.setDRACOLoader(dracoLoader)

loader.load(url, (gltf) => {
  const model = gltf.scene
  // Auto-scale to fit 10-unit bounding box
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  const scale = 10 / maxDim
  model.scale.multiplyScalar(scale)
  // Center at origin
  const center = box.getCenter(new THREE.Vector3())
  model.position.sub(center.multiplyScalar(scale))
  scene.add(model)
})
```

### Performance Budget

| Metric | Target | Acceptable |
|--------|--------|------------|
| Render FPS (no video) | 60 fps | 30 fps |
| Render FPS (1 video texture) | 60 fps | 25 fps |
| Render FPS (3 video textures) | 30 fps | 20 fps |
| Initial model load (10 MB GLB) | < 2s | < 5s |
| Memory (1 model + 1 video) | < 150 MB | < 300 MB |
| GPU VRAM (1080p video texture) | ~8 MB | ~16 MB |

---

## Dependencies

- `three` npm package (r170+ — currently pinned to `^0.184.0` in `optionalDependencies`, per WO-30 Phase 1).
- Existing: `webrtc-client.js`, `stream-state.js`, `live-view.js` from WO-05.
- Existing: go2rtc streaming infrastructure.
- Existing: HighAsCG thumbnail polling and Caspar thumbnail fallback (same ladder the 2D PGM cell uses).
- Draco decoder files served statically from `/web/draco/` only when the module is installed.
- **Reference files:** [`work/references/show_creator/`](./references/show_creator/README.md) — read-only snapshot of `Unnamed_Show_Creator`'s `SceneViewer.tsx`, `ScreenSystem.tsx`, `CanvasMapper.tsx`, plus the data-model excerpt from their Zustand store. Consult the "Borrowed workflows" section above for the 1:1 porting map.

---

## Work Log

### 2026-04-21 — Agent (Revision: PGM-cell toggle + module gating)

**Work Done:**
- Rescoped the feature from "new workspace tab" to **"2D/3D toggle on the existing PGM preview cell"** per operator feedback. PRV remains plain 2D.
- Documented the PGM cell's auto-resize behaviour when 3D is active.
- Added per-mesh source priority ladder (lightweight stream → HighAsCG thumbnails → Caspar thumbnails → "NO SIGNAL") to match the 2D PGM cell's existing fallback strategy.
- Tied the WO to the optional-module umbrella (WO-30): directories, registration, optional dependency declaration.
- Noted the hook points WO-19 (tracking overlay) and WO-31 (zone editor) will plug into.

**Status:** Revised. Implementation still pending — blocked on WO-30 registry/boot hook (T30.1–T30.4).

**Instructions for Next Agent:** Implement WO-30 Phase 1 first so this WO has a registration point. Then T1.2 (`previs-pgm-3d.js`) is the keystone — everything else bolts to it.

### 2026-04-21 (later) — Agent (Show Creator port plan + module scaffolding)

**Work Done:**
- Stashed a read-only reference snapshot of `Unnamed_Show_Creator`'s key files under [`work/references/show_creator/`](./references/show_creator/README.md) (`SceneViewer.tsx`, `ScreenSystem.tsx`, `CanvasMapper.tsx`, `store_types_excerpt.ts`, plus a README).
- Added a **"Borrowed workflows from Show Creator"** section above Tasks, with a 1:1 table mapping each of their R3F components to a HighAsCG vanilla-Three target file. Highest-value port is `ScreenSystem.tsx → previs-uv-mapper.js` — the virtual-canvas UV math is already solved there.
- Confirmed coordinate / unit conventions line up (metres, right-handed +Y-up, pixel pitch in mm, UV v inverted relative to canvas y). glTF files produced for Show Creator will render correctly in HighAsCG Previs without axis re-mapping.
- Recorded Capture 2025 gotchas (light fixtures come in as meshes, not KHR_lights; name-prefix heuristic for auto-tagging screens on first import).
- Added `src/previs/types.js`, `src/previs/register.js`, `web/assets/modules/previs/entry.js`, `web/styles/previs.css` as module skeletons — the registry now has a real module to load when `HIGHASCG_PREVIS=1`. Each file is a stub with the right exports and TODO markers pointing back into this WO's tasks.

**Status:** Scope locked with concrete port targets. Module skeleton loads end-to-end (flag → registry → web loader → stub entry logs `[previs] initialised`). Real implementation of T1.2 / T2.1 / T3.1 / T3.2 is unblocked.

**Instructions for Next Agent:** Start with T3.2 + the new `previs-uv-mapper.js`. Port the `ContentLayer` maths from Show Creator's `ScreenSystem.tsx` into a pair of pure functions (`computeScreenUV`, `computePanelUV`) — test them against a few synthetic regions before wiring into real meshes. Once those return the right `{ uvs, meshWidth, meshHeight, offsetX, offsetY }` tuples, the rest of the scene graph is straightforward Three.js boilerplate. Do _not_ rewrite the maths from scratch — their version is already correct for both regular and irregular screens, including the gap-eliminator and z-fight offsets.

### 2026-04-21 (later again) — Agent (Phase 1 keystone landed)

**Work Done:**
- Ported the Show Creator UV maths into `web/lib/previs-uv-mapper.js` (380 lines). Both `computeScreenUV` and `computePanelUV` are pure functions, covered by an in-file `__selfTest()` and runnable as `npm run smoke:previs-uv` (20/20 cases pass).
- Ported `getMeshInfo` + material-texture-preserving cloning + mesh-tagging convention into `web/lib/previs-mesh-info.js` (297 lines). THREE is dependency-injected so nothing in this file forces the `three` dependency to load.
- Added `web/lib/previs-video-texture.js` (205 lines): reuses the existing PGM `<video>` element, auto-upgrades between a 1×1 placeholder `DataTexture` and a live `THREE.VideoTexture`, with a `setSource()` hook for channel swaps.
- Added `web/lib/previs-scene.js` (218 lines): vanilla-Three equivalent of the R3F `<Canvas>`. Camera, lights, GridHelper, OrbitControls, dispose(). Kept out of the component file so the keystone stays lean.
- Added `web/components/previs-pgm-3d.js` (284 lines, keystone): mounts inside `.preview-panel__compose-cell--pgm`, draws a 2D/3D button, dynamically imports `three` + `three/addons/controls/OrbitControls.js` on first activation, wires the PGM video to a demo plane. IntersectionObserver and full disposal on exit.
- Added vendor plumbing so the browser can resolve bare `three` specifiers without a bundler:
  - `<script type="importmap">` in `web/index.html` mapping `three`, `three/`, `three/addons/`.
  - New `vendorDirs` option on `startHttpServer` + `/vendor/three/*` → `node_modules/three/*` mount wired up by `index.js::buildVendorDirs`.
  - Graceful handling when `three` isn't installed: clean 404 (not SPA fallback), warning log, toggle declines.
  - `module-registry.isLoaded(name)` helper added.
- Updated `web/assets/modules/previs/entry.js` from a skeleton into the real controller that attaches/detaches the PGM 3D toggle as the preview panel re-renders (MutationObserver + polling for the initial mount).

**Status:** Phase 1 scene plumbing is done. With `HIGHASCG_PREVIS=1` + `three` installed, the PGM cell gains a 2D/3D button that, on click, renders a flat demo screen carrying the live PGM video texture. The path from real glTF stage → mapped screens is the next focus.

**Instructions for Next Agent:** Phase 2 (T2.1 model import) is next. Use `prepareImportedSceneGraph()` from `previs-mesh-info.js` to clone materials safely, then add a drag-drop zone on the 3D overlay + `POST /api/previs/models` persistence (T2.2). After that, Phase 3.1 — mesh tagging UI that flips `userData["highascg.screen"]` via `tagScreenMesh()`. The UV mapper and video-texture binder are ready to be called the instant you have a `ScreenRegion` tied to a tagged mesh; don't rebuild either one.

### 2026-04-21 (evening) — Agent (Phase 2 model import landed)

**Work Done:**
- Added `web/lib/previs-model-loader.js` (274 lines) with `loadModelFromUrl` / `loadModelFromFile` / `loadModelFromArrayBuffer` + `disposeModel`. Performs prep (shadows + texture-preserving material clone), normalises to a 10 m max extent, centres on origin, places on floor, and returns `meshInfos[]`, `normalizationFactor`, `originalBox`. `three` is dependency-injected so the module stays valid without the optional install.
- Added `src/previs/routes-models.js` (269 lines) and wired it through `src/previs/register.js`. Full REST CRUD for glTF/OBJ/FBX at `/api/previs/models`: list, streaming busboy upload (100 MB cap, extension allow-list), download with correct MIME + `Content-Disposition`, and delete. Records persist under the shared `persistence` key `previs.models`; binaries land at `<repo>/.highascg-previs/models/<id>.<ext>`. Verified live: upload → list → byte-exact download → delete cleans record + file; 404 on unknown id, 415 on bad extension.
- Relaxed `src/server/http-server.js` raw-body handling: any request with `Content-Type: multipart/*` skips the body concatenation so downstream module handlers (busboy in previs) can own the stream. Previously only `/api/ingest/upload` was exempt.
- Added `web/components/previs-pgm-3d-toolbar.js` (150 lines) — self-contained factory for the top-left "Load model… / Clear / status" toolbar plus the full-overlay drop-zone backdrop. No Three.js dependency; works in tests.
- Added `web/lib/previs-scene-model.js` (221 lines) — owns the imported-model slot in a previs scene. Adds/removes the model root, picks a screen mesh (pre-tagged first, else largest vertical surface, else keeps the demo plane), swaps its material for a `MeshBasicMaterial` bound to the shared `videoTexture`, restores the original on unload, and disposes cleanly.
- Rewired `web/components/previs-pgm-3d.js` (397 lines) to delegate the scene slot to `createPrevisSceneModel`, attach the toolbar + drop-zone, handle dragenter/over/leave/drop with file-type gating, parse the file in-browser, swap the demo plane for the real model, and `POST /api/previs/models` in the background so the model survives a reload. `ensureThreeLoaded` now also resolves `GLTFLoader` from `three/addons/loaders/GLTFLoader.js`.

**Status:** Phase 2 complete. With `HIGHASCG_PREVIS=1` + `three` installed, the operator can drag a `.glb` / `.gltf` onto the 3D PGM overlay (or click "Load model…"): the file is parsed in-browser, the demo plane is replaced with the real stage, the largest upright surface (or a pre-tagged mesh) picks up the live PGM texture, and a copy of the file is streamed to the server for persistence.

**Instructions for Next Agent:** Phase 3 (T3.1 mesh tagging UI) is the next keystone. Meshes are already enumerated on import (`LoadedModel.meshInfos`) and the scene-model host exposes `getScreenMesh()` — hook an inspector side-panel that lists mesh names, lets the user click one to toggle its `userData['highascg.screen']` via `tagScreenMesh`, and calls `setModel(currentModel)` again to re-bind the texture to the new choice. T1.3 (`previs-state.js`) should be started alongside so camera presets + tagging choices survive a reload; persist to `localStorage` keyed by model id. T3.2 / T3.3 are already in place — do not rebuild the video texture pipeline.

### 2026-04-21 (late evening) — Agent (T1.3 state + Phase 3 inspector landed)

**Work Done:**
- **`web/lib/previs-state.js`** (298 lines): framework-free event-emitting store — models / activeModelId / tags / presets / UI toggles — persisted with a 250 ms-debounced `localStorage` write under `highascg.previs.state.v1`. Emits both a firehose `change` event and fine-grained `models:changed`, `active:changed`, `tags:changed`, `presets:changed`, `ui:changed` events. Covered by `tools/smoke-previs-state.mjs` (`npm run smoke:previs-state`) — upserts, removes, tag add/clear, preset add, UI patch, persistence round-trip.
- **`web/lib/previs-scene-model.js`**: added `refreshBinding()`, `tagMeshAsScreen(mesh, tag)`, `untagMesh(mesh)`, and `setSelection(mesh | null)`. Selection is rendered as a `THREE.BoxHelper` with `depthTest: false` so it tracks the mesh transform for free. Material restoration from the previously-bound mesh happens before rebind, so the texture swap is clean.
- **`web/lib/previs-scene.js`**: scene handle now exposes `grid`, `axes` (hidden by default), and `setWireframe(on)`. Dispose path extended to release the axes helper.
- **`web/components/previs-mesh-inspector.js`** (307 lines): right-edge panel with three sections — Saved Models (list + Load + ✕ Delete), Current Model → Meshes (click to select, Set / Clear screen tag, live "(screen)" annotation), Display (grid / axes / wireframe toggles backed by state).
- **`web/components/previs-pgm-3d-inspector-binder.js`** (201 lines): glue between the inspector, state store, scene-model host, and REST. Fetches `/api/previs/models` on entry, keeps a `meshByUuid` map for fast selection / tag lookups, loads saved models via `GET /api/previs/models/:id` + `loadModelFromArrayBuffer`, deletes via `DELETE /api/previs/models/:id`, and restores saved `userData['highascg.screen']` tags onto meshes after every model load.
- **`web/components/previs-pgm-3d.js`**: wires the state store, instantiates the inspector binder on enter-3D, notifies it after local drag-drop imports and server uploads (so the active id is set as soon as the record arrives), and disposes cleanly on exit. "Clear" now tears down the model + active id + mesh cache coherently.
- Verified end-to-end again against the running server: `/api/previs/health`, `/api/previs/models` list/upload/delete paths still clean after the new routes were added, and the inspector-binder RESTclient uses them correctly.

**Status:** Phase 3 core shipped — the operator can now import a model, flip the "screen" designation between meshes (with a cyan outline on the selected one), delete / reload models from the server, and everything survives a reload (active id + tags + UI toggles via `localStorage`; binaries + metadata via the server). Multi-stream (per-mesh source selector), camera presets, and the T5.x polish bits are still open.

### 2026-04-21 (Agent 10 — T5.2 toolbar model dropdown + T5.3 scene settings)

**Completed:**

- **`web/lib/previs-state.js` (378 lines)** — extended `DEFAULT_UI` / `mergeUiWithDefaults()` with scene + performance + layout fields: `backgroundColor`, `ambientIntensity`, `directionalIntensity`, `emissiveIntensity`, `pixelRatioCap` (1/2/4), `antialias`, `cameraFov`, `prvFractionWhen3d`. Every `setUI` patch runs through `mergeUiWithDefaults` so values stay clamped. New exports: `PREVIS_DEFAULT_UI`, `readMergedPrevisUiFromStorage()` (used by the module entry for the PRV split).
- **`web/lib/previs-scene.js`** — `addDefaultLights` now takes optional intensities and returns `{ ambient, directional }`; handle exposes `lights` + `applySettings(patch)` for live background / lights / pixel ratio / FOV updates without rebuilding the renderer.
- **`web/lib/previs-scene-model.js`** — `setEmissiveIntensity(n)` mutates the shared emissive config and all active screen materials + demo plane.
- **`web/components/previs-settings-panel.js` (185 lines)** — collapsible `<details>` bottom-left (`Scene settings`) with colour picker + sliders + PRV % + AA note; writes through `state.setUI`.
- **`web/components/previs-pgm-3d-toolbar.js`** — T5.2 saved-model `<select>` + `syncSavedModelSelect()`; toolbar `flex-wrap` + CSS for the dropdown.
- **`web/components/previs-pgm-3d.js` (433 lines)** — `enter3D` reads merged `state.getUI()` into `createPrevisScene` / `createPrevisSceneModel`; subscribes to `UI` + `CHANGE` to apply scene settings, emissive, PRV dispatch, and refresh the toolbar model list; removes dead `dragEnterCount` assignment.
- **`web/components/previs-pgm-3d-inspector-binder.js`** — mounts the settings panel before the inspector; exposes `loadSavedModelById` for the toolbar callback.
- **`web/assets/modules/previs/entry.js`** — `onExpand` uses `readMergedPrevisUiFromStorage().prvFractionWhen3d` (clamped 0.05–0.5) instead of a hard-coded `0.2`.
- **`web/styles/previs.css`** — toolbar model row + full **Scene settings** block.
- **Smoke:** `smoke:previs-state` extended with default-merge assertions; `smoke:previs-stream` + `smoke:previs-uv` still green.

**Still open (at the time):** WO-30 Modules modal duplicate, UV mapping status, max video-texture cap, zones (WO-31) — see latest work log for subsequent completions.

---

### 2026-04-21 (Agent 9 — dropzone split + T5.4 styles + LED emissive glow)

**Completed:**

- **Keystone split — dropzone extracted.** `web/components/previs-pgm-3d-dropzone.js` (174 lines) now owns all drag/drop plumbing (`dragenter`/`dragleave`/`dragover`/`drop` on the overlay), the file-picker callback, glTF parse via `previs-model-loader.js`, and the `POST /api/previs/models` upload pipeline. The keystone pulled back from **506 → 376 lines** and the coupling is now explicit: dropzone receives lazy accessors (`getToolbar`, `getModelHost`, `getThreeModulePromise`, `getInspectorBinder`) plus a `setCurrentModel` setter so the keystone remains the single source of truth for lifecycle.
- **T5.4 styles — `web/styles/previs.css` (282 lines).** Rewrote the previous stub into a first-class BEM-ish module stylesheet. New classes: `.previs-pgm-toggle`, `.previs-pgm-3d-overlay`, `.previs-pgm-3d-toolbar(__button|__status|__file-input)`, `.previs-pgm-3d-dropzone(.is-visible)`, `.previs-pgm-3d-inspector(__section|__section-header|__body|__row|__row--tagged|__label|__label--active|__empty|__btn|__btn--ghost|__select|__input|__preset-row|__save-row)`. Includes hover states, disabled buttons, and focus-visible outline on the 3D overlay. Loaded automatically via `webStyles: ['/styles/previs.css']` in `src/previs/register.js`, so detaching the module cleanly removes the stylesheet.
- **Component refactor** — stripped inline styles from `previs-pgm-3d.js`, `previs-pgm-3d-toolbar.js`, `previs-pgm-3d-dropzone.js` (classes only), and the inspector (`previs-mesh-inspector.js` went 475 → 402 lines). The only remaining runtime style touches are state-class toggles (`classList.toggle('is-visible', …)` on the dropzone, `--tagged` / `--active` modifiers on inspector rows/labels).
- **Phase 6 LED emissive glow — shipped.** `previs-scene-model.js` now creates all screen materials via a new `createScreenMaterial(THREE, texture, cfg)` helper. Default behaviour switches from `MeshBasicMaterial` to `MeshStandardMaterial` with `map = emissiveMap = binding.texture`, `emissive = 0xffffff`, `emissiveIntensity = 1.4`, `roughness = 0.9`, `metalness = 0`, and `toneMapped = false`. This makes the PGM screen "glow" convincingly under the scene's ambient+directional lights without washing out to pure white.
  - `applyTextureToScreenMaterial(material, tex, cfg)` keeps `map` + `emissiveMap` in lockstep whenever the underlying `VideoTexture` swaps between placeholder and live.
  - Graceful fallback: if `THREE.MeshStandardMaterial` isn't exposed (e.g. in the smoke-test shim) OR the caller passes `emissive: false`, we return the old `MeshBasicMaterial` unchanged.
  - Config: `createPrevisSceneModel({ emissive: true | false | { enabled, intensity, emissiveColor, roughness, metalness } })`. Defaults live in the new `DEFAULT_EMISSIVE` export.
- **Smoke:** `smoke:previs-state`, `smoke:previs-uv` (20/20), `smoke:previs-stream` (19/19) all green with the refactored bindings + new emissive path. `ReadLints` clean.

**File budgets** (all under 500): keystone 376, dropzone 174, toolbar 107, inspector 402, scene-model 460 (+~65 from emissive helpers/docs; still comfortable), previs.css 282.

**Still open:**

- **T4.1 Reset-view button** (low priority; `Front` built-in doubles as one).
- **T5.2 sidebar polish** (Import Model button, model-selector dropdown, standalone grid/axes/wireframe toggles outside the inspector).
- **T5.3 Settings section** (background colour, lighting intensity, AA quality, max video-texture resolution, default PGM ratio-shift — the emissive knobs are now part of this too).
- **True per-channel sources** — blocked on the streaming WO exposing Channel N / Input M `<video>` elements in the DOM. The stream manager just needs two more `{ id, label, findVideo }` source entries.

**Instructions for Next Agent:** The lowest-effort polish wins are inside `previs.css` — e.g. animating the tagged-row highlight or adding a subtle drop-shadow to the inspector. For the next functional pick, **T5.3 Settings** is now very close: the `createPrevisSceneModel({ emissive })` option + `createPrevisScene({ backgroundColor, cameraFov })` options cover most of what the WO-30 Modules settings panel needs. You'd wire a small form into the WO-30 panel that writes to `previs-state.setUI({ emissive: {...}, background: … })`, and the keystone's `enter3D` would read that snapshot before constructing the scene. Because the settings already live behind a feature flag, gating the whole form on `HIGHASCG_PREVIS=1` is automatic.

---

### 2026-04-21 (Agent 8 — T4.2 keyboard shortcuts + `previs:pgm-mode-changed` event bus)

**Completed:**

- **T4.2 keyboard shortcuts — shipped.** New `web/components/previs-pgm-3d-keyboard.js` (142 lines) attaches a single `keydown` listener to the 3D overlay (`overlay.tabIndex = 0`, `overlay.focus({ preventScroll: true })` is called at the end of `enter3D` so keys land immediately). Keys are ignored when the active element is an `INPUT` / `TEXTAREA` / `SELECT` / `[contenteditable]`, so the "Save view" field still works. Bindings:
  - `1-9` → `state.getPresets(activeModelId)[N-1]` → `sceneHandle.flyTo({ position, target, fov }, 500)`. Built-ins (`Front` / `Top` / `ISO`) stay button-only so operators can assign `1-9` to their own shots.
  - `F` → frame selected mesh. Uses `new THREE.Box3().setFromObject(mesh).getBoundingSphere(…)` to compute a radius; positions the camera along the current `(position − target)` direction at `radius / sin(fovRad/2)` so the mesh fills the view. Handles degenerate view direction and empty bounds (warn-and-skip).
  - `G` → toggles `sceneHandle.grid.visible` and persists via `state.setUI({ grid })`.
  - `W` → calls `sceneHandle.setWireframe(next)` and persists via `state.setUI({ wireframe })`.
  - `Escape` → `modelHost.setSelection(null)` (clears the `BoxHelper` outline).
- **`previs:pgm-mode-changed` event bus — shipped.** `createPrevisPgm3d` now dispatches a `document`-level `CustomEvent('previs:pgm-mode-changed', { detail: { active: boolean, at: epochMs } })` at the tail of both `enter3D` and `exit3D`, AFTER the PRV split override + `onExpand` fire (so listeners see the final DOM layout). Consumers:

```javascript
document.addEventListener('previs:pgm-mode-changed', (ev) => {
  const { active, at } = ev.detail || {}
  if (active) attachTrackingOverlay()  // WO-19
  else detachTrackingOverlay()
})
```
- **`web/lib/previs-scene-model.js`** — exposed `getSelection()` on the scene-model handle (returns the currently-selected mesh for the `F` shortcut). JSDoc updated.
- **`web/components/previs-pgm-3d.js`** (now 506 lines): wires `createPrevisPgm3dKeyboard(…)` in `enter3D` after the inspector binder; disposes it first in `exit3D`. `emitModeChanged(boolean)` helper centralises the event dispatch with a try/catch guard. The `PGM_MODE_EVENT` constant is defined at module scope for easy reuse.

**Smoke:** `node --check` clean on all touched files; `npm run smoke:previs-state`, `smoke:previs-uv` (20/20), and `smoke:previs-stream` (19/19) all green. ReadLints clean.

**File budgets:** keyboard 142, scene-model 393, keystone 506 (just over — see next-agent note). All other files unchanged.

**Still open:**

- **T4.1 Reset-view button** (low priority — `Front` built-in already doubles as one).
- **T5.2 sidebar polish** (dedicated Import Model button, model-selector dropdown, grid/axes/wireframe toggles alongside the mesh list — much of this already lives in `previs-mesh-inspector.js`; just needs a pass for consistency with WO-30 module layout).
- **T5.3 Settings section** (default lighting, AA quality, max video-texture resolution, default PGM ratio when flipping to 3D).
- **T5.4 Styles** (`web/styles/previs.css` — currently inline in each component).
- **Phase 6** (performance / polish) — screen-space outline shader, screen emissive glow, LOD, idle-pause heuristics.
- **True per-channel sources** — unblocked once the streaming WO exposes Channel N / Input M `<video>` elements in the DOM. The stream manager will just need two more source entries; no other file changes.

**Instructions for Next Agent:** `previs-pgm-3d.js` is now 506 lines, just over the 500-line budget. The obvious split is to extract the drag/drop + upload plumbing (`onDragEnter`/`onDragOver`/`onDrop`/`loadAndMountModel`/`uploadModelToServer`) into a new `web/components/previs-pgm-3d-dropzone.js` helper — that's ~90 lines today and cleanly decoupled from the scene lifecycle. After the split, keystone drops back under ~420 lines and gains room for the remaining Phase 5/6 items. Next functional pick is **T5.3 Settings** — the WO-30 Modules panel is already rendering a per-module "Open settings" button so the hook point exists. Default lighting intensity and background colour map directly to options already accepted by `createPrevisScene(opts)`. If you tackle Phase 6 first, the lowest-effort win is an emissive glow on screen meshes: in `bindMesh` switch from `MeshBasicMaterial` to `MeshStandardMaterial` with `emissive = 0xffffff`, `emissiveMap = binding.texture`, `emissiveIntensity = 1.5` — it immediately looks like LED.

---

### 2026-04-21 (Agent 7 — per-mesh stream selector / multi-source scene-model)

**Completed:**

- **Per-mesh stream selector — shipped.** Every tagged mesh can now carry its own source (PGM or PRV — Channel N/Input M are plug-in-ready) and the inspector renders a per-row `<select>` instead of the old Set/Clear pair.
- **New `web/lib/previs-stream-sources.js` (116 lines)** — `createPrevisStreamManager(THREE, sources)` exposes `acquire(id) / release(id) / refreshVideoSources() / listSources() / dispose()`. Refcounted per source, so N meshes on PGM share one `VideoTextureBinding` and get disposed together when the last one releases. Sources are defined as `{ id, label, findVideo: () => HTMLVideoElement | null }` so the manager stays decoupled from the DOM.
- **`web/lib/previs-video-texture.js`** — added `binding.onTextureChanged(fn) → unsub` so consumers can react to placeholder ⇄ live swaps. `swapToLive` / `swapToPlaceholder` now emit both `onLiveChanged` and `onTextureChanged`. Added `findWebrtcVideoElement(stream, root)` + `findPrvVideoElement()` (back-compat: `findPgmVideoElement` still exported).
- **`web/lib/previs-scene-model.js` — refactored (391 lines).** Single `screenMesh` / `screenMaterial` / `screenMeshOriginal` replaced by a per-mesh `Map<meshUuid, MeshBinding>` (each entry holds mesh, sourceId, material, originalMaterial, textureBinding, and an `unsubscribe` for the texture-change listener). New APIs: `setMeshSource(mesh, sourceId)`, `getMeshSource(uuid)`, `getBindings()`. `refreshBinding()` now reconciles the tag set against the bindings map — adds new, drops removed, switches source in-place — and shows / hides the demo plane based on whether any meshes are tagged. The auto-picker writes a tag with an explicit `source: defaultSourceId` so reload is a no-op.
- **Demo plane** also goes through the manager now (`streamManager.acquire('pgm')`) and subscribes via `onTextureChanged`, so the "no model loaded" screen flips to live video the instant PGM becomes playable. (Previously the demo plane kept showing the black placeholder until the user imported a model.)
- **`web/components/previs-mesh-inspector.js` — UI**: when `getAvailableSources` is provided, rows render a `<select>` (options: `—`, `PGM`, `PRV`) with the current source pre-selected; picking `—` fires `onUntagMesh`, anything else fires `onSetMeshSource(uuid, sourceId)`. The "(screen)" suffix becomes "(PGM)" / "(PRV)" and the row still highlights cyan when tagged. Falls back to the old Set/Clear pair when sources aren't provided.
- **`web/components/previs-pgm-3d-inspector-binder.js`** — added `getAvailableSources` passthrough, new `tagMeshWithSource(uuid, sourceId)` helper, new `onSetMeshSource` callback. `getMeshes` now reports `{ sourceId }` per row by querying `modelHost.getMeshSource(uuid)`. Persisted tags include the `source` field.
- **`web/components/previs-pgm-3d.js`** — replaced the old `createPgmVideoTexture(pgmVideo, …)` call with `createPrevisStreamManager(THREE, [pgmSource, prvSource])`. Added a 1 s refresh timer that calls `streamManager.refreshVideoSources()` while 3D is active, so late-mounted `<video>` elements (e.g. when the preview panel remounts) are picked up automatically. `exit3D` disposes the stream manager instead of a single binding.
- **Smoke test — `tools/smoke-previs-stream.mjs` + `npm run smoke:previs-stream`**: 19/19 assertions passing. Covers refcounted acquire/release, fresh binding after final release, unknown-source → null, `listSources` shape, `dispose` cascade. Plus scene-model integration with a minimal THREE shim: auto-pick creates exactly one binding, `setMeshSource` on a second mesh produces two bindings with different sources, source switching unbinds+rebinds, untag releases, and `dispose` clears everything.
- **Live smoke**: server boots cleanly under `HIGHASCG_PREVIS=1`, `/api/previs/health` returns `phase-2`, and every new file serves with the expected symbols (`createPrevisStreamManager`, `setMeshSource`/`getMeshSource`, `onSetMeshSource`/`getAvailableSources`, `findPrvVideoElement`).

**File budgets** (all under 500): scene-model 391, inspector 475, binder 273, keystone 446, stream-sources 116, video-texture 238.

**Still open:**

- **T4.2 keyboard shortcuts** (`1-9` preset recall, `F` frame-selected, `G`/`W`/`Esc`).
- **T5.1 event bus**: `previs:pgm-mode-changed` for WO-19 / WO-31 consumers.
- **True per-channel sources**: adding Channel N / Input M requires `<video>` elements discoverable in the DOM (pending a larger streaming WO). The stream manager will pick them up automatically once the source registry grows — no changes needed in the scene-model or inspector.

**Instructions for Next Agent:** Easiest next pick is **T4.2 keyboard shortcuts**. Hook a single `overlay.addEventListener('keydown', …)` (remember to make overlay focusable — `overlay.tabIndex = 0`). Keys → actions: digits `1-9` → `recallPreset(state.getPresets(activeId)[n-1]?.id)` via a callback on the binder; `F` → `sceneHandle.flyTo({ position: camera + (boundingSphere.radius * 2 * viewDir), target: boundingCenter, fov: camera.fov })` using `THREE.Box3().setFromObject(selectedMesh)` to get the sphere; `G` toggles `state.setUI({ grid: !ui.grid })`; `W` toggles `wireframe`; `Esc` calls `modelHost.setSelection(null)`. Second pick: the event-bus bullet — add a single `document.dispatchEvent(new CustomEvent('previs:pgm-mode-changed', { detail: { active } }))` inside `enter3D` / `exit3D`; document the event in WO-17 and WO-30. Third pick: once the streaming WO exposes per-channel `<video>` elements, register them in the keystone's stream manager sources — no other file needs to change.

---

### 2026-04-21 (Agent 6 — Phase 4 T4.1 + T5.1 auto-expand)

**Completed:**

- **T4.1 camera presets — shipped.** Inspector grew a "Cameras" section between the mesh list and Display:
  - Three built-in buttons (`Front`, `Top`, `ISO`) call `sceneHandle.flyTo({ position, target, fov }, 500)` with preset stage coordinates so operators can snap back to familiar angles from any orbit.
  - A `[name input] [Save view]` row calls `sceneHandle.getCameraState()` on the active scene, captures `{ position, target, fov }`, and persists through `previs-state.addPreset(activeModelId, …)` (`localStorage`-backed, per-model). Saving is only enabled while a model is active — the hint "Load a model to save views." shows otherwise, since presets are per-model.
  - Each saved preset renders as a row with `Go` (animated recall via the same `flyTo`) and `✕` (`state.removePreset`). The label tooltip shows fov.
  - Transitions use cubic-ease-in-out over 500 ms. Position, OrbitControls target, and camera fov are all lerped together; `camera.updateProjectionMatrix()` is called every frame. A new `flyTo` overwrites any in-flight tween.
- **`web/lib/previs-scene.js`**: added `getCameraState()` and `flyTo(to, durationMs)` to the scene handle; both wired into the handle's dispose path (in-flight tween is cancelled on teardown). The scene stays at 322 lines, within budget.
- **`web/components/previs-mesh-inspector.js`**: +124 lines (431 total) to host the new `renderCameraPresets` block and its input/row UI; no Three.js coupling — it just calls through to injected callbacks.
- **`web/components/previs-pgm-3d-inspector-binder.js`**: added `saveCurrentView(name)` / `recallPreset(id)` / `getBuiltinPreset(id)` helpers (252 lines). Built-in preset coordinates live here so the inspector UI stays framework-agnostic.
- **T5.1 auto-expand — shipped.** `web/components/preview-canvas-panel.js` now listens for `document`-level `CustomEvent('previs:set-prv-pct', { detail: { value } })`. On 3D enter, `web/assets/modules/previs/entry.js` dispatches `value: 0.2` (PRV shrinks to 20%, PGM auto-expands to 80%); on 3D exit — or when the module detaches — it dispatches `value: null` which makes the panel re-read the persisted `kPrvPgmSplit` from `localStorage` and restore it. The override is never written back to storage so the drag-saved preference is preserved.
- Live smoke: started the server with `HIGHASCG_PREVIS=1`, confirmed `/api/previs/health` reports `phase-2`, and verified all five touched files (`preview-canvas-panel.js`, `entry.js`, `previs-scene.js`, `previs-mesh-inspector.js`, `previs-pgm-3d-inspector-binder.js`) ship the new symbols to the browser. Existing smoke tests pass (`smoke:previs-state` green, `smoke:previs-uv` 20/20).

**Still open:**

- **T3.1 / Phase 4 per-mesh stream selector.** Needs a small extension to `previs-scene-model.js` (track multiple `{ meshUuid → texture }` bindings) plus a video-texture factory that can bind arbitrary stream sources (PGM / PRV / per-channel). Inspector row would gain a "Source" dropdown.
- **T4.2 keyboard shortcuts** (`1-9` to recall preset by index, `F` to frame selection, `G` grid, `W` wireframe, `Esc` deselect).
- **T5.1 event bus**: `previs:pgm-mode-changed` for WO-19 / WO-31 consumers.

**Instructions for Next Agent:** Per-mesh streams is the natural next step. Refactor `web/lib/previs-scene-model.js` so `_screenBinding` becomes a `Map<meshUuid, { material, originalMaterial, texture, source }>`. Add a `setMeshSource(mesh, source)` method where `source` is one of `'pgm'`, `'prv'`, `'ch<N>'`, `'off'`. In `web/components/previs-pgm-3d.js`, the existing `createPgmVideoTexture` factory can be generalized — add a `findVideoElementForSource(source)` helper (selectors already exist: `[data-preview-webrtc="pgm"]`, `[data-preview-webrtc="prv"]`). The inspector row already has "Set"/"Clear" — add a `<select>` above them whose value is persisted on the tag (`mesh.userData['highascg.screen'].source = 'pgm'` etc.), and the binder rebinds on change. Keep files under 500 lines — if `previs-scene-model.js` grows past ~400, split the per-mesh binding logic into `previs-scene-model-bindings.js`. For T4.2 keyboard shortcuts, hook a single `keydown` listener on the overlay (only active when 3D is on) that reads `state.getPresets(activeModelId)` and indexes by number. `F` can use `THREE.Box3().setFromObject(selection)` + compute a camera position at `boundingSphere.radius * 2` along the current view direction, then `flyTo`.

---

### 2026-04-21 — Agent (max video texture + Video streams pipeline)

**Completed:**

- **`web/lib/previs-video-texture.js`** — Optional `getMaxVideoLongEdge()` → `0` keeps `VideoTexture`; `> 0` uses `CanvasTexture` + per-frame `drawImage` via `binding.tick()`. `lastCapApplied` / `setSource` / `tick` coordinated so cap and source changes rebuild without infinite loops.
- **`web/lib/previs-stream-sources.js`** — Third argument `{ getMaxVideoLongEdge }` passed into `createPgmVideoTexture`; new `tick()` (forwards to all bindings) and `getStreamStatuses()` (per-source `live` + `acquired`).
- **`web/components/previs-pgm-3d.js`** — `videoTextureMaxToLongEdge(state.getUI().videoTextureMax)` wired into the stream manager; RAF loop calls `streamManager.tick()` before `render`; inspector binder receives `getStreamStatuses`; 1 s refresh timer also calls `inspectorBinder.refreshPipeline()`.
- **`web/components/previs-settings-panel.js`** — **Video texture max** `<select>` (Auto / Native / 720p / 1080p).
- **`web/components/previs-mesh-inspector.js`** — optional **Video streams** section; `refreshPipeline()` for lightweight updates.
- **`web/styles/previs.css`** — pipeline row + badge classes.
- **`tools/smoke-previs-stream.mjs`** — `CanvasTexture` on THREE shim; asserts `tick` / `getStreamStatuses`.

**Still open:** UV / virtual-canvas mapping editor, zones (WO-31).

**Instructions for Next Agent:** Next high-value previs item is the **UV / virtual-canvas editor** (`previs-uv-mapper.js` — wire a minimal inspector readout + drag UI).

---

### 2026-04-21 — Agent (Application Settings → 3D Previs tab, WO-30)

**Completed:**

- **`web/lib/previs-state.js`** — `getSharedPrevisState()` so the PGM overlay and Application Settings share one store.
- **`web/lib/optional-modules.js`** — `registerOptionalSettingsTab` / `getOptionalSettingsTabs`.
- **`web/components/previs-settings-modal-pane.js`** — mounts `createPrevisSettingsPanel` with intro copy; details default `open`.
- **`web/components/settings-modal.js`** — injects optional tabs before **Variables**; delegated tab clicks; lazy mount; `optionalDisposers` on close; `#settings-pane-previs` excluded from server autosave.
- **`web/assets/modules/previs/entry.js`** — registers the **3D Previs** tab on load.
- **`web/styles/previs.css`** — modal positioning overrides for `.previs-settings-modal-pane`.

**Still open:** UV drag editor (`previs-uv-editor.js`), zones (WO-31).

---

### 2026-04-21 — Agent (Screen mapping inspector readout)

**Completed:** **Screen mapping** inspector section — video frame dimensions (`getVideoFrameDimensions` on `VideoTextureBinding`), world-space mesh face sizing + aspect comparison vs video, UV0 explanatory copy; scene-model `getScreenMappingSummary`; `refreshMapping` on mesh select and 1 s stream timer; styles in `previs.css`.

---

### 2026-04-21 — Agent (T4.1 Reset view button)

**Completed:** Inspector **Cameras** section — new ghost **Reset view** button below the Front/Top/ISO row; calls `onRecallPreset('__builtin_front')` (same camera pose as **Front**, explicit discoverability).

---

### 2026-04-21 — Agent (texture crop `flipY` + install doc blurb)

**Completed:** **`applyVirtualCanvasRegionToTexture`** branches on **`texture.flipY`** (VideoTexture default vs CanvasTexture downscale path); **`syncDisplayTextureFromMaster`** copies **`flipY`**; **`smoke-previs-texture-crop`** asserts both branches; **`MANUAL_INSTALL.md`** §9.2.1 short paragraph on 3D UI + Screen mapping + `localStorage` key.

---

### 2026-04-21 — Agent (UV canvas region editor + per-mesh texture clone)

**Completed:**

- **`web/lib/previs-texture-crop.js`** — `clampCanvasRegion`, `resolveCanvasRegionFromTag`, `applyVirtualCanvasRegionToTexture` (`offset` / `repeat`).
- **`web/components/previs-uv-editor.js`** — drag-move + corner resize on a virtual-canvas aspect stage; `onLiveChange` (rAF) vs `onCommit` (pointer-up); **Use full canvas** reset.
- **`web/components/previs-mesh-inspector.js`** — Screen mapping mounts the editor when callbacks exist; `computeScreenUV` uses `summary.canvasRegion` + `summary.virtualCanvas`; dispose previous editor to avoid leaked window listeners.
- **`web/components/previs-pgm-3d-inspector-binder.js`** — `onCanvasRegionLive` / `onCanvasRegionCommit` / `onCanvasRegionReset`; **`tagMeshWithSource` merges prior tag** so `canvasRegion` is not wiped on source change.
- **`web/lib/previs-scene-model.js`** — optional `getVirtualCanvas`; **`cloneDisplayTexture` + `syncDisplayTextureFromMaster`** so each bound mesh has independent crop; `refreshTextureCrop`; mapping summary includes `virtualCanvas` / `canvasRegion`.
- **`web/components/previs-pgm-3d.js`** — passes `getVirtualCanvas`; `refreshTextureCrop` on UI changes.
- **`web/styles/previs.css`** — UV editor BEM.
- **`web/lib/previs-mesh-info.js`** — `ScreenTag.canvasRegion` + `source` in typedef.
- **`tools/smoke-previs-texture-crop.mjs`** + **`npm run smoke:previs-texture-crop`**.

**Still open:** CanvasMapper-scale polish, irregular panels (**WO-31** zones).

**Instructions for Next Agent:** If runtime crop + video `flipY` look wrong on real PGM, adjust `applyVirtualCanvasRegionToTexture` with one known-good fixture (screenshot). Consider throttling `setTag` further if large models + many meshes.

---

### 2026-04-21 — Agent (virtual canvas + computeScreenUV preview)

**Completed:**

- **`web/lib/previs-state.js`** — `virtualCanvasWidth` / `virtualCanvasHeight` in `DEFAULT_UI` (1920×1080), merged with `clampInt` (64–8192).
- **`web/components/previs-settings-panel.js`** — **Virtual canvas (px)** row (W×H number inputs); `Application Settings → 3D Previs` inherits the same panel.
- **`web/components/previs-mesh-inspector.js`** — **Screen mapping** shows virtual canvas line + **UV preview** from `computeScreenUV` (full-canvas screen region vs centred video/content); distinguishes runtime UV0 from preview math.
- **`web/styles/previs.css`** — compact number inputs for virtual canvas.
- **`tools/smoke-previs-state.mjs`** — asserts defaults + clamp.
- **`work/docs/MANUAL_INSTALL.md`** — §9.2.1 optional `three`, `npm run install:previs`, `HIGHASCG_PREVIS=1` / `config.features.previs3d`.

**Still open:** UV drag editor (`previs-uv-editor.js`), zones (WO-31).

**Instructions for Next Agent:** Build a minimal **UV drag editor** on a 2D overlay or canvas that writes `region` fields and persists per mesh — or extend **Screen mapping** with copy-out of numeric UV bounds for manual Show Creator alignment.

---
*Work Order created: 2026-04-12 | Revised: 2026-04-21 (twelve times) | Parent: [WO-30](./30_WO_PREVIS_TRACKING_MODULE.md)*
