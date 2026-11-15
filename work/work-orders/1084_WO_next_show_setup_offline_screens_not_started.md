# WO-1084 — Next show setup: screen consumers of unplugged outputs start anyway and cover the operator GUI

**Area:** devices-config, os-iso, mapping
**Status: DONE (15.11.26 — 18-test offline harness + live box: gated launch, GUI uncovered on :0, Devices not dirty; physical hot-plug not exercised, see VERIFIED)**

Owner 15.11: *"put a harness on 'next show setup'. meaning i just got back to the warehouse, hooked the pc up, had the
'start gui here' prompt and i did, now i have the gui covered by screen destinations/consumers. the consumers that dont
have their connectors up shouldnt be started/turned on."*

Related: [WO-638](./638_WO_boot_monitor_assignment.md) (boot screen gate), [WO-645](./645_WO_startup_launcher_autostart_opt_in.md)
(start-up launcher), [WO-717](./717_WO_screen_consumer_policy_enforced_on_every_launch.md) (launch-time policy in run.sh),
[WO-483](./483_WO_SCREEN_CONSUMER_PLACED_BY_OPENBOX_NOT_CONFIG.md) (placement), [WO-868](./868_WO_gui_channel_and_monitor_first.md)
(operator first), [WO-938](./938_WO_pointer_sprite_shows_on_program_output_past_barrier.md) (128 px gap),
[WO-1020](./1020_WO_caspar_dynamic_channels_video_modes_runtime_config.md) (`ADD ch-idx XML`).

## Investigation

Evidence captured on the box before any change: [work/notes/wo1084-evidence/](../notes/wo1084-evidence/)
(`drm-sysfs.txt`, `xrandr-query.txt`, `xwininfo-tree.txt`, `screen_destinations.json`, `device_graph.json`,
`casparcg.config.generated`, `live-consumers-before.txt`, `before-screenshot.png`).

**Hardware at this boot (15.11 18:57, boot c4cd6c1f).** One monitor, on xrandr `DP-3` 1920x1080+0+0. Every other
output is disconnected. Note `/sys/class/drm` calls the same jack `card0-DP-2`: the NVIDIA DRM names are offset from
the xrandr names on this GPU, so sysfs names can only be used for *change detection*, never to identify a head.

**Saved show config (from the last show).** Three destinations, operator first (WO-868):
| destination | Caspar ch | cabled to | live |
|---|---|---|---|
| Operator GUI (shm `opgui`) | 1 | gpu_p0 (DP-0/DP-1) before boot | dark |
| PGM/PRV 1 (3072x1024) | 2 / 3 | gpu_p1 (DP-2/DP-3) | DP-3 lit |
| PGM 2 (3072x1024, fill + key-only) | 4 | gpu_p2 (DP-4/DP-5) + gpu_p3 (DP-6/DP-7) | dark |

**What happened, in order (journal `-u highascg -b`, `/tmp/caspar.log`):**
1. `[Boot screens] start-up launcher on every screen (startup.mode ask); Caspar held` — run.sh waits (WO-645).
2. The owner pressed "Start operator here" on DP-3: `[Boot screens] operator = DP-3 (port 2, clicked); destination
   cables moved: none; no free screen for gpu_p1, gpu_p2, gpu_p3 — applying`. DP-3 is gpu_p1 — the jack PGM/PRV 1 was
   cabled to. `planDestinationCables` (src/system/boot-screen-assignment.js:162-205) leaves a cable with no free lit
   jack where it is ("unplaced"), so after the answer gpu_p1 carries **both** the operator cable and the PGM/PRV 1
   cable (`device_graph.json` edges `e_dst_in_dst_mw7t9epz_1_gpu_p1` + `e_dst_in_dst_operator_gui_gpu_p1`). PGM 2's
   cables stay on the dark gpu_p2 / gpu_p3. Keeping the cables is right (configured, not deleted); starting them is not.
3. Layout plan written with the config (18:57:36): `Layout screen_1: id=DP-3 … pos=0,0 size=3072x1024`, `screen_2:
   id=DP-3 … pos=3072,0`, `screen_2 extra output 1: id=DP-3 … pos=6144,0`, and **no operator_gui head any more**.
   - gpu_p1's first in-edge is PGM/PRV 1's (src/utils/os-layout-calculator-assign.js `edges.find(e => e.sinkId ===
     c.id)`), so the operator's jack became screen_1's head.
   - the dark jacks DP-4/DP-5 and DP-6/DP-7 resolve to the lit DP-3 through the fuzzy name fallback
     (`resolveViaLiveXrandrHeuristic`, src/utils/xrandr-output-resolve.js:243).
4. X apply: `xrandr head: output=DP-3 pos=0x0 mode=3072x1024` — node tried to switch the **operator monitor** to the
   PGM resolution. It failed only because the monitor cannot take that mode (`cannot find mode 3072x1024`, 3 tries).
   The xrandr apply dedups heads by output with screens first (src/utils/os-config-xrandr-apply.js:252-264), so a
   screen head always beats the operator head on a shared output.
5. Generator: `screen_N_screen_consumer` = "has a PGM cable to any gpu_out"
   (src/config/build-caspar-generator-config-screens.js `applyScreenConsumerOverridesFromCabling`) — no connection
   check anywhere. casparcg.config got three always-on-top `<screen>` consumers: ch2 at 0,0 3072x1024 (= on top of
   the operator monitor), ch4 device 2 key-only at 3072,0 and ch4 device 61 at 6144,0 (both on a canvas that is
   1920 px wide).
6. `[Boot screens] Caspar start released` → run.sh launched Caspar on that file (WO-717 policy only touches vsync /
   gpu-texture). Live consumers (node's AMCP, `INFO n`): ch2 `600:screen`, ch4 `611:screen 660:screen`.
7. Windows (`xwininfo -root -tree`): `Screen consumer [2|3072x1024]` at +0+0, two `Screen consumer [4|3072x1024]` at
   +1613+0 — Openbox clamps an off-canvas window back onto the canvas. `[Screen placement] ch 4: 1613,0 → 3072,0`
   did not stick (no head there). The GUI (`HighAsCG Operator` 1920x1080+0+0) is under all three; screenshot: the
   GUI is covered except its bottom 56 px.
8. `GET /api/system/operator-display` also took PGM/PRV 1's head for the operator's: `DP-3 — screen consumer 1 @ 0,0
   3072×1024` (pointer barriers `XFixes barriers on DP-3 @ 0,0 3072x1024`).

**Every path that starts a screen consumer.** Caspar opens `<screen>` consumers only from the config file it reads at
launch; node never adds a screen consumer over AMCP (`rg "SCREEN"` in src/: only `REMOTE_SCREEN` / labels). Every
launch — boot after the WO-638/645 gate, Devices/Settings Apply & restart, AMCP RESTART, crash relaunch, project-load
apply, operator-first / channels-cabled switches — is a loop of `run.sh run_caspar()` on `$CONFIG_PATH`. The file
itself is written by the generator (boot gate prestart, Apply, project load, switches), a saved casparConfigOverride,
a project bundle, the ISO template copy, a stick restore or a hand edit (the WO-717 table). So run.sh is the one choke
point that sees every consumer that can start, whoever wrote the file; a runtime path (hot-plug) is new in this WO
and goes through the same decision function.

## What was done

**The rule, one function** — `src/config/screen-connector-gate.js` (pure). A `<screen>` window starts only when its rect
(`<x> <y> <width> <height>`) intersects a connected xrandr head *with a mode*, and does not intersect the operator's
head. Exception: the Operator GUI channel's own legacy window (comment "Operator GUI channel"). No display state, or a
window with no position → start (fail open: a probe error never darkens a show). Geometry, not names: NVIDIA DRM
names are offset from xrandr names, and X places the window where its rect says whatever jack the config meant. A
window that must not start is **not deleted**: its block stays in casparcg.config inside
`<!--HACG-OFFLINE reason="…" <screen>…</screen> HACG-OFFLINE-->` (base64 variant when the block contains `--`);
`restoreOfflineScreens` gives back the byte-identical original, so every launch decides again from the full config.

**The seam** — `src/utils/connector-state.js`: heads from `xrandr --current` (no re-probe — `--query`/`--verbose` freeze
X input, WO-397), DRM sysfs statuses for change detection only, the operator's output name(s) in
`~/.highascg/run/operator-output.json`. `HIGHASCG_CONNECTOR_STATE=<json>` replaces both reads,
`HIGHASCG_OPERATOR_OUTPUT_FILE` the file; under `node --test` the file is a private temp file.

**The choke point** — `run.sh run_caspar()` runs `tools/runtime/gate-screen-consumers.js "$CONFIG_PATH"` right after the
WO-717 policy, before `"$CASPAR_BIN" "$CONFIG_PATH"`. Every start path is a launch through that function: boot after the
WO-638/645 gate, Devices/Settings Apply & restart, AMCP RESTART, crash relaunch, project-load apply, operator-first /
channels-cabled switches, a saved override, project bundle, ISO template, stick restore, hand edit. One line in
/tmp/caspar.log per launch (`[screen gate] lit: …; operator: … — N started (…), M not started (…)`). Best-effort: any
error prints one line and exits 0.

**Who the operator is** — `src/system/operator-output-file.js`: node writes the name the client itself stands on
(`listPickerOutputs` row whose port = `resolveFlagPort`, same as GET /api/system/operator-screen) at start (index.js,
before the boot gate can release Caspar) and after every casparcg.config write (routes-caspar-config.js), so the boot
answer and Apply both update it before the launch they trigger.

**Hot-plug while running** — `src/system/screen-hotplug.js`, started at the first Caspar connect
(caspar-info-ready.js). Polls DRM status every 2 s; a change must hold 6 s (a NovaStar P80 re-handshakes ~1 s on every
modeset / Caspar restart) and differ from the last reconciled state. Then: a connected head without a mode → one
`applyX11Layout` (30 s cooldown, so a re-handshake it causes cannot loop); operator file; gate the restored file
against fresh heads; `INFO <ch>` per channel → `ADD ch-idx XML <base64 of the file's own block>` (WO-1020) for windows
now startable, `REMOVE ch-idx` for windows now on nothing / on the operator; the file's marks follow; placement
(WO-483); `gpu_topology_changed` broadcast. Skipped while an Apply runs, before the boot gate opens, in sandbox /
headless / offline / `HIGHASCG_SCREEN_HOTPLUG=0`. `operatorTools.screenHotplug: false` = log only (changes at the next
Apply). Runtime consumers (stream, record, shm, meter) are never touched — only `<screen>` ports the file holds.

**Visibility** — `src/system/screen-output-status.js` maps channels to destinations and phrases the reason from the
device-graph cables: at every Caspar connect the journal gets `[Screen gate] PGM 2: DP-4/DP-5 + DP-6/DP-7 not
connected — not started`; the Devices payload gets `live.screenOutputs`; the Godot destination card shows an amber
`Not started: …` line under it (destinations_model.gd `offline_cue`, same place as the WO-1029 remote cue).

**The root-cause bugs the gate would otherwise have hidden:**
- `os-layout-calculator-assign.js`: a jack carrying the operator cable and a destination the boot answer left there
  (no free screen) is the operator's (`firstInEdge` prefers the operator in-edge) — the plan keeps the operator head.
- `os-config-xrandr-apply.js`: operator heads are processed first in the per-output dedup, so the operator's monitor
  keeps the operator's mode (it was set to 3072x1024 and survived only because the mode did not exist).
- `xrandr-output-resolve.js`: `DP-4/DP-5` (one physical port's two NVIDIA names) resolves to its live member or stays
  itself — no longer the same-kind guess that put every dark jack onto the one lit head (single names keep the old
  heuristic, pinned by smoke-operator-gui-4k-layout-rect). `xrandr-layout-verify.js`: a planned output that is not
  plugged in is `offline`, not a mismatch (apply already leaves it out, WO-919 F4) — the OS-Watchdog had re-applied
  xrandr 12× trying to put PGM 2 on DP-3.
- The marks are not a config change: `caspar-config-dirty.js` (unwritten / not_restarted) and `config-compare.js`
  (running_differs skips the screen on/off check for gated channels and windows the hot-plug opened);
  `screen-consumer-placement.js` ignores commented blocks.

Not chosen: patching each writer (generator, override, bundle…) — five patches miss the sixth path; deleting the
consumers — the owner's show must come back as it was when the rig is plugged in.

## What was VERIFIED

**Harness** — `tools/smoke/smoke-wo1084-next-show-setup.test.js` (curated, offline-test-files-2.js): 18 tests, all
pass. Synthetic operator-first show (ch1 GUI, ch2/3, ch4, ch5 on DP-0|DP-2|DP-4|DP-6) plus the recorded evidence:
all up (nothing marked, file unchanged) · only operator up (only the GUI channel window; byte-identical restore;
idempotent) · operator + one of three · a name this GPU no longer has · connected without a mode · fail open ·
operator screen = old program head (evidence: 2-600, 4-611, 4-660 not started; both log lines; operator wins the
plan) · run.sh tool end to end with injected state (marks, then all back = original file) · connector appears later
(ADD with the file's own block) · connector disappears (REMOVE, runtime consumers untouched) · modeless head laid out
first · hot-plug off = offered only · NovaStar flap debounce · dirty/placement ignore marks · running_differs exemption
· pair-name resolution + offline verify · test isolation.
Related smokes: 62 files / 485 tests and 52 files / 384 tests (layout, xrandr, operator, WO-638/645/717/868/938/1029…)
pass. Full offline suite: 6601 tests, 2 fails (WO-1058 LTC pacing under load; both pass when run alone — 4/4) plus
the WS contract doc (regenerated, d1956abc). Godot: `run-client.sh --test` 28496 passed, 0 failed (incl.
test_wo1084_offline_screen_cue, 7 asserts). Lint clean on touched files; check-max-file-lines 0 over; format:check OK.

**Live box (.17), via the normal paths** (node `kill -TERM` + Devices Apply `POST /api/caspar-config/apply`, under
`flock -o /tmp/highascg-node-restart.lock`):
- before: ch2 `600:screen`, ch4 `611:screen 660:screen`; GUI covered (before-screenshot.png).
- /tmp/caspar.log 19:29:35: `[screen gate] lit: DP-3; operator: DP-3 — 0 started, 3 not started (ch2 @0,0
  3072x1024: would cover the operator screen DP-3; ch4 @2048,0 …: no connected screen there; ch4 @5120,0 …)`.
- after: no screen consumer on any channel (live-consumers-after.txt — shm/ffmpeg/portaudio only); no `Screen
  consumer` window in xwininfo-tree-after.txt; after-screenshot.png (viewed): the full GUI visible, nothing on top.
- journal: `[Screen gate] PGM/PRV 1: DP-3 is the operator screen — not started`, `PGM 2: DP-4/DP-5 + DP-6/DP-7 not
  connected — not started`; `[Screen hot-plug] watching 4 connector(s)`; `[OS-Watchdog] xrandr layout matches
  config` (was 12 failed re-applies); `[Pointer confine] XFixes barriers on DP-3 @ 0,0 1920x1080` (was 3072x1024).
- GET /api/caspar-config/dirty → `dirty: false`; GET /api/device-view → `live.screenOutputs` with both destinations
  `offline` and the reasons above.
- dry run of the hot-plug reconcile against the live box (real xrandr, real file, INFO through node): no action, file
  unchanged.

**Not verified:** a physical plug / unplug while Caspar runs (no spare monitor or hands in the warehouse; covered
only by the harness with a fake AMCP) — the first real one should be watched in the journal (`[Screen hot-plug]`);
`ADD ch-idx XML` of a `<screen>` on this build is from WO-1020's own test, not re-run here. The Godot card cue is
unit-tested but not looked at on glass (no pointer input allowed on :0 to open Devices). The web Devices view has no
cue (Godot is the operator UI). The Apply restarted nodm (existing "canvas_expansion" decision of the full apply) —
the GUI came back by its autostart.
