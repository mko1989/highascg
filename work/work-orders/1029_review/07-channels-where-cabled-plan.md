# 07 — Caspar channels only where a destination is cabled (plan, 10.11.2026)

Read-only planning pass. I read the code and ran GETs only, against `127.0.0.1:4200` (highascg7579, master, epoch 13) and `192.168.0.10:4200` (highascg5867, follower). Nothing was changed. "Today" claims cite file:line in this tree.

## Summary (≤ 40 lines)

- **Rule.** On a server where `cluster.channelsWhereCabled` is on, a screen destination gets Caspar channels only if *this server's own device graph* cables it to a physical sink. Physical sinks are GPU, DeckLink out, stream, record, NDI out, audio out, Art-Net, or a mapping node with at least one cabled output. The rule is computed from local config only, so a peer going offline never changes the channel plan.
- **Screen index stays the shared key.** `programChannels[i]` / `previewChannels[i]` keep their index = `mainScreenIndex`, with `null` holes for screens that are not on this server. `program_N`, `pgmN`/`prvN` shm roles, `screen_N_*` keys, looks' `mainScope` and the Godot deck stay index-aligned. One bug must be fixed first: `programCh(n)` falls back to `programChannels[0]` (`routing-map.js:385`), so a hole would silently land on screen 1.
- **Every action on a screen that is not here becomes a signed node-to-node call to its owner(s), keyed by destination id** (`dest.take`, `dest.preview`, `dest.clear`, `dest.ftb`, `dest.testcard`, `dest.media`, `dest.mixer`, `dest.timeline`, `dest.state`). The owner runs it through its own routes. The copy-channel AMCP fan-out, its channel translation, the catch-up journal and the master-side holders all go. The AMCP mirror stays only as the opt-in frame-accurate backup transport (owner answer 4).
- **Calls stop depending on the clock.** `cluster-call.js:115` uses a 60 s window; it becomes a per-sender counter like the hello: a window measured on the sender's own clock, plus nonces, plus a stored floor. Calls also get an `opId` (safe to retry) and a per-destination `seq` (last press wins).
- **A multi-screen take across servers uses prepare / go.** Each owner prepares (LOADBG, phase A) and answers ready; the master's barrier sends `go` to all of them. Expected skew is about 1 frame without genlock, the same as today's mirror. Scheduled takes need PTP + genlock and come later.
- **Seeing a remote screen.** The owner's existing JPEG feed (`/api/video-feed`) is relayed node → node and served to the local client under the same role names, marked `transport: feed`. That covers Live windows, the look editor backdrop, previs and the PGM/PRV tiles. Thumbnails go through the existing relay. Multiview and other pictures composed inside Caspar get a labelled placeholder until the NDI transport (plan 06, S18) exists.
- **What is on air remotely.** Each owner reports per destination (look on PGM/PRV, test card, FTB, timeline, holder) on a new exchange topic `dest.air` to every linked server. The master shows it per screen index.
- **"Media local".** A media list per destination (looks scoped to that screen or `all`, timelines, playlists, CG templates). Every linked server reports what media it has. Missing clips are pushed automatically with the existing rsync, from a server that has them, rate-limited, never deleting anything. Readiness shows on the destination card and the look card.
- **Migration (the two boxes).**
  - 7579: today 1 opgui, 2/3 LED, 4 "to zoom", 5/6 + 7/8 copies, 9/10 DeckLink 1/2. After: 1 opgui, 2/3 LED, [4 to zoom], DeckLink 1/2 on 5/6 (or 4/5 without to zoom).
  - 5867: today 1 opgui, 2/3 + 4 copies, 5/6 PGM/PRV 3, 7/8 Stream (stream attached to 7), 9/10 DeckLink 3/4. After: 1 opgui, 2/3 PGM/PRV 3, 4/5 Stream (stream on 4), DeckLink 3/4 on 6/7.
  - What breaks: "2box Mixer" `route://9-3` and "2box PPT" `route://10-4` in the shared show. So input identity (plan 06, S13–S16) must ship before the switch.
- **Rollout, each step reversible.** (R0) holes safe + capabilities advertised + counter on calls → (R1) `dest.*` used for remote screens while the copy channels still exist (flag per link) → (R2) picture relay + remote air state → (R3) media sync → (R4) input identity migration → (R5) the channel switch: per server, dry run, persisted state remapped by role, "Apply all" with the air snapshot → (R6) the fan-out code removed.

**Owner decisions (my recommendation in brackets):**
- O1 A single server with no links: unchanged, every destination gets channels [yes; the rule is on only while the switch is on].
- O2 What counts as cabled: physical sinks only, through mapping nodes that have at least one cabled output. Multiview cells and previews do not count [yes].
- O3 Destination cabled nowhere ("to zoom" today): no channels anywhere, unless it has a new **Local use** virtual cable on a server (for zoom, virtual camera, drafts, local previews). The migration gives "to zoom" a Local use cable on 7579 [yes; the alternative "always channels on the master" moves channels when mastership changes].
- O4 Every owner of a `pgm_prv` destination also gets its PRV channel; servers that do not output it get none [yes].
- O5 Pictures of remote screens: JPEG relay for GUI surfaces, placeholder in Caspar-composed multiview cells until NDI [yes].
- O6 A backup destination (cabled on both servers): `dest.*` to both owners with prepare / go. The AMCP mirror only when chosen per link [yes].
- O7 A take whose clips are missing on the owner: the GUI warns and asks for confirmation; the server never refuses [yes].
- O8 Media sync automatic (on cabling, look save, media import), rate-limited during a show, never deletes [yes].
- O9 Input identity (S13–S16) is a precondition of the switch [yes].
- O10 Version gate: the switch refuses unless every linked server advertises the capability and is online. Old builds keep the fan-out [yes].
- O11 Pixel-map (Art-Net) destinations need an explicit sending server (an Art-Net cable) [yes; today both servers would send].

---

## 1. Today

### 1.1 How the channel plan is derived (`getChannelMap`, `src/config/routing-map.js:181-432`)

- **Inputs.**
  - The destination list comes from `routingDestinationsFromConfig` (`screen-destinations.js:279-287`). When `screenDestinations.destinations` is missing it returns `null` (legacy: `screen_count` decides); `[]` means no screens.
  - `isMainBusDestinationMode` (`screen-destinations.js:175-178`): every mode except `multiview`, `stream` and `operator_gui` claims a PGM slot at `mainScreenIndex`. That includes `pgm_prv`, `pgm_only`, `pixelmap` and `host_channel`.
  - `compactMainScreenIndices` (`:222-231`) keeps the indices dense.
- **Screen count** (`resolveMainScreenCount`, `:74-113`) = max(`mainScreenIndex`) + 1 over the main destinations, together with `inferGraphMainUsage` (`:34-72`) for legacy `dst_chN` edges. **Cables do not change the count** (the comment at `cluster-fanout.js:4-7` says so: "channels follow the shared destination list, not the cables").
- **PRV per screen** (`resolvePreviewEnabledByMain`, `:115-136`): yes unless the screen's destination is `pgm_only` or `pixelmap`.
- **Order** (pins from stored host-live sources are skipped by `allocCh`, `:206`, `:227`):
  1. Operator GUI first (WO-868, `:213-220`): when `casparServer.operator_gui_first` is set (it is on both boxes, `operatorGuiFirst: true`), the GUI takes channel 1.
  2. Mains (`routing-map-mains.js:54-78`): per screen index, PGM then PRV (or PGM only), starting at `firstCh`.
  3. Multiview channels (`:229-235`).
  4. Operator GUI, when it is not first (`:237-239`).
  5. One channel per input: DeckLink by slot, live audio, v4l2 (`:262-305`). Then the legacy inputs host (`:308`), extra audio-only channels (`:311`), the monitor bus (`:316`).
  6. A dedicated streaming channel only when `dedicatedOutputChannel` is set. Otherwise streaming attaches to an existing channel: a `stream`-mode destination's `programChannels[mainIdx]`, or the `videoSource` vocabulary (`:157-179`, `:343-352`).
  7. Host-live channels (NDI host, webpage host…) merged from `nextCh` (`:354-367`).
- **Generator.** `buildChannelPlan` (`config-generator-channel-plan.js:38-115`) emits one `<channel>` per screen 1..`screenCount` (`:56`), plus multiviews, operator GUIs, inputs and extra audio. Screen modes come from the screen-indexed `screen_N_*` keys (`screenModeString`, `getModeDimensions`).
- **Shm / meters.**
  - shm consumers are not channels. The operator surface is config (`videoOutput: 'shm'`). PGM/PRV/inputs/any channel are leased at runtime by role: `pgm1..4`, `prv1..4` (by screen index), `inN`, `chN` (`video-surfaces.js:24-60`; `resolveRoleChannel` reads `programChannels[idx]`, `:42`).
  - The meter null consumer is added to channels at runtime (`audio/meter-null-consumer.js`).
- **Live (GET `/api/state` `channelMap`), both boxes identical except the inputs:**
  - 7579: `programChannels [2,4,5,7]`, `previewChannels [3,null,6,8]`, opgui `[1]`, DeckLink 1 → 9 (`route://9-1`), DeckLink 2 → 10, `streamingCh null`.
  - 5867: the same mains; DeckLink 3 → 9 (`route://9-3`), DeckLink 4 → 10; `streamingCh 7` (Stream PGM's PGM).
  - Destinations (shared list, identical on both): `dst_operator_gui` (opgui), `dst_mw7t9epz_1` "PGM/PRV 1" (main 0), `dst_mw96s6pd_1` "to zoom" (`pgm_only`, main 1), `dst_mw989wyz_1` "PGM/PRV 3" (main 2), `dst_mw9orj4o_1` "Stream PGM" (`pgm_prv`, main 3).
  - Cables:
    - 7579: opgui → `gpu_p3`, PGM/PRV 1 → `gpu_p1`.
    - 5867: opgui → `gpu_p1`; PGM/PRV 3 → `mapping_mw2fnwz5_1_in` → out_1 `gpu_p0`, out_2 `gpu_p3`; Stream PGM → `str_1` and `rec_1`.
    - "to zoom" is cabled nowhere (`owners: []` on both).

### 1.2 Consumers of "screen index → channel number" (the blast radius)

`grep programChannels|previewChannels|programCh(|previewCh(` over `src/` (not tests) finds **102 files** and **72 `programCh(`/`previewCh(` call sites**. Grouped:

- **Map core:**
  - `config/routing-map.js`, `routing-map-mains.js`, `channel-map-from-ctx.js` (`/api/state` shape), `operator-gui-first.js` `defaultProgramChannel`, `output-source-name.js` (`program_N` / `channel_N` vocabulary), `audio-preview.js`, `program-audio-layouts.js`, `live-audio-input.js`, `routing-setup.js`, `extra-live-source-enrich.js`, `live-source-route-heal.js`, `host-live-sources.js`.
  - Generator: `config-generator-channels.js`, `config-generator-consumer-attach-screen.js`, `config-generator-channel-plan.js`.
  - `channel-remap.js` `channelRoles` (`pgm:${i}`).
- **Take / looks:**
  - `api/routes-scene-take.js`, `-take-look.js` (`:117`, `:131`), `-take-overlay.js`, `-take-audio-only.js`, `-preview-push.js`, `-preview.js`, `-look-preset.js`, `-layer-tools.js`, `-layer-scrub.js`, `-lower-third.js`, `-shared.js`, `-global-border.js`.
  - Engine: `scene-transition.js`, `scene-exit-layers.js`, `scene-native-fill.js`, `scene-template-cg.js`, `scene-live-main-sync.js`, `look-air-compose-channel.js`, `look-layer-ranges.js`, `global-border-control.js`, `cg-routing.js`.
- **Live state:**
  - `state/live-scene-state.js`: key `liveScenesByProgramChannel` (`:14`); `invalidateIfProgramChannel` loops `programCh(i+1)` (`:130`).
  - `state/live-deck-state.js`, `state/live-scene-reconcile.js`, `engine/restore-on-screens.js`, `engine/air-snapshot-roles.js`.
  - `cluster/air-state.js:18-28` (on-air looks by channel).
- **Air tools:**
  - `api/routes-ftb.js:20-34` (`resolveFtbChannels` by `screenIdx`), `engine/ftb-pgm-prv.js`.
  - `api/routes-led-test-card.js`, `routes-led-test-control.js`, `engine/led-test-card-control.js`.
  - `api/routes-pgm-layer.js`, `routes-pgm-capture.js`, `routes-preview-nudge.js`, `routes-shader-live.js`, `routes-shader-stack.js`, `engine/caspar-channel-clear.js`, `engine/new-project*.js`, `engine/project-activate.js`.
- **Timeline:** `engine/timeline-playback-layer-screens.js:21-29` (`_screenChannelSet` with a `programCh` fallback), `timeline-playback-amcp-send.js`.
- **Multiview / previews / pictures:**
  - `engine/multiview-apply.js`, `multiview-apply-overlay.js`, `multiview-layout-helper.js` (cells are `route://N`).
  - `system/operator-gui-source-cells.js:112`, `operator-gui-channel-geometry.js`, `video-surfaces.js`.
  - `preview/compose-preview-mode.js`, `media/live-thumbnail-input-capture.js:74-75`, `companion-bridge/look-air-frames.js`.
  - `api/routes-stage-mvr.js`, `fixtures/pixel-map-model.js`, `pixel-map-service.js`, `artnet/artnet-slot-config.js`, `engine/mapping-slices-apply.js`.
- **Audio:**
  - `api/routes-audio.js`, `routes-audio-mixer.js`, `routes-audio-cross-screen.js`, `audio/fft-channel-source.js`, `audio/input-audio-routing.js`, `audio/meter-null-consumer.js`.
  - `zoom/zoom-audio.js:44-55` (feeds = every screen's PGM/PRV).
  - `show-timers/main-video.js`, `api/routes-screen-timers.js`.
- **Stream / record:** `bootstrap/streaming-lifecycle.js`, `api/routes-streaming-channel-shared.js`.
- **Cluster / replication:**
  - `cluster/cluster-fanout.js:49-60` (`mainChannels`), `remote-destination.js:94-105`, `destination-ownership.js:53-76`, `cluster-peers.js:193` (`program_channels` count).
  - `replication/amcp-fanout.js`, `channel-parity.js`, `mirror-apply.js`, `follower-caspar-output.js`, `live-state-feed.js`, `playhead-export.js`, `replication-service.js`.
- **Misc:** `utils/periodic-sync.js`, `utils/program-resolution.js`, `utils/gpu-connector-label.js`, `bootstrap/caspar-info-ready.js`, `api/device-view-apply.js`, `device-view-snapshot.js`, `system/operator-first-plan.js`.
- **Godot (43 .gd files read the arrays):**
  - `features/live/deck_model.gd:25-30, 83-90` (index-aligned; already checks `!= null`), `compose_tiles.gd:310`, `compose_tile_math.gd:88`, `look_preset_page.gd:106`.
  - `features/multiview/mv_layout.gd:52-53`, `mv_geometry.gd`, `features/audio/audio_rows.gd:86-111, 279, 337-377`, `audio_console_ctl.gd`.
  - `features/visuals/visuals_model.gd`, `features/previs/fixtures/pixel_map_*.gd`, `features/devices/slice_page_model.gd`, `replication_format.gd`, `app/header_badges_model.gd`, `features/live/pgm_timer_model.gd`, `live_sources_model.gd`.
  - Roles by screen index: `look_editor_backdrop.gd:35` (`prv%d`), `previs/stage_objects.gd:172`, `mvr_screens.gd:209`, `devices/slice_flow.gd:67`.
- **Persisted stores holding channel numbers** (from the WO-868 precedent, `system/operator-first-plan.js:22-31`):
  - Keyed by channel: `liveScenesByProgramChannel`, `liveAudioOnlyLooksByChannel`, `programLayerBankByChannel`.
  - Holding route strings: `multiviewLayout(_N)`, `scene_deck`.
  - In the project: `route://N[-L]` in looks, multiview cells and live sources; `channel_<N>` sources; `hostChannel`, `inputsChannel`, `thumbnailChannel`, `casparChannel` (`channel-remap.js:17-22`). The stamp is `channelScheme` (narvil = `operator-first-v1`).
  - Outside the server's reach (`operator-first-plan.js:26-31`): Companion `…_compose_preview_ch<N>_image`, scripts that address a channel by number, OSC `/channel/<N>/…`, `/dev/shm/highascg-ch<N>`.

### 1.3 What a non-cabled destination's channels do today, per box

- **Copy channel for the fan-out.**
  - The master plays every take on its own channel and `cluster-fanout.js` forwards each line to every server where the destination is cabled. It translates channel → destination → that server's channel (`channelPlan`, `:83-110`; `rewriteLine`, `:113-121`: only `route://` of destination channels is translated, any other route goes as is).
  - Every AMCP send reaches the journal sink (`routes-cluster.js:158-166`). Catch-up replays the journal (`:240-269`); the holders limit catch-up (`cluster-holders.js`).
  - Live: 7579's fan-out to 5867 maps PGM/PRV 3 `5→5, 6→6` and Stream PGM `7→7, 8→8`.
- **Gate on followers.** A follower's copy PGM is refused with 409 `REMOTE_SCREEN` (`destination-ownership.js:105-114`). Look takes there are relayed (`look-relay.js:27-49`; `routes-scene-take-look.js:73-86`, `:117`).
- **The operator's picture of a remote screen.**
  - The Live PGM/PRV windows are cells composed inside the operator GUI channel by local `route://` (`compose_tiles.gd:1-14`, atlas). The look editor backdrop reads `prv<N>` shm. Previs reads `pgm<N>`.
  - So on the master, today's picture of Stream PGM is the master's own copy channel. It is only right as long as the master can render the look: same media, and routes that resolve locally (WO-1027: `route://9-3` on the master is its own DeckLink channel, an empty layer).
- **Also on the copy channel:** live thumbnails (`live-thumbnail-input-capture.js:74-75`), multiview cells, timeline targets (`_screenChannelSet`), zoom feeds (`zoom-audio.js:44-55`), audio strips and meters (`audio_rows.gd`), Companion look frames, FTB-all (`routes-ftb.js:21-29` loops every screen), on-air rules (`air-state.js`).
- **"to zoom":** cabled nowhere, but it has a PGM channel (4) on both boxes and is a zoom return feed source.
- **5867 has a copy of PGM/PRV 1 on its channel 2.** "shm visuals" played there (WO-1029, verified section). That is useless work on a box that never outputs it.

---

## 2. Target channel plan

### 2.1 The rule

A screen destination D gets channels on server S only when:
- S has `cluster.channelsWhereCabled: true` in its own config (set by the switch, section 7), **and**
- D is **cabled on S**: `cabledHere(S.config, D)` is true, computed only from S's own `deviceGraph`.

When the flag is off (any unlinked box, and every box before the switch), nothing changes.

`cabledHere(config, D)` is true when one of D's sources (`dst_in_<id>`, legacy `dst_chN` / `dst_mvN`, `device-graph-destination-wiring.js:44-55`) reaches a **physical sink** by a directed path that may pass through mapping nodes (`mapping_*_in` → `mapping_*_out_k`). Physical sinks:
- `gpu_out`, `decklink_io` in an output direction, `stream_out`, `record_out`, `audio_out`, `caspar_mv_out`;
- an NDI output once it exists;
- an Art-Net sender (new virtual connector, O11);
- the new **Local use** virtual connector (O3).

A mapping node with no cabled output does not count. Today `cabledIds` (`cluster-fanout.js:63-74`) counts any edge out of `destination_in`, and Godot `cluster_model.gd` uses the same rule. Both must move to the one shared predicate.

Not counted:
- multiview cells (a multiview shows only local channels; a remote cell is a placeholder);
- previews and thumbnails;
- a GUI window.

### 2.2 Per destination kind

| Kind | Channels where cabled | Notes |
|---|---|---|
| `pgm_prv` | PGM + PRV on **every** owner (O4) | PRV is the owner's staging bus (preview push, look editor, take). With two owners (backup) both have PRV, so a PRV staged by the master is identical on both. A PRV-only cable (`outputLayer ≥ 2`, `device-graph-destination-wiring.js:16-26`) makes S an owner too. |
| `pgm_only`, `pixelmap` | PGM | Pixel-map needs an explicit sending server (O11). |
| `stream` mode / Stream PGM | as `pgm_prv` | `str_1` / `rec_1` count as cables. `resolveStreamOutputCasparChannel` (`routing-map.js:157-179`) must read the hole and attach only where local. |
| `multiview` | its channel where cabled | Cells of remote screens: placeholder (§4). |
| `operator_gui` | per server, unchanged (D2 option b, plan 06 S1) | Channel 1 on both boxes. |
| `host_channel` | unchanged (per-server input) | |
| Inputs (DeckLink, ALSA, v4l2, host-live) | unchanged (per-server hardware) | Numbers shift, see 2.4. |
| Monitor bus, audio-only, dedicated stream | unchanged | |

### 2.3 Special cases

- **A single server with no links** (O1). Unchanged: the flag is never set, every destination gets channels, the ~104 smokes pinning channel maps stay green. I recommend against applying the rule to single boxes. A single box with an uncabled draft destination keeps working as now (preview it, build looks), and nothing is gained by renumbering it.
- **Destination cabled nowhere** (O3; "to zoom" today).
  - With the flag on: no channel anywhere. The look editor shows a placeholder: "PGM/PRV X has no output: cable it, or mark Local use on a server".
  - The new **Local use** connector (one virtual jack per server in Devices, rear panel "Local use (zoom, virtual camera, previews)") is a real cable, so the rule stays "cabled here ⇒ channels here" and stays deterministic.
  - Migration gives "to zoom" a Local use cable on 7579, because zoom runs there.
  - The rejected alternative, "uncabled ⇒ channels on the master", moves channels (and needs an Apply) on every mastership change.
- **Operator GUI and multiview channels:** per server, as above.
- **Screen count** stays the shared count (max index + 1). `programChannels` and `previewChannels` get **`null` holes** at the indices of screens that are not here. `channelMap` gains `screenHosts: [{ idx, destId, here, owners: [serverId] }]` so the client knows why a slot is empty and who outputs it.
- **Hole handling (prerequisite C1).**
  - `programCh(n)` / `previewCh(n)` must return `null` for a hole. Today `programChannels[n-1] || programChannels[0]` (`routing-map.js:321`, `:385`) would send screen 4's FTB to screen 1.
  - `timeline-playback-layer-screens.js:27-28` falls back to `(screenIdx+1)*2`.
  - Every `for i < screenCount` loop must skip holes (`routes-ftb.js:21-29`, `zoom-audio.js:47-55`, `live-scene-state.js:130`).
  - The generator loop (`config-generator-channel-plan.js:56`) emits no `<channel>` for a hole.
  - `allocateMainChannels` (`routing-map-mains.js:54-78`) gets an `isLocal(i)` predicate and does not call `next()` for a hole, so numbers stay dense (Caspar numbers channels by their position in the config).

### 2.4 How stored references survive (channel numbers differ per box and change when a cable is added)

General rule: **nothing new may store a channel number**. Every existing store gets a role-based remap whenever the plan changes on Apply, not only at the switch.

| Store | Today keyed by | Survival |
|---|---|---|
| Looks' `mainScope`, preset items, `timeline.layer.screenIdx`, FTB `screenIdx` | screen index | no change (index is cluster-wide) |
| `route://N-L` to an **input** in looks / live sources | channel | Replaced by input identity `{server, input}` (plan 06 S13–S16, WO-1027) **before** the switch (O9). Until then the remap below rewrites them by role `in:<kind>:<slot>`. |
| `route://N` to a **screen** (PGM/PRV cell, multiview cell, `channel_<N>`) | channel | Remapped by role `pgm:<destId>` / `prv:<destId>`. A role that no longer exists here becomes a placeholder cell `{ screen: idx, bus }`, never a wrong number. |
| `liveScenesByProgramChannel`, `liveAudioOnlyLooksByChannel`, `programLayerBankByChannel` (persistence) | channel | `remapChannelKeyedObject` by role at every plan change. Entries for vanished copy channels are **dropped** (that content was never on a screen). |
| `multiviewLayout(_N)`, `scene_deck`, operator GUI layout cells | route strings | `remapDeep` |
| Air snapshot | `pgm:dst_…` (`air-snapshot-roles.js:1-27`) | Already by destination; the Apply restore survives renumbering. A destination newly cabled here has no snapshot entry; it "joins" by `dest.state` (§3.6). |
| Companion variables, OSC `/channel/N`, shm `highascg-ch<N>` | channel | Listed in the dry run as external (as WO-868 did). Companion look frames are published per screen index from now on (`look-air-frames.js`). |
| `channel-remap.js channelRoles` | `pgm:${i}` | Add `pgm:<destId>` roles (as air-snapshot-roles does). Holes are skipped by `put()` (`:30-33`). |

Mechanism (C11): generalize the WO-868 switch (`system/operator-first-switch.js`, `-plan.js`, `engine/project-channel-scheme.js`) into **"channel plan changed"**. It runs in the Apply path when the old and new `getChannelMap` differ. It remaps persistence and the **local** projects (`projects/*.json`, `_autosave`) and the shared show.

For the shared show: it holds looks for every screen, so it must not be remapped with one box's numbers. With S13–S16 done, the show holds no input channel numbers; screen routes in the show become `{screen, bus}` cell objects. That is why O9 is a precondition.

---

## 3. Driving a destination that is not on this server

### 3.1 Calls (new `src/cluster/dest-actions.js`, registered in `cluster-call-actions.js`)

Common arguments: `{ destId, opId, seq, from }`. The receiver resolves `destId → mainIdx → its own channel` at call time and runs **its own route handler** (a remote press is a local press, WO-712 D3).

| Call | Runs on the owner | Exists today as |
|---|---|---|
| `dest.take { sceneId, bus:'program', forceCut?, transitionOverride?, timersVisibility?, group? }` | `handleTakeLook` (`routes-scene-take-look.js:30`) | `look.take` (`cluster-call-actions.js:69-86`) keyed by `mainIdx`. Keep `look.take` as an alias for one release. |
| `dest.preview { sceneId \| sceneSnapshot, mode }` | preview-push (`routes-scene-preview-push.js`) | none (the look editor of a remote screen needs it) |
| `dest.clear { bus }` / `dest.ftb { frames, bus? }` | `routes-ftb.js` per `screenIdx` | none |
| `dest.testcard { on, pattern? }` | `led-test-card-control.js` | none |
| `dest.media { layer, clip, opts }` / `dest.layer { op, layer, … }` | `routes-pgm-layer.js` | none |
| `dest.mixer { layer, prop, value, frames }` (includes the audio strip volume) | `routes-audio-mixer.js`, mixer nudge | none |
| `dest.timeline { timelineId, op, at?, group? }` | timeline engine, filtered by `screenIdx` | none |
| `dest.state {}` (query, on the `info` list) | `liveSceneState` + test card + timeline + holder, for that destination | none |
| `dest.pressed` | stays only for mirror-transport backup | exists (`destination-ownership.js:23-26`) |

Sender side (new `src/cluster/dest-route.js`): `routeFor(ctx, mainIdx) → { local: true } | { owners: [...] }`.
- Every route that takes `mainIdx` / `screenIdx` asks it first: take-look, preview-push, look-preset recall, FTB, test card, layer tools, pgm-layer, audio mixer, timeline, zone actions (`tracking/zone-actions.js:48`).
- A route that takes a raw **channel** number from a client cannot address a remote screen (there is no channel). The client must use the by-screen variant, so Godot sends `mainIdx` / `destId` for every screen-scoped action (C15).
- Raw AMCP `/api/amcp/raw` is never relayed.

### 3.2 Transport (C4)

- **Today:** `cluster-call.js:21,115` accepts only `|now − ts| ≤ 60 s`, with a 120 s nonce window. `cluster-media.js:19,38` has the same window. The hello already uses a strictly rising per-sender counter (`cluster-hello.js:98`).
- **Target:** accept `ts > highest(sender) − 10 s`. Both values come from the sender's clock, so the receiver's clock never matters, and parallel calls can arrive out of order inside the 10 s. Nonces are kept for the last 20 s of sender time. `highest(sender)` is stored (`config/cluster-call-floor.json`), so a call captured before a restart cannot be replayed after it. The same change applies to `/api/cluster/ssh-key`.
- **Idempotency:** the receiver keeps the last 64 `opId → answer` per sender. A retry, sent after a timeout with a fresh nonce and the same `opId`, gets the cached answer and does not run twice.
- **Ordering:** each sender keeps a `seq` per destination. The owner applies "last press wins" by `(seq, sender priority)` (report 02 §3, conflict rule) and reports the holder in `dest.air`.

### 3.3 Latency versus today's mirror

- **AMCP mirror today:** the master writes the same lines to both Caspars. The peer starts within about the network RTT (under 1 ms on a LAN) plus the frame phase (up to 1 frame without genlock).
- **`dest.take`:** HTTP POST + ed25519 sign/verify (about 0.1 ms each) + the owner's own take preparation (scene build, LOADBG, phase A). Expect 15–60 ms before the owner's PLAY. Relative to the master's own screen, that is 1–3 frames late, unless the take is synchronized (3.4).
- For a remote-only screen (distribution) the extra delay is invisible: nothing on another screen shows the skew.

### 3.4 Multi-screen take across servers (C7)

- **Today:** `take-sync-barrier.js` (timeout 1500 ms, `:23`; `joinTakeGroup`, `:88`) releases every local screen's phase B as one merged AMCP batch. A preset recalled on a follower drops the group (`routes-scene-take-look.js:84`).
- **Target: two-phase.**
  1. The master sends `dest.take {…, group: { id, size, phase: 'prepare', deadlineMs: 1500 }}` to each owner. Each owner runs phase A and parks its phase-B plan in its own barrier, then answers `ready`.
  2. When local and remote screens are ready (or at the deadline), the master sends `dest.go { groupId }` to every owner in parallel and releases its own batch at the same moment.
  3. Skew = the difference in one-way latency (under 1 ms) plus the frame phase (up to 1 frame). Without genlock, frame-exact is not possible (the owner already knows this).
  4. An owner that never hears `go` releases itself at `deadline + 500 ms` and reports `late: true`.
- **Later (needs PTP + genlock):** `dest.take {at: <PTP time>}`, scheduled takes. Not in this plan.

### 3.5 What the master's live state holds for a remote destination (C8)

- **The owner is the authority.** After every live change (`broadcastSceneLive`, `live-scene-state.js`) the owner publishes on a new exchange topic `dest.air`, keyed by destination id, to **every** linked server (`cluster-exchange.js` TOPICS; today `air` goes only to servers with zones, `:43-50`):
  `{ destId: { pgm: {sceneId, name, at}, prv: {…}, testcard, ftb, timeline: {id, state, pos}, holder: {server, seq, at}, media: {ready, missing} } }`
- **The receiver** keeps the newest per source (EXPIRE 15 s → "unknown") and exposes it in `/api/state` as `scene.remoteLive` (by screen index) plus WS `cluster:dest-air`.
- **Godot** `deck_model.resolve_bus_look_ids` reads `remoteLive[idx]` when `pgm_ch` is a hole. Today it falls back to the project's `liveSceneIdByMain` (`deck_model.gd:37-41`), which is wrong for a remote screen.
- **On-air rules** (`air-state.js`) take `dest.air` as well, so zones see what is on the remote LED.
- **Holders:** `cluster-holders.js` (master-side, for catch-up) is retired. The owner's `lastPress` becomes the holder, shown in both GUIs ("PGM/PRV 3 · driven from highascg7579 12 s ago").

### 3.6 What happens to `cluster-fanout.js` (recommend O6)

- **Replace it entirely with `dest.*` to every owner**, including both owners of a backup destination.
- Keep the AMCP mirror only as an opt-in per-link "frame-accurate backup" transport for identical boxes (owner answer 4: it also replaces `src/replication/`). It applies only to destinations cabled on both servers, which then both have channels, so the translation table covers only those destinations.
- **Trade-off for a backup:**
  - The mirror sends identical lines (same clip start frame, same MIXER tweens) within about 1 ms.
  - `dest.*` with prepare/go gives the same about-1-frame bound. Each box builds its own lines from the same look (same code, same media), so content is identical as long as media and versions match. The risk is version skew between builds, which the capability gate limits.
  - Clip drift over a long clip is identical in both (both free-run at the same nominal rate).
- **Interactions:**
  - **`AIR_HELD`** stays only for raw AMCP on a backup destination's channels on the backup box while the master holds it (`amcp-fanout.js:239` `airHeldBy`, P1c). Every by-screen route on the backup box goes through the backup rule (3.7) instead of 409.
  - **`REMOTE_SCREEN`** disappears from the AMCP gate (there is no channel to refuse). It survives only as "no owner reachable" from `dest-route` (`look-relay.js:46-48` already builds it).
  - **Catch-up after a peer restart / Apply:** the owner restores itself (`restore-on-screens.js`, Apply's air snapshot by destination). The master replays nothing; the bugs B5/B6 and the 10.11 stray-layer bug cannot happen.
  - **Newly cabled here, or a backup owner that comes back:** the new owner asks the holder `dest.state` and takes the same look at the reported position (state-level join, not a line replay). For a backup that diverged, the master's next take re-syncs.
  - **Air snapshot:** unchanged, per server, by destination.

### 3.7 A press on the backup box (owner answer 3)

- The press goes to the master (`dest.take` relayed). The master sends `dest.take` with prepare/go to every owner, including the presser.
- No answer within 1 s (`look-relay.js:15` `BACKUP_MS`): taken locally, marked `diverged` (exists, `routes-scene-take-look.js:40-50`). The master's next take clears it.

---

## 4. Seeing a remote destination

**Today:**
- `/api/video-feed` (`system/video-feed.js:1-14`): WS; the client sends `{roles}`, the server sends `[u8 n][role][JPEG]`; width 160–1920 (default 960), fps 1–30 (default 15) (`video-feed-encoder.js:20-26`). The encoder runs in a worker and only while wanted, and drops frames instead of queueing.
- Godot uses the feed for all roles or for none (`video_surfaces.gd:33-35`, `:90`).

| Surface | Recommendation |
|---|---|
| Live PGM/PRV windows (composed in the operator GUI channel) | The server marks the cell `remote: { server, role: 'pgm4' }` and routes nothing into that atlas slot. Godot draws that window from the relayed role texture (it already crops one `TextureRect` per window in atlas mode). |
| Look editor backdrop (`look_editor_backdrop.gd:35`, `prv<N>`) | The owner's PRV (staged by `dest.preview`), relayed, about 15 fps / 960 px. |
| Previs (`pgm<N>`) | Relayed, low rate (5 fps). |
| Look thumbnails | Rendered where the media is (the owner). Fetched through the existing relay (`/api/cluster/peers/:id/relay/…`) and cached; refreshed on look save. |
| Multiview cells and other Caspar-composed outputs | Labelled placeholder ("PGM/PRV 3 — on highascg5867") until NDI on demand exists (plan 06 S18, D9). An 8K LED channel over full NDI is about 400 Mbit/s, so it needs a scaled feed; that is not designed here. |
| Audio meters of remote screens | `dest.air` at 5 Hz (peak/RMS per channel pair), volume through `dest.mixer`. |

**Relay (C9, new `src/cluster/feed-relay.js`):**
- The node opens one WS per wanted remote role to the owner's `/api/video-feed`, authenticated by a short-lived ticket from a signed `feed.ticket` call (the feed needs auth when `enforceAuth` is on). It fans the frames out to its local clients on its **own** `/api/video-feed`, under the same role name.
- `GET /api/video-surfaces` descriptors get `transport: 'feed'` for remote roles. The client stays on its own node (rules 2–3).
- Bandwidth: MJPEG 960×540 at q5 is about 40–80 KB per frame, so about 5–10 Mbit/s per role at 15 fps; four roles is about 40 Mbit/s on GbE. Latency is about 70–150 ms (encode + one hop + decode).
- **Godot change:** per-role transport in `video_surfaces.gd _ensure` (shm for local roles, the `VideoFeed` reader on the local node's feed for `transport: feed`).
- **Rejected alternative:** the node decodes into a local shm segment so Godot is unchanged. Rejected because of an extra decode + BGRA writes (8 MB per frame) on the show box.

---

## 5. "Have the media local" (C10)

**Today:**
- "Send media" is manual. `cluster-media.js:55-87` pushes the whole project's media by rsync over ssh (forced command into `media/` and `template/`).
- `buildProjectMediaRsyncPlan` comes from `collectProjectAssetRefs` (`replication/project-media-refs.js:34-60`: scenes, playlists, timelines, templates).
- Parity is one signature per project (`cluster-peers.js:133-137`); live it reads `differs` (7579: 3 files, 5867: 1).
- `onSent` triggers a fan-out resync (`routes-cluster.js:358`). The take already reports `missingMedia` (`deck_model.gd take_warning`).

**Design:**
- **Media list per destination:** `collectProjectAssetRefs` filtered by screen: looks with `mainScope == idx` or `all`; look presets naming the screen; timelines routed to it (per layer `screenIdx`); playlists inside those looks; CG/HTML templates and the template's own folder. Fonts and assets inside the template folder ride with it. Live inputs are excluded (they are hardware).
- **What each server has:** an `info` exchange topic `media.have` (name, size, mtime, short hash for files under 100 MB, size+mtime above that), refreshed on media scan.
- **Plan per owner:** missing = list − have, plus mismatched (same name, different size/hash). Source = the master if it has the file, else the lowest-id server that has it. The source pushes it (only push exists: the forced command on the receiver).
- **Triggers:** a destination newly cabled on a server; look/timeline save that adds a clip; media import / ingest; a server coming online; plus a manual "Sync now".
- **Constraints:**
  - rsync `--partial --bwlimit` (default 30 MB/s, or 10 MB/s while any destination of the receiver is on air; configurable).
  - rsync writes to a temp file and renames, so Caspar never sees half a file.
  - One transfer per receiver at a time.
  - Before sending, the receiver's free space (reported in `media.have`) must cover the bytes plus a 5 % margin; otherwise "not enough space on highascg5867 (needs 12.4 GB, 8 GB free)".
- **Never deletes.** "Clean unused media" is an explicit per-server button listing clips that no destination it owns uses.
- **Status:**
  - `/api/cluster` `destinations[].media = { ready: n, missing: [..], syncing: { percent, file } }`.
  - Godot destination card badge "media 3/4 on highascg5867 — syncing 45 %".
  - Look card amber "not ready on <server>".
  - Take: the GUI asks "2 clips missing on highascg5867 — take anyway?" (O7). The server never refuses; the owner's take answers `missingMedia` as today.
- **Reuse:** `sync-project-media-rsync.js`, `replication-ssh-setup.js`, `cluster-media.js` trust handshake, `project-media-refs.js`, `media-exists.js`.

---

## 6. Hot backup (a destination cabled on both servers)

- **Owners:** both servers have channels for it.
- **Default transport:** `dest.*` with prepare/go to both owners. Both build from the same look and media. Media sync makes both have the files; take readiness considers both.
- **Opt-in frame-accurate transport** per link: the old AMCP mirror, for identical boxes and for this destination only.
- **A press on the backup box:** goes to the master; after 1 s without an answer it runs locally and is marked diverged (3.7). A press on the master goes to both.
- **Frame tightness:** about 1 frame either way without genlock. With the mirror and genlock, frame-exact; with `dest.*` and genlock, exact only after scheduled takes (PTP).
- **Divergence check:** each owner reports PGM sceneId and clip position in `dest.air`. The master flags "backup differs" when sceneIds differ or a clip position differs by more than 2 frames for more than 3 s.

---

## 7. Migration on the two real boxes

### 7.1 Channel lists (opgui first on both)

| | Today | After |
|---|---|---|
| **7579** | 1 opgui, 2/3 PGM/PRV 1, 4 to zoom, 5/6 PGM/PRV 3 (copy), 7/8 Stream PGM (copy), 9 DL1 (`route://9-1`), 10 DL2 | 1 opgui, 2/3 PGM/PRV 1, 4 to zoom (Local use, O3), 5 DL1, 6 DL2. `programChannels [2,4,null,null]`, `previewChannels [3,null,null,null]`. |
| **5867** | 1 opgui, 2/3 PGM/PRV 1 (copy), 4 to zoom (copy), 5/6 PGM/PRV 3, 7/8 Stream PGM (`streamingCh 7`), 9 DL3 (`route://9-3`), 10 DL4 | 1 opgui, 2/3 PGM/PRV 3, 4/5 Stream PGM (`streamingCh 4`), 6 DL3, 7 DL4. `programChannels [null,null,2,4]`, `previewChannels [null,null,3,5]`. |

### 7.2 What breaks at the moment of the switch

- **"2box Mixer" (`mainScope 3`, `route://9-3`) and "2box PPT" (`route://10-4`)** in the shared narvil show. On 5867, DeckLink 3 moves 9 → 6. The shared show cannot be remapped with 5867's numbers while 7579 holds the same text.
  - Today these looks work only because the fan-out forwards an untranslated route that matches 5867 by coincidence.
  - So input identity S13–S16 must run first. Migration by D11: "2box Mixer" → `{highascg5867, decklink:3}`, "2box PPT" → `decklink:4`.
- **BIG_BUCK_BUNNY** (scope 0, 7579 ch 2): unchanged. **zz_tl_ramp** (scope 2, now on 5867): needs `zz_tl_ramp.mp4` on 5867 (parity `differs` today), so media sync must have run.
- **Persisted state:**
  - 7579: live entries on 5 and 7 (copies) are dropped; ch 2 stays.
  - 5867: 5 → 2 and 7 → 4 in `liveScenesByProgramChannel` and `programLayerBankByChannel`; its old copy entries on 2 and 4 are dropped.
  - Operator GUI layout cells with `route://5` / `7` on 7579 become remote cells.
  - Multiview: none configured.
  - Stream / record on 5867 follow `streamingCh` (by `program_N` vocabulary or the stream destination's index); check the record consumer re-attaches on 4.
- **Fan-out:** 7579 stops forwarding (holder `highascg7579` on Stream PGM is replaced by 5867's `lastPress`).
- **Externals:** Companion `…_ch<N>_image`, OSC `/channel/5..8` readers, the WO-1026 harness (T5 looks), the release-test cards that name channels.
- **Re-check the old cabling issue:** WO-1029 noted record losses (T7.1/T8.1) on 5867's new cabling, not attributed yet. Copy channels (shm visuals on 5867 ch 2) cost GPU there, so the switch may help; verify after it.

### 7.3 Rollout order (each step shippable and reversible)

| Step | Behaviour change | Reverse |
|---|---|---|
| **R0** | None visible: holes safe everywhere (C1); shared cabled predicate (C2); counter transport (C4); capabilities `dest.v1`, `cwc.v1` in hello and device view. | none needed |
| **R1** | Per-link flag `dest_transport` (default on when both have `dest.v1`). The master drives remote screens with `dest.*` instead of the fan-out. Copy channels still exist but are idle. | flag off → fan-out as today |
| **R2** | Picture relay + `dest.air` remote state in GUI | flag |
| **R3** | Media list + automatic sync | flag (manual Send stays) |
| **R4** | Input identity (S13–S16) + look migration (D11) | the migration keeps a backup of the project |
| **R5** | The switch, per server: `POST /api/cluster/channels-where-cabled { enable, dryRun }`. The dry run lists channel tables before/after, persisted keys and project references that would change, externals, and media not ready. It **refuses** unless every linked server is online and has `cwc.v1`, `dest_transport` is on, no shared look holds a raw input route, and the media lists are complete (`force` overrides only the last). Enable writes the flag on every linked server and runs "Apply all" (followers first, master last, with the air snapshot). | `enable:false` + Apply all: the same remap by role, back |
| **R6** | One release later: delete the copy-channel fan-out path, `cluster-holders.js`, the journal sink for distribution | — |

**Mixed builds (O10 / D6):**
- A new master facing an old follower (no `dest.v1`) keeps the fan-out. That only works while the master still has copy channels, so R5 refuses then.
- An old master facing a new follower: the follower runs the old behaviour until the switch.

---

## 8. Steps (dependency order; files per step do not overlap within one wave)

### Wave A — foundations (parallel)

- **C1a Hole-safe map core.**
  - Files: `config/routing-map.js` (`programCh` / `previewCh` return null, `screenHosts`), `routing-map-mains.js` (`isLocal`), `channel-map-from-ctx.js`, `output-source-name.js`, new `config/screen-channels.js` (helpers `screenChannels(map, idx)`, `localScreens(map)`).
  - Tests: `smoke-cwc-holey-map.test.js` (synthetic hole maps; `programCh(4)` on a hole is null; stream attach).
- **C1b Engine consumers.**
  - Files: `engine/timeline-playback-layer-screens.js`, `ftb-pgm-prv.js`, `led-test-card-control.js`, `scene-*.js` callers, `state/live-scene-state.js:130`, `cluster/air-state.js`, `zoom/zoom-audio.js`, `media/live-thumbnail-input-capture.js`, `system/video-surfaces.js`, `audio/*`.
  - Tests: extend the existing per-module smokes with a hole fixture.
- **C1c API routes.**
  - Files: `api/routes-ftb.js`, `routes-led-test-*.js`, `routes-pgm-layer.js`, `routes-audio*.js`, `routes-scene-*.js`, `routes-stage-mvr.js`, `routes-screen-timers.js`, `routes-streaming-channel-shared.js`.
  - Hole → a typed 409 `NOT_HERE { owners }` until C6 relays it.
- **C2 Cabled predicate + Local use connector.**
  - Files: new `config/destination-cabling.js` (`cabledHere(config, destId)`, transitive through mapping nodes, sink kinds); `cluster/cluster-fanout.js` `cabledIds` delegates to it; `config/device-graph-core.js` (virtual `local_use`, `artnet_out` connector per server); Godot `features/devices/cluster_model.gd`, `rear_panel.gd` (jack).
  - Tests: `smoke-cwc-cabled-predicate.test.js` (mapping without outputs = no; PRV-only = yes; `str`/`rec` = yes; orphan cables ignored), a Godot unit.
- **C4 Call transport.**
  - Files: `cluster/cluster-call.js`, `cluster-media.js` (ssh-key), new `config/cluster-call-floor.json` store.
  - Tests: extend `smoke-wo712-cluster-call.test.js` (clock 10 min off → ok; replay → 409; out-of-order within 10 s → ok; restart floor; `opId` retry returns the cached answer).
- **C0 Capabilities.**
  - Files: `cluster/cluster-hello.js`, `cluster-peers.js` (peer `caps`), `api/device-view-snapshot.js`.

### Wave B — `dest.*` (R1)

- **C5 Receiver.**
  - Files: new `cluster/dest-actions.js`; `cluster-call-actions.js` (register; `look.take` alias).
  - Tests: `smoke-cwc-dest-actions.test.js` (each call resolves `destId` → the local channel on two different maps; unknown dest → 404 `DEST_UNKNOWN_HERE`; not cabled here → 409).
- **C6a Sender for looks.**
  - Files: new `cluster/dest-route.js`; `cluster/look-relay.js` (generalized); `api/routes-scene-take-look.js`, `routes-scene-preview-push.js`, `routes-scene-look-preset.js`; `tracking/zone-actions.js`.
- **C6b Sender for air tools.** Files: `api/routes-ftb.js`, `routes-led-test-control.js`, `routes-pgm-layer.js`, `routes-audio-mixer.js` (after C1c, same files: one implementer, serial).
- **C6c Sender for timeline.** Files: `api/routes-timeline*.js`, `engine/timeline-*` dispatch.
- **C7 Prepare/go barrier.**
  - Files: `engine/take-sync-barrier.js`, `dest-actions.js` (`go`), `routes-scene-look-preset.js`.
  - Tests: barrier unit (remote ready, timeout, late go); bed scenario measuring the send spread.
- **C8 Remote air state.**
  - Files: new `cluster/dest-air.js`; `cluster-exchange.js` (topic); `state/live-scene-state.js` broadcast hook; `api/routes-state` / `channel-map-from-ctx.js` (`scene.remoteLive`); Godot `features/live/deck_model.gd`, `header_badges_model.gd`.
  - Tests: exchange smoke; Godot unit for `resolve_bus_look_ids` with a hole.
- **C13a Fan-out gated by `dest_transport`.** Files: `api/routes-cluster.js` `fanoutOf`, `cluster/destination-ownership.js` (`verdict` without REMOTE_SCREEN when the flag is on).

### Wave C — pictures and media (R2, R3; parallel with B after C4)

- **C9 Picture relay.**
  - Server: new `cluster/feed-relay.js`; `system/video-feed.js` (remote roles); `api/routes-video-surfaces.js` (`transport`); `system/operator-gui-source-cells.js` + operator GUI layout (`remote` cells).
  - Godot: `video/video_surfaces.gd` (per-role transport), `features/live/compose_tiles.gd`, `look_editor_backdrop.gd`.
  - Tests: `smoke-cwc-feed-relay.test.js` (stub feed → relayed frames, auth ticket, one upstream for two clients); Godot unit for per-role readers.
- **C10 Media.**
  - Files: new `cluster/dest-media.js` (list, plan, scheduler); `replication/project-media-refs.js` (scoped walk); `cluster/cluster-media.js` (`--bwlimit`, space check); `cluster-exchange.js` (`media.have`); `routes-cluster.js` (status); Godot destination and look cards.
  - Tests: list unit (looks/timelines/presets/templates per screen), planner unit (source choice, space refusal), bed scenario.

### Wave D — inputs and switch (R4, R5)

- **S13–S16** (plan 06), unchanged; a precondition.
- **C11 Plan-change remap.**
  - Files: new `system/channel-plan-change.js` (from `operator-first-plan.js` / `-switch.js`); `config/channel-remap.js` (`pgm:<destId>` roles); `cluster/cluster-apply.js` hook; `engine/project-channel-scheme.js`.
  - Tests: remap units on the two real boxes' configs (fixtures from the GETs above); `smoke-wo1029-apply-snapshot` extended to renumbering.
- **C3 The rule behind the flag.**
  - Files: `config/routing-map.js` (`isLocal` from C2), `config-generator-channel-plan.js:56`, `config-generator-channels.js`, `config-generator-consumer-attach-screen.js`, `utils/os-layout-calculator` (check only).
  - Tests: `smoke-cwc-channel-plan.test.js` with both real boxes, asserting exactly the 7.1 tables and the generated XML; flag off = byte-identical config (guards the 104 smokes).
- **C12 The switch.** Files: new `system/channels-where-cabled-switch.js` + route in `api/routes-cluster.js`; Godot Devices / Servers card.
  - Tests: dry-run refusals, enable/disable round trip.

### Wave E — retire (R6)

- **C13b** Delete the distribution fan-out and the holders. `cluster-fanout.js` keeps the mirror only.
- **Tests that change:** `smoke-wo670-cluster-fanout`, `-catchup`, `smoke-wo933-fanout-checks-before-replay`, `smoke-wo1017-fanout-holds-stale-layout`, `smoke-wo1026-two-box-follower`, `smoke-wo1029-ownership`, `smoke-wo1029-drive-gate`, `smoke-wo772-media-sent-resync`, `smoke-wo1029-virtual-takeover` (stray-layer case becomes "no foreign writer ever").
- **C15 Godot audit.** The 43 files listed in 1.2: holes; by-screen endpoints instead of `channel` for take / test card / layer / mixer; remote cue.

### Virtual box bed (`tools/e2e/virtual-boxes*.js`, C14; before Wave B ends)

- **Per-box channel plans from cables:** already follows each node's generated config. Add `bed.channels(id)` and assert the 7.1-style tables for `twoBoxes`.
- **Strict writer invariant:** `assertNoStrays` with `who === box` for every channel. No box's Caspar ever receives a line from another box's node (the mirror scenario allows it explicitly).
- **Picture feed stub:** fake shm segments per channel (reuse `tools/e2e/godot-shm-writer`) carrying a box/role/clip marker, so relay tests can check which box and look a frame came from.
- **Media per box:** per-box media inventory in the fake `CLS`; a missing clip answers 404 on `PLAY`; the rsync hook is stubbed to copy into the other fake's list with a delay and progress.
- **Scenarios:**
  - (1) the master takes a look on B's screen: only B writes; `remoteLive` on A shows it.
  - (2) a preset across A + B: prepare/go spread under 5 ms in the bed.
  - (3) B restarts: B restores itself; A writes nothing.
  - (4) a cable is added on B: Apply renumbers, live state survives by destination, media syncs, then the join by `dest.state`.
  - (5) backup on both: B's press relayed; freeze A → diverged.
  - (6) clocks 10 min apart (fake `now`) → calls still work.
  - (7) old-build peer (no caps): fan-out path still used; switch refused.
  - (8) switch on → off round trip: the channel tables and stores are restored.

### Plan 06 steps

| Order | Steps | Why |
|---|---|---|
| **Before this change** | S1 (operator GUI per server), S2, S3 + S4 (combined device view: owners, cables, `DEST_UNKNOWN_HERE`), S5 (destinations shared on link, D1), S6 (deleting a destination clears its cables everywhere, otherwise an orphan cable would create channels), S13–S16 (input identity) | They define what "cabled" and "owner" mean and remove the raw input routes. |
| **In parallel** | S7–S9 (unified Devices UI), S10 (Apply per server / Apply all), S17 | S10 must exist before R5. |
| **After** | S11 (remove Edit), S12 (two-box verification, re-run with the switch on), S18 (NDI: also gives multiview cells of remote screens a picture) | |

### Risks

- **Holes:** a missed `programCh` fallback sends an action to screen 1. Mitigation: C1 first, a lint/grep test for `programChannels[0]` fallbacks, and the flag-off byte-identical guard.
- **Apply on every cable change** now renumbers channels. Mitigation: the remap (C11) + air snapshot by destination. WO-1020 (runtime `CHANNEL ADD`, not deployed) could later avoid the restart.
- **Version skew between owners of a backup** (each builds its own lines). Mitigation: capability gate + the "backup differs" check.
- **Relay load** on the owner (encoder per role). Mitigation: the existing one-encoder-per-role cap; previs low rate.
- **Media sync during a show** saturating the link. Mitigation: bwlimit, a lower limit while on air, one transfer at a time, never delete.
- **The two "2box" looks and WO-1026 harness T5** depend on S13–S16; schedule the harness re-run after R4.
- **A Local use cable forgotten at migration** makes a draft disappear. Mitigation: the dry run lists every destination cabled nowhere, with a one-click "Local use on this server".
- **Companion / OSC / scripts addressing channel numbers** (externals) are listed in the dry run and cannot be fixed by the server.

### Critical files for implementation

- /home/casparcg/highascg/src/config/routing-map.js (+ routing-map-mains.js, config-generator-channel-plan.js)
- /home/casparcg/highascg/src/cluster/cluster-fanout.js (cabledIds → destination-cabling.js; retirement)
- /home/casparcg/highascg/src/cluster/cluster-call.js and cluster-call-actions.js (counter transport, `dest.*`)
- /home/casparcg/highascg/src/api/routes-scene-take-look.js with src/cluster/look-relay.js and src/engine/take-sync-barrier.js
- /home/casparcg/highascg/src/system/operator-first-plan.js and src/config/channel-remap.js (the plan-change remap pattern)
- Also: /home/casparcg/highascg/src/system/video-feed.js, /home/casparcg/highascg/godot/client/video/video_surfaces.gd, /home/casparcg/highascg/src/replication/project-media-refs.js, /home/casparcg/highascg/tools/e2e/virtual-boxes.js
