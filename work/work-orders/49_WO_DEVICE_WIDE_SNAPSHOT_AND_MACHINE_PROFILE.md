# Work Order 49: Device-wide snapshot (machine profile) — JSON bundle + rear-panel image

> **AGENT COLLABORATION PROTOCOL**  
> Every agent that works on this document MUST:  
> 1. Add a dated entry to the **Work Log** section at the bottom.  
> 2. Update task checkboxes to reflect current status.  
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.  
> 4. Do **not** delete previous agents’ log entries.

**Parent / context:** [WO-33 Device View index](./33_WO_DEVICE_VIEW_INDEX.md); hardware settings [WO-39](./39_WO_SETTINGS_SYSTEM_HARDWARE.md); GPU / xrandr binding [WO-40](./40_WO_DEVICE_VIEW_GPU_XRANDR_SCREEN_DEST_SYNC.md)  
**Status:** Draft  
**Prerequisites:** Working Device View rear panel render (33c+), persisted `DeviceGraph` / settings round-trip (33a, `routes-settings` patterns). WO-39 tabs can remain separate in UI; this WO **aggregates** their effective persisted state into one file.

---

## 1. Goal

Provide a **single, portable “device snapshot”** that captures **this machine’s** cabling + OS/GPU + DeckLink (and related) configuration so an operator can **save** and later **recall** a known-good rig in one action.

Today, GPU-oriented state (layout editor, xrandr-related fields, screen bindings) and DeckLink / system-hardware context (see WO-39) may be **scattered** across settings keys, local editor state, and the device graph. This work order defines:

1. A **versioned JSON document** that bundles **all machine-specific slices** we care to restore.  
2. A **save workflow** that prompts for a **human device name** (used as display title and as the **default basename** for the exported file).  
3. An embedded **visual snapshot** of the **Caspar rear panel** (same rendering as Device View — connectors, cables, markers) so thumbnails and offline sharing do not require opening the UI.

**Distribution model**

- Ship a **small set of generic snapshots** checked into the repo (or under `docs/` / `samples/`) representing common chassis/GPU/BMD combos *you* maintain.  
- Accept **additional profiles via you** (manual drop-in JSON files). **No** in-product “submit to vendor” UI is required.

---

## 2. Scope — what belongs in the bundle (normative v1)

The snapshot is **not** a full clone of `highascg.config.json`. It is a **narrow, labelled subset** that is safe to merge or apply with explicit UX (“Replace device graph”, “Overwrite GPU layout”, etc.).

Minimum **logical sections** inside the JSON payload (exact nesting is implementation detail, but the document must be reviewable):

| Section | Purpose |
|---------|---------|
| **`deviceGraph`** | Saved `DeviceGraph` (devices, connectors, edges, layout hints) — same conceptual model as WO-33a. |
| **`screenDestinations` / tandem-related patches** | Only the fragments needed so Caspar outputs + bindings line up after restore (reuse existing normalization from settings apply — do not fork generator). |
| **`osDisplay` / GPU layout** | Keys that drive **GPU head layout**, **override flags**, EDID-ish selections persisted with settings — aligned with WO-40 / inspector export paths where they already exist. |
| **`systemHardware`** (optional block) | *If* persisted: chosen NVIDIA branch target, DeckLink/port notes, anything operators expect to travel with the machine profile — mirror what WO-39 surfaces, without storing secrets or arbitrary paths from client input. |

**Explicit non-goals for v1**

- Snapshots **must not** embed absolute file paths unique to another machine unless they are **allow-listed** benign fields documented in schema. Prefer logical IDs (`gpu_out`, `decklink_out`, connector ids).  
- No automatic **silent** restore on boot — apply is **user-initiated** with confirmation when overwriting live config.  
- No cloud upload / community gallery.

---

## 3. UX — save flow

1. User chooses **Save device snapshot…** from Device View (or Settings → Hardware — pick **one** primary entry point and deep-link the other).  
2. Modal **prompt**: “**Device name**” (required).  
   - Validate: non-empty after trim; suggest slug from name for filename (`My Truck A` → default `my-truck-a.json`).  
   - Operator may edit filename before download / before server write — product choice: browser download-only vs POST to server `config/` folder.  
3. On confirm: assemble JSON (§2), attach visual (§4), serialize **pretty-printed UTF-8 JSON**, then trigger **download** and/or **server-side save** (implementation picks one coherent story; document in Work Log).

**Recall / load flow (paired, same WO)**

1. User chooses **Load device snapshot…** and picks a `.json` file (or selects from bundled list in UI — optional stretch).  
2. Server or client validates **`kind` / `version`**, lists **what will change** (bullets per section).  
3. Apply with **explicit** merge strategy: at minimum “Import device graph only” vs “Apply full snapshot” toggle; escalate to staged sub-dialog if overlapping keys are risky.

---

## 4. Visual snapshot — rear panel rendering

Embed a **bitmap or SVG snapshot** of the **Caspar host rear panel** as rendered today (markers, cables, connector positions).

Recommended implementation order:

1. **Prefer** capturing the existing SVG / root element via browser APIs (`foreignObject`, serializing SVG, or `canvas` draw) consistent with existing Device View DOM under `device-view-caspar-render*` modules.  
2. **Normalize** coordinates / stroke widths so the image is stable across zoom; capture at a **fixed export scale** (e.g. 2×) for legibility.  
3. Store in JSON as:  
   - `visual.mimeType` + `visual.encoding` (`base64`) + `visual.width` / `visual.height`, **or**  
   - `visual.uri` if we sidecar a `.png` next to the JSON (only if product wants smaller JSON — default to **single file** with base64 for simplicity).

**Acceptance:** opening the JSON in a text-unaware tool still allows recovery of the image (decode base64); `file` size guardrails (warn if > N MB).

---

## 5. JSON envelope (sketch — implement as versioned schema)

```json
{
  "kind": "highascg-device-snapshot",
  "version": 1,
  "deviceName": "OB truck — Caspar 1",
  "slug": "ob-truck-caspar-1",
  "createdAt": "2026-05-18T12:34:56.000Z",
  "appVersion": "optional semver from server",
  "host": { "hostname": "optional; informational only" },
  "visual": {
    "mimeType": "image/png",
    "encoding": "base64",
    "width": 1280,
    "height": 720,
    "data": "…"
  },
  "payload": {
    "deviceGraph": { },
    "settingsPatches": { }
  },
  "notes": "optional free text for integrators"
}
```

- Add **`GET /api/device-snapshot/schema`** or export a JSON Schema file under `docs/` if other tools will validate.  
- Document migration path `version: 1 → 2` in code when new sections are added.

---

## 6. Tasks (checklist)

- [x] **T1** Define `normalizeDeviceSnapshot` / validation in `src/` (reject unknown `kind`, enforce size limits for `visual.data`).  
- [x] **T2** Server: `GET /api/device-snapshot/build` — returns **current** payload sections + optional `visual` if client posts dimensions or if server can accept multipart (prefer **client-generated** image to avoid headless canvas issues).  
- [x] **T3** Server: `POST /api/device-snapshot/apply` — validate body, dry-run diff, apply via existing `configManager` / device-graph save paths (no new ad-hoc writers).  
- [x] **T4** Web: save modal (device name), client-side JSON assembly + download; wire to **T2** if server round-trip is required.  
- [x] **T5** Web: capture routine for rear panel → base64 PNG (or SVG) with fixed scale; unit-test **pure** resize/base64 helpers if extracted.  
- [x] **T6** Web: load flow + conflict UI; reuse settings “apply” feedback patterns.  
- [x] **T7** Repo: add **2–3 generic** example snapshots under an agreed path (e.g. `samples/device-snapshots/README.md` + `.json` files) — **no real customer hostnames**.  
- [x] **T8** Docs: short operator paragraph — how to request a new generic template (through maintainer), filename conventions, version field.

---

## 7. Success criteria

1. One **Save** action produces **one JSON file** named from **device name** with embedded **rear-panel image**.  
2. **Load** reapplies **device graph + GPU/DeckLink-relevant settings** without manual re-entry for the covered fields.  
3. Generics + hand-authored JSON can be dropped in and loaded with the same code path.  
4. Large images or invalid files fail with **clear** errors, not partial corrupt config.

---

## 8. Related files (expected touch points)

- `client/components/device-view-caspar-render*.js` — rear panel DOM / SVG for capture  
- `client/components/device-view-inspector-gpu*.js` — existing export / layout save events (`gpu-layout-export` etc.)  
- `src/api/routes-*` — device graph, settings apply (follow existing auth patterns)  
- `client/components/settings-modal*.js` — WO-39 hardware panes; read persisted keys for bundle  
- `src/config/` — normalization helpers; avoid duplicating tandem merge logic

---

## 9. Work log

### 2026-05-18 — WO drafted

- Captures product ask: **single machine profile** JSON, **prompted device name**, **rear panel visual**, generic templates + **manual** user submissions (no submission UI).  
- **Instructions for next agent:** confirm whether export is **download-only** or **server-persisted** under `config/`; pick primary nav entry (Device View vs Settings); implement **T1–T8** in order, starting with schema + validation before UI polish.

### 2026-05-18 — Initial implementation (agent)

- **`src/config/device-snapshot.js`**: kind/version validation, visual size limits, `extractPayloadFromConfig`, `applySnapshotToConfigClone`, JSON Schema export.  
- **`src/api/routes-device-snapshot.js`**: `GET /api/device-snapshot/build`, `GET /api/device-snapshot/schema`, `POST /api/device-snapshot/apply` (`full` | `graphOnly`, `dryRun`). Persist via same shape as settings save (`saveFullConfigLikeSettings`).  
- **`src/api/router.js`**: routes wired (pre–Caspar gate, with settings).  
- **`src/bootstrap/modules.js`** + **`client/index.html`**: vendor mount + import map for `html-to-image` (ESM).  
- **Web**: `client/lib/device-snapshot-capture.js` (dynamic `import('html-to-image')`), `device-view-snapshot-modals.js`, **Devices** toolbar **Save snapshot** / **Load snapshot**; download-only export (no server-side drop folder).  
- **`samples/device-snapshots/`** + `npm run test:device-snapshot` (`tools/smoke/smoke-device-snapshot.js`).  
- **Dependency**: `html-to-image` (npm).  
- **Instructions for next agent:** QA in browser (PNG capture may depend on browser resolving extension-less ESM imports under `/vendor/html-to-image/`); optionally add **Settings → Hardware** shortcut to snapshot modals; consider shipping additional real-world generic JSON files once validated on hardware.
