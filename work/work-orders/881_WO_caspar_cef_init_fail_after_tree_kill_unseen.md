# WO-881 — Caspar came up without CEF after a supervisor tree-kill, and nothing said so

**Area:** caspar-build, engine
**Status: OPEN** (31.10: found during the WO-877..880 on-air checks; investigated, not fixed)

Found while running the on-air checks for [WO-580](./580_WO_shader_live_seamless_speed_and_smooth_params.md) /
[WO-877](./877_WO_visuals_show_looks_crossfade_master.md). A show-day failure mode: every HTML layer (shader looks,
lower thirds, the LED test card) is dead for hours while PLAY/AMCP look healthy.

## 1. Investigation

- `/tmp/caspar.log:108,111` — after the box came back from the eggs build, run.sh's supervisor killed the tree twice:
  `00:33:08` and `00:37:25 [supervisor] casparcg still running without AMCP — killing process tree`
  (`tools/runtime/casparcg-supervisor-lib.sh:280` `caspar_ensure_fully_stopped`: TERM → 2 s → KILL → **1 s** → start).
- The relaunch 5 s later: `log/caspar_2026-10-31.log:989-991`
  `00:37:31.874 [html] Using CEF cache path …/cef-cache` → `00:37:31.943 [error] [html] Failed to initialize CEF` →
  `Initialized html module.` Caspar carried on: channels, consumers and AMCP all fine.
- Probable cause (not yet reproduced): the KILL sweep does not wait for the CEF tree to be gone. CEF children are
  matched by `pgrep -f user-data-dir=<cache>` (`:193`) and signalled once; the start follows after `sleep 1` with no
  re-check, so a GPU/zygote child still exiting (or a `SingletonLock` → `host-<pid>` of a KILLed main) can make the new
  CEF see the profile as in use. `caspar_clear_cef_cache` (`:199`) only runs on hard-fail exit codes (`run.sh:196`), not
  on this path.
- Nothing surfaced it for 6 h 40 min: each `CG ADD` answered `404 CG ADD FAILED`; the node's startup LED test card
  (`src/bootstrap/startup-led-test-pattern.js:229`, `HIGHASCG_STARTUP_LED_TEST_FAST` → 2.5 s, else 5 s, unbounded)
  retried 864 times between 06:40 and 07:16 alone (journal `[Startup LED test] AMCP: 404 CG ADD FAILED (deploy
  templates/led_grid_test.html …)` — the hint blames the template, which was there). No health flag, no GUI warning.
- Fixed by hand at 07:16: an operator restart (`/tmp/caspar-operator-restart` + TERM) → `Initialized html module.`
  with no error; two more restarts the same morning came up clean (07:20, 07:22).
- Related, by design (WO-268/661): the factory config has `operatorTools.cefEnableGpu` off, so after a stick/ISO reset
  every Caspar-side shader is a black layer (`Shader FX: WebGL2 unavailable …` in the Caspar log). The Templates tab
  shows ⚠ on shaders (WO-661); the default itself is an owner decision.

## 2. To do

1. Supervisor: after the KILL sweep, wait (bounded, ~5 s) until `caspar_list_all_pids` is empty, then drop
   `cef-cache/Singleton*` when the lock's PID is dead.
2. Detect `[html] Failed to initialize CEF` in Caspar's log after a start → restart Caspar once and log it; if it
   repeats, raise a health warning (GUI status) instead of looping.
3. LED test card retry: back off (×2 to 60 s) and stop after N; word the 404 as "Caspar HTML producer unavailable"
   when the template file exists.

## 3. What was verified

- Nothing fixed yet. Evidence above from the box logs; the clean restarts at 07:16 / 07:20 / 07:22 show the failure
  is not deterministic.
