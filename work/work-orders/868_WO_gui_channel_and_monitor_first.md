# WO-868 — Operator GUI channel and monitor first everywhere (Caspar channel 1, leftmost X screen, first in lists)

**Area:** engine, os-iso
**Status: OPEN (30.10) — investigation + design, not implemented**

Owner, 30.10: *"also i think it would be easier if the gui channel and gui monitor becomes the first everywhere, so in caspar, in x, etc."*

Read-only investigation (no code, no config, no git, nothing restarted). Evidence is `file:line` in `/home/casparcg/highascg`, the live
API (`GET /api/settings`, `/api/system/operator-display`, `/api/system/operator-screen`), Caspar `INFO` on :5250, `xrandr` on :0, and
read-only looks at `config/*.json`, `projects/*.json` and `.highascg-state.json`.

Related WOs whose constraints matter: [WO-243](./deprecated/243_WO_OPERATOR_GUI_CEF_CHANNEL.md) (operator_gui is a utility channel, never a
PGM/PRV slot), [WO-271](./271_WO_STALE_ROUTE_CHANNEL_HEAL.md) (the last time the channel map shifted and what it broke),
[WO-377](./377_WO_host_channel_cable_ignored_by_output_mapping.md) / [WO-381](./381_WO_operator_gui_channel_reserved_planned_badge_timer_dock.md) /
[WO-414](./414_WO_PINNED_HOST_CHANNEL_COLLISION_AND_PGM_SOLO.md) (host-channel pins never move), [WO-378](./378_WO_channel_source_vocabulary.md)
(`program_N` = screen label, `channel_<N>` = literal channel), [WO-597](./597_WO_server_video_surfaces_shm_and_atlas.md) /
[WO-684](./684_WO_kiosk_output_deprecated_factory_shm.md) (operator GUI is an shm ring, no X window), [WO-638](./638_WO_boot_monitor_assignment.md)
(boot screen gate + per-boot layout), [WO-246](./246_WO_OPERATOR_MONITOR_AUTO_SELECT.md) / [WO-308](./308_WO_SPLIT_OPERATOR_MONITOR_FROM_POINTER_CONFINE.md) /
[WO-412](./412_WO_SYNC_TICK_DRIVES_CASPAR_AND_OPGUI_CABLE_IMPLIES_MONITOR.md) (operator monitor is a GPU-slot flag, not a position),
[WO-40a](./40a_WO_PIXEL_MAP_GPU_XRANDR_CASPAR_ALIGNMENT.md) (mapping bbox pushes heads right), [WO-407](./407_WO_SCREEN_CONSUMER_MICRO_STUTTER.md) (GL sync
display), [WO-54](./54_WO_HOT_BACKUP_LEADER_FOLLOWER_REPLICATION.md) (follower mirrors channels by number), [WO-805](./805_WO_devices_apply_button_latency.md) /
[WO-515](./515_WO_APPLY_LAYOUT_GUARD_AND_RESTART_COST.md) (what an Apply and Caspar restart cost).

---

## 1. Investigation

### 1.0 Today on this box (ground truth)

Live Caspar (`INFO`): 8 channels. Generated `config/casparcg.config` comments + `GET /api/settings` `channelMap`:

| Caspar ch | Role | Source of the number |
|---|---|---|
| 1 | Screen 1 PGM "Dioda" (3840x1792, screen consumer at x=0) | `routing-map.js:228-243` (`let ch = 1`, PGM then PRV per main) |
| 2 | Screen 1 PRV | same |
| 3 | Screen 2 PGM "Proj" (DeckLink 4) | same |
| 4 | Screen 2 PRV | same |
| 5 | **Operator GUI** (`<shm>` ring `opgui`, no screen consumer) | `allocCh()` after mains, `routing-map.js:277-280` |
| 6 | DeckLink input 1 | `allocCh()` `routing-map.js` (input loop) |
| 7 | Live audio input 1 | same |
| 8 | Monitor / headphone mix | `routing-map.js:354` |

`channelMap.programChannels=[1,3]`, `previewChannels=[2,4]`, `inputsCh=6`. Note the client-facing `channelMap` carries no
`operatorGuiCh`/`operatorGuiChannels`/`operatorGuiEnabled`: `src/config/channel-map-from-ctx.js` (grep: only `multiviewCh*` are copied, lines 105-106) drops
them, although `getChannelMap()` computes them (`routing-map.js:276-283`, result keys further down).

X (`xrandr --listmonitors`, `apply-layout.sh`): DP-0 LED wall 3840x1792 at **+0+0**, DP-4 operator 1920x1080 **primary** at **+3840+0**. `GET
/api/system/operator-display` → `rect {x:3840,y:0,sysId:DP-4, kind:operator_gui}`. `config/device_graph.json` cables: PGM1 → `gpu_p0` (DP-0),
PGM2 → `dlsdi_4`, **operator_gui → `gpu_p2` (DP-4)**; `casparServer.screen_3_operator_monitor=true` (GPU slot 3 = DP-4).

Destinations list (`GET /api/settings` `screenDestinations`): `dst_operator_gui` is **already index 0** (Operator GUI, Dioda, Proj). Factory seeds it first
(`src/config/factory-starter.js:28-40`). The list needs no change on this box (see 1.5).

### 1.1 Caspar channel allocation

- The number of a channel is its position in `<channels>`; `config-generator-channels.js:196-215` loops `ch = 1..max` and emits `channelXmlByNumber.get(ch)`
  (a hole becomes a "Placeholder" channel). So whatever `getChannelMap()` returns is the config; the generator has no order of its own.
- `getChannelMap()` (`src/config/routing-map.js:178`): mains are numbered first, `let ch = 1; … pgm = ch++; prv = ch++` (`:228-243`);
  `nextCh = max(mains)+1` (`:256`); `allocCh()` (`:263`) hands out the rest while skipping **pinned host channels** (`:262`); order after mains:
  multiview (`:268-272`), **operator_gui (`:276-280`)**, DeckLink / live-audio / v4l2 inputs, audio-only, monitor (`:354`), streaming (dedicated), then host-live
  entries (`hostLive.mergeHostLiveChannelsIntoRouting`, `:392`).
- `virtual_main_channels` mode (`:182`, `:204-206`) lets the config name PGM/PRV numbers directly (`parseInt(v.pgm) || 1`). Operator-first cannot apply
  there unless those numbers are also shifted (see 3.Q4).
- PGM/PRV allocation does **not** skip pins (`:228-243` has no `allocCh`). Today that is fine because pins are chosen above the mains. A "+1" shift of every main
  would run into any host pin sitting on `mains_end+1` (WO-414 constraint: "pins never move, dynamic allocation flows AROUND them").
- Cheapest numbering change: in the `else` branch at `:228` start `ch` at 1 + (number of operator_gui destinations when the flag is on) and allocate the
  operator channel(s) first (`operatorGuiChannels = [1]`), i.e. new order `1 opgui, 2 pgm1, 3 prv1, 4 pgm2, 5 prv2, 6 DeckLink, 7 live audio, 8 monitor`.
  Everything after the GUI shifts by exactly +1; relative order unchanged.
- Everything in the config generator consumes the map, not literals: `config-generator-channel-plan.js:67-83` (operatorGuis), `config-generator-channels.js:144-160`
  (operator block), `config-generator-operator-gui.js:94-115` (shm channel body, comment text `Caspar channel ${ch}`), monitor source fps
  (`config-generator-channels.js:188`). The comment text changes → the config-compare sees a diff (expected, one Apply).
- `engine/project-activate.js:42-65` `channelLayoutSignature` fingerprints the map (including `operatorGuiChannels`); a project load whose map differs from the
  live one sets `restartRequired` (`:203-208`). With the flag a machine-level setting both maps move together → no spurious restart on project switch.

### 1.2 Table: hard-coded or implied "channel 1 = first PGM"

"Stays right" = the code means *the first PGM screen* and gets it from the map (`programCh(1)`, `programChannels[0]`), so it follows the renumber. "WRONG"
= a literal number or a stored number that silently points at the operator GUI channel after the change.

| Where (file:line) | What it assumes | After operator-first |
|---|---|---|
| `src/config/routing-map.js:176` (`map.programCh(1)` fallback), `:359`/`:421` (`programChannels[n-1] \|\| programChannels[0]`), `:484` | first PGM via map | stays right |
| `src/config/routing-setup.js:56-57` (default MV layout `programCh(1)`/`previewCh(1)`), `src/engine/multiview-layout-helper.js:75`, `src/api/routes-streaming-channel-shared.js:262`, `src/api/routes-led-test-card.js:50`, `src/api/routes-screen-timers.js:53` | first PGM via map | stays right |
| `client/lib/live-audio-play-targets.js:198` (`programChannels[0] ?? 1`), `client/components/header-bar-audio.js:62-63` (`?? 1`, `?? 2` label fallbacks), `godot/client/app/header_badges_model.gd:87,103-104` (defaults `[1]`/`[2]`), `src/api/routes-playlist-edit.js:120-122` | map first, literal only if map absent | stays right (literals only reachable with no map) |
| `src/api/routes-amcp.js:96`, `src/api/routes-mixer.js:72`, `src/api/routes-pip-overlay.js:48,76,110`, `src/api/routes-countdown.js:155`, `src/engine/cg-routing.js:80` (`fallbackChannel = 1`) | public REST body omitting `channel` means channel 1 = PGM1 | **WRONG**: lands on the operator GUI ring. Must default to `programCh(1)`. `docs/api-reference.md` examples (`"channel": 1`) also become wrong |
| `src/media/live-thumbnail-cache-handlers.js:137,203` (`channel ?? ch ?? 1`), `src/config/extra-live-source-enrich.js:191,200` (`{channel: 1}` print target) | default PRINT/thumbnail channel | **WRONG** (thumbnail of the GUI composite) → default to `programCh(1)` |
| `src/virtual-output/v4l2-bridge-config.js:15,51`, `v4l2-bridge-relay.js:177`, `v4l2-bridge-consumer.js:126`, `v4l2-bridge-audio.js:119` (`vc.channel`, default **1**) | virtual camera taps channel 1; the stored `vc.channel` is a literal number | **WRONG**: stored literal is the PGM1 bus; needs remap (data) and a map-derived default |
| `src/config/live-source-route-heal.js:34-40` (`knownRouteChannels`) and `:100-124` | heals only inputs/hosts by identity; **PGM/PRV `route://N` cells are explicitly left as is** (`return null`) | the existing heal does NOT cover PGM/PRV numbers → new remap needed (1.3) |
| `src/config/output-source-name.js:20-60` (`channel_<N>` literal), `streamingChannel.casparChannel`, `stream_outputs`/`record_outputs` | `program_N`/`preview_N` are screen labels (survive); `channel_<N>` and numeric `casparChannel` are literal | `program_N` fine (live config uses only `program_1`/`preview_1`: `config/streaming_channel.json`, `rtmp.json`, `audio_routing.json`); `channel_<N>`/`casparChannel` **WRONG** if present (none on this box) |
| `src/system/video-surfaces.js:25-31,45-50` (`resolveRoleChannel`): roles `pgm1..4`, `prv1..4`, `in1..16` resolve through the map; roles `ch1..ch99` are raw channels (ring `/dev/shm/highascg-chN`) | raw channel roles | `pgm*`/`prv*`/`in*`/`opgui` survive; `chN` roles **WRONG** (e.g. `tools/tracking-detect/sidecar.py:10` camera path `/dev/shm/highascg-ch1`, `tools/e2e/*shm*.sh` `PLAY 1-10`) |
| `tools/hshm-bridge/hshm_bridge.py:99` (`--channel` default **5**) | default = today's operator channel | **WRONG** dev tool default → 1 (or read it from the map) |
| `src/companion-bridge/contract.js:42` (`composePreviewImageKey` → `compose_preview_ch${N}_image`), `~/companion-module-dev/companion-module-highpass-highascg/src/feedbacks.js:27,93` (button layers use `$(highpass-highascg:highascg_compose_preview_ch{N}_image)`) | variable keys carry the Caspar channel number | **WRONG for existing Companion buttons**: a button showing `…_ch1_image` now shows channel 1 = operator GUI. Module reads `programChannels[screenIdx]` from the live map (feedbacks.js:55,121,244; look-air-state.js:39,101) so presets/feedbacks follow; only hand-made style overrides break |
| Smoke tests that pin numbers: `tools/smoke/smoke-config-generator-routing-2.js`, `smoke-wo381-operator-gui-channel-reserved.test.js`, `smoke-wo604-…`, `smoke-wo581-…`, `smoke-wo371-…`, `test/replication-channel-parity.test.js` (80 smoke/test files touch `programChannels`/`programCh(`/`operatorGui…`) | today's numbers | repoint, never weaken (CLAUDE.md "smoke tests grep source text") |

Not found: no `route://1` literal, `'1-'`, or `channel = 1` in `src/` outside the rows above (rg over `src client godot/client tools`); the remaining hits are tests, dev
fixtures (`tools/dev/gen-godot-golden-multiview.mjs`, `tools/smoke/smoke-scene-route-deps.js`) or unrelated (MIDI, DMX).

### 1.3 Stored data that names channel numbers

Channel numbers are **derived each time** for everything keyed by screen/role. They are **stored verbatim** in the places below. A renumber needs a remap for
exactly these; the remap must be a single simultaneous substitution (1→2, 2→3 …) — applying it twice, or sequentially, corrupts (not idempotent), so it needs a stamp.

Derived, no migration: `screenDestinations` (ids, `mainScreenIndex`, `stream.source=program_1`), `casparServer.screen_N_*` (screen/GPU-slot indexed), `device_graph`
(destination ids and `gpu_pN`/`dlsdi_N` ids; the legacy `dst_ch<N>` source ids at `routing-map.js:41` are read as a main index `n-1`, not a Caspar channel), `audio_routing` (`preview_1`), Godot
surfaces by role name (`opgui`, `pgm1` …; `godot/client/features/live/compose_tiles.gd:38`, `live_preview.gd:188`), intra-look layer routes `route://<pgmCh>-<L>`
(rewritten to the channel being taken at every take path — `client/lib/scene-route-preview-remap.js:1-30`, `src/engine/scene-route-deps.js`), looks' PLAY targets, timeline
clips (`projects/*.json` `timelines` hold no channel keys: checked `frontex.json`), project `hardwareConfig` (graph/destinations, no channels).

Stored literals:

| Store | Evidence | Remap |
|---|---|---|
| `projects/*.json` look layers `scenes[].layers[].source.value = route://N[-L]` | 62 project files; `route://1` x79, `2` x41, `3` x20, `5` x19, `6` x12, `4` x9, `7` x6, `8` x3 (counts over `projects/*.json`; paths `layers/source/value` 34 of `route://1`) | map old→new by role; intra-look ones are rewritten at take anyway but must stay consistent |
| project multiview cells `multiviewLayout.layout[].source` and `…/cells/source/value` (`route://N`) | 25+22+9+… per path (counted by path) | same; WO-271 heal does not touch PGM/PRV numbers |
| `config/general.json:142` `extraLiveSources[].value = route://6-1` (+`hostChannel`, `inputsChannel`, `thumbnailChannel`) | WO-271 heal rewrites inputs by identity at boot: `routing-setup.js:105-112` (`healExtraLiveSourceChannels`), `multiview-layout-helper.js:35` (`healMultiviewCellSource`), `live-source-route-heal.js:139-181` (`healPersistedMultiviewLayouts`) | already self-healing for DeckLink/live-audio/v4l2/ndi_host/webpage_host **by identity**; host pins (`hostChannel`) are NOT moved by the heal |
| `.highascg-state.json` keys `liveScenesByProgramChannel` (channel-keyed; currently keys `'2'`,`'4'` — unexpected, see 3.Q6), `liveAudioOnlyLooksByChannel`, `programLayerBankByChannel` (keys `1-4`), `multiviewLayout[_n]` | `src/state/live-scene-state.js:14,66-84`, `src/state/live-audio-only-look-state.js:15`, `src/utils/persistence.js:36-44` (IMMEDIATE_KEYS), `src/engine/scene-transition.js:35` | re-key; or clear and let boot reconcile (WO-160 path in `live-scene-state.js:24-37`) because the Caspar restart empties every channel anyway |
| `streamingChannel.casparChannel`, `stream_outputs`/`record_outputs` `channel_<N>`, v4l2 bridge `vc.channel` | `routing-map.js:142-176`, `output-source-name.js`, `v4l2-bridge-config.js:51` | none present with a literal on this box except `vc.channel` default 1 (check live value before shipping) |
| Companion pages (user data, outside the repo): `…_ch<N>_image` variables | `contract.js:42` | cannot be migrated from the server; announce/recipe (see 1.7) |
| Hot backup follower | `src/cluster/cluster-air-journal.js:49` replays `MIXER 1-10 …` by number; `test/replication-channel-parity.test.js` | leader and follower must flip together (same flag, same build) |

`scene.live` itself is `liveScenesByProgramChannel` served through `GET /api/state` (`live-scene-state.js:148`); it is derived from persisted state plus
reconcile, so the table row above is its migration.

### 1.4 X layout: what "first" means

- Positions come from `calculateLayoutPositions()` (`src/utils/os-layout-calculator.js:57`). `computePlacedLayoutResults()`
  (`src/utils/os-layout-calculator-place.js:25-34`) builds the placement list in a fixed order — **screens (1..N, reversed by `x11_horizontal_swap`),
  then multiview, then operator_gui, then PRV heads** — and advances `cumulativeX` by each head's width (`:40`, `:171`); `posX = manualX ?? cumulativeX`
  (`:165`). That order is why the LED wall (screen 1) is at x=0 and the operator at 3840 on this box. `x11_horizontal_swap` (`defaults-core.js:158`) exists but reverses *all screens*, not
  "operator first".
- Which physical jack is the operator is **not positional**: `screen_N_operator_monitor` (N = GPU slot + 1, here `screen_3`) plus the device-graph cable
  (`resolveOperatorMonitorPort`, `src/utils/operator-monitor-resolve.js:48-150`; cable implies flag, WO-412). The layout rect for the operator is looked up by port
  (`resolveLayoutRectForOperatorPort`, `x-display-session-layout-resolve.js:149`). So "operator leftmost" = a **placement-order** change in
  `os-layout-calculator-place.js`, nothing to do with which jack.
- Caspar's screen consumers do not use a screen index to place windows: `<device>1</device>` for every consumer and absolute `<x>/<y>` from the same layout plan
  (`config/casparcg.config` PGM1: `device 1`, `x0 y0`; comment in `config-generator-operator-gui.js:70-75`, "`<device>` is the X-screen index … positioning is x/y-driven"). The
  operator GUI has **no** screen consumer on this box (`videoOutput: shm`, `config-generator-operator-gui.js:106-121`), so in Caspar terms the GUI has no X "screen" to move: only
  the PGM/other heads' `x` change when the operator head is inserted before them (PGM1 `x` 0 → 1920). That edit lands in `casparcg.config` and needs a Caspar restart.
- Primary output: already the operator (`xrandr --output DP-4 --primary`, `x-display-session-runtime.js:96-100,156`; `apply-layout.sh`), and `xrandr --listmonitors` already lists
  DP-4 as monitor 0. So "first in X" in the xrandr/monitor-index sense is already true; what remains is the **x coordinate**.
- NVIDIA: `highascg-nvidia-x-apply.sh` addresses outputs by name (`HIGHASCG_NVIDIA_SYNC_OUTPUT=DP-4`, `__GL_SYNC_DISPLAY_DEVICE` via `~/.config/highascg/caspar-env` =
  `DP-4`, `caspar-gl-sync-env.js:23-45`) and re-derives MetaModes after every xrandr apply; positions are re-pushed by `apply-layout.sh` each time, so the
  metamodes follow. Observation, outside this WO: `CASPAR_GL_SYNC_DISPLAY` currently is the operator's DP-4 (the "sync to display" tick is on `screen_3`); WO-407 intended the PGM
  display. It follows the port, not the x, so it neither blocks nor is fixed by this WO.
- NovaStar P80 EDID (memory + WO-638): the LED wall's DP-0 mode is the EDID preferred mode, and a replug blanks DP-0. Moving the wall from x=0 to x=1920 changes
  only its position; re-run through `apply-layout.sh` (xrandr `--pos`), which already sets `--mode 3840x1792 --rate 50` explicitly for DP-0. Risk is that the position change
  is applied by an xrandr call that re-lights DP-0 (blank + Caspar's always-on-top PGM window burying the GUI). The change must therefore go through the existing Apply path
  (config → layout → NVIDIA policy → Caspar restart, `full-config-apply.js`), never a bare `xrandr --pos` on a running Caspar.
- **Mapping interplay (WO-40a):** `os-layout-calculator-offset.js:41-98` shifts all destination heads (screens, multiview, operator_gui, prv) right by `mappingGpuBBox.maxX`
  when mapping-fed GPU outputs exist. An "operator first" order would put the operator inside/under that bbox. This box has no pixel-map → GPU cable in `device_graph.json`
  edges, so the offset path is inert here, but the design must define "leftmost" = leftmost of the whole canvas, and shift the mapping bbox too, or refuse the
  flag when a mapping rig is cabled.
- **WO-638 boot gate:** `src/system/boot-screen-assignment.js:238-240` `prepare` spreads outputs left to right in *slot* order (`--auto --right-of`) purely to give each head its own
  prompt; the final layout comes from the plan (`resolve` → `applyOperatorMonitorChoice` + `calculateLayoutPositions`). Because the operator jack is chosen per boot
  (the operator may land on any lit jack), "operator is x=0" **must be computed from the plan after the answer**, never from a saved jack/position. Good news: with the plan reordered, the
  per-boot choice automatically makes whichever monitor was picked the leftmost. The gate itself needs no change; `run.sh` holds Caspar until
  `~/.highascg/run/caspar-screens-ready`, so `casparcg.config` is written with the final x before Caspar's first start (WO-638 "VERIFIED" boot 2/3). Re-verify with the three
  simulated boots (Caspar stopped, outputs stacked, record cleared) — never a real reboot (memory: boot gate).
- Godot window placement is already by output name (`window_placement.gd` `live_rect` from `/api/system/operator-screen`, WO-638 follow-up); `operator-screen` outputs carry their own `x`, so
  the client follows any x. `main.gd` autostart no longer passes `--screen=0` (WO-638). No hard-coded x.
- Pointer confine and mouse warp are computed from the operator rect (`x-display-session-runtime.js:96-110`, `confine-pointer-barriers.py DP-4`): they follow the new rect on Apply.
  `/api/system/operator-display` is plan-derived; after a layout change it can disagree with live X until applied (WO-638 follow-up note) — verify against `xrandr`, not the API.

### 1.5 Web client and Godot client ordering

- Destination list: stored order, no re-sort found (`client/components/device-view-destinations-ui.js` only sorts output edges, `:269`; Godot `destinations_model.gd` has no sort and
  `next_main_index` leaves utility modes at 0, `:19-29`). `dst_operator_gui` is first on the live box and in the factory seed. Remaining gap: an operator_gui **added later**
  (Add button) is appended last. A "keep operator_gui first" normalisation belongs in `src/config/screen-destinations.js` (normalizeDestinations), not in either client.
- Channel numbers shown in the UI come from the map (`header-bar-audio.js:62-63`, Godot `header_badges_model.gd`); both consume `programChannels`/`previewChannels`
  arrays so labels follow. Neither client can label "ch 1 = Operator GUI" because the client `channelMap` omits operator keys (1.0). Device View: `buildGeneratedChannelOrder`
  (`src/api/device-view-snapshot.js:196-215`) already emits an `operator_gui` row (WO-381 fix) in allocation order.
- Godot tests pin number fixtures (`test_deck_model.gd`, `test_header_badges_model.gd`, `test_pixel_map_model.gd` …) with `programChannels [1,3]`; they are fixtures of the *map*, not of
  the algorithm, so they keep passing; no Godot production code assumes `1`.

### 1.6 OSC and external-controller addressing

- HighAsCG receives Caspar's OSC on UDP :6250 (`config-generator-osc-xml.js:13-34`, one `predefined-client`) and parses `/channel/N/…` (`src/osc/osc-state.js:96`). Nothing here
  re-publishes OSC with channel numbers; an owner-added second `predefined-client` in `casparcg.config` or a third-party OSC listener on the box would see the shift (Q5).
- Public HTTP API takes literal channels (`docs/api-reference.md:23-104`, `routes-amcp.js:96`). Any external script that posts `channel: 1` plays into the operator GUI ring and **appears on the operator's screen**.
- AMCP on :5250 itself: any external AMCP client (QLab, a scripted `PLAY 1-10`) is addressed by number.
- Companion: see the table in 1.2 (preset/feedback code follows the map; user-authored `…_ch<N>_image` style overrides do not).

### 1.7 Risks (on-air box)

1. **Restart needed**: both effects live in generated files (`casparcg.config` channel numbers + screen-consumer `x`), applied only on Apply (WO-638: "casparcg.config is regenerated only on Apply"), and a restart costs the full Apply/restart
   time (WO-515, WO-805). Never during a show.
2. Silent mis-routing, not errors: stored `route://N` still resolves, to a *different* channel (WO-271 failure shape: "routed the operator channel into itself → black").
3. REST/AMCP/Companion callers using literal `1` hit the operator GUI ring.
4. Pin collision: any host pin on `mains_end+1` collides with the shifted PGM/PRV (routing-map.js:228-243 ignores pins).
5. Non-idempotent remap: a double application shifts twice.
6. Layout: moving DP-0 to x=1920 → NovaStar relight risk + always-on-top PGM window over the GUI (memory: novastar EDID / GUI burying) if sequenced wrongly; mapping-bbox collision (1.4).
7. Hot-backup pair with mixed settings.
8. Smoke tests: ~80 files touch these maps (curated list in `tools/ci/offline-test-files.js`).
9. Syncthing: `.highascg-state.json`, `config/*.json` are runtime-written and synced; any migration writer must hold the existing `.stignore` conventions (memory: Syncthing fights) and the rewrite must not run on a peer.

---

## 2. Proposed design

Principle: three **independent, flag-gated** moves, each reversible, shipped in this order. The numbers are never hard-coded: the new order is one pure function of the
config (same as today), the migration is one pure remap computed from `getChannelMap()` before/after.

Terminology guard (stated in the UI and the WO): *Screen N* (`mainScreenIndex`, `program_N`, `screen_N_*`) is **not renumbered** — the operator GUI does not become "Screen 1";
Dioda stays Screen 1. Only the Caspar **channel number**, the X **position**, and the list **order** change.

### Phase 0 — make it safe to change (no behaviour change, ships any time)

1. Expose `operatorGuiCh`, `operatorGuiChannels`, `operatorGuiEnabled` in the client `channelMap` (`channel-map-from-ctx.js`), so clients can label channels from data.
2. Default every "literal channel 1" in the 1.2 table to `programCh(1)` (a helper `defaultProgramChannel(ctx)`); update `docs/api-reference.md` examples to say "first PGM channel
   (check `GET /api/state`)". This is correct today and after.
3. Make PGM/PRV allocation pin-aware (`allocCh`-style skip) so a pin can never be taken by a main; log a WARN when it would.
4. Add the pure remap `buildChannelRemap(oldMap, newMap) -> Map<oldCh,newCh>` keyed by role identity (pgm idx, prv idx, input kind+slot, host `sourceId`, multiview idx, operator gui, monitor, streaming, audio-only idx)
   and `remapRouteString(str, remap)`, plus `applyRemapToProjectJson`, `applyRemapToPersistence`, `applyRemapToExtraLiveSources`. Single-pass substitution; stamp
   `channelScheme: "operator-first-v1" | "legacy"` on the project envelope / persistence so a stamped store is never remapped twice. Unit tests: 1→2→3 corruption case, `route://N`, `route://N-L`,
   unknown channel left alone, round-trip legacy→first→legacy is identity.
5. Companion: in the module, make the compose-preview variable names role-based in addition (`highascg_compose_preview_pgm<screen>_image`), keeping `ch<N>` as an alias for one release.

### Phase 1 — Caspar channel 1 (flag `casparServer.operator_gui_first`, machine-local, default false)

- `routing-map.js`: when the flag is on and an `operator_gui` destination exists and `!useVirtual`: allocate it first (`operatorGuiChannels = [1]`, `ch` for mains starts at 2).
  New order `1 opgui, 2/3 pgm1/prv1, 4/5 pgm2/prv2, then multiview, inputs, audio-only, monitor, streaming, host entries` (all `allocCh()` as today). In virtual mode: flag is a no-op with a Devices-tab note unless
  `virtual_main_channels` already avoids channel 1.
- Keep the flag **machine-local** (not in project `hardwareConfig`): check `applyHardwareConfigFromProject` and the `MACHINE_LOCAL_JSON` list so a project load can neither set nor clear it.
- Generated config: nothing else (consumers read the map). Update the XML comment text, the config-compare expectation, `buildGeneratedChannelOrder` ordering (already map-driven).
- UI: Devices → a single toggle "Operator GUI is Caspar channel 1" with the explicit note "Apply + Caspar restart; stored routes are converted"; Godot and web render it (client-neutral: the model returns the state).
- Tests: new `tools/smoke/smoke-wo868-operator-first-channel-map.test.js` (flag off = byte-identical map to today for this box's config: 8 channels, pgm [1,3]; flag on = pgm [2,4], prv [3,5], opgui [1], inputsCh 6→7…; pins skipped; generator output has channel 1 = shm block; `channelLayoutSignature` differs), add to
  `tools/ci/offline-test-files.js`; repoint pinned smokes (1.2 last row) behind the flag-off default so they keep guarding the legacy numbering.

### Phase 2 — leftmost X (flag `x11_operator_first`, default false; may follow Phase 1 by days)

- `os-layout-calculator-place.js:25-34`: when the flag is on, push the `operator_gui` placement(s) **before** the screens; `cumulativeX` then starts with the operator width. Manual overrides
  (`screen_N_os_x`, `operator_gui_*_os_x`) win as today. When mapping-fed GPU outputs exist (`mappingGpuBBox`), place the operator at the canvas minimum and shift the mapping bbox
  consumers right by its width, or refuse the flag with an Apply-time message (`515`-style guard).
- No change to the operator-monitor resolution (`screen_N_operator_monitor`, cable) — it stays jack-based and per-boot (WO-638). Primary stays the operator.
- Result on this box: DP-4 at +0+0 (primary), DP-0 at +1920+0. PGM1 screen consumer `x=1920`. `apply-layout.sh` regenerated by the normal Apply.
- Flag also drives the WO-638 `prepare` spread? No — `prepare` only exists so every head gets its own prompt and is rewritten by `resolve`; keep it, and verify the final layout.
- Sequencing in Apply: write config → apply xrandr layout (explicit `--mode/--rate`, as `apply-layout.sh` does) → NVIDIA policy → Caspar restart, so Caspar starts on the final geometry (never bare `xrandr --pos` under a running Caspar: NovaStar relight/GUI burying).

### Phase 3 — the one-shot switch (`POST /api/system/operator-first {dryRun, enable|disable}`; Devices button)

A single backend operation so the owner never edits stores by hand:
1. `dryRun`: build old/new map, the remap table, and report counts per store (projects touched, route strings changed, pins moved, persistence keys) and the new xrandr plan. No writes.
2. Refuse with a clear reason when: a show is on air (any PGM layer playing or `scene.live` non-empty and `force` not given), Caspar is down, leader/follower mismatch, mapping rig + flag conflict.
3. Backup: copy `projects/` (+`_autosave`, `_trash`), `.highascg-state.json`, and the config slices that will change into `~/.highascg/backup/wo868-<UTC>/` and record the path in the response.
4. Apply remap, in this order: host pins (`extraLiveSources.hostChannel/value`, +1 for entries ≥ new GUI slot, using `buildChannelRemap` so it is identity-based), persisted multiview layouts, `liveScenesByProgramChannel` / `liveAudioOnlyLooksByChannel` /
   `programLayerBankByChannel` re-key, `streamingChannel.casparChannel`, `channel_<N>` source tokens in stream/record outputs, `vc.channel`, then every `projects/*.json` (stamped `channelScheme`).
   Projects saved later while the flag is on are stamped on save; a legacy-stamped project **loaded** while the flag is on is remapped lazily in memory at load (`project-activate.js` hook) so restored backups and synced files from another box also work.
5. Set flags (`operator_gui_first`, `x11_operator_first`) and run the standard Apply (config + layout + Caspar restart). Return the journal lines.
6. Write only through the existing config manager / persistence APIs (never raw file writes), mirror `.stignore` rules (state file, backup dir ignored).

### Migration summary (what changes vs what does not)

Needs remap: project route strings (looks, multiview cells), `extraLiveSources` pins, persisted live/bank maps, numeric stream/record/vc channel fields, Companion hand-made style overrides (manual recipe).
Needs nothing: destinations, graph, `screen_N_*`, `program_N`/`preview_N` sources, intra-look routes, Godot surfaces by role, timelines.

### Test plan

- Offline: the Phase 0 remap unit tests; Phase 1 map/generator smokes (flag off identical; flag on exact numbers); Phase 2 layout smoke with the live `device_graph` shape (operator cable on `gpu_p2`, PGM on `gpu_p0`) expecting operator x=0, PGM x=1920, and the mapping-rig refusal;
  project round-trip test over a copy of every file in `projects/` (flag on→off equals original byte-for-byte); full offline suite + `check-max-file-lines` (the routing-map.js file is 498 lines: extract the allocation into a new module before adding code, 500-line limit).
- Box (dry-run first, then real): `dryRun` report; Apply on a spare window with no show on air; `INFO` shows channel 1 `1080p5000` shm; `GET /api/settings` channelMap; `xrandr` positions; `apply-layout.sh`; journal for the WO-638 gate on the **three simulated boots** (Caspar stopped, outputs stacked, record cleared); open the active project, check a look with a PRV route and the multiview cells render; Godot Live tab shows the operator surface; Companion look buttons; a 10-minute soak for frame drops (GL sync display unchanged).
- Also confirm the replication pair if one is configured (`test/replication-channel-parity.test.js` + live compare tool `tools/replication/compare-caspar-parity.js`).

### Rollback

- Flags are reversible: `disable` runs the same operation with old/new swapped (same remap function, inverse table), then Apply. Because the remap is role-identity-based and stamped, enable→disable is the identity (tested).
- If the box is in a bad state after Apply: restore from the printed backup directory (projects + state file + config slices), clear the two flags, Apply. `config/casparcg.config.bak.<ts>` snapshots already exist from every Apply (`config/casparcg.config.bak.*`), as does the Caspar binary rollback procedure (memory: caspar build v2) — not needed here, this is config only.
- No git/ISO change is irreversible; the only data loss window is a project saved with the flag on and then restored on a legacy build without the lazy remap (hence the stamp and the one-release overlap).

---

## 3. Open questions for the owner

1. **Which numbering?** All following channels shift by one (1 GUI, 2-3 PGM1/PRV1, 4-5 PGM2/PRV2, 6 DeckLink …) — or keep PGM1/PRV1/PGM2/PRV2 and only swap the GUI with channel 1 (GUI 1, PGM1 5, …)? (Recommended: shift all, stable order.)
2. **Is the GUI "Screen 1"?** Or does Dioda stay Screen 1 / `program_1` and only the channel number and position change? (Recommended: Dioda stays Screen 1.)
3. **Leftmost = x=0 in a single canvas (LED wall moves to x=1920)?** OK to move the LED wall's X position — nothing needs the wall at 0 (NovaStar relight happens on Apply only)?
4. **Virtual main channels / pixel-map rigs:** may the flag refuse (or require a different setup) on boxes using `virtual_main_channels` or mapping-fed GPU outputs?
5. **External controllers:** does anything outside HighAsCG address channels by number — other OSC listeners, QLab/AMCP scripts, REST scripts that post `channel: 1`, Companion style overrides using `…_ch1_image`?
6. **State file keys `'2','4'`:** `liveScenesByProgramChannel` currently holds keys 2 and 4 although PGMs are 1 and 3 — is something staging looks on the PRV channels, or are those stale? (Only affects whether to re-key or clear.)
7. **Single flag or two?** Ship channel-first and X-first as separate switches (safer, can sit half-way), or one combined "Operator GUI first" toggle?
8. **When?** Is there a no-show window for the Caspar restart + `dryRun` first, and do you want the backup directory kept after success?
9. **Hot-backup pair:** is the follower in use now (both boxes must flip together)?

## Owner decisions (30.10)

- **Q1 numbering:** shift every channel by one: 1 GUI, 2–3 PGM1/PRV1, 4–5 PGM2/PRV2, 6 DeckLink, and so on.
- **Q2 Screen 1:** Dioda stays Screen 1 / `program_1`. Only the channel numbers and the positions change.
- **Q7 switches:** one combined "Operator GUI first" switch. It moves the GUI to channel 1 and its monitor to x=0; the LED
  wall moves to x=1920.
- Not answered, so the recommended defaults apply:
  - Q3: the wall moves in X;
  - Q4: the switch refuses on boxes with `virtual_main_channels` or mapping-fed GPU outputs, and says why;
  - Q5: every channel reference inside HighAsCG is remapped; outside consumers are listed in the WO;
  - Q6: the stale `liveScenesByProgramChannel` keys are re-keyed;
  - Q8: a `dryRun` comes first and the backup directory is kept;
  - Q9: the follower must flip with it, and the switch warns when a follower is paired.
