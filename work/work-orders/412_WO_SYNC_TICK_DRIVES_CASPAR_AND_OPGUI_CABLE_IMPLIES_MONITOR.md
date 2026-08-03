# WO-412 — "NVIDIA sync to display" tick drives caspar GL sync too; operator-GUI cable implies Operator monitor + stacking (todos03.08 follow-ups)

**Status: DONE (2026-08-03 — suite green, built + kiosk F5 + service restarted; both take full effect at the next Apply)**
**Priority:** High (owner: "the gl sync can be under the same tick box… just sync to this display, changes it in nvidia and caspar" + "connecting operator gui to an output needs to automatically enable operator monitor and disable always on top")
**Source:** owner conversation 03.08, follow-up to WO-407's auto GL sync
**Related:** WO-407 (GL vblank sync), WO-263 (stacking below Firefox), WO-246 (operator monitor resolution), WO-308 (monitor/confine split)

## 1. Investigation

1. **One tick, two consumers.** The Device-View port inspector already has "NVIDIA sync to
   display" (`screen_N_nvidia_sync_to_display`, single-select across ports 1–4) feeding the
   NVIDIA policy script (`HIGHASCG_NVIDIA_SYNC_OUTPUT` via `resolveNvidiaSyncToDisplayOutput`).
   WO-407's caspar-side resolver ran purely on auto (screen 1) and ignored the tick.
   **This box already has the tick set on port 1** (the PGM port) — so tick and auto agree
   today (both → DP-0), but a tick moved to another port would have silently diverged.
2. **Operator-GUI cable flags stopped at the merged config.**
   `applyPhysicalPortConsumerFlagsToScreens` stamps `operator_monitor: true`,
   `always_on_top: false`, `interactive: true` on the cabled port — but only on the MERGED
   generator config. The APP config (what the runtime display session, kiosk placement,
   pointer confine and the Device-View tick itself read) never got them: the owner still
   had to tick "Operator monitor" manually after cabling.

## 2. What was done

- `src/utils/caspar-gl-sync-env.js` — resolution order is now: explicit
  `caspar_gl_sync_display` override (off/none/name) → **the NVIDIA-sync ticked port**
  (its `screen_N_system_id`, else the layout plan's `screens[N].sysId`) → auto screen 1 →
  `screen_1_system_id`. Inspector tooltip updated ("…AND Caspar GL swap vblank").
- `src/config/screen-consumer-port-resolve.js` — new `deriveOperatorGuiAppConfigPortFlags`:
  finds the operator_gui destination's cabled port via the same wiring context the merged
  pass uses, returns a single-select `screen_1..4_operator_monitor` patch (mirroring the
  inspector's own loop, so a moved cable CLEARS the old port) + `always_on_top: false` +
  `interactive: true` on the cabled port. No cable → empty patch (never clobbers manual
  choices).
- `src/utils/full-config-apply.js` — persists that patch into `casparServer` (config
  manager save) at the top of every Apply, before the layout session runs.
- `tools/smoke/smoke-wo412-opgui-cable-implies-monitor.test.js` (3 tests) + 1 new test in
  the WO-407 smoke (tick priority, override-beats-tick). Both in the CI list.

## 3. What was VERIFIED to work

- Behavior proven against the REAL box config offline: derive → `guiPort 3` with
  single-select patch (matches the actual operator-GUI cable); GL resolver honors the
  box's existing port-1 tick → `DP-0` (same as the running caspar's env).
- Suite green (counts in commit); `build:client` + kiosk F5 (tooltip); service restarted.
- Owner QA: next **Apply** persists the port-3 flags (the "Operator monitor" tick in the
  port inspector should show ticked afterwards); moving the GUI cable to another port and
  Applying must move the tick and the sync behavior with it.
