# Work Order 32: CG Overlay Studio — Visual HTML Template Editor (detachable module)

> **AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Ship a **visual editor / creator** for CasparCG **HTML (and FT) graphics** — comparable in *workflow ease* to **vMix GT Title Designer** (drag-drop layout, text/image/shapes, animation hooks, data fields) — while keeping the feature in an **optional, detachable module** like **WO-30 Previs** (delete directories + flag off → core app unchanged).

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

**Reference workflow (vMix GT):** WYSIWYG stage → data fields bound to external updates → one-click deploy. Map: **data fields** → Caspar `CG UPDATE` XML/JSON; **preview** → iframe or offscreen; **deploy** → write to repo `templates/` + optional sync to Caspar template path (reuse WO-12 / routing patterns).

---

## Dependencies / coupling

| Core touchpoint | Module responsibility |
|-----------------|----------------------|
| **Sources → Templates tab** | Core lists TLS today; module may add **“Open in Studio”** or **duplicate row actions** via optional registration (no hard dependency — core keeps TLS list; see 2026-04-22 Templates tab). |
| **AMCP / CG** | Reuse WO-07 `CG ADD` / `UPDATE` / `INVOKE`; module may add `/api/cg-studio/*` routes. |
| **WO-25 PIP overlays** | Orthogonal — studio targets **full-screen** template graphics; PIP templates stay small/reg. |
| **WO-30 registry** | Mirror: `register.js`, `HIGHASCG_CG_STUDIO=1` or `config.features.cgStudio`. |

---

## Directory sketch (all gated / deletable)

| Path | Purpose |
|------|---------|
| `src/cg-studio/register.js` | Hook routes, static mount, feature flag |
| `src/cg-studio/routes-*.js` | Save template, list projects, deploy to `templates/` |
| `web/components/cg-studio-*.js` | Editor shell, iframe bridge, deploy dialog |
| `web/lib/cg-studio-*.js` | Export adapters, field schema |
| `web/styles/cg-studio*.css` | Scoped styles |
| `work/references/cg-studio/` | Vendored upstream snapshot or design notes |

**Invariant:** No file outside these trees may `require`/`import` module paths except through **`module-registry`**.

---

## Tasks (initial breakdown)

### Phase 0: Product + legal

- [ ] **T0.1** Shortlist 1–2 embeddable editor libraries (license, bundle size, export quality).
- [ ] **T0.2** Define **Caspar output contract** (single `index.html` vs `template.html` + assets; `update` JSON shape).

### Phase 1: Module shell

- [ ] **T1.1** `src/cg-studio/register.js` + feature flag + `module-registry` hook (no-op when off).
- [ ] **T1.2** Placeholder route `GET /api/cg-studio/health` + optional static `web/assets/modules/cg-studio/entry.js` pattern (match previs).
- [ ] **T1.3** `optionalDependencies` + `npm run install:cg-studio` doc line in `MANUAL_INSTALL` (when touched).

### Phase 2: Editor MVP

- [ ] **T2.1** Editor UI: new workspace tab or modal **“CG Studio”** (lazy-loaded).
- [ ] **T2.2** Project model: JSON on disk under `.highascg-cg-studio/` or repo folder (versioned).
- [ ] **T2.3** **Export** → write `.html` (+ assets) into `templates/` with `window.update` stub merging field map.
- [ ] **T2.4** **Deploy** button: optional copy to Caspar template path (config key) + `TLS` refresh.

### Phase 3: Data fields + live link

- [ ] **T3.1** Field schema → generate sample `CG UPDATE` payload from inspector.
- [ ] **T3.2** Optional: bind to HighAsCG **variables** / Companion (WO-10) for preview.

### Phase 4: Sources integration

- [ ] **T4.1** From **Templates** tab: “Edit in Studio” for selected template (if file is managed by studio).
- [ ] **T4.2** New template from wizard (resolution, frame rate, safe margins).

---

## Work Log

### 2026-04-22 — Agent

**Work Done:**

- Created WO-32 scope: **detachable CG/HTML visual studio module**, vMix-GT-style *workflow* target, **integrate existing web editor** preference, directory + registry alignment with WO-30, phased tasks.

**Instructions for Next Agent:**

- Run **T0.1–T0.2** (library pick + Caspar export contract); then **T1.x** shell so the repo can toggle the module without shipping editor weight by default.

---

*Work Order created: 2026-04-22 | Parent: [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md) | Related: [25](./25_WO_PIP_OVERLAY_EFFECTS.md), [30](./30_WO_PREVIS_TRACKING_MODULE.md), [07](./07_WO_AMCP_PROTOCOL_API.md)*
