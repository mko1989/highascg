# 05 - Remote Godot client (Mac / Windows) driving one or two boxes

Read-only research, 10.11.2026. Paths are under /home/casparcg/highascg. Live probes: only GET /api/auth/status,
GET /api/cluster, `ss -ltn`, `gh release list/view`. Nothing run on a Mac/Windows machine: every "works" below is
"the code and the WO say so", not "I saw it".

## 0. One-paragraph answer

A Mac/Windows Godot client can be pointed at one box today (build it, `--server=http://<ip>:4200` or the A/B host menu),
gets pictures through the JPEG WebSocket feed, and drives everything that is plain HTTP/WS. Against two linked boxes it
connects to ONE node (RULES.md rule 2). Through the master it drives the second box's screens only via the master's AMCP
fan-out (no picture of the second box's real outputs), and edits the second box's Devices setup through the relay. There
is no client-side switching between "box 1 / box 2" except the two-slot A/B host profile (a restart, built as hot
backup). The prebuilt Windows/macOS clients in the newest GitHub releases are from 26.10, i.e. BEFORE WO-802/WO-811.
Nothing in the repo has ever run the Windows/macOS builds (WO-686: "nothing to run them on here").

## 1. Getting the client

- Presets: `godot/client/export_presets.cfg` - Linux x86_64 (line 3), Windows x86_64 (33), macOS universal (68),
  macOS Intel (104), Web (140, demo only). All exclude `tests/*, e2e/*, addons/hshm/*` (line 11).
- Script: `godot/export-client.sh` (needs export templates for the pinned Godot `godot/GODOT_VERSION`,
  `--fetch-templates` downloads ~1 GB). Output `godot/export/<platform>/`. On the box right now: windows .exe dated
  22.10, macos zip 22.10, macos-intel 29.10 (stale vs. source).
- Release assets: `tools/release/make-github-release-server.sh:208-215,276-290` exports and attaches
  `highascg-operator_<stamp>_{windows-x86_64.zip, macos-universal.zip, linux-x86_64.tar.gz}` ONLY in the manual
  `npm run release:github-server` (unless `--no-godot-clients`). The CI auto prereleases (ci.yml:130-134) carry the
  server tarball only. `gh release view` over the 40 newest: operator assets exist on 2026-10-26_044709,
  2026-10-24_174730, client_2026-10-22_221506, 2026-10-22_214247. The 10.11 releases (e.g. 2026-11-10_095041) have none.
  => the newest downloadable Windows/Mac client predates WO-802 (no stale-origin cleanup), WO-811 (password prompt),
  and WO-1029-era cluster UI. A current client has to be exported from the tree (`godot/export-client.sh`) and copied
  over; or run the Godot project from source on the Mac with the pinned Godot (not verified).
- Not signed: Windows SmartScreen "More info > Run anyway"; macOS ad-hoc signed, not notarized, right-click > Open
  or `xattr -cr` (export-client.sh header, WO-686).
- hshm GDExtension: `godot/extensions/hshm/hshm.gdextension` lists linux x86_64 and macOS x86_64+arm64 only (no
  windows); the binaries are built per machine and not committed (only a linux debug .so is in `bin/`). The export
  excludes `addons/hshm/*` anyway. Without it: `video/shm_native.gd` loads through ClassDB and falls back; off-box
  the JPEG feed is used regardless (`video/video_surfaces.gd:38,85`). Consequence: a remote client never has the
  native zero-copy path and decodes JPEG on the main thread (~3 ms per 960 px frame, WO-670 "Not done in P1").
  The shm_out sink (`libhshm_sink`, Visuals tab) is unavailable on Win/Mac (see 4).
- Platform fixes already in (WO-686): `core/platform.gd` (home dir via USERPROFILE, downloads dir), Cmd instead of
  Ctrl on macOS in previs/tracking, box-only start-up gated on a loopback origin.

## 2. Connecting

Precedence (`godot/client/core/config.gd:62-65, 137-148`): `-- --server=http://host:4200` > env `HIGHASCG_SERVER` >
active A/B profile in `user://ui.cfg [connection]` > `http://127.0.0.1:4200`.
- Profiles: `core/connection_profiles_model.gd` (host_a, host_b, active). Bare host gets `http://` + `:4200` (line 21-27).
  UI: right-click the connection eye (top right, `app/connection_eye.gd:56`) > "A/B hosts..." (`app/connection_menu.gd`)
  or "Connect to <other>". A switch saves the profile and RESTARTS the client (`OS.create_process`, connection_menu.gd:93).
  `HIGHASCG_SERVER` set in the environment silently beats the profile (menu warns, connection_menu.gd:77-80).
- Port 4200, plain `http://` + `ws://`. `ws_url_for` (config.gd:151) maps https>wss, so an https origin works if a
  reverse proxy terminates TLS (Caddy / Tailscale Serve, docs/SECURITY.md "TLS / reverse proxy"); the node has no TLS
  of its own and the :4443 proxy was removed (WO-822).
- Discovery: NONE in the client (grep for mdns/avahi/UDP/broadcast in godot/client: no hits). The operator types an
  IP/hostname. Whether `highascgNNNN.local` resolves from Windows (needs Bonjour) or macOS: not confirmed from code.
- Header: `app/header_project.gd:49-62` - label "local" (muted) when the origin host is 127.0.0.1/localhost/::1, amber
  "on <host>" otherwise (`core/platform.gd:8-20`), tooltip "connected to the server at <origin>: this show is that
  server's". It names the host only; it never says master/follower/linked. (A remote client on a Mac always shows
  amber "on 192.168.x.y" - by design, not a warning.)
- First start on a Mac/Windows box: default origin is 127.0.0.1 -> nothing answers; client sits disconnected until
  the eye menu or `--server` is used (WO-686 "First start points at 127.0.0.1").
  CLI on macOS: `open -a "HighAsCG Operator" --args -- --server=http://IP:4200` or env var (not tested by me).

## 3. Auth

Server (`src/server/auth.js`): ONE shared password/token for the whole install. `security.enforceAuth` (config) decides
(`:35-40`); live state now: `GET /api/auth/status` = `{"enforceAuth":false,"hasToken":true}` => ENFORCEMENT IS OFF on
this box: every route and the WS are open to anyone who can reach :4200 (bind 0.0.0.0, `ss`: 0.0.0.0:4200). The server
has NO notion of "local vs remote" for the API gate: either everyone needs the password or nobody does (no loopback
trust, deliberately - WO-811 option D rejected). Open even with enforcement on (`isPublicApiPath`, auth.js:134-143 /
now :138-146): GET /api/auth/status, POST /api/auth/login|logout, GET /api/ping, POST /api/cluster/call and
/api/cluster/hello (ed25519-signed by linked servers). Static pages (`dist-web`, /templates) are not gated.
Transport: `Authorization: Bearer`, cookie `highascg_session`, or `?token=` (auth.js:113-132; `checkWebSocketAuth`
:~223 for /api/ws, /ws, /api/video-feed).

Client (`core/auth_model.gd`, `core/auth_prompt.gd`, `core/config.gd:98-133`): sends `Authorization: Bearer <pw>` on
every HTTP request, WS handshake (`core/ws.gd:90`) and the video feed (`video/video_feed.gd:74`), uploads and
downloads. On a 401: dialog "Server password" (first ask once per server, cancel quiets it 60 s), then the password is
stored PLAINTEXT in `user://ui.cfg [auth] passwords = {origin: pw}` per origin. On the box the client reads the
node's `.private/api-token` itself (`adopt_local_password`, loopback only). Pairing/tokens-per-device: not built; a lost
laptop = rotate the one password (WO-811 section 2).
- Status: WO-811 "IN PROGRESS"; the remote-Godot password prompt is explicitly listed as NOT exercised under real
  enforcement (WO-811 "Is enforcement proven for every client?"). Enforcement was tested on this box for ~4 min and
  reverted. Two-box under enforcement: linked-server calls send the node's own password (`outboundAuthHeaders`,
  cluster-relay.js:60) so both boxes need the SAME password; never run with two boxes + enforcement ON.
- Local-only actions (refused to a remote client): OS-password terminal and gui-launch (`checkBoxLocalRequest`,
  `src/api/box-local-request.js`, used in `system-hardware-gui.js:222`; Godot hides the button off-box,
  `features/settings/os_password_model.gd:24`) and local-path media ingest (`routes-media-ingest-local.js:41`, 403;
  Godot falls back to HTTP upload, `features/live/media_ingest.gd` upload_plan).
- Nuclear password (reboot/update etc.) is separate and, with `nuclearRequirePassword:false` on the box, those actions
  are open to any LAN caller today (WO-811 1.2).

## 4. Pictures

Mechanism (WO-670 P1): `ws://<box>:4200/api/video-feed?width=960&fps=15` (`src/system/video-feed.js`,
`video/video_feed.gd`). Same port and same auth/origin check as /api/ws. Client sends text `{"roles":["opgui","pgm1"]}`
(the set it holds now); server sends binary `[u8 n][role][JPEG]`. It is selected automatically when the origin is not
loopback (`VideoFeed.wanted`, video_feed.gd:117-120); `--video=feed|shm`, `--video-width=`, `--video-fps=` override.
The client still POSTs `/api/video-surfaces/lease` every 5 s for runtime roles (video_surfaces.gd:140), so channels
are added/removed on the box exactly as for an on-box client.
- Limits: width clamp 160..1920, fps 1..30, JPEG q 2..20, default 960 / 15 / q5 (`video-feed-encoder.js:feedParams`).
  Slow client (>= 2 MB unsent) skips frames (video-feed.js MAX_BUFFERED). Newest frame per role only; client decode on
  the main thread.
- Box cost: one worker thread + one long-lived ffmpeg (raw BGRA from /dev/shm -> scale -> MJPEG, `-threads 1`) per
  wanted role, only while some client holds the role; a role several clients want is encoded once at the max asked.
  Role names map to `/dev/shm/highascg-<role>` on the NODE'S machine - only the box the client is connected to.
- Bandwidth: measured in WO-670 on `opgui`: 960x540, 15.3 fps, ~12 KB/frame = ~1.5 Mbit/s per role. Busy video will be
  larger (I have not measured it); at q5/960 expect a few Mbit/s per role - an estimate, label it as such. PGM + PRV +
  multiview = 3 roles.
- Which pictures: any shm role (pgm1, prv1, in1.., ch.., opgui, multiview) - what the Live view, Devices thumbnails,
  previs inputs hold. Compose preview JPEGs, Companion button previews and mesh/media downloads are plain HTTP.
- Meters / state: `osc` WS snapshots (~25 Hz, ws-server.js:203, `features/live/osc_mirror.gd`) come over the normal WS, so
  audio meters and layer state work remotely (no UDP on the client).
Degraded or impossible when not on the box (silent unless noted):
 1. Native zero-copy shm path, hshm: gone -> JPEG, lower res/fps, small latency (~130 ms first frame measured on LAN).
 2. Picture quality is JPEG-downscaled <= 1920 px wide, <= 30 fps - not a frame-accurate monitor.
 3. Visuals tab output into Caspar (`features/visuals/visuals_tab.gd:23,129,384-389` + `features/shm_out/viewport_publisher.gd`)
    writes `/dev/shm/highascg-<ring>` on the CLIENT machine and needs `libhshm_sink`: a Mac/Windows client cannot feed the
    box (the pane says "libhshm_sink is not loaded"). Retro/game launcher (`features/visuals/game_launcher.gd:104,136`,
    /proc and /dev/shm, spawns its own Godot) the same. NOT POSSIBLE remotely, needs building (e.g. a network sink).
 4. Operator dock (`app/operator_dock_model.gd:23`), start-up launcher/boot questions (`app/boot_question.gd`), the box
    operator-monitor placement and tab undock-on-box (`app/main.gd:460`, `app/screen_follow.gd:49`, `app/shell.gd:119`):
    switched off off-box on purpose.
 5. MIDI out uses `amidi` via OS.execute (`features/midi/midi_out.gd:50`): Linux-only; MIDI in uses
    `OS.open_midi_inputs` (works per platform, but the devices are the client's own).
 6. `app/perf_overlay.gd` reads /proc/self: empty on Win/Mac (client rows blank; box rows from /api/host-stats work).
 7. Hard-coded `http://127.0.0.1:4200/template/` (`features/devices/live_input_model.gd:19`,
    `host_live_controls.gd:10,78`) is a Caspar-side URL (Caspar is on the box), so correct; but Companion host default
    "127.0.0.1" (`settings_panes.gd:135`) and the media-path hint (`:154`) show box-local values.
 8. File dialogs act on the client machine: project save/load to file, media "download to this computer", "Add media
    files" (uploads over HTTP, big HAP files go through `core/stream_upload.gd`). Works, but a file picked on the Mac is
    NOT a path the box can read.
 9. 3D previs / stage: meshes, MVR, GDTF models are fetched over HTTP (`Api.get_bytes`) - works, heavier first load.
    Tracking camera views / person overlays ride the same video roles or HTTP: not verified remotely.
10. Windows `$HOME` handled (platform.gd); the WO-686 list of "Owner QA" (pictures, font/icons, upload, Cmd+D) was
    never done on a real Windows/macOS machine.

## 5. Other localhost assumptions (server side)

Server routes that check the peer address: only (a) `routes-media-ingest-local.js:19,41` (403 for non-loopback),
(b) `box-local-request.js` for gui-launch / OS-password (`system-hardware-gui.js:222`), (c) `template-credential.js`
(template key only to Caspar's host), (d) `cluster-media.js:32-42` ssh-key accept (from the linked server's IP),
(e) replication pair token. Nothing refuses a remote client's normal API use. CORS: `*` while enforcement is off; a
Godot client sends no Origin so `isOriginAllowed` passes (auth.js:~277).
Client-side localhost uses are listed in section 4 (items 3-7); the `127.0.0.1`/`/dev/shm`/`/proc` grep of
`godot/client` (excluding tests/e2e/demo) is exactly: perf_overlay, midi_out, game_launcher, game.gd,
viewport_publisher, video_surfaces `segment_path`, live_input_model/host_live_controls template URLs, settings_panes
defaults, config DEFAULT_ORIGIN, platform.gd.

## 6. Two boxes (current main, 10.11)

Live: this box 7579 is master (epoch 11), fan-out active to 5867 (`GET /api/cluster`), fan-out connects straight to the
peer's Caspar `192.168.0.10:5250` (cluster-fanout.js; against the stated node-only rule, WO-1029 "Gaps").

Connected to the MASTER node (the remote client's node = master):
- Takes on destinations cabled on the other box: WORKS via the master's AMCP fan-out (WO-670 P4a/b, cluster-fanout.js
  channelPlan: master channel -> peer channel; catch-up journal). Restrictions: only main-bus destinations
  (cluster-fanout.js:37), held when the two Caspars' running channel sizes differ (remote-destination.js), only while the
  peer's Caspar connection is up (lines dropped otherwise, report B/F5), PRV takes can overwrite the peer operator's preview
  (1029 review B8), new master's catch-up replays its own copy channel onto a peer's screen (1029 "Found in this run" 2).
- Pictures of the other box: NOT AVAILABLE as its real output. The master plays the same take on its OWN channel for a
  destination cabled on the peer (remote-destination.js header: "the master plays takes on its own channel for it and the
  fan-out translates"), so the client sees the master's mirror channel (a model of what was sent, not the peer's output,
  not DeckLink/GPU truth). `/api/video-feed` reads only the connected node's /dev/shm and is not relayed
  (cluster-relay.js REFUSED list covers /api/ws and /api/system only; video-feed is a separate WS path, not under the
  relay; `src/cluster/` has no picture code - grep). Whether a mirror channel really exists for each peer-only
  destination depends on the Apply layout: not confirmed here.
- Devices of the second box: "Edit" on its card in Devices > Servers (cluster_panel.gd:197) sets DevicesTarget.editing;
  the Devices tab's Api calls go GET|POST|DELETE `/api/cluster/peers/:id/relay/<path>` (core/api.gd:54,
  cluster-relay.js). Allowed: any /api/ path except /api/system/*, /api/ws, relay-of-relay; 14 s timeout (110 s for
  Caspar applies); body <= 8 MB; one hop. Polled every 3 s (no WS from the peer). Works for rear panel, cables,
  destinations, Apply, and the Devices stream/record/vcam controls (output_port_controls.gd:93,274 use `DevicesTarget.api`).
  NOT through the relay: the Live tab, header badges (header_badges.gd:40 uses plain `Api`, i.e. always the connected
  node's stream/record state), media browser, timeline, video. So stream/record state in the header is the master's
  only; the second box's stream/record is driven from its Devices page (Edit) and not shown in the header.
- Media of the second box: no media list/browser for it in the Live tab; Devices "Send media" (rsync over ssh, node
  to node, cluster-media.js; cluster card "media_parity" shown, live: `differs`). Relay could GET its /api/media but no
  UI does.
- Per-server controls: node-level duties/senders (tracking, lighting, ptz) follow the master (server-senders.js,
  1029 S5); power/updates of the other box are refused by design (relay + RULES: "a client never shuts down or updates
  another machine").
- Show: one shared show, master's (WO-746); follower edits go to the master (cluster card note).

Connected to the FOLLOWER node:
- PGM channels of the follower are blocked for local AMCP when it sees the master (D1/G0), answered 409 AIR_HELD only for
  channels the master forwards to it (P1c). Program takes on a destination go to the master (R1 `look.take` relayed,
  routes-scene-take-look.js:59-68) and the answer is the master's. A destination cabled ONLY on the follower and
  forwarded by the master gets 409 (1029 "Found in this run" 1) - i.e. the client cannot drive the follower's own LED
  wall from the follower today; that is the owner's rule-2 gap, phase 2, not built.
- Pictures: its own shm only (its PGM/PRV/inputs); same JPEG feed. Edit of the master's setup is possible through the
  follower's relay (the follower lists the master as a peer).
- Header says "on <host>" only. No master/follower mark in the header; the Servers card has the master line and
  follow note (cluster_model.gd).

Switching box from one client:
- Only the A/B profile slots (two origins) via the connection eye > restart. No "box list", no hot-switch without
  restart, no remembered cluster (WO-802 deliberately erased ui.cfg [cluster] on start, config.gd:67-77), the client
  never follows a master change or failover.
- A client can run on two boxes at once only as two separate client processes (two origins, two ui.cfg passwords
  keyed by origin); on a Mac that needs a second user data dir/launch, not documented.

## 7. Network

- TCP 4200 on each box that the client connects to (HTTP API, `/api/ws`, `/api/video-feed`, media upload/download,
  static `/template`, `/login`). Nothing else from the client: no UDP, no OSC, no :5250 (the client never speaks AMCP;
  and the repo rule is never to hit 5250 from tools), no SSH. `ss` on this box: 4200 listens on 0.0.0.0; also open
  on the box but NOT needed by the Godot client: 5250 (Caspar AMCP, used box-to-box by the fan-out), 8000/16622 Companion,
  22000/21027 Syncthing, 22 ssh.
- Box-to-box (for two boxes): :4200 both ways (signed cluster calls, hello, device-view), master -> peer :5250 (AMCP
  fan-out), ssh/rsync for "Send media", clocks within 60 s (cluster-call MAX_SKEW_MS, 1029 left-open).
- Latency: control = HTTP/WS RTT (take on remote client is one POST); pictures 66 ms frame period at 15 fps plus
  encode/decode - a preview, not a monitor. Higher video-fps/width raise box CPU (ffmpeg per role).
- Tailscale: the box has tailscale0 (`ss` shows 100.101.245.97%tailscale0 listeners) and `routes-network-tailscale.js`;
  nothing in the client is tailscale-aware; using `--server=http://<100.x or magicdns>:4200` should work as any
  routable host (not tested). With no TLS and auth OFF, a tailnet/LAN client is fully trusted. A routed WAN/VPN
  path: plain HTTP + password in cleartext (put Tailscale Serve/Caddy in front, then `https://` origin).

## 8. Concrete steps

(a) ONE box
 1. Build or fetch the client. Newest released operator zip is from 26.10; for current code run on the box
    `godot/export-client.sh Windows macOS` (templates once: `--fetch-templates`) and copy
    `godot/export/windows/HighAsCG-Operator.exe` / `godot/export/macos/HighAsCG-Operator.zip` over (or run
    `npm run release:github-server` for a release with all three).
 2. Mac: unzip, right-click > Open (or `xattr -cr`). Windows: SmartScreen > More info > Run anyway.
 3. Start with `-- --server=http://<box-ip>:4200` (Windows: `HighAsCG-Operator.exe -- --server=http://IP:4200`; Mac:
    `open -a "HighAsCG Operator" --args -- --server=http://IP:4200`) or set env HIGHASCG_SERVER, or right-click the
    connection eye > A/B hosts > Host A = the box IP > Save > Reconnect.
 4. Header must read amber "on <ip>". If the box has enforceAuth ON a "Server password" dialog appears once; enter the
    shared password (today the box is open - no prompt).
 5. Allow the Mac/Windows firewall to reach TCP 4200 of the box; nothing inbound on the client.
 6. Check: Live PGM/PRV pictures arrive (JPEG), add a media file from the laptop (HTTP upload).
(b) TWO linked boxes (link made on the boxes: Devices > Servers > add by IP)
 1. Connect the client to the box that should be master (it will drive both). Header shows only that box.
 2. Takes on destinations cabled on box 2 are forwarded by the master; pictures of those destinations = master's mirror
    channel. Box 2 setup: Servers card > "Edit" (relay). Media for box 2: "Send media". To look at box 2's real pictures
    or Live tab, quit and reconnect the client to box 2 (A/B profile slot B = box 2, one restart).
 3. Do not turn auth ON on only one box; the shared password must match on both.
 4. If you connect to the follower instead, expect 409 AIR_HELD on its own screens (phase 2 not built).

### Works / degraded / not possible / needs building (client on Mac/Win, two boxes)

WORKS
- Connect to either box by IP; Live/Timeline/Devices/Settings/previs data over HTTP+WS; takes, mixers, looks,
  timeline on the connected node; media upload/download/project files via file dialogs; audio/layer meters (WS osc).
- From the MASTER: takes/media/mixer lines for destinations on box 2 through the fan-out (main-bus destinations only).
- Devices edit of box 2 through the relay (rear panel, cables, destinations, Apply, its stream/record/vcam controls).
- Header names the connected host; "Make master", link/unlink, Send media from the cluster card.
DEGRADED
- Pictures: JPEG <= 1920 w / 30 fps over WS (decode on main thread), no native shm; no picture of box 2's real outputs
  (only the master's mirror channel); header stream/record badges show the connected node only; Live tab does not
  list box 2's media; no remote audio monitoring; hostname resolution (.local) on Windows unconfirmed.
- Releases: Win/Mac builds only from manual releases (latest 26.10, stale); unsigned; never QA'd on real machines;
  password stored plaintext in ui.cfg; auth enforcement unproven for a remote Godot and breaks Companion/templates
  setups if turned on carelessly.
NOT POSSIBLE TODAY
- Visuals / Retro / game output (client-side shm ring) from Mac/Windows into Caspar; operator dock, OS-password, power,
  update of a box from the client (box-local by design); MIDI out (amidi) from Windows/Mac; local-path media ingest.
- Driving the follower's own screens from the follower (409), driving box 1's screens from box 2 "in a pinch" as a true
  independent peer (no peers kind; 1029 phase 2).
- Switching boxes without a client restart; two simultaneous box connections in one client (forbidden by RULES.md).
NEEDS BUILDING
- Picture of the other box through the master (relay/proxy of `/api/video-feed` for a peer, or a master-side route
  of the peer's output; WO-670's P1 note "also needed to show another server's outputs" was never done for peers).
- A relayed Live view of box 2 (media list, stream/record status in header, timeline) or a safe multi-profile
  switcher that does not restart; a "master/follower/linked" cue in the header ("on <host>" is all there is).
- Release pipeline: operator builds on every server release (or a manual-release reminder), Windows/Mac QA, notarization.
- Discovery (LAN/mdns or list from the cluster); per-device tokens/pairing; TLS built in.
- Network sink for Visuals/shm_out; destination ownership phase 2 (1029) so a follower box is driveable.

## Could not confirm from code
- Any run of the Windows .exe or macOS .app (none exists; WO-686 owner QA never recorded). .local resolution on Win.
- Real bandwidth of PGM at 960/15/q5 for busy content (only 12 KB/frame on opgui measured); box CPU per role.
- Whether a mirror (copy) channel for every peer-only destination exists on the master after Apply, and what the
  client shows in the Live view for it.
- Remote Godot under auth enforcement (WO-811 itself says not exercised).
- Tailscale path, tracking camera views remotely, Mac CLI invocation forms.
