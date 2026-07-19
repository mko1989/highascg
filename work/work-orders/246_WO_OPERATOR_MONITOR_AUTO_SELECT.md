# WO-246 — Auto-select operator monitor: single connected display wins, multiple wait for the flag

**Status:** Implemented (owner/hardware acceptance pending)
**Priority:** MEDIUM (UX + self-healing; the 2026-07-15 config clobber flipped `screen_3_operator_monitor` off and silently broke operator-display features)
**Owner check:** A246.1

## Owner requirement (verbatim intent)
"automate the operator screen choice. when one screen connected this one is set, if multiple wait for a flag"

## Resolution rule
1. **Exactly one physical display connected** → that port IS the operator monitor, regardless of flags (a flag pointing at a disconnected port is meaningless; a lone display is self-evidently where the operator sits).
2. **Multiple displays connected** → explicit `screen_N_operator_monitor` flag decides; if none set, resolve to null (unchanged behavior — "wait for a flag", no guessing).
3. **Detection unavailable** (xrandr error, headless, empty physical map) → fall back to today's flag-only behavior exactly.

## Ground truth (verified live 2026-07-15)
- Flag resolver today: `operatorMonitorPortIndex(config)` at `src/utils/x-display-session-layout.js:94-99` — walks `screen_1..4_operator_monitor` via `portFlagEnabled`/`readCasparSetting`. Internal callers at lines 202 and 216; exported at line ~396.
- `src/system/pointer-confine.js:311` fails `{ ok:false, reason:'no_operator_monitor' }` — find how it obtains the port (likely imports `operatorMonitorPortIndex`) and switch it to the new resolver.
- Connected-display detection: `getDisplayDetails()` from `src/utils/hardware-info.js:273` (sync, short-TTL cached — see comment at line ~155, safe per-request) + `getGpuConnectorInventory()`; `buildGpuPhysicalMap({ config, displays, connectors })` from `src/utils/gpu-physical-map.js:71` returns port entries with `connected` booleans and port indexing (see how `src/support/gpu-display-snapshot.js:21-40` composes these — copy that composition, including the `isPseudoGpuConnectorName` filter for connectors).
- NOTE the flag family split: `screen_N_operator_monitor` (this WO) is DISTINCT from `screen_N_interactive` / interactive zones (`src/system/cef-interactive-bridge-zones.js`, used by host-operator-fullscreen's 400). Do NOT touch the interactive-zone logic — follow-up only.

## Tasks

**T246.1 — new module `src/utils/operator-monitor-resolve.js`** (new file, keeps x-display-session-layout.js under the 500-line limit)
`resolveOperatorMonitorPort(config, opts = {})` → `{ port: number|null, mode: 'auto-single'|'flag'|'none'|'fallback-flag' }`:
- `opts.displays` / `opts.connectors` injectable for tests; default to `getDisplayDetails()` / filtered `getGpuConnectorInventory()` inside try/catch.
- Build the physical map; collect connected physical ports (1-based indices as used by the flags).
- Apply rules 1-3 above (`fallback-flag` = detection threw/empty → flag result).
- Reuse `operatorMonitorPortIndex` (import from x-display-session-layout.js — check for require cycles; if one exists, move `operatorMonitorPortIndex`+`portFlagEnabled` INTO the new module and re-export from x-display-session-layout.js for back-compat).

**T246.2 — switch consumers**
- `src/utils/x-display-session-layout.js` lines 202 and 216: use the resolver's `.port`.
- `src/system/pointer-confine.js` (~311): use the resolver; keep the `no_operator_monitor` reason string.
- Grep the whole repo for other `operatorMonitorPortIndex` imports and switch each (report the list).

**T246.3 — surface the resolution in the device-view snapshot**
In `src/api/device-view-snapshot.js` (it already builds `gpuPhysicalMap` at ~313): add `operatorMonitor: { port, mode }` so the UI/support bundle shows whether the choice was automatic. No client rendering work in this WO.

**T246.4 — smoke test** `tools/smoke/smoke-wo246-operator-monitor-auto.test.js`, wired into the curated gate FILES list (`tools/ci/run-offline-tests.js`):
1. one connected display, no flags → that port, mode 'auto-single';
2. one connected display, flag on a DIFFERENT port → connected port wins, 'auto-single';
3. two connected, flag set → flag port, 'flag';
4. two connected, no flag → null, 'none';
5. detection throws / empty displays, flag set → flag port, 'fallback-flag'.
Use injected `opts.displays`/`opts.connectors` fixtures (shape: copy from a real `buildGpuPhysicalMap` call's inputs — see gpu-display-snapshot.js). NO xrandr, NO live server, NO AMCP.

## Constraints (standard)
- No git, no service ops, no AMCP, no `npx vite build`, curated gate ONLY (`node tools/ci/run-offline-tests.js`) — NEVER the full suite.
- Verify: `node --check` on touched files, `./node_modules/.bin/eslint --quiet` on touched files, curated gate with exact counts.
- Match surrounding code style; check WO checkboxes only for shipped work; note deviations honestly.

- [x] T246.1 resolver module
- [x] T246.2 consumers switched (list them)
- [x] T246.3 snapshot field
- [x] T246.4 smoke in gate
- [ ] A246.1 (owner) after deploy+restart: unplug down to one display → operator features follow it without touching settings
