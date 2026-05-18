# Work Order 42: Sources browser — live thumbnails (channel/layer, wait-for-play) + thumbnail/PRINT folder hygiene

> **AGENT COLLABORATION PROTOCOL**  
> Every agent that works on this document MUST:  
> 1. Add a dated entry to the **Work Log** section at the bottom.  
> 2. Update task checkboxes to reflect current status.  
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.  
> 4. Do **not** delete previous agents’ log entries.

**Parent / context:** [WO-33 Device View index](./33_WO_DEVICE_VIEW_INDEX.md) (extra live sources, `thumbnailChannel`); [WO-07 AMCP / API](./07_WO_AMCP_PROTOCOL_API.md) (`PRINT`); media tree behaviour overlaps [WO-29 USB ingest](./29_WO_USB_MEDIA_INGEST.md)  
**Status:** Draft  
**Prerequisites:** Caspar `PRINT` path writable under configured media root; existing `GET/POST /api/thumbnail/live/*` and `src/media/live-thumbnail-cache.js`

---

## 1. Goal

### 1.1 Live source thumbnails in the Sources browser

Operators need **small list thumbnails for live sources** (NDI, browser, routed inputs, extra live entries) in the **Sources** panel **Live** tab, visually consistent with **media** rows (`source-item__thumbnail` in [`web/components/sources-panel-media.js`](../web/components/sources-panel-media.js)).

Thumbnail content must come from **where the live source is actually on air**: a **Caspar channel + layer** (or full-channel still if product accepts channel-only `PRINT` and a single dominant layer). Behaviour:

1. **Prefer an explicit binding** when the operator has already pointed the source at a preview/route channel (today: `thumbnailChannel` on extra live sources and similar metadata — see [`web/lib/thumbnail-url.js`](../web/lib/thumbnail-url.js), [`web/components/sources-panel-live-render.js`](../web/components/sources-panel-live-render.js)).
2. **If the source is not playing anywhere yet**, the system **waits** (bounded timeout, clear UI state — e.g. spinner or “waiting for signal”) until Caspar reports that **this** producer (same URI / same logical source id) is **active on some channel-layer** (any channel, e.g. 1 or 8, any layer — discover via `INFO` / layer XML / existing query cycle data — exact mechanism is an implementation task).
3. **When play is detected**, perform **one** still capture from that channel (and layer if AMCP supports it — see §3), **store** it as the thumbnail for **that live source identity** (not only keyed by channel number — channel reuse must not show the wrong still for a different source).
4. After a successful auto capture, set a flag meaning **“does not need another thumbnail until the operator manually reloads from the Sources browser”** — no continuous polling / no repeated `PRINT` spam. In the UI, show a **small looping-arrow (reload) control** on that live row; manual reload clears the flag and re-runs the wait → capture pipeline (with optional `force`).

**Direct NDI** (`useDirect` + `ndi://`) remains **without** a reliable channel still (existing product rule in `getLiveThumbnailChannelForSource`); the WO should document UX: placeholder icon + tooltip, no fake PGM still.

### 1.2 Thumbnail and PRINT scratch files vs media root (GUI)

Caspar **`PRINT`** and any **HQ / generated stills** that land under the **media** tree should **not clutter the root of the media browser** for normal operators. Requirements:

1. Introduce a **conventional subfolder** under the media root (name bikeshed OK, e.g. `.highascg-thumbnails/`, `_highascg_print/`, or `highascg/.thumbs/`) used for:
   - Caspar `PRINT` output target (if configurable in generated Caspar config), **or** copy/move from default scratch location into this folder post-`PRINT` (see current `findNewestRootPngSince` in [`src/media/live-thumbnail-cache.js`](../src/media/live-thumbnail-cache.js)).
   - Optional consolidation of **ffmpeg HQ cache** paths if they currently write adjacent clutter — only if already under media root; do not break `resolveMediaFileOnDisk` security rules.
2. **Web UI media browser:** **hide** this folder (and its contents) from the **default** flat/tree listing — same way system junk should not appear beside PGM exports. Operators must still reach files when needed: e.g. **“Show system folders”** toggle, or **Settings → path** documentation + **move into folder** action for power users.
3. **Actual PGM / layer screen prints** saved as real media for playout remain **first-class** files in normal folders; only **machine-generated** thumbnail/PRINT scratch follows the hidden-folder convention (product must not hide arbitrary user PNGs).

---

## 2. Normative behaviour (acceptance-oriented)

### 2.1 Discovery and capture

- [ ] **T42.1** Given a live source record with stable `value` (and optional `thumbnailChannel` hint), the server or client can **resolve** `{ channel, layer }` where that producer is currently loaded/playing, using existing AMCP/state — **no** hard-coded channel 1 only.
- [ ] **T42.2** If nowhere on air: expose **wait** state in API + UI; poll or subscribe with **backoff** and **max wait**; cancel on tab close / source removed.
- [ ] **T42.3** On success: write **per-source** cached PNG (path or id derived from hashed `value` + type, or uuid in config) under `data/live-thumbnails/` **or** under media subfolder policy — document chosen layout; **must** survive channel change (same source moved to another channel keeps thumb until manual reload).
- [ ] **T42.4** Extend AMCP wrapper if Caspar supports **`PRINT` with layer** (research Caspar version in repo); if not supported, document **fallback**: full-channel `PRINT` + warning when multiple layers are visible.

### 2.2 UI — Sources Live tab

- [ ] **T42.5** Each live row includes a **thumbnail column** matching media list density (reuse `source-item__thumbnail` styles from media tab).
- [ ] **T42.6** States: **missing** (placeholder), **waiting** (animated indicator), **ready** (image), **error** (tooltip + retry). **Reload** icon clears “frozen” flag and re-arms capture.
- [ ] **T42.7** Drag-and-drop metadata unchanged; thumbnail is display-only.

### 2.3 Media folder hygiene

- [ ] **T42.8** New config key(s): e.g. `media_thumbnail_subdir` / `caspar_print_subdir` (exact names at implementation) — default to the conventional hidden-style folder; documented in [`config/defaults.js`](../src/config/defaults.js) + settings if operator-visible.
- [ ] **T42.9** Media browser tree builder in [`web/components/sources-panel-media.js`](../web/components/sources-panel-media.js) (and any CLS-driven list) **filters** the reserved folder name unless “show hidden” is on.
- [ ] **T42.10** Migration: one-time optional move of existing loose `YYYYMMDDTHHMMSS.png` print scratch files from media root into the subfolder **or** delete if already copied to `data/live-thumbnails` — script or startup log only; do not delete user-named PNGs.

### 2.4 Tests

- [ ] **T42.11** Unit tests for: path filter (folder hidden), cache key from `value`, backoff/timer cleanup (where testable without Caspar).
- [ ] **T42.12** Manual QA checklist: routed NDI on ch 8 layer 2, browser source, DeckLink tile, extra live source from Device View.

---

## 3. Implementation notes (for implementers)

- **Current code:** `PRINT` is channel-scoped in [`src/caspar/amcp-basic.js`](../src/caspar/amcp-basic.js) (`print(channel)`). Layer-aware capture may require AMCP string extension and Caspar version gate.
- **Current cache:** per-channel files `ch-${channel}.png` in [`src/media/live-thumbnail-cache.js`](../src/media/live-thumbnail-cache.js) — insufficient for “same channel, different source”; WO requires **per live source** file or metadata mapping.
- **Client helpers:** [`web/lib/thumbnail-url.js`](../web/lib/thumbnail-url.js) today builds `/api/thumbnail/live/${ch}` — may need `/api/thumbnail/live-source` or query param `source=` with encoding rules.
- **Osc / state:** If layer occupancy is already parsed elsewhere (preview canvas, query cycle), **reuse**; avoid duplicate AMCP storms — coordinate with [`src/utils/query-cycle.js`](../src/utils/query-cycle.js) / periodic sync.

---

## 4. Do **not** implement (explicit rejections)

- **Continuous live video** inside the small list cell — out of scope (see [WO-05](./05_WO_LIVE_PREVIEW_SETTINGS.md)); list uses **still** only.
- **Auto-PRINT on every** media refresh or on a fixed interval for all lives — forbidden; only first capture after play, then manual reload.
- **Hiding user-created** folders that merely “look like” thumbnails — only the **single configured system** subfolder name is filtered by default.

---

## 5. Acceptance criteria (summary)

1. Live tab shows **thumbnails** comparable to media tab; **reload** icon matches “frozen until manual refresh” semantics.  
2. Capture triggers after **source is on air** on **some** channel-layer (or documented fallback), not before.  
3. Media browser root **no longer fills** with Caspar PRINT scratch; system folder **hidden by default**, **recoverable** via toggle or documented path.  
4. No wrong still when **channel reused** for a different live source without manual refresh.

---

## 6. Work log

| Date | Agent / role | Summary |
|------|----------------|--------|
| 2026-05-15 | Agent | WO created from operator workflow (channel/layer-aware live thumbs, wait-for-play, one-shot + manual reload, media subfolder for PRINT/HQ clutter). |

### Instructions for next agent

- Confirm **Caspar `PRINT` layer syntax** for the version shipped in this project; update `amcp-basic.js` accordingly or document channel-only fallback in UI.  
- Sketch **API** (`GET` still URL + `POST` capture with `sourceId` / `value` + `force`) before large UI work.  
- Implement **T42.9** early so operators see immediate benefit from folder hygiene even before full wait-for-play logic lands.

---

*End of WO-42*
