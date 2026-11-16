# WO-1093 — Settings menu review: one place per setting, 17 panes → 7

**Area:** godot-client, audio, devices-config
**Status: IN PROGRESS**

Owner, 16.11: "we need a review of the whole settings menu. it got too big. also there are a couple of items buttons
that made sense only in webui. a tab like live audio seems redundant as all the audio settings are in devices and
audio tabs. id like to also weave the timecode settings somewhere in the audio tab or devices. basically try
compacting as much as possible without loosing important stuff"

Scope: the Godot client's Settings tab (`godot/client/features/settings/*`). The web UI's settings modal is not
changed. Rule of thumb (owner + standing box rule): what configures a device / output / input lives in **Devices**
(per-item controls in the device-view inspector), audio mixing / monitoring in the **Audio** tab, Settings keeps what is
global to the box / app and rarely touched. Timecode / LTC is **WO-1092**'s (it moves the LTC controls to the Audio
tab); this WO leaves the Timecode pane alone.

Related: WO-608 (Godot settings port), WO-619 (`newConfig` hand-list), WO-692 (Network pane, also on the Devices server
page), WO-799 (ALSA mixer docked in the Audio tab), WO-801 (headphone pair), WO-406 (monitor output), WO-571 / WO-862
(per-slot program routes), WO-645 (start-up), WO-646 (kiosk gone), WO-838 (lockscreen), WO-1066 (controllers),
WO-1092 (LTC UI).

## Investigation

### Before: 17 panes, ≈ 152 controls

Counted from the source and on glass (`before_*.png`, list at the end). Controls = things an operator can press,
type or pick; per-device rows (Bluetooth list, ALSA strips, Variables rows) not counted. The tab strip did not fit
1190 px: Lockscreen / Nuclear / About were only reachable through the scroll arrows (`before_00_current.png`).

| # | Pane | Controls |
|---|---|---|
| 1 | Defaults | 20 |
| 2 | Companion | 8 |
| 3 | Media / USB | 7 |
| 4 | Updates | 3 |
| 5 | System | 7 |
| 6 | Network | 20 (2 wired cards × 7 + Wi-Fi 6) |
| 7 | GDTF library | 4 |
| 8 | DeckLink | 5 |
| 9 | Diagnostics | 2 |
| 10 | Tailscale | 11 |
| 11 | Live audio | 13 + ALSA mixer 4 |
| 12 | Timecode | 15 (WO-1092) |
| 13 | Controllers | 3 |
| 14 | Variables | 6 |
| 15 | Lockscreen | 12 |
| 16 | Nuclear | 12 |
| 17 | About | 0 |

Target: ≤ 8 panes (7 + Timecode until WO-1092 takes it), nothing that is a duplicate of Devices / Audio, rarely used
blocks behind folds so no pane is longer than about one screen when opened.

### Inventory (pane → control → key / API → reader → duplicate? → last touched → verdict)

Last touched = last commit of the pane file. Readers grepped in `src/`, `scripts/`, `client/` (web) and the Godot
client.

**1. Defaults** (`settings_panes.gd defaults()`, c3bc1eab 30.10)

| Control | Sets | Read by | Duplicate? | Verdict |
|---|---|---|---|---|
| Coordinate origin | `editorDefaults.coordinateOrigin` | Godot look editor / timeline inspector, web | no | KEEP — Defaults |
| Loop media on new layers / Start playback / Content sizing (scene) | `editorDefaults.scene.*` | Godot + web drop-onto-look | no | KEEP — Defaults |
| Loop always / Content sizing (timeline) | `editorDefaults.timeline.*` | Godot + web timeline | no | KEEP — Defaults |
| Transition type / duration / tween | `editorDefaults.transition.*` | new looks, Take bar | no | KEEP — Defaults |
| Compose preview: source, fps, resolution, JPEG quality, Companion preview variables | `composePreview.*` | `src/preview/compose-preview-*.js` (web remote client + Companion thumbs; "this client shows its own previews") | no | MOVE → Companion pane, fold "Previews for the web client and Companion" (same keys, same autosave) |
| Note "Screen labels and the streaming channel are configured in the Devices tab" | — | — | — | REMOVE — a pointer note for a WO-270 move, no control |
| Invert touchpad scroll | `ui.invertTouchpadScroll` | `client/lib/wheel-delta.js` only (web); the Godot client never reads it | no | REMOVE-UI — web-only; the web settings modal keeps it, `POST /api/settings {ui}` |
| When the box starts | `startup.mode` | `scripts/setup/09-openbox-autostart.sh`, `src/system/boot-screen-assignment.js` | no | MOVE → System pane (box-global, not an editor default) |
| UI scale | `ui.cfg [window] scale` (this screen) | `app/window_placement.gd` | no | MOVE → This screen pane |
| Choose operator screen… | operator-GUI cabling (`app/operator_screen_picker.gd`) | Devices cabling | same result as cabling the operator GUI in Devices, but a different gesture | KEEP — This screen pane |
| Simulated server / Restart client / Reset demo | `ui.cfg [demo]` | `core/config.gd` | no | MOVE → This screen pane |

**2. Companion** (`settings_panes.gd companion()`)

| Control | Sets | Read by | Verdict |
|---|---|---|---|
| Check + status | `GET /api/companion/connection-status` | — | KEEP |
| Companion host / port | `companion.host/port` | `src/companion/companion-config.js` | KEEP |
| Satellite preview on, host, port, bitmap size, page picker grid | `companion.satellite*`, `previewBitmapSize`, `pickerGridSize` | `src/companion/satellite-preview-client.js`, `routes-companion-preview.js` | KEEP — behind fold "Button previews (Satellite)" |

**3. Media / USB** (`settings_panes.gd media()`) — `projectScopedMedia.*` (`src/media/project-media-*.js`),
`local_media_path` (`src/media/local-media-paths.js`, routing), `usbIngest.*` (`src/config/config-classify.js`, USB
ingest). 7 controls, no duplicate anywhere. KEEP all.

**4. Updates** (`updates_pane.gd`, c6f6e757 25.10) — build stamp, Refresh / Check now / Install latest release
(`/api/system/update/*`). KEEP, MERGE into System (first section, open).

**5. System** (`system_pane.gd`, d5ab0714 20.10)

| Control | Sets / calls | Verdict |
|---|---|---|
| Operator display line | `GET /api/system/operator-display` | MOVE → This screen, under "Choose operator screen…" (it is the answer to "which is the operator screen") |
| Open browser | `POST /api/system/gui-launch {action:firefox}` — Firefox on :0 | REMOVE-UI — kiosk-era: the Firefox kiosk had no other way to a browser (WO-646 removed it); the desktop has one. Route stays (web System tab still has the button) |
| Open file manager | `POST /api/system/gui-launch {action:file-manager}` | REMOVE-UI — same reason; route + web button stay |
| Refresh hardware | `GET /api/system/hardware` | KEEP — inside fold "Hardware" |
| NTP enabled / Date / Time / Set time | `POST /api/system/time` (nuclear gate) | KEEP — System, fold "System time" |
| Hardware summary | `GET /api/system/hardware` | KEEP — System, fold "Hardware" |

**6. Network** (`network_pane.gd`, b16d368f 24.10) — every NIC (DHCP / static / Apply), Wi-Fi on / scan / join /
disconnect. **Duplicate:** the Devices server page builds the very same `NetworkPane.new()`
(`features/devices/server_controls.gd:16,156`, WO-692 "Lives in Settings → Network and on the Devices server page").
Verdict: REMOVE-UI from Settings; Devices → server page (click the rear-panel background) keeps it unchanged.

**7. GDTF library** (`library_pane.gd`, 9bcff684 30.10) — Build / Download full / Delete / Stop
(`/api/fixtures/library/*`). Rare (once per box). KEEP — System, fold "GDTF fixture library".
(The GDTF Share account itself has no UI in Settings: `~/.highascg/gdtf-share.json`.)

**8. DeckLink** (`decklink_pane.gd`, 61b04621 03.11) — Refresh, Desktop Video Setup / Updater on :0, upload + install
driver (`/api/system/decklink*`, `gui-launch`). Box driver, rare. Devices has the DeckLink *ports* but not the driver / the
Blackmagic tools. KEEP — System, fold "DeckLink driver".

**9. Diagnostics** (`settings_panes.gd diagnostics()`) — Save support bundle (`/api/support/bundle`), Open server logs
(also on the connection eyes). MERGE → About ("About & support").

**10. Tailscale** (`tailscale_pane.gd`, f974e9a6 20.10) — service on, log in / on operator monitor / copy URL / log out
/ admin console, auto-login, operator assist, accept routes, hostname, Save preferences
(`/api/network/tailscale/*`). Remote access, box-global, rare. KEEP — System, fold "Remote access (Tailscale)".
"Open on operator monitor" kept: it is the only login path for a remote client that cannot open a browser itself.

**11. Live audio** (`live_audio_pane.gd`, 31077e9f 20.10) — the owner's suspicion holds, control by control:

| Control | Sets | Read by | Elsewhere? | Verdict |
|---|---|---|---|---|
| Status lines (channels, started / failed) | `GET /api/audio/live-inputs` | — | Devices → live-audio host channel inspector "Status" (`host_input_controls.gd:34-36`) | REMOVE (duplicate) |
| Slot N — capture device | `casparServer.live_audio_input_N_device` | `src/config/live-audio-input.js` | Devices → live-audio inspector "Capture device" (`host_input_controls.gd:37-38`) | REMOVE (duplicate) |
| Refresh devices | `GET /api/audio/devices?refresh=1` | — | same inspector "Refresh devices" | REMOVE (duplicate) |
| Route live inputs to program after connect | `casparServer.live_audio_pgm_always_on` | `routing-setup-live-inputs.js:106-112` (boot / reconnect re-route of the saved per-slot routes) | **nowhere** | MOVE → Devices live-audio inspector, fold "Program routes (all live audio inputs)" |
| Screen | `casparServer.live_audio_pgm_screen` | `live-audio-input.js:336` only when a slot has no `_pgm_channels` key and `live_audio_pgm_all_screens` is off — the per-slot Ch buttons in the Audio tab (WO-571) always write that key and a new slot is pinned to '' (WO-862); this box has `all_screens: true` | superseded by the Audio tab's per-strip Ch buttons | REMOVE-UI (legacy fallback); `casparServer.live_audio_pgm_screen` stays in config / API / web modal |
| First PGM layer | `casparServer.live_audio_pgm_layer` | `live-audio-input.js:341-353` (slot N → layer + N − 1) | nowhere | MOVE → same Devices fold |
| Audio only on PGM routes | `casparServer.live_audio_pgm_audio_only` | `live-input-route-reassert.js:55`, `routing-setup-live-inputs.js:116` | nowhere | MOVE → same Devices fold |
| Enable audio preview bus / Preview bus / Preview screen index / OpenAL device | `audio_preview_enabled/bus/screen/device_name` | `src/config/audio-preview.js`, `config-generator-audio-routing.js:76-87` (a `<system-audio>` on PRV / multiview) | the headphone bus today is the Devices audio output with the **Monitor** tick (WO-406, `vcam_audio_model.gd:202`) + the Audio tab SOLO / HP pair (WO-801) + the header headphones menu | REMOVE-UI (superseded); keys stay (web Live audio panel, `POST /api/settings`) |
| When solo cleared | `audio_preview_default_source` | `audio-preview.js:60-85` | header headphones menu picks PGM / PRV / Multiview live (`/api/audio/monitor-source`) | REMOVE-UI; key stays |
| Save config | `POST /api/audio/live-inputs/config` + apply | — | — | REMOVE (see the bug below) |
| Apply PLAY + PGM routes | `POST /api/audio/live-inputs/apply` | — | the Audio tab Ch buttons save + route; the Devices inspector Start re-plays one input (apply re-PLAYs every slot and glitches inputs on air, `routes-audio.js:418-419`) | REMOVE-UI; route stays |
| ALSA mixer (card, view, Refresh, Launch alsamixer, strips) | `/api/audio/alsa-mixer` | — | Audio tab, docked at the bottom (WO-799, `audio_tab.gd:63-64`) — the same `alsa_mixer_panel.gd` | REMOVE (duplicate) |

**Bug found (the pane never saved most of what it showed).** `_save()` posts `S.live_audio_body(ui)` — top-level keys
— to `POST /api/audio/live-inputs/config`, whose handler (`src/api/routes-audio.js:455-480`) copies only
`live_audio_input_count`, the slot devices, `_pgm_channels`, `live_audio_pgm_always_on` and the FFT source, plus a
nested `casparServer` object. Offline probe (`scratchpad/drop_probe.js`, the real handler with a fake ctx): posting the
pane's body with layer 5 / audio-only off / bus multiview / preview on saved `always_on: false` but kept
`layer: 2, audio_only: true, bus: preview_1, enabled: false`; the same key nested in `casparServer` saved (`layer 5`).
So in the Godot client PGM screen, first PGM layer, audio only and all five headphone controls snapped back after every
Save — nobody could have been using them there.

**12. Timecode** (`ltc_pane.gd`) — `ltc.*`. MOVE → Audio tab (**WO-1092**); left untouched here.

**13. Controllers** (`controllers_pane.gd`, 0c3a7a89 13.11, WO-1066) — Bluetooth scan / pair / connect / forget
(`/api/bluetooth/*`). Box-level pairing for the game window. KEEP — System, fold "Game controllers (Bluetooth)".

**14. Variables** (`variables_pane.gd`) — browse the Companion variables (`GET /api/variables` + WS), click copies
`$(highascg:key)`. A Companion tool. MERGE → Companion pane, fold "Variables".

**15. Lockscreen** (`lockscreen_pane.gd`, 0985adb9 31.10) — `ui.cfg [lockscreen]`, this screen only. MOVE → This screen
pane, fold "Lockscreen".

**16. Nuclear** (`nuclear_pane.gd` + `settings_panes.gd nuclear()`) — password (`ui.nuclearRequirePassword`,
`ui.nuclearPassword` set explicitly), restart window manager (nodm is the active display manager here), reboot,
shut down, change OS password, install to disk, stop / start / restart CasparCG. KEEP as is ("Settings → Nuclear" is
named by `app/nuclear_gate.gd`).

**17. About** (`about_model.gd`) — `GET /api/about`, AGPL §5(d) attribution: must stay reachable. KEEP, + support.

**Not in the Godot Settings at all (checked, nothing to move):** modules / games (Sources ▸ Games), streaming /
recording (Devices stream / record outputs, `stream_record_model.gd`), linked servers / hot backup (Devices server
page + cluster panel), tracking (Previs ▸ Tracking), Art-Net / sACN / PSN / DMX (Previs fixtures, lighting consoles in
Devices), operator tools (`operatorTools.cefEnableGpu` on the Devices server page; pointer confine has no Godot UI),
displays / NVIDIA (Devices GPU outputs), audio devices (Devices audio outputs), security (`security.*`, no Godot UI),
licences (About).

### Target layout

| Pane | What | Folded |
|---|---|---|
| Defaults | layer position, scene, timeline, default transition | — |
| Media / USB | unchanged | — |
| This screen | UI scale, operator screen (+ current operator display line), simulated server | Lockscreen |
| Companion | check, host, port | Button previews (Satellite) · Previews for the web client and Companion · Variables |
| System | updates (version, check, install), start-up | System time · Remote access (Tailscale) · Game controllers · DeckLink driver · GDTF fixture library · Hardware |
| Nuclear | unchanged | — |
| About | support bundle + server logs, attribution | — |
| (Timecode) | WO-1092 | — |

Moved out of Settings: **Devices → live-audio input inspector**, new fold "Program routes (all live audio inputs)":
re-route after a restart (`live_audio_pgm_always_on`), first program layer (`live_audio_pgm_layer`), audio only
(`live_audio_pgm_audio_only`) — saved with `POST /api/settings {casparServer: {key}}` (`casparServer` is in the
hand-listed `newConfig`, `settings-post.js:161,396`), no apply: changing them must not re-PLAY inputs on air.

## What was done

(in progress)

## What was verified

(in progress)
