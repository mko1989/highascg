# WO-593 — Port the operator client to Godot, built around Caspar channels in shared memory (EPIC)

**Area:** godot-client
**Status: IN PROGRESS (2026-10-21) — phases 0–5 built and box-verified: the Godot client runs on the shop box over the Caspar `shm` consumer and does everything the web operator client does (per-area parity in WO-600…608, owner ticks in `work/checklist20.10.26_owner_checks.md`); WO-595's GO was taken in practice (the owner said to continue the port on the box, 17.10) without filling its M1–M12 table. Remaining: owner QA on real shows → [WO-609](./609_WO_godot_cutover_packaging_kiosk_decommission.md) (package + cut over + delete the kiosk); [WO-610](./deprecated/610_WO_godot_remote_native_client.md) deferred; [WO-615](./615_WO_previs_fixtures_gdtf_patch_dmx_out.md) GDTF lighting not started. See "Progress (2026-10-21)" at the end.**

## 0. Owner request and decision trail

- 16.10: "list here Best options for native client for Ubuntu port instead of the kiosk ui." →
  options written in `client_ideas.md` (repo root, untracked).
- 16.10: "I'm not opposed a full rewrite but it'd need to a perfect choice … I think keeping the
  operator screen consumer is a good idea but I'd like the client to be built around it not on top
  of it." → architecture: **Caspar channel frames in shared memory, drawn inside the client's own
  scene** (no X SHAPE holes).
- 16.10: "one frame of delay is totally acceptable and the whole approach seems the best."
- 17.10: "i like godot for the native 3d previz which i wanted to include in the future and this
  future might be now. i want to try porting the client to godot. do a very thorough investigation.
  write everything to work orders."

**Prior art, and what changed since:** `work/NATIVE_GUI_PROPOSITIONS.md` (2026-07-20) recommended
staying on the web UI; the only real native argument it found was self-shaping the holes ("worth
about a month"), and it ruled Flutter-style "own every pixel" toolkits out because "another
process's video must show through my window". Electron was ruled out by the owner then
("electron is a no go for me", todos19.07.26). Two things changed: (1) **shared memory removes the
hole mechanism entirely** — video becomes a texture inside the client, so "own every pixel" is now an
advantage, not a blocker; (2) **native 3D previs is now a goal**, and Godot is a 3D engine.
`work/NODEGUI_PORT_INVESTIGATION.md`, `work/CASPAR_OUTPUT_TO_BROWSER.md`,
`work/LOCALHOST_CHANNEL_VIEW.md` remain valid background (the NVENC `/ws/gui-stream` they led to is
reused for remote clients, WO-610).

## 1. Investigation summary (measured 2026-10-17, tree = `origin/main` d5521d50)

Detailed per-area inventories (Haiku-generated, load-bearing claims re-checked by hand) live in
[`work/godot-port/inventory/`](../godot-port/inventory/); desk checks in [`work/godot-port/desk-checks/`](../godot-port/desk-checks/).

### 1.1 The client to port

| Measure | Value |
|---------|-------|
| Tracked client JS+CSS (`components/`, `lib/`, `styles/`, `app.js`) | **106,278 LOC** (`git ls-files … \| xargs cat \| wc -l`) |
| — components | 262 files, 58,925 LOC |
| — lib | 244 files, 33,658 LOC |
| — CSS | 65 files, 14,192 LOC |
| Growth since July (81,195 JS LOC) | ~+11 k JS |
| Distinct `/api/…` paths referenced by the client | **216** (router registers 256) |
| Server WS broadcast types | **26** (`change` at 35 call sites); client→server types: `scene_deck_sync`, `catalog_request|subscribe`, `device_view_subscribe` |
| Untracked stale leftovers under `client/` (pre-sync working tree) | 15 files, ~1.7 k LOC (excluded from the numbers above) |

Per area (inventories): live core **27,251 JS + 4,772 CSS** ([WO-600](./600_WO_godot_port_live_core.md)) ·
device view **16,600 + 1,902** ([WO-605](./605_WO_godot_port_device_view.md)) · timeline/audio/media/secondary
**19,021 + 5,015** ([WO-602](./602_WO_godot_port_timeline.md)/[603](./603_WO_godot_port_media_and_playlists.md)/[604](./604_WO_godot_port_audio_mixer_meters.md)/[606](./606_WO_godot_port_secondary_panels.md)) ·
inspector **12,094 + 1,660** ([WO-601](./601_WO_godot_port_inspector.md)) · shell/settings/contract **17,448**
([WO-608](./608_WO_godot_port_shell_settings_web_surfaces.md)) · previs **4,916** ([WO-607](./607_WO_godot_previs_native_3d.md)).
(Area totals overlap slightly on shared CSS and include a few untracked files.)

**Not ported at all:** the hole-reporting machinery (`operator-gui-mode*`, 1,008 LOC + suppression
latches), map explorer (dev tool, 1,059), orphans (`sync-modal`, `publish-modal`,
`inspector-panel-routing`), WebRTC/WebCodecs local preview paths, Firefox workarounds.

### 1.2 Architectural facts that decide the plan

1. **The client owns the show document** — exported whole and pushed by `POST /api/project/autosave`
   with an optimistic `rev` (`client/app.js:164-200`), echoed to all clients as `project_sync`
   (`client/lib/app-ws-handlers.js:221-244`). Two editors (web + Godot) on one show → the project JSON
   must be byte-compatible and pinned by golden tests → [WO-598](./598_WO_client_contract_and_thin_client.md).
2. **The browser builds AMCP**: 12 files, `/api/raw` ×34 + batch routes; PRV push pipeline (2,104 LOC)
   and takes are assembled client-side, although the server can already take by look id
   (`src/api/routes-scene-take.js:84-90`). → move show logic to the server before porting it (WO-598 C).
3. **Client-local persistence** (`localStorage` scenes cache, previs tags/presets, hardware policy,
   GPU layout keys; IndexedDB catalog) is invisible to a native client → migrate to server (WO-598 D, WO-607 T1).
4. **Caspar already reads every frame back to CPU** (`image_mixer.cpp:104-106`, upstream `fe19ac0`) →
   a shm consumer is one memcpy, zero GPU work; but **the channel blocks on every consumer's
   future** (`output.cpp:171-189`) → the consumer must return immediately and drop on overload
   ([WO-594](./594_WO_caspar_shm_frame_consumer.md)).
5. **Firefox stays on the box** — WO-258 browser sources (`browser-source-session.js:187-189`) and
   "Open browser" (`system-hardware-gui.js:147-148`) spawn it. Only the kiosk goes: 21 files /
   3,799 LOC + 13 routes + ~17 smokes ([WO-609](./609_WO_godot_cutover_packaging_kiosk_decommission.md)).

### 1.3 Godot facts (desk + research)

- Every API the design needs exists — headless ClassDB probe on 4.6.3 (`desk-checks/check_api.gd`):
  `Texture2DRD`, `AtlasTexture`, `RenderingDevice.texture_update/texture_create_from_extension`,
  `DATA_FORMAT_B8G8R8A8_UNORM`, `GLTFDocument` (runtime), `FBXDocument`, `WebSocketPeer`,
  `HTTPRequest/HTTPClient`, `PacketPeerUDP`, `GraphEdit`, `Window.files_dropped`,
  `DisplayServer.screen_*`, `file_dialog_show`. No built-in shared memory → GDExtension ([WO-596](./596_WO_godot_hshm_gdextension.md)).
- GDScript-only frame read (dev Mac i5): 1080p 1.46 ms, 3072×1728 7.77 ms (`desk-checks/bench_read.gd`).
- Latest stable **4.7.2**, godot-cpp **10.0.0-stable** (✔ git ls-remote). Research with sources:
  [`godot-ecosystem-research.md`](../godot-port/inventory/godot-ecosystem-research.md).

### 1.4 The box (from `work/LOCALHOST_CHANNEL_VIEW.md`, measured 2026-07)

i7-14700KF (28 threads), RTX PRO 4000 Blackwell, driver 595.71.05, X11/Openbox, no compositor.
ch5 operator GUI 1920×1080@50p; ch1 PGM 3072×1728@50p; ch3 PGM2 1080p50 (DeckLink).

## 2. Target architecture

```
CasparCG (highascg-build-v1 + shm module, WO-594)
  ch5 operator channel ──shm──► /dev/shm/highascg-opgui  (always on; atlas of preview tiles, WO-597)
  ch1/ch2/ch3 …        ──shm──► /dev/shm/highascg-pgm1 …  (lazily, while previs/fullscreen views need them)
HighAsCG server (Node, unchanged role) — HTTP + WS contract (WO-598), video-surface leases + atlas allocator (WO-597)
Godot operator client (WO-599), systemd user unit on :0, X11, Forward+/Mobile
  hshm GDExtension (WO-596) → one Texture2DRD per surface → AtlasTexture tiles in 2D UI, materials in 3D previs
  UI drawn OVER video natively (labels, tally, guides, handles) — no holes, no xdotool, no top-assert
Web client (stays): remote browsers + fallback (WO-608 D1); same contract, same project JSON
```

## 3. Child work orders and order of execution

| Phase | WO | Title | Gate / exit |
|-------|----|-------|-------------|
| 0 | [595](./deprecated/595_WO_godot_m0_spike_on_box.md) | M0 spike on the box (step 0 needs no Caspar change) | **GO / NO-GO** (M1–M12) |
| 0 | [594](./594_WO_caspar_shm_frame_consumer.md) | Caspar `shm` frame consumer | live acceptance table |
| 0 | [611](./611_WO_web_client_bugs_found_in_godot_inventory.md) | Web-client bugs found in the inventory | independent |
| 1 | [599](./599_WO_godot_client_foundation.md) | Godot foundation (engine pin, net, state, windows, theme, CI) | boots on box, mirrors state |
| 1 | [596](./596_WO_godot_hshm_gdextension.md) | `hshm` GDExtension | upload budget met |
| 1 | [597](./597_WO_server_video_surfaces_shm_and_atlas.md) | Server video surfaces, shm config, atlas | canvas mode live |
| 2 | [598](./598_WO_client_contract_and_thin_client.md) | Contract + golden tests + thin client | prerequisite for editing |
| 3 | [600](./600_WO_godot_port_live_core.md) | Live core (deck, PRV/PGM, take, compose, sources…) | owner operates a show read/write |
| 4 | [607](./607_WO_godot_previs_native_3d.md) | **Previs native 3D** (the reason for Godot) | PGM on LED mesh ≥ 50 fps |
| 5 | [601](./601_WO_godot_port_inspector.md) · [602](./602_WO_godot_port_timeline.md) · [603](./603_WO_godot_port_media_and_playlists.md) · [604](./604_WO_godot_port_audio_mixer_meters.md) · [605](./605_WO_godot_port_device_view.md) · [606](./606_WO_godot_port_secondary_panels.md) · [608](./608_WO_godot_port_shell_settings_web_surfaces.md) | Remaining areas (parallelisable) | per-area parity checklists |
| 6 | [609](./609_WO_godot_cutover_packaging_kiosk_decommission.md) | Package, cut over, delete the kiosk | ≥ 3 real shows without fallback |
| later | [610](./deprecated/610_WO_godot_remote_native_client.md) | Remote native client | deferred |

Rule for every phase: the kiosk remains the fallback (one destination toggle, `videoOutput`) until
WO-609 step 4. Nothing in phases 0–5 removes a working path from the operator.

## 4. Parity method

Each area WO gets `work/godot-port/parity/<area>.md`, generated from its inventory's "What the
operator can do" bullets (one checkbox each) — the owner ticks them on the box, following the
existing `work/checklist*.md` QA hand-off convention. Pure modules port 1:1 with their JS tests
reproduced in gdUnit4 (same inputs, same expected numbers).

## 5. Effort (honest range)

- The July calibration (one experienced developer, 2–3 k LOC/week, canvas/WebGL at half rate)
  gave 40–65 person-weeks for a Qt/QML rewrite of 81 k LOC. Today's ~92 k JS, minus not-ported
  (~3 k) and server-moved logic (WO-598, est. 3–5 k), lands in the **same 40–60 person-week band**
  for unassisted work.
- This repo is developed agent-assisted at high velocity; that rate for a *rewrite* is unknown.
  **Re-estimate from measured throughput after WO-600 step 1** (read-only live view) — the first
  real data point. Until then, treat the band above as the planning number.
- Phase 0 is small: spike step 0 ≈ days; shm consumer ≈ 300–400 LOC C++ + probe + build.

## 6. Risk register (ranked)

| # | Risk | Severity | Mitigation (WO) |
|---|------|----------|-----------------|
| 1 | Two clients drift / corrupt one show (client-owned project JSON) | critical | golden round-trip tests in both languages; thin client (598) |
| 2 | Port scale outruns operator needs; long period with two half-UIs | high | phase gates; kiosk fallback until 609; previs early for value (607) |
| 3 | `texture_update` cost at 3072×1728@50 (CPU copies, 64 px tiles, render thread; #57147) | high | staging-buffer tuning; Plan B zero-copy Vulkan import; Plan C downscaled surface (596) |
| 4 | Pacing: 50 fps vs 60 Hz panels; mixed-refresh X11/NVIDIA stutter (#62821) | high | operator monitor at 50 Hz; max_fps pacing fallback (595 M8, 599) |
| 5 | Shm consumer on on-air channels (ADD/REMOVE hiccup) | high | never blocks (594 §3); add/remove only with grace + maintenance-window test (597) |
| 6 | Engine churn (4.6 EOL-ish, 4.8 due Q4) | medium | pin 4.7.x + templates; one planned upgrade per minor (599) |
| 7 | Blackwell + driver 595 untested by Godot community | medium | M8b smoke first (595) |
| 8 | UI paradigm gap (no CSS/DOM, non-virtual lists, manual HiDPI, experimental a11y) | medium | UI kit first (599 T5): VirtualTable, theme, scale manager |
| 9 | Networking gaps (no keep-alive pool, no streaming upload, 64 KB WS default) | medium | own Api/Ws services (599); local-path ingest on box (603) |
| 10 | Syncthing peers fighting over `godot/.godot/` cache | medium | `.gitignore` + `.stignore` on box and Mac before the project exists (599 T1) |
| 11 | Remote video in Godot (Theora only; FFmpeg addons immature, licensing) | low now | web client covers remote; 610 deferred |
| 12 | Wayland in the future (no window placement) | low now | stay X11 |

## 7. What dies, what stays

Dies at cutover: Firefox kiosk launch/placement/scale, X SHAPE overlay (python-xlib), helper-window
taskbar/top-assert machinery, 13 kiosk routes, ~17 smokes, `python3-xlib` in CI/setup.
Stays: Firefox (browser sources, Open browser, CG Studio window), the web client (remote), the
operator Caspar channel (now as an atlas surface), `/ws/gui-stream` (remote), every server route
the client uses.

## 8. Owner decisions — ANSWERED 17.10.2026

Owner, 17.10: "ive got no box to run tests now. so i want you to create the trial here and then i
will move it to the box once i have it / id like the webclient to stay as is for remote work. if
godot works we will deprecate the kiosk client. / cg studio whatever, can be seperate browser. / i
didnt know takes werent on server. of course we have to move them. / basically thats the best
practise to run everything in the same refresh rate. so when the project is 50fps all outputs
should be 50fps and similarly for 60fps. / language, whatever is recommanded. / 15 stale, delete them"

| # | Decision | Recorded in |
|---|----------|-------------|
| 1 | **Trial built on the dev Mac now**, moved to the box later (no box available) | WO-595 (Mac results), WO-594 |
| 2 | **Web client stays as is** for remote work; **kiosk client deprecated if Godot works** | WO-608 D1, WO-609 |
| 3 | **CG Studio = separate browser** | WO-608 D2 |
| 4 | **Takes (and show logic) move to the server** — approved | WO-598 C |
| 5 | **All outputs run at the project rate** (50 fps project ⇒ every output incl. the operator monitor at 50 Hz; 60 ⇒ 60) | WO-599, WO-595 M8 |
| 6 | **Language: recommended** = typed GDScript (app) + C++ godot-cpp 10 (hshm) | WO-599, WO-596 |
| 7 | **15 stale untracked client files deleted** 17.10 (copies on `backup/local-wip-2026-10-16`) | WO-611 |

Original list (kept for history):

1. **Go/no-go after WO-595** (and permission to run it on the box outside show hours; ch1/ch3 shm only
   in a maintenance window).
2. **Web client policy** (WO-608 D1): recommended = stays for remote + fixes; new operator features
   land in Godot first.
3. **CG Studio** (WO-608 D2): recommended = own Firefox window launched from the Godot client.
4. **Thin-client refactor** (WO-598 C): takes/PRV push by id on the server — changes web-client
   internals (behaviour must stay identical; owner QA on PRV/take).
5. **Operator monitor at 50 Hz** (WO-599/595 M8) if pacing at 60 Hz judders.
6. **Language**: typed GDScript for the app + C++ (godot-cpp 10) for `hshm` — recommended; C# possible
   but adds .NET to the ISO.
7. **Untracked stale files** under `client/` (WO-611): delete or commit (copy is on
   `backup/local-wip-2026-10-16`).

## What was done

Investigation only (2026-10-17): inventories, desk probes, research, 19 work orders (593–611),
`work/godot-port/` reference tree. No code, config or box changes.

## What was VERIFIED

- Godot API presence: headless ClassDB probe on 4.6.3 — 77 checks (35 classes, 34 methods,
  5 constants, 3 signals): 76 present, `SharedMemory` absent as expected (negative control).
- GDScript frame-read cost: benchmark on the dev Mac (300 reads per size).
- Versions: `4.7.2-stable`, godot-cpp `10.0.0-stable` (git ls-remote).
- Caspar consumer API / readback / channel-blocking: read in upstream source `fe19ac0` (not yet in `highascg-build-v1`).
- Hand re-checks of every inventory claim a WO relies on (marked ✔ in the child WOs); three
  inventory claims were corrected in the process (meter peak-hold, keyframe easing scope, orphan file).
- Nothing was run on the production box.

## Progress (2026-10-21)

| Phase | WO | State |
|-------|----|-------|
| 0 | 595 M0 spike | box numbers recorded under WO-599 "Box run" (canvas 49.3 fps, previs 3072×1728 45.7 fps); GO taken in practice, M1–M12 table not filled |
| 0 | 594 shm consumer | built into Caspar v2.5.1 (`highascg-build-v2`), running on the box; CPU +5.2 % of a core vs < 3 % target; 1 h soak open |
| 0 | 611 web bugs | #1–#9 fixed |
| 1 | 599 foundation | done except the native monitor picker (placement + HiDPI 21.10) |
| 1 | 596 hshm GDExtension | Linux build in use on the box (`addons/hshm`), CI runs the seqlock + bridge tests; the `.so` is built locally (no CI build) |
| 1 | 597 video surfaces + atlas | done pending owner check (atlas 21.10) |
| 2 | 598 contract | done for the Godot client; the web client's switch to take-by-id / PRV push is owner QA |
| 3 | 600 live core | done pending owner ticks (atlas step 4, 21.10) |
| 4 | 607 previs | done (T7 pop-out deferred, T8 parked); 612 MVR import, 614 stage builder, 616 tracking done |
| 5 | 601–606, 608 | built and box-verified slice by slice; owner ticks open |
| 6 | 609 cutover | not started — gated on ≥ 3 real shows on the native client |
| — | 621–632 | the owner's next.md rounds 1–4, the dock, LED test card, PSN out, Art-Net read-through: done |

