# WO-439 — "NVIDIA sync to display" tick silently dropped on a mapping-node-only rig

**Status: DONE (2026-08-06 — suite 1853/0/2, service restarted; tick-resolution verified DP-0 against the live merged config. Caspar env var still lands on next Apply + caspar restart)**

Owner escalation on WO-437's report ("GL sync was NOT set"): *"thats why i fucking told you
to link the gl sync to the nvidia sync to display tickbox in gpu port inspector."*

The owner is right, and the tick WAS linked (owner 03.08 / WO-407: ONE tick drives the
NVIDIA vsync policy AND caspar's GL swap gating) — but the link was broken on exactly this
rig, and WO-437's session initially failed to see it.

## Investigation

- The tick IS set in the live config: `config/caspar_server.json:251`
  `screen_1_nvidia_sync_to_display: true`.
- `resolveGlSyncDisplay` step 1 reads it correctly (`nvidiaSyncToDisplayPortIndex` → port 1),
  then resolves the port to an output NAME via `screen_1_system_id` **or the layout plan's
  `screens`** — BOTH empty on this mapping-node-only rig (no screen destinations are assigned
  to screens; everything is `pixel_map_out → gpu_out`). So the tick was read and then
  **silently dropped at the name lookup**, and the resolver fell through to the (also-empty,
  pre-WO-437) auto path → caspar-env written with no `CASPAR_GL_SYNC_DISPLAY`.
- Same defect in the tick's OTHER consumer: `resolveNvidiaSyncToDisplayOutput`
  (`src/utils/x-display-session-runtime.js`) resolved ONLY via `screen_N_system_id`, so
  `HIGHASCG_NVIDIA_SYNC_OUTPUT` was never exported to the NVIDIA policy script either.
- Why WO-437's session missed it: its offline repro loaded `highascg.config.json` WITHOUT
  the `config/caspar_server.json` slice (flat-content file nested under `casparServer` by
  config-manager), so `nvidiaSyncToDisplayPortIndex` returned null in the repro and the tick
  path looked inactive. The live 09:52 caspar-env (no var) was consistent with both
  explanations; the session picked the wrong one and added a mapping-outputs fallback
  (WO-437 step 3) instead of fixing the tick's name resolution. That fallback happens to
  resolve the same DP-0 on today's graph, which masked the bug.
- Port→name ground truth that DOES exist on this rig: the device graph's GPU connector
  (`gpu_p0.externalRef = "DP-0"`, `gpu_p2.externalRef = "DP-4"`); tick port N ↔ connector
  `gpu_p{N-1}` (same rule as the client's `resolveGpuPhysicalScreenIndex`, gpu_p0 → 1).

## What was done

- `src/utils/xrandr-output-resolve.js`: new exported
  `resolveGpuPortIndexToXrandrOutput(config, portIndex1)` — ticked port → graph connector
  `gpu_p{N-1}` → `pickGpuOutLayoutSysId` → `resolveSysIdToXrandrOutput` (falls back to the
  raw sysId so it stays deterministic headless/CI).
- `src/utils/caspar-gl-sync-env.js` step 1: `screen_N_system_id` → plan screens → **graph
  connector** — the tick can no longer be dropped for lack of screen assignments.
- `src/utils/x-display-session-runtime.js` `resolveNvidiaSyncToDisplayOutput`: same graph
  fallback, so the tick exports `HIGHASCG_NVIDIA_SYNC_OUTPUT` on this rig too (kept the
  existing name-shape guard); exported for the smoke.
- New smoke `tools/smoke/smoke-wo439-nvidia-sync-tick-mapping-rig.test.js` (curated list):
  synthetic mapping-only config — tick resolves via connector for BOTH consumers, moving
  the tick moves the head, explicit `screen_N_system_id` still outranks, no tick → null.

## Verified

- Against the LIVE merged config (casparServer + deviceGraph slices nested properly):
  tick port 1 → `DP-0` via step 1 (the tick itself, not the WO-437 fallback); hypothetical
  tick on port 3 → `DP-4`. Smoke 4/4; full suite **1855 tests, 1853 pass, 0 fail, 2 skip**.
- highascg restarted (API 200). As with WO-437: `CASPAR_GL_SYNC_DISPLAY=DP-0` is written to
  caspar-env on the next config **Apply**, and caspar reads it at its next launch — not
  forced from here (Apply restarts Caspar; owner's call).

## Relationship to WO-437

WO-437's mapping-outputs fallback stays (it is the right behaviour when NO tick is set on a
mapping rig), but the precedence is now honest: **tick → screen assignment → mapping wall
origin**. WO-437's WO carries a correction note pointing here.
