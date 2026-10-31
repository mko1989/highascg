# WO-888 — PGM micro stutter on alt-tab: Caspar's window never takes focus; frame sync sticks to the PGM screen

**Area:** caspar-build, os-iso
**Status: DONE (31.10.26 — smoke 5/5 + WO-407/439/805 smokes green; live: caspar relaunched with `__GL_SYNC_DISPLAY_DEVICE=DP-0`, NVIDIA XVideoSyncToDisplayID 4→0 (DP-0), Caspar window SKIP_TASKBAR/SKIP_PAGER; alt-tab proven to skip it on a private Xvfb with the box rc.xml. the on-air stutter itself is not yet measured — needs real alt-tabs on :0 with the frame-drop probe)**

## Owner request (31.10.26)
"there is a micro stutter of the caspar's screen consumer with pgm when alt tabing between different windows." —
approved fix: the window-manager rule (never focus, out of alt-tab) + Caspar restart. On the sync finding: "that is an
important point you touched. the nvidia and caspar's frame sync needs to kind of automatically stick to a first real
pgm screen consumer. ofcourse the user should be able to change it to another screen."

## 1. Investigation
- Openbox manages only the Godot GUI and Caspar's PGM window `Screen consumer [2|3840x1792]`. `xprop`:
  `WM_CLASS = "casparcg", "Screen consumer [2|3840x1792]"` — the **instance** is `casparcg`, the **class** is the
  title. `_NET_WM_STATE_ABOVE`, normal type, focusable (WM_HINTS has no input=False). So Alt-Tab cycles onto it
  (Focus + Raise).
- Caspar's screen consumer polls SFML window events on its render thread (caspar-build src-v2
  `screen_consumer.cpp` ~:1136/1139/1156; SFML does XGetWMHints round trips on focus events). With a frame queue of
  one (~:263) and the late-frame drop at ~:841-843, a focus change can cost PGM a frame — the stutter.
- `~/.config/openbox/rc.xml` was the stock file (`<applications>` held only the commented example).
- **Sync display was on the GUI monitor.** `config/caspar_server.json:254` had `screen_3_nvidia_sync_to_display: true`;
  port 3 is DP-4, also `screen_3_operator_monitor: true`. `caspar-gl-sync-env.js` priority 1 (the tick) therefore
  wrote `CASPAR_GL_SYNC_DISPLAY=DP-4`: the running caspar had `__GL_SYNC_DISPLAY_DEVICE=DP-4`, and
  `nvidia-settings -q [screen:0]/XVideoSyncToDisplayID` = 4 (DP-4). Without the tick the WO-407 auto resolves the
  layout plan's screen 1 = DP-0 (the LED / PGM head).
- `x-display-session-runtime.js resolveNvidiaSyncToDisplayOutput` only exported `HIGHASCG_NVIDIA_SYNC_OUTPUT` when a
  port was ticked — no tick = no NVIDIA target at all, so the two halves could disagree.
- `caspar-env` was only rewritten by a full config Apply (`full-config-apply.js:243`), so a resolver change needed
  an Apply to reach caspar.

## 2. What was done
- **`src/utils/caspar-gl-sync-env.js`** — the tick is honoured only when its port is not the operator monitor
  (`operatorMonitorPortIndex`) and its connector is not an operator-GUI head of the layout plan
  (`isOperatorMonitorPort`). Any other ticked screen still overrides; otherwise auto = the first PGM screen (WO-407 /
  WO-437 chain unchanged). Ignoring rather than rejecting keeps stale configs safe without a migration.
- **`src/utils/x-display-session-runtime.js`** — `resolveNvidiaSyncToDisplayOutput` = `resolveGlSyncDisplay`, so the
  NVIDIA XVideoSyncToDisplayID and caspar's GL swap gating are always the same head, auto included.
- **`src/system/caspar-window-sync.js`** (new) + `index.js` boot: rewrite `caspar-env` at every node start and ensure
  the Openbox rule (idempotent, `rc.xml.pre-wo888` backup, `openbox --reconfigure`); skipped for a sandbox instance
  and headless mode. Rule: `<application name="casparcg" type="normal">` focus no, skip_taskbar, skip_pager, layer
  above, decor no — `name=` because the class is the title. Openbox's focus cycle skips normal windows with
  skip_taskbar. Chosen over the alternative (WM_HINTS input=False in caspar's screen_consumer.cpp) because it needs
  no Caspar rebuild and is reversible by deleting one block.
- **Godot** `gpu_output_model.gd` — the "NVIDIA sync to display" tooltip says unticked = automatic first PGM screen,
  ignored on the operator monitor.
- `tools/smoke/smoke-wo805-apply-nvidia-deferred.test.js` repointed: the NVIDIA head now comes from
  `caspar-gl-sync-env` (mocked), not the layout module's tick lookup.

## 3. What was VERIFIED
- `tools/smoke/smoke-wo888-caspar-sync-follows-pgm.test.js` 5/5 (operator-monitor tick ignored → DP-0 for both
  consumers; other tick wins; no tick → NVIDIA follows PGM; `off` kills both; rule insert/idempotent/backup; wiring).
  WO-407 / 437 / 439 / 805 / interactive-operator smokes green.
- Live config through the resolver: before `DP-4`, after `DP-0`.
- Node restart 12:17 → journal `[Caspar GL sync] caspar-env written: sync display DP-0`.
- `HIGHASCG_NVIDIA_SYNC_OUTPUT=DP-0 tools/runtime/highascg-nvidia-x-apply.sh` → `XVideoSyncToDisplayID` 4 → 0.
- Caspar relaunched (TERM to the main process, run.sh loop): new process env `__GL_SYNC_DISPLAY_DEVICE=DP-0`; its
  window `_NET_WM_STATE = SKIP_TASKBAR, SKIP_PAGER, ABOVE, _OB_WM_STATE_UNDECORATED`.
- Alt-tab behaviour on a private Xvfb :91 running openbox with the box rc.xml: windows CASPAR (instance casparcg),
  GUI1, GUI2 — five alt-tabs went GUI1 ↔ GUI2 only, never CASPAR.
- Not yet measured: the stutter itself on air (needs real alt-tabs on :0 with the frame-drop probe
  `alttab-probe.py`); no input automation on the owner's display.
