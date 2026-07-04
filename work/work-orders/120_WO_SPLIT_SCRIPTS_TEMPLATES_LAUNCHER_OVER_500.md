# WO-120 — Split scripts, templates, launcher & logs modal over 500 lines

> **⚠️ AGENT COLLABORATION PROTOCOL** — see [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)

**Parent:** [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)  
**Status:** Done  
**Priority:** **Low–Medium**

**Touches:** `scripts/`, `template/`, `client/tools/electron-launcher/`, `client/components/logs-modal.js`

---

## 1. Problem

| Lines | File |
|------:|------|
| 610 | `client/tools/electron-launcher/renderer.js` |
| 578 | `template/lower-thirds/lt-engine.js` |
| 570 | `client/components/logs-modal.js` |
| 562 | `client/tools/electron-launcher/index.html` |
| 556 | `template/lower-thirds/lt-engine-from-client/lt-engine copy.js` |
| 522 | `template/led_grid_test.js` |
| 520 | `scripts/exfat/install-exfat-systemd-units.sh` |
| 518 | `scripts/lib/install-helpers.sh` |

---

## 2. Split plan

### 2.1 Shell scripts

**`install-helpers.sh` (518)** — split by concern:

| New file | Content |
|----------|---------|
| `install-helpers-github.sh` | `get_latest_github_*` |
| `install-helpers-deb.sh` | dpkg/apt helpers |
| `install-helpers-systemd.sh` | unit install helpers |
| `install-helpers.sh` | `source` hub only |

**`install-exfat-systemd-units.sh` (520)** — split:

| New file | Content |
|----------|---------|
| `install-exfat-units-boot.sh` | boot/arrive units |
| `install-exfat-units-sync.sh` | sync/update units |
| `install-exfat-systemd-units.sh` | main entry, sources subs |

### 2.2 Templates

**`lt-engine.js` (578)** and duplicate **`lt-engine copy.js` (556)**:

- Consolidate to **one** canonical `lt-engine.js`; delete or redirect the copy.
- Split: `lt-engine-render.js`, `lt-engine-data.js`, `lt-engine-animate.js`.

**`led_grid_test.js` (522)** — split test grid vs Art-Net driver if mixed.

### 2.3 Electron launcher

**`renderer.js` (610)** — split by launcher panel:

| New module | Responsibility |
|------------|----------------|
| `renderer-sim.js` | simulator controls |
| `renderer-modules.js` | module toggles |
| `renderer-stick.js` | stick prep / deploy |

**`index.html` (562)** — extract inline `<style>` / large `<script>` blocks to external files; target ≤ 200 lines HTML.

### 2.4 `logs-modal.js` (570)

| New module | Responsibility |
|------------|----------------|
| `logs-modal-panes.js` | tab panes (caspar, highascg, system) |
| `logs-modal-fetch.js` | tail/download API |
| `logs-modal-filter.js` | level filter, search |

---

## 3. Tasks

- [x] **T120.0** Split `install-helpers.sh` + exfat install script; dry-run on dev host.
- [x] **T120.1** Consolidate + split lt-engine; remove duplicate copy file.
- [x] **T120.2** Split electron launcher renderer + slim index.html.
- [x] **T120.3** Split logs-modal (prior session).
- [x] **T120.4** Split `led_grid_test.js`.
- [x] **T120.5** All listed paths ≤ 500 lines.

---

## 4. Verification

```bash
npm run lint
npm run smoke:log-record
npm run smoke:exfat-sync
bash -n scripts/lib/install-helpers.sh
bash -n scripts/exfat/install-exfat-systemd-units.sh
```

---

## Work Log

### 2026-07-03 — Created

- **Instructions for Next Agent:** Shell script splits are lowest risk — start with `install-helpers.sh` sourced modules.

### 2026-07-03 — WO-120 complete

**Electron launcher:** `renderer.js` hub + `renderer-{nav,stick,sim,optional-modules,guides,partials,port}.js`; `index.html` 203 lines with `partials/tab-{flash,partition}.html`.

**Shell:** `install-helpers.sh` → `-github`, `-runtime`, `-packages`; `install-exfat-systemd-units.sh` → `-units-{bridge,exfat,enable}.sh`.

**Templates:** `lt-engine.js` loader + `lt-engine-{styles,core}.js`; duplicate `lt-engine copy.js` → 2-line redirect; `led_grid_test.js` loader + `led-grid-test-{core,patterns}.js`.

`check:file-lines` — **0 files over 500** (WO-111 scope complete; WO-121 strict CI gate next).
