# WO-330 — Companion module: finish, verify on-box, and ship

**Source:** todos24.07.26 — "Companion module."
**Status: AUDITED ON-BOX 2026-07-24 — one deploy command for the owner, then desk QA.**
A HighAsCG Bitfocus Companion module ALREADY EXISTS and has its own work tracking.

## On-box audit result (2026-07-24, live)
- Companion (headless v5, admin :8001) RUNNING; HighAsCG :4200 RUNNING; satellite :16622
  listening; `/api/companion/control-status`: acceptsCompanionControl=true, role standalone.
- **Installed module is v1.0.1; source/packaged is v1.0.3** — the entire WO-170 feature
  set (RTMP start/stop, record start/stop, multiview apply, timeline take/sendTo,
  countdown actions) plus WO-216 WoL exists ONLY in 1.0.3, i.e. NONE of it is on the desk.
  This is almost certainly what "Companion module" on the todo means.
- The Companion instance PINS `moduleVersionId: "1.0.1"` in `v5.0/db.sqlite` — a plain
  file swap would kill the instance on the next Companion restart. The installer
  (`tools/eggs/companion/install-companion-module.sh`) has been upgraded 2026-07-24 to
  repoint ANY stale pin (not just "dev") to the installed version, and it refuses to
  touch the db while Companion is running.
- `/api/companion/connection-status` anomaly: satellite `connected:true` yet
  `reason:"satellite_not_connected"` — contradictory status payload; journal shows the
  satellite TCP session established then closed with 0 surfaces. Cosmetic/status bug,
  investigate after 1.0.3 lands.
- Companion journal: "Invalid preset definitions: Preview ch1/ch2 · Bottom-right" +
  "Preset references not found: preview_ch1_quad_br, preview_ch2_quad_br" — module preset
  bug (bad references), fix in module repo.
- WO-170-QA-CHECKLIST.md: ALL items unchecked — nothing desk-verified yet.

## OWNER ACTION (needs sudo; ~1 min, briefly drops the streamdeck):
```
sudo systemctl stop companion \
  && /home/casparcg/highascg/tools/eggs/companion/install-companion-module.sh \
  && sudo systemctl start companion
journalctl -u companion --since '1 min ago' | grep -i highpass
```
Then run the WO-170 desk QA with the streamdeck and tick the checklist.

## Verified current state (2026-07-24, source read)

### The module itself (lives OUTSIDE this repo)
- `/home/casparcg/companion-module-dev/companion-module-highpass-highascg` — module id
  `highpass-highascg`, packaged tgz up to **1.0.3**, with its own
  `04_WO_CREATE_COMPANION_MODULE.md` and `WO-170-QA-CHECKLIST.md` in that directory.
- Installer/packaging: `tools/eggs/companion/` in THIS repo — `companion.service`,
  `install-companion-module.sh` (packages the module, unpacks into
  `~/.config/companion/modules`, and patches Companion's `v5.0/db.sqlite` instances stuck
  on moduleVersionId "dev"), `install-companion-service.sh`,
  `prepare-companion-for-eggs-clone.sh`.

### App-side support (this repo, already implemented)
- Companion-style URL prefix `/instance/<id>/api/*` accepted by the HTTP server
  (`index.js` ~375-383) and WS at `/instance/<id>/api/ws`.
- Control surface the module drives: `POST /api/scene/take`, `/api/scene/live/preview(/clear)`,
  `/api/timelines/{id}/play|pause|stop|seek`, `/api/mixer/volume|mastervolume`,
  `/api/ftb`, AMCP passthrough `POST /api/amcp/*` (see `src/api/router.js`).
- Feedback: WS messages `state`, `change`, `variable_update`, `osc`, `timeline.tick`,
  `compose.preview`; `GET /api/variables?prefix=...`; UI-selection variables
  (`ui_selection_*`) documented in `docs/companion-module-ui-selection.md`; slim bootstrap
  behavior in `docs/companion-websocket-catalog-bootstrap.md`.
- Bridge + previews: `src/companion-bridge/` (contract.js, look-air-frames.js,
  registry.js), `src/companion/` (satellite-preview-client.js — TCP satellite protocol for
  pulling Companion button previews INTO HighAsCG, button-preview-cache), config in
  `config/companion.json` (satellite port 16622), status endpoints
  `/api/companion/connection-status`, `/api/companion/control-status`,
  `/api/companion/preview/*`, and a client button-picker UI
  (`client/components/companion-button-picker-modal.js`, `settings-modal-companion.js`).
- Tests already present: `test/companion-control-status.test.js` + 6 smoke tests
  (`tools/smoke/smoke-companion-*.test.js`, incl. hot-backup failover and satellite preview).

## The actual work (audit → gap-close → ship)

1. **Reconcile trackers.** Read `04_WO_CREATE_COMPANION_MODULE.md` and
   `WO-170-QA-CHECKLIST.md` in the module repo; mark what's actually done in current
   source. Ask the owner what "Companion module" on todos24 means concretely — most likely
   candidates: unfinished checklist items, the module not being installed/running on this
   box, or missing actions the operator wants on the desk.
2. **On-box install verify.** Is Companion installed and `companion.service` enabled here?
   Does the installed module version match 1.0.3 (not "dev")? Run
   `tools/eggs/companion/install-companion-module.sh` if stale. Confirm
   `/api/companion/connection-status` reports connected.
3. **Desk-level QA pass** (with owner, streamdeck in hand): look take + preview select
   with button feedback (PGM red / PRV green semantics), timeline transport, FTB, master
   volume, `ui_selection_*` variables updating, compose-preview button images.
4. **Close the gaps found** — in the module repo for module-side items, here for app-side.
   Version-bump + repackage tgz + rerun installer; update the eggs clone prep so a fresh
   box image carries the working module.

## Acceptance
- Fresh Companion instance on this box connects to HighAsCG with zero manual db surgery,
  shows the module at a real version (not "dev").
- The QA checklist in the module repo is fully ticked or each open item is explicitly
  deferred by the owner in that file.
- Take/preview/FTB/transport/volume all work from a physical streamdeck with correct
  feedback within one round-trip.
- App-side: existing companion smoke tests green; any new endpoint/variable gets a smoke
  test. `npm run test:ci` → 0 fail.

## Constraints
- Module changes live in `/home/casparcg/companion-module-dev/...` — do not vendor the
  module into this repo; keep tools/eggs/companion as the install path.
- Companion's sqlite db is live state — only touch it via the existing installer script.
