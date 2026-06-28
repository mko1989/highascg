# Work Order 67: Logs modal — pane toggles, categorized HighAsCG logging, support bundle export

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **not** delete previous agents' log entries.

**Status:** Shipped (v1) — live-rig manual QA still recommended (§7)  
**Priority:** High (operator troubleshooting — broken toggles block daily use; uncategorized logs are unusable on busy rigs)  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Related:**
- [08_WO_CASPARCG_CLIENT_FEATURES.md](./08_WO_CASPARCG_CLIENT_FEATURES.md) — connection eye, status UX
- [49_WO_DEVICE_WIDE_SNAPSHOT_AND_MACHINE_PROFILE.md](./49_WO_DEVICE_WIDE_SNAPSHOT_AND_MACHINE_PROFILE.md) — machine profile JSON (cabling/GPU); **not** the same as support bundle
- [62_WO_PROJECT_SCOPED_MEDIA_ROOT.md](./62_WO_PROJECT_SCOPED_MEDIA_ROOT.md) — `GET /api/project/bundle` (project publish); **not** the same as support bundle
- [59_WO_DEVICE_VIEW_SERVER_INSPECTOR_FPS_NETWORK.md](./59_WO_DEVICE_VIEW_SERVER_INSPECTOR_FPS_NETWORK.md) — system inventory / network readouts to include in bundle
- [performance/PF-02-websocket-chatter.md](./performance/PF-02-websocket-chatter.md) — `log_line` rate cap (preserve when extending log schema)

**Operator entry point today:** click **connection eye** in header → `showLogsModal()` (`client/components/logs-modal.js`).

---

## 1. Problem statement

| Symptom | Likely cause |
|---------|----------------|
| **HighAsCG** / **CasparCG** toolbar buttons do not hide their panes | `syncPaneVisibility()` sets `hidden` on `.logs-modal__pane`, but panes use `display: flex` with **no** `.logs-modal__pane[hidden] { display: none !important; }` rule (other modals/panels in this repo **do** define explicit `[hidden]` CSS — see `08c-modals-misc.css`, `07b-audio-mixer-modal-shell.css`). UA `[hidden]` may lose to author stylesheet in some builds. |
| HighAsCG log stream is one flat wall of text | `log-buffer.js` stores plain `string[]`; `logger.js` formats `[timestamp] (HACG) [level] message` with **no category**; modules use ad-hoc `[Tag]` prefixes in message text (`[OS-Config]`, `[ArtNet]`, `[scene-take]`, …) — not machine-filterable. |
| Operators cannot isolate xrandr vs AMCP vs Art-Net vs streaming noise | No server-side category field; client cannot filter without fragile substring heuristics. |
| After a failure, no single artifact captures “what the box looked like” | Config, project, inventory, and logs are scattered; `GET /api/project/bundle` is **project publish**, WO-49 snapshot is **device graph restore** — neither is a **forensics / support** export. |

**Goal:** Fix pane toggles, introduce **first-class log categories** with UI filters, and add a **Support bundle** download from the logs modal (or adjacent toolbar) that packages configs, active project metadata, system snapshot slices, and recent logs for post-mortem analysis.

---

## 2. Product behaviour (normative)

### 2.1 Pane source toggles (bug fix — ship first)

| Requirement | Detail |
|-------------|--------|
| **HighAsCG toggle** | When off: hide `#logs-pane-highascg`, tear down WS `log_line` subscription, stop appending to DOM. When on: show pane, reload tail via `GET /api/logs?highascg=1&caspar=0`, re-subscribe WS. |
| **CasparCG toggle** | When off: hide `#logs-pane-caspar`, stop 2 s poll timer. When on: show pane, poll tail, keep AMCP input visible only when pane visible. |
| **Layout** | When one pane hidden, remaining pane expands to full width (flex). When both hidden, show empty-state hint (“Enable HighAsCG or CasparCG above”). |
| **CSS** | Add explicit `.logs-modal__pane[hidden] { display: none !important; }` (and optional `.logs-modal__panes--single` when one pane active). |
| **Persistence** | Optional stretch: remember last toggle state in `sessionStorage` for the browser tab — **not** required for v1 acceptance. |

### 2.2 HighAsCG log categories (server)

Replace (or wrap) plain-string buffer entries with **structured records**:

```typescript
type LogCategory =
  | 'system'      // boot, shutdown, inventory, generic Node/process
  | 'config'      // [Config] load/save/factory reset
  | 'os-display'  // [OS-Config] xrandr, layout persist, nodm
  | 'amcp'        // AMCP bridge traffic, raw commands, Caspar query failures
  | 'playback'    // scene-take, transitions, layer banks, timeline
  | 'streaming'   // [Streaming], [NDI], RTMP/ffmpeg consumers
  | 'audio'       // [Audio], ALSA default, PortAudio routing
  | 'network'     // replication peer, Tailscale hints, HTTP bind, nmcli apply
  | 'artnet'      // [ArtNet] UDP/DMX
  | 'replication' // [replication] hot backup (distinct from generic network)
  | 'websocket'   // [WS] client connect, state size warnings, log_line throttle
  | 'device'      // Device View apply, GPU/DeckLink enumeration
  | 'sync'        // project/usb/exfat sync, rsync
  | 'debug'       // verbose / uncategorized debug

type LogRecord = {
  ts: string          // ISO or Caspar-style — keep backward-compatible display
  level: 'debug'|'info'|'warn'|'error'
  category: LogCategory
  message: string     // human text without redundant category prefix when possible
}
```

| Requirement | Detail |
|-------------|--------|
| **Buffer API** | `log-buffer.js`: store `LogRecord[]`; expose `getHighasLines({ lines, categories?, levels? })`; `appendHighasLine` accepts record or legacy string (auto-migrate strings via tag parser during transition). |
| **Logger API** | Extend `createLogger({ category })` or `logger.info('msg', { category: 'os-display' })`; default category `system`. Wire `index.js` root loggers with sensible defaults. |
| **Tag migration** | Phase-in: map existing `[Tag]` prefixes in messages to categories (table in §4.2) so old lines and modules not yet updated still filter correctly. |
| **WS payload** | `log_line` event sends **object** `{ ts, level, category, message, line }` where `line` is preformatted string for backward compatibility; client uses object when present. |
| **HTTP API** | `GET /api/logs?categories=system,amcp&levels=warn,error&lines=500` — comma-separated allow lists; omit = all. Response: `{ highascg: LogRecord[] \| string[], caspar, casparPath, schemaVersion: 1 }`. |
| **Rate cap** | Preserve `HIGHASCG_WS_LOG_LINE_MAX_HZ` behaviour (PF-02); dropped lines should increment a counter exposed in bundle metadata (optional). |

**CasparCG log file** stays **uncategorized** in v1 (file tail only). Optional stretch: parse Caspar log level lines into coarse filters (`caspar-level=error`).

### 2.3 Logs modal UI — category filters

Add a **filter row** below source toggles (HighAsCG pane only):

```text
┌─ Server logs ─────────────────────────────────────────────
│ [HighAsCG ✓] [CasparCG ✓]  Pause  Copy  Clear  [Support bundle ↓]
│ Categories: [All] [System] [OS/xrandr] [AMCP] [Playback] [Streaming]
│             [Audio] [Network] [Art-Net] [Replication] [WebSocket] …
│ Level: ☑ info  ☑ warn  ☑ error  ☐ debug
├─ HighAsCG (live) ─────────────┬─ CasparCG ─────────────────
│  (filtered lines)             │  (file tail + AMCP input)
└───────────────────────────────┴────────────────────────────
```

| Requirement | Detail |
|-------------|--------|
| **Chip toggles** | Multi-select categories; **All** resets to full set; default on open: all categories, levels info+warn+error (debug off). |
| **Client-side filter** | Apply to WS stream and initial HTTP load using same query params as server (re-fetch when filter set changes, or filter client buffer — prefer **server filter** for large buffers). |
| **Copy** | Copy respects active filters and visible panes. |
| **Clear** | Unchanged (`POST /api/logs/clear` highascg only). |
| **Colour / prefix** | Optional: muted category badge per line in `<pre>` via structured render (not required v1 — plain text OK if category column in copy export). |

### 2.4 Support bundle export

**Purpose:** One downloadable artifact an operator or integrator can attach to a bug report — “what failed, how the system was configured, recent logs, performance hints.”

| Requirement | Detail |
|-------------|--------|
| **Trigger** | **Download support bundle** button in logs modal toolbar (primary); duplicate in **Settings → Diagnostics** tab. |
| **Format** | **ZIP** file, default name `highascg-support_<hostname>_<ISO-timestamp>.zip`. |
| **Generation** | Server-side `GET /api/support/bundle` or `POST /api/support/bundle` (POST allows optional note from operator). Stream ZIP; no temp file left on disk when possible (`archiver` or ` yazl` — match existing deps). |
| **Max size** | Cap total ~25 MB default; truncate log tails with manifest note when over; env `HIGHASCG_SUPPORT_BUNDLE_MAX_BYTES`. |

**Minimum ZIP contents (v1):**

| Path in ZIP | Source |
|-------------|--------|
| `manifest.json` | Bundle schema version, `createdAt`, app/build stamp (`BUILD_STAMP` / WO-66), hostname, uptime, active project id/name, filter snapshot, byte counts |
| `logs/highascg.jsonl` | Last N structured HighAsCG records (default 5000, all categories) |
| `logs/highascg-warn-error.txt` | Plain-text tail warn+error only (quick read) |
| `logs/caspar-tail.txt` | Last N lines from Caspar log file (same path as `/api/logs`) |
| `config/highascg-redacted.json` | Merged settings **redacted** (no tokens, passwords, Tailscale keys — reuse redaction helper or add one) |
| `config/caspar-server.xml` | Generated or on-disk Caspar config snapshot |
| `project/project-summary.json` | Active project metadata + scene list ids/names (not full media binaries) |
| `system/inventory.json` | `/tmp` system inventory file if present (`system-inventory-file.js`) |
| `system/network.json` | `GET /api/system/network` equivalent |
| `system/gpu-display.json` | GPU connector map + xrandr summary (subset of device-view snapshot) |
| `runtime/status.json` | Connection flags: AMCP connected, OSC diagnostics summary, replication role, stream state |
| `runtime/host-stats.json` | Last host stats sample if available (`routes-host-stats`) |

**Explicit non-goals v1:**
- No full `media/` tree or project bundle binaries (use existing publish flow).
- No automatic upload to vendor/cloud.
- No secrets — bundle builder must **fail closed** (strip field) rather than leak.

**Client UX:** Button shows spinner; on success trigger browser download; on error show alert with server message.

---

## 3. Current state (baseline)

| Area | Today | Gap |
|------|--------|-----|
| Modal | `client/components/logs-modal.js` | Toggle logic present but panes likely stay visible (CSS) |
| Styles | `client/styles/08a-modals-logs.css` | No `[hidden]` rule for panes |
| Buffer | `src/utils/log-buffer.js` | `string[]` only, max 4000 lines |
| Logger | `src/utils/logger.js` | Level only; formatLine has no category |
| Wiring | `index.js` | `onLine: logBuffer.appendHighasLine` → WS `log_line` |
| HTTP | `src/api/routes-logs.js` | `GET /api/logs`, `POST /api/logs/clear` |
| Tags in wild | `[OS-Config]`, `[Config]`, `[ArtNet]`, `[Audio]`, `[Streaming]`, `[replication]`, `[scene-take]`, `[WS]`, `[Sync]`, … | Convention, not schema |
| Project export | `GET /api/project/bundle` | Publish-oriented, not diagnostics |
| Device snapshot | WO-49 draft | Machine profile restore, not logs |

---

## 4. Architecture

### 4.1 Data flow (after WO)

```text
Module logger (category)
       ↓
log-buffer (LogRecord[])
       ├→ GET /api/logs?categories=…
       ├→ WS log_line { record, line }
       └→ support-bundle builder

Caspar log file (disk tail, uncategorized)
       ├→ GET /api/logs?caspar=1
       └→ support-bundle logs/caspar-tail.txt
```

### 4.2 Tag → category mapping (migration helper)

Implement `inferCategoryFromMessage(msg: string): LogCategory` for legacy lines:

| Prefix / pattern | Category |
|------------------|----------|
| `[OS-Config]`, `xrandr` | `os-display` |
| `[Config]` | `config` |
| `[ArtNet]` | `artnet` |
| `[Audio]` | `audio` |
| `[Streaming]`, `[NDI]` | `streaming` |
| `[replication]` | `replication` |
| `[scene-take]`, `[global-border]` | `playback` |
| `[WS]` | `websocket` |
| `[Sync]`, `exfat`, `rsync` | `sync` |
| AMCP `>>` / `<<` in client-injected Caspar pane | N/A (Caspar pane) |
| `[Shutdown]` | `system` |
| default | `debug` if level debug else `system` |

Prefer explicit `category` on new log calls over inference.

### 4.3 API additions

```text
GET  /api/logs?lines=&categories=&levels=&highascg=&caspar=
POST /api/logs/clear  { target: 'highascg' | 'both' }

GET  /api/support/bundle?logLines=5000&casparLines=2000
POST /api/support/bundle  { operatorNote?: string, logLines?: number }
     → Content-Type: application/zip
     → Content-Disposition: attachment; filename="highascg-support_…"
```

Register in `src/api/router.js`; implement `src/api/routes-support-bundle.js` + `src/support/build-support-bundle.js`.

### 4.4 Redaction

Centralize in `src/support/redact-settings.js`:
- Strip keys matching `/token|password|secret|apiKey|auth/i`
- Truncate long strings (>4k) in bundle
- Document redacted key list in `manifest.json`

---

## 5. Tasks

### Phase A — Fix pane toggles (P0)

- [x] **T67.A.1** Add `.logs-modal__pane[hidden] { display: none !important; }` to `08a-modals-logs.css`.
- [x] **T67.A.2** When both panes off, render `.logs-modal__empty` hint in panes container.
- [ ] **T67.A.3** Manual QA: toggle each pane independently and together; verify WS teardown when HighAsCG off; verify poll stop when Caspar off.
- [x] **T67.A.4** Smoke or DOM test: open modal, click toggles, assert `hidden` / visibility (optional).

### Phase B — Structured logging (server)

- [x] **T67.B.1** Define `LogRecord` + categories enum in `src/utils/log-record.js`.
- [x] **T67.B.2** Upgrade `log-buffer.js` to store records; keep `getHighasLines` backward compatible (string mode via query `format=text`).
- [x] **T67.B.3** Extend `createLogger` with default category; update `index.js` bootstrap loggers.
- [x] **T67.B.4** Add `inferCategoryFromMessage` for legacy strings.
- [x] **T67.B.5** Update `routes-logs.js` query filters (`categories`, `levels`).
- [x] **T67.B.6** WS `log_line` payload: object + `line` string; update `ws-server.js` if needed.
- [x] **T67.B.7** Buffered category loggers: `buffered-logger.js`; wired `os-config`, `ConfigManager`, `streaming/*`. Remaining modules use `ctx.log` + `[Tag]` inference (replication, artnet, scene-take).

### Phase C — Logs modal filters (client)

- [x] **T67.C.1** Category dropdown with checkboxes + level toggles in `logs-modal.js`.
- [x] **T67.C.2** Pass filter query to `GET /api/logs` on open and on filter change (debounce 150 ms).
- [x] **T67.C.3** WS handler: drop lines not matching active category/level client-side (belt-and-suspenders if server sends all).
- [x] **T67.C.4** Update Copy to include filter legend header.
- [x] **T67.C.5** Styles for filter chips in `08a-modals-logs.css`.

### Phase D — Support bundle

- [x] **T67.D.1** `build-support-bundle.js` — assemble manifest + files; unit test with fixture config.
- [x] **T67.D.2** `routes-support-bundle.js` + router registration.
- [x] **T67.D.3** Redaction helper + test (no secrets in output).
- [x] **T67.D.4** Client download button + error handling in logs modal; duplicate in Settings → Diagnostics tab.
- [x] **T67.D.5** Document operator-facing blurb in `docs/wiki/api/system-settings-hardware.md`.

### Phase E — QA & docs

- [ ] **T67.E.1** Manual QA checklist (§7) on live rig.
- [x] **T67.E.2** Update `project_status.md` row when shipped.
- [x] **T67.E.3** Note in PF-02 if `log_line` payload size changes (structured objects slightly larger — still rate-capped).

---

## 6. Acceptance criteria

1. Clicking **HighAsCG** or **CasparCG** toggle **immediately hides/shows** the corresponding pane; no ghost text or continued WS append to hidden pane.
2. Operator can enable **only Art-Net + warn/error** and see a readable stream during DMX debugging.
3. Category filters apply to **historical tail** (HTTP) and **live** (WS) lines consistently.
4. **Download support bundle** produces a ZIP openable on another machine; `manifest.json` lists contents; no API keys in `config/highascg-redacted.json`.
5. Bundle includes at least one Caspar log tail line when Caspar log file exists (or explicit `(file not found)` stub in manifest).
6. Existing `/api/logs` clients without `categories` param behave as today (all categories, text lines OK).

---

## 7. Manual QA checklist

- [ ] Open logs from connection eye; disable Caspar → only HighAsCG visible; re-enable → Caspar tail returns within one poll.
- [ ] Disable HighAsCG → live badge hidden, no new lines while disabled; re-enable → tail reload + live resumes.
- [ ] Select **Art-Net** only → xrandr lines hidden; **OS/xrandr** only → Art-Net hidden.
- [ ] Uncheck **info** → only warn/error remain.
- [ ] Copy with filters → pasted text matches visible content.
- [ ] Support bundle downloads; unzip; verify manifest, redacted config, logs present; grep zip for `password`, `token` — no hits from config files.
- [ ] Two browser tabs: both receive filtered WS without server crash (PF-02 cap still active).

---

## 8. Related files (starting points)

| Layer | Path |
|-------|------|
| Logs modal | `client/components/logs-modal.js` |
| Logs CSS | `client/styles/08a-modals-logs.css` |
| Connection eye | `client/components/connection-eye.js`, `client/app.js` |
| Log buffer | `src/utils/log-buffer.js` |
| Logger | `src/utils/logger.js` |
| Log routes | `src/api/routes-logs.js` |
| WS broadcast | `index.js` (`setOnNewLine`), `src/server/ws-server.js` |
| System inventory | `src/bootstrap/system-inventory-file.js` |
| Device snapshot slices | `src/api/device-view-snapshot.js` |
| Project bundle (reference) | `src/api/routes-project.js` |
| Host stats | `src/api/routes-host-stats.js` |
| Build stamp | WO-66 / `BUILD_STAMP` |

---

## 9. Out of scope (v1)

- Caspar log categorization / `LOG CATEGORY` AMCP integration in UI.
- Remote upload (S3, email).
- Full project/media inclusion in support bundle.
- Log search regex / grep UI (future).
- Persisting category filter prefs across sessions (stretch only).

---

## Work Log

### 2026-06-28 — WO drafted (operator request)

**Work done:**
- Created WO-67 from operator request: fix HighAsCG/CasparCG pane toggles in logs modal; expand HighAsCG logging into categories with UI filters; add downloadable support bundle (configs, project summary, system snapshot, logs).
- Reviewed current implementation: `logs-modal.js`, `log-buffer.js`, `routes-logs.js`, `[Tag]` conventions across server modules; identified missing `[hidden]` CSS as likely toggle bug; distinguished support bundle from WO-49 device snapshot and WO-62 project bundle.

**Status:** Draft — no implementation started.

**Instructions for Next Agent:** Ship **Phase A** first (CSS + empty state + QA) — quick win. Then **T67.B.1–B.5** before client filters. Support bundle can parallelize after structured logs exist.

---

### 2026-06-28 — Agent (Phases A–D initial implementation)

**Work done:**
- **Phase A:** Fixed pane toggles via explicit `[hidden]` CSS, single-pane layout class, empty-state when both sources off.
- **Phase B:** Added `src/utils/log-record.js`, structured `log-buffer.js`, category/level filters on `GET /api/logs`, WS `log_line` objects with backward-compatible `line` string.
- **Phase C:** Logs modal category chips, level checkboxes, server-side filter query + client WS filter, Copy header with active filters.
- **Phase D:** `GET /api/support/bundle` ZIP export (config redacted, logs, Caspar tail, project summary, inventory, network, host-stats); **Support bundle** button in modal; `npm run smoke:log-record`.

**Remaining:** T67.B.7 explicit category on modules (inference covers `[Tag]` prefixes today); T67.A.3 manual QA; T67.D.5 operator doc blurb.

**Instructions for Next Agent:** Manual QA toggles + filters on rig; optionally add explicit `category` to noisy modules; add short wiki troubleshooting paragraph for support bundle.

---

### 2026-06-28 — Agent (completion pass)

**Work done:**
- Support bundle: `system/gpu-display.json` (connectors, xrandr check, physical map, screen bindings); manifest `redactedKeyPatterns`, `wsLogLineDropped`; OSC diagnostics in `runtime/status.json`.
- `buffered-logger.js` — OS/xrandr, config, streaming logs now land in Web UI buffer; `ws-server` drop counter.
- Category UI: dropdown with checkboxes (replaces chips).
- Docs: `docs/wiki/api/system-settings-hardware.md`; PF-02 WO-67 note.
- Smoke: bundle + gpu-display test (`npm run smoke:log-record`).

**Remaining:** T67.A.3 / T67.E.1 manual QA on live rig only.

---

### 2026-06-28 — Agent (optional stretch: DOM smoke + Settings Diagnostics)

**Work done:**
- **T67.A.4:** Puppeteer harness (`tools/smoke/fixtures/logs-modal-test.html`) + `npm run smoke:logs-modal-toggles`; unit tests for `applyLogsPaneVisibility` / `setLogsToggleStyles` in `smoke-logs-modal-pane.test.js` (included in `npm run smoke:log-record`).
- **Settings → Diagnostics:** `settings-modal-diagnostics.js` wires support bundle download and **Open server logs** via shared `logs-modal-shared.js` helpers.
- Wiki: support bundle entry points mention Settings → Diagnostics.

**Remaining:** T67.A.3 / T67.E.1 manual QA on live rig only.

**Instructions for Next Agent:** Run `npm run smoke:logs-modal-toggles` in CI or pre-release checklist; live-rig toggle/WS/poll QA still open.

---

*Work Order created: 2026-06-28 | Series: HighAsCG operator diagnostics | Parent: 00_PROJECT_GOAL.md*
