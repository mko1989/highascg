# Work Order 32: Template Editor — Visual HTML Template Editor (detachable module)

> **AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Ship a **visual Template Editor** for CasparCG **HTML (and FT) graphics** — comparable in *workflow ease* to **vMix GT Title Designer** (drag-drop layout, text/image/shapes, animation hooks, data fields) — while keeping the feature in an **optional, detachable module** like **WO-30 Previs** (delete directories + flag off → core app unchanged).

The product-facing name is **Template Editor** (not "CG Studio").

**Non-goals for Phase 1:** Replacing Adobe/OBS ecosystems; shipping a full motion-graphics compositor. Phase 1 is **integration + shell + export to Caspar template** (HTML + `update()` / `play()` contract).

---

## Why a module

- Heavy/editor dependencies (canvas UI toolkit, optional bundler for generated HTML, asset pipeline) must not bloat the default HighAsCG install.
- Product risk: if the editor approach fails, operators can **`rm -rf`** the module tree and lose nothing else.
- Same integration pattern as WO-30: **`src/module-registry.js`**, `optionalDependencies`, feature flag, no core `import` of module internals.

---

## Strategy: integrate an existing project

| Approach | Pros | Cons |
|----------|------|------|
| **A. Embed MIT-friendly web editor** (e.g. GrapesJS, Polotno, or a thin React wrapper) | Fast UI; export HTML/CSS/JS | Need Caspar-safe output (single file or small bundle, `window.update`) |
| **B. Fork / vendor a “title designer”-style OSS repo** | Closer to GT workflow if found | Maintenance, license, fit |
| **C. Build minimal in-house** | Full control | Slow |

**Phase 1 recommendation:** **A** — pick one **browser-based** layout editor with **JSON + HTML export**, add a **Caspar adapter** that wraps output in the standard HighAsCG template contract (`window.update(json)`, transparent background, 1920×1080 safe area).

**Reference workflow (vMix GT):** WYSIWYG stage → data fields bound to external updates → one-click deploy. Map: **data fields** → Caspar `CG UPDATE` XML/JSON; **preview** → iframe or offscreen; **deploy** → write directly to **`/template`** (Caspar + HighAsCG shared workdir).

---

## Dependencies / coupling

| Core touchpoint | Module responsibility |
|-----------------|----------------------|
| **Sources → Templates tab (left browser)** | Templates are selected from the existing Sources browser Templates tab; module opens the selected template in **Template Editor**. |
| **AMCP / CG** | Reuse WO-07 `CG ADD` / `UPDATE` / `INVOKE`; module may add `/api/cg-studio/*` routes. |
| **WO-25 PIP overlays** | Include editing/preparing **custom PIP border presets** as part of Template Editor scope (preset authoring + save/load). |
| **WO-30 registry** | Mirror: `register.js`, `HIGHASCG_CG_STUDIO=1` or `config.features.cgStudio`. |

---

## Directory sketch (all gated / deletable)

| Path | Purpose |
|------|---------|
| `src/cg-studio/register.js` | Hook routes, static mount, feature flag |
| `src/cg-studio/routes-*.js` | Save template, list projects, deploy to `template/` |
| `web/components/cg-studio-*.js` | Editor shell, iframe bridge, deploy dialog |
| `web/lib/cg-studio-*.js` | Export adapters, field schema |
| `web/styles/cg-studio*.css` | Scoped styles |
| `work/references/cg-studio/` | Vendored upstream snapshot or design notes |

**Invariant:** No file outside these trees may `require`/`import` module paths except through **`module-registry`**.

---

## UX placement (required)

- **Main workspace:** Template Editor appears as a **top-level workspace tab**.
- **Inspector:** currently selected template item/element is edited in the **existing inspector panel** (no separate inspector paradigm).
- **Sources browser (left):** template list remains under **Templates** tab; selecting an item opens/loads it into Template Editor.

---

## Tasks (initial breakdown)

### Phase 0: Product + legal

- [x] **T0.1** Shortlist 1–2 embeddable editor libraries (license, bundle size, export quality).
- [x] **T0.2** Define **Caspar output contract** (single `index.html` vs `template.html` + assets; `update` JSON shape).

### Phase 1: Module shell

- [x] **T1.1** `src/cg-studio/register.js` + feature flag + `module-registry` hook (no-op when off).
- [x] **T1.2** Placeholder route `GET /api/cg-studio/health` + optional static `web/assets/modules/cg-studio/entry.js` pattern (match previs).
- [x] **T1.3** `optionalDependencies` + `npm run install:cg-studio` doc line in `MANUAL_INSTALL` (when touched).
- [x] **T1.4** Align naming in UI/routes/docs to **Template Editor** (no "CG Studio" user-facing labels).

### Phase 2: Editor MVP

- [x] **T2.1** Editor UI: new **workspace tab** **“Template Editor”** (lazy-loaded).
- [x] **T2.2** Project model: JSON on disk under `.highascg-cg-studio/` or repo folder (versioned).
- [x] **T2.3** **Export** → write `.html` (+ assets) into `template/` with `window.update` stub merging field map.
- [x] **T2.4** **Open/Save/Export path** uses shared workdir **`/template`** as canonical template location.
- [x] **T2.5** Inspector integration: selected stage item binds to existing inspector controls.

### Phase 3: Data fields + live link

- [ ] **T3.1** Field schema → generate sample `CG UPDATE` payload from inspector.
- [ ] **T3.2** Optional: bind to HighAsCG **variables** / Companion (WO-10) for preview.

### Phase 4: Sources integration

- [ ] **T4.1** From left **Sources → Templates** tab: open selected template in Template Editor.
- [ ] **T4.2** New template from wizard (resolution, frame rate, safe margins).

### Phase 5: PIP border presets

- [ ] **T5.1** Preset model for custom PIP border styles (name + effect params + schema version).
- [ ] **T5.2** Author/edit/save/load presets from Template Editor.
- [ ] **T5.3** Inspector section for preset parameter editing and live preview binding.
- [ ] **T5.4** Persistence path and import/export rules documented (shared workdir-friendly).

---

## Work Log

### 2026-04-22 — Agent

**Work Done:**

- Created WO-32 scope: **detachable CG/HTML visual studio module**, vMix-GT-style *workflow* target, **integrate existing web editor** preference, directory + registry alignment with WO-30, phased tasks.

**Instructions for Next Agent:**

- Run **T0.1–T0.2** (library pick + Caspar export contract); then **T1.x** shell so the repo can toggle the module without shipping editor weight by default.

### 2026-05-07 — Agent

**Work Done:**

- Renamed product-facing scope to **Template Editor** throughout this WO.
- Added required UX placement:
  - main workspace tab,
  - selection-driven existing inspector editing,
  - integration with left Sources browser **Templates** tab.
- Updated storage/deploy assumptions to shared workdir path **`/template`** for open/save/export.
- Expanded scope to include **custom PIP border preset** authoring/editing/prep.
- Added new tasks `T1.4`, `T2.5`, and full **Phase 5** for PIP border presets.

**Instructions for Next Agent:**

- Keep internal module names if needed for compatibility, but ensure all user-facing labels are **Template Editor**.
- Implement T2.1/T2.5 and T4.1 together so the Sources→Editor→Inspector flow is end-to-end in one pass.
- Define the PIP border preset schema early (T5.1) to avoid migration churn.

### 2026-05-07 — Antigravity

**Work Done:**

- **T0.1**: Shortlisted and selected **GrapesJS** as the embeddable editor due to its MIT license, excellent HTML/CSS export suitable for broadcast graphics, and rich ecosystem without heavy frameworks.
- **T0.2**: Defined the Caspar output contract: `window.update(data)` + `window.play()`, transparent body background, writing directly to `/template/<project-name>/` structure.
- **T1.1–T1.4**: Created the `cg-studio` module shell. Updated `src/bootstrap/modules.js` to look for `HIGHASCG_CG_STUDIO=1`. Added `grapesjs` to `optionalDependencies` in `package.json` with an `install:cg-studio` script. Created `src/cg-studio/register.js`, `routes.js`, and the frontend entry point `entry.js`. 

**Instructions for Next Agent:**

- The module shell is complete and loadable via feature flag. Move to Phase 2 (Editor MVP).
- Start with **T2.1** to build the Template Editor workspace tab layout that lazy-loads GrapesJS.
- Then tackle **T2.2** (Project JSON persistence) and **T2.3** (Export logic to output CasparCG compliant HTML).

### 2026-05-07 (Phase 2) — Antigravity

**Work Done:**

- **T2.1**: Injected the "Template Editor" tab into the workspace UI via `entry.js` and implemented lazy-loading for GrapesJS via `cg-studio-editor.js`. Configured GrapesJS to mount its style/trait panels inside a hidden element, preparing them for the inspector.
- **T2.2 & T2.3 & T2.4**: Added `/api/cg-studio/save` endpoint to save GrapesJS `project.json` and generate an exported CasparCG `index.html` (with `window.update` and transparent body styles) directly into the shared `/template/` directory.
- **T2.5**: Updated `inspector-panel.js` with a new decoupled event hook (`highascg-inspector-render-external`) allowing the detachable `cg-studio` module to mount GrapesJS Style/Block managers into the right-hand Inspector panel whenever an element is selected on the canvas.

**Instructions for Next Agent:**

- Phase 2 is complete. Test the Editor UI, drag-and-drop components, and verify `/api/cg-studio/save`.
- Move on to **Phase 3 (Data fields)**, which requires mapping the text fields to variables, and **Phase 4 (Sources integration)** to allow opening existing templates from the left panel.

---

*Work Order created: 2026-04-22 | Parent: [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md) | Related: [25](./25_WO_PIP_OVERLAY_EFFECTS.md), [30](./30_WO_PREVIS_TRACKING_MODULE.md), [07](./07_WO_AMCP_PROTOCOL_API.md)*
