# Checklist 20.10.26 — every check that needs YOU (owner)

Owner 20.10: "make an md file with a list of all the checks that need user interaction."

How to use it: tick a box, or write a word next to it ("ok", "no: …", "skip"), and tell the session. The row in
`OPEN_ISSUES.md` then flips. **Section 1 is the newest and the most precise** (Godot port, previs / tracking /
lighting, written by the session that built them). Sections 2–6 are carried over from older WOs: their wording comes
from the WO docs and was **not re-checked on the box this session**, so some may already be satisfied. Say "already
fine" and they close.

Not on this list: anything a session can do alone. The node server has been restarted many times since August, so
"restart highascg to make it live" items count as done. Their QA part, if any, is still listed.

## 1. Godot port, previs, tracking, lighting (WO-593 … WO-631)

### Decisions
- [ ] **WO-593 / WO-609** — the Godot client has run on this box since WO-599 (box acceptance passed). Record **GO**
      for the port, and say when the web kiosk may be retired. Until then both clients stay.
- [ ] **WO-619** — should a Settings save also persist the editor Defaults tab, or only explicit Defaults saves?

### Look and feel (Godot client on the box)
- [ ] **WO-608** — header: Save / Load / Load from file / New project / rename / FTB. These were deliberately not
      pressed on the box (they change your show). Try each once on a scratch project.
- [ ] **WO-608** — Settings → Nuclear: WM restart, reboot, shut down, Install to disk, Caspar stop / restart were not
      pressed (only Start on a running Caspar + the password prompt). Try each once when a break is OK; Updates →
      Install also not pressed (dev box runs from git).
- [ ] **WO-608** — Settings → Tailscale: only viewed (and Cancel on "turn off"). Log out / log in / operator-monitor
      login / Save preferences / Admin console not pressed — try when losing remote access briefly is OK.
- [ ] **WO-608** — Settings → System / DeckLink: NTP toggle, a real Set time, Desktop Video Updater, driver Upload and
      Install driver were not pressed. Also say if System time belongs below the hardware list (web order).
- [ ] **WO-608** — Settings → Live audio: Save config / Apply PLAY + PGM routes not pressed (0 live-audio slots on
      the box); with a slot configured, check the status line now names its channel (WO-611 #8).
- [ ] **WO-608** — Import from USB (Media + → Import from USB…): no stick was plugged in, so only the empty state
      was seen. With a stick: the menu item shows the drive count, browse folders, Select media in folder, Import
      (progress bar + Cancel copy; the clips land in the project folder and the Media list refreshes), Safely eject.
- [ ] **WO-608** — Hardware reconcile: this box's project matches its hardware, so the prompt was only seen with a
      fake report (`--probe-hw-reconcile`). With a project saved on ANOTHER machine as the server's project, restart
      the Godot client: the "Hardware does not match this project" dialog should list the differences; try **Apply
      project hardware** (Device View + routing, OS layout, Caspar config regenerate) and Remember my choice.
- [ ] **WO-608** — Connection A/B hosts: only tested with two names for this box (127.0.0.1 / localhost). With the
      backup box up, right-click the connection eyes → **A/B hosts…** → A = this box, B = the backup's IP → Save →
      right-click → **Connect to B**: the GUI restarts showing the backup's project and state; Connect to A returns.
- [ ] **WO-603** — Placeholders (offline / preshow mode only): with the server in offline mode the Sources panel gets
      a **Placeholders** tab; add one, drag it onto a look and check the preview; tick the rows of
      `work/godot-port/parity/media-playlists.md`. (Box test used the dev flag `-- --placeholders`; no drag.)
- [ ] **WO-607** — only if you use the GLB model library (server `previs` module, off on this box): load a model in
      Previs → Models, tick / untick meshes under "Screens (live texture)", reload the model → the ticks stay.
- [ ] **WO-606** — Shader Live (logo click or deck toolbar → Shader Live): never tried on air — this box has no
      shader live and GPU CEF is off, and PGM/PRV were off limits. Take a shader look to PRV, then ride a slider,
      ≋ wiggle, a preset, Randomize, ▶ Take, a playlist hop (the picker should follow the layer), a Templates
      shader click (audition → PRV), and land / ✕ clear on the PGM stack column. Say if the
      logo should only open it while GPU CEF is on (the web's bunny-with-shades rule). Shader FX editor (Media + →
      Shader FX…): press **Preview on PRV** on a saved shader — it should play alone on PRV.
- [ ] **WO-628** — dock: bottom-centre, hides itself; reveal after 0.4 s of hover, hide 1 s after leaving. Too
      eager or too slow?
- [ ] **WO-629** — header "Test card" master on/off and the Test card… dialog on a real LED wall (pattern,
      bunny, labels). Since 21.10 the web header uses the same node settings: tick "Test card" in the web header →
      the Godot checkbox ticks too (and the other way round); a label changed in one dialog shows in the other.
- [ ] **WO-600 / WO-601 / WO-602** — looks deck, Inspector, timeline: compare the feel against the web (trim In/Out,
      effect sliders, clip move/resize/keyframes, route change while playing, align icons).
- [ ] **WO-603** — drop a big folder (progress line) and drop onto an upper-case CLS folder. Should Ctrl+Alt+click
      delete keep skipping the confirmation?
- [ ] **WO-604** — move a fader in the web and in Godot: both show it and the meters match. (Look_8 stays playing.)
- [ ] **WO-604** — Godot Audio tab → **+ Live audio input** adds an ALSA input (then Apply + restart in Devices).
      Click its strip: Devices opens on that input's host-channel page (Remove is there).
- [ ] **WO-604** — ALSA live-audio input (box with an ALSA slot): after a reboot the Ch buttons light for the PGMs it
      plays on. Press one in Godot: the web console button follows, and the route stops or starts.
      Then the web Live Audio Mixer → Save & Apply: the audio keeps playing on the same PGMs (now routed by the server).
- [ ] **WO-604 question: DeckLink N and v4l2 N audio clash** — both put their PGM audio on layer 320 + N, so
      DeckLink 1 and capture card 1 routed to the same PGM fight over one layer. Move the v4l2 band (e.g. to 340 + N)?
      Layers already on air on deployed boxes would move with it. Answer move / leave.
- [ ] **WO-604** — Screens row (2-screen box only): on a look strip, press the other screen's number. Its PGM
      should play the layer's audio (no picture). Press again → silent. Reload the look: the button stays lit.
- [ ] **WO-601** — Live → a screen's **Presets** → From PRV / From PGM → name it. Then Preview (PRV gets the look),
      ▶ (take with the look's transition), Auto (deck default transition), Cut. On a 2-screen box tick "All screens"
      first: one preset takes both screens at once.
- [ ] **WO-600 M** — box with a Multiview destination: Godot → **Multiview** tab → right-click → Default layout. The
      multiview output shows PGM / PRV where the boxes are. Drag a DeckLink from Sources → Live onto the canvas: a new
      window appears on the multiview. Click it: you hear only that window (the speaker mark moves). The web Multiview
      tab shows the same layout after a reload.
- [ ] **WO-598 shader push** — web client: put a shader look on PGM and PRV, open Shader Live, drag a param slider.
      Both outputs change live. Press a param's wiggle button: only PRV wobbles, then it settles back. The Opacity /
      Brightness rows still ride the layer. A playlist hop with a MIX transition restarts the shader once on its first
      edit (re-host), then it edits smoothly.
- [ ] **WO-598 shared multiview presets** — open the web Multiview editor in a browser and the Godot Multiview tab
      at the same time. Save a preset in one: its button lights up in the other within a second. Recall it in the
      other one. Switch both to multiviewer 2 (if you have one): a layout edit in one shows in the other.
- [ ] **WO-598 shared Device View setup** — web Devices tab in a browser and the Godot Devices tab side by side.
      Rename or hide a GPU port in one, or reorder the DeckLink ports: the other follows within a second. On the
      project-load hardware question, pick "remember": the other client stops asking too. Note: the web **New
      project** clears the saved GPU rows for every client now (they are shared); say if that should stay per browser.
- [ ] **WO-598 question: web client takes** — the Godot client takes looks and fills PRV through the server
      (`POST /api/scene/take`, PRV push by id). The web client still builds its own AMCP for both. Switch the web
      client to the server path too (one code path, but a short test window on real looks), or leave the web client as
      it is until the kiosk is retired (WO-609)? Answer yes / leave.
- [ ] **WO-597 atlas** — Godot Live tab, Standard view: drag and resize the PRV / PGM / source windows. The picture
      follows at once with no flicker, and the Caspar log shows no `MIXER 3-…` lines while you only move. A big resize
      (more than a quarter) or adding a source re-packs once. The box is left in atlas mode; to go back, POST
      `/api/operator-gui/layout` with `atlas:false` (or say so and I add a toggle). If a browser remote view is open,
      its windows should still show the right pictures.
- [ ] **WO-597 T4** — Devices → operator GUI destination: the new **Video output** select (Screen / Shared memory)
      shows "Shared memory" on this box. Don't change it unless you mean to: it needs a Caspar regenerate + restart.
- [ ] **WO-594 question: shm consumer CPU** — the Godot picture feed costs Caspar +5.2 % of one core at 1080p50
      (target < 3 %); the 1 h soaks are clean (no writer drops). Getting under target means rebuilding Caspar and
      swapping the binary (Caspar restarts a few times), plus `sudo sysctl kernel.perf_event_paranoid=1` to profile.
      OK to do that on this box, or leave it (it is about 0.2 % of the machine)? Also still open: ADD/REMOVE of the
      consumer on an on-air PGM, which needs a maintenance window.
- [ ] **WO-599 T4** — on a **4K operator monitor** the Godot client should open on it by itself and draw at 2×
      (same size as at 1080p). Settings → Defaults → This screen → UI scale overrides it per screen.
- [ ] **WO-599 picker** — Settings → Defaults → This screen → **Choose operator screen…**: a button on every screen
      (the mouse may leave the operator monitor while they show); press it on the screen you want, or Cancel / Esc.
      Is a prompt over the PGM output acceptable, and should a fresh box ask at start-up (it does now)?
- [ ] **WO-605** — Device view on a big show file: cable hit-targets, Matrix with 50+ rows, Node view.
- [ ] **WO-612 T7** — Previs → MVR scene → Export…, then open the .mvr in Capture (or MA3 / Perastage). The LED
      walls / TVs / projection should sit where they are in our previs. Does the tool show the `highascg:pgm1` source
      and crop? Re-importing a `highascg:` .mvr shows the live channel on its screens in the 3D previs (T5).
- [ ] **WO-607** — the previs stage keeps its tags; the PGM 3072×1728 surface looks right on the real stage.
- [ ] **WO-618** — take a look with a non-linear transition (e.g. easeinoutsine) and watch the curve.

### Tracking and lighting (real rig needed)
- [ ] **WO-616** — gamepad drives a marker; a real moving head follows over Art-Net; two-camera walk; camera
      calibration on a real DeckLink `inN` input.
- [ ] **WO-624** — E2: is "click a person in Detect to follow them" what you meant? E3: calibrate a real head.
- [ ] **WO-630** — Follow → Calibrate on a real moving head. Jog the beam onto a floor spot, **click that spot in
      the camera picture** (no marker needed), repeat 4+ times, Solve, Apply. The head should then hit the marker.
      In Markers mode, a click on the floor puts the selected marker there.
- [ ] **WO-616 T13b** — same calibration, but press **Find beam spot** instead of clicking: the server finds the
      beam in the camera picture and adds the point. On a stage with a lit LED wall, first aim the beam off stage (or
      close the shutter) and press **Beam-off reference**. Does it find the real spot every time?
- [ ] **WO-630** — a marker held by Detect's **replace** pin can't be placed by hand (the bottom line says so). Is
      that right, or should a held marker with nobody tracked be movable by hand, as OpenFollow allows?
- [ ] **WO-630 Q2** — play a real Resolume **DXV3 HQ with alpha** export over a colour layer. Does the edge key?
      (FFmpeg's test samples carry no real alpha, so this couldn't be proven here.)
- [ ] **WO-631** — grandMA3: PSN input on the show-network port → tracker ids (= marker ids) → fixtures. Walk a
      marker upstage and to stage left. If the console moves the wrong axis, set Follow → Output → Axes to
      "Y up". Same on the MagicQ MQ500. A managed switch needs IGMP snooping with a querier.
- [ ] **WO-631** — Art-Net backup: switch Output to "Art-Net backup" with the console released, and check the head
      follows.
- [ ] **WO-615** — real fixtures from GDTF: Previs → Fixtures → **Import GDTF…** a moving head you own (from
      GDTF Share). Does the mode list match its manual? Add one at the universe / address it is set to, check that
      universe under **Send ▾**, then turn **DMX output** on. The head should go to its defaults (centred, dark).
      Then try the same over **sACN**.
      To drive it before the programmer UI lands:
      `curl -X POST http://<box>:4200/api/fixtures/program -d '{"id":"fx2","values":{"Dimmer":1,"Pan":90}}'`.
      Turn DMX output off when done.
      **Previs (T5):** the patched head appears on the 3D stage at its pose (Follow form: x / y / z, truss / floor, yaw)
      and follows what you send — does pan / tilt go the **same way** as the real head, and does a gobo you pick
      (`"Gobo1":{"set":"<slot name>"}`) show the same image?
      **Programmer (T6):** Previs → Fixtures → Programmer: click the head in the 3D view (shift-click adds), move
      Intensity / Pan / Tilt, pick a colour and a gobo thumbnail, then Point at + click the floor where you stand —
      does the real beam land there? Release hands it back to its defaults.
      **Visualiser (T7):** send the console's universes for the patched heads to this box (Art-Net, or sACN
      multicast / unicast to the box), then tick **Visualise console**. The Fixtures section should show
      "sACN n ← <console IP> (<desk name>)". Does the previs follow the console (pan / tilt, colour, gobo)? Unplug
      the console: after ~3 s the rig goes dark. The box sends nothing while this is on.
- [ ] **WO-612** — MVR import: export your rig as `.mvr` from **Capture** (and from Vectorworks / the MA3 if you
      use them), then Previs → MVR scene → Import…. Do the trusses, fixtures and screens land where they are in
      Capture? Note anything listed as "missing" in the status line.
- [ ] **WO-632** — read-through: send the follow heads' universes from the console to this box as well, at output
      + offset (e.g. +10), tick Follow → Output → "Read the console first", then Output ON. Nothing should move.
      Track a marker → the head fades to it; lose it → back to the console's look. Pull the console's cable → the
      look holds.

## 2. Caspar build, outputs, performance (carried over)

- [ ] **WO-613** — soak/show QA of the v2.5.1 build on real shows (DeckLink A/V sync, audio) and decide Enhanced OAL vs upstream #1714 (row + doc: owner may flip) before deploying to show machines.
- [ ] **WO-594** — 1 h soak and on-air ADD/REMOVE of the shm consumer (row: "soak open"; CPU +5.2 % of a core vs target < 3 %) → soak clean; CPU target still a profile item.
- [ ] **WO-540** — re-measure ch1 after a few hours of use using the doc §5 one-liner (doc §5); check whether genlock should feed the 8K Pro (doc) → ch1 holds ~50 fps; no drift.
- [ ] **WO-500** — restart `highascg` to make the fix live; ch6/ch7 consumers are restored by the restart (doc §10) → PGM1 at ~99.9 % realtime with both DeckLink consumers (doc §5).
- [ ] **WO-504** — restart + reboot to confirm the operator channel boots with no test card (row) → no test card on the operator channel after reboot.
- [ ] **WO-507** — Apply after recreating ch1 → DeckLink 1&2 (row) → no consumer on DeckLink 3.
- [ ] **WO-508** — on .37 run `pgrep -af casparcg \| grep -v -- --type=` (row) → exactly ONE main Caspar process.
- [ ] **WO-509** — Apply and confirm each DeckLink appears on exactly one channel (doc §8 acceptance) → one channel per DeckLink.
- [ ] **WO-514** — Apply and confirm one channel per connector (row) → one channel per connector; wall keeps its tiles.
- [ ] **WO-515** — on-box stopwatch measurement of the Apply restart cost (doc: needs owner hardware and a stopwatch) → cadence decision after measurement.
- [ ] **WO-493** — set the 2160p DeckLink output to YUV in Device View, Apply + restart Caspar (row) → picture returns on the 2160p output.
- [ ] **WO-487** — re-apply, play, measure PGM1 (row: hypothesis unmeasured) → PGM1 realtime; doc WO-500 suggests closing 487 as superseded (owner to confirm).
- [ ] **WO-485** — re-apply config on .28, then measure PGM1 (row) → PGM1 at realtime with subregions.
- [ ] **WO-477** — watch the Caspar log on .28 (row) → INFO lines appear only around a clip change.
- [ ] **WO-505** — open a mapping-node output, pick a standard mode, confirm W/H fill; reload the kiosk (doc §4) → W/H follow the chosen resolution.
- [ ] **WO-439** — next Apply + Caspar restart so the caspar-env GL-sync var lands (row) → var present in the live Caspar env.
- [ ] **WO-437** — next Apply + Caspar restart for the GL-sync var (row "Caspar picks up the GL-sync var on the owner's next Apply + caspar restart") → var present.
- [ ] **WO-440** — press Apply once to restart Caspar and arm GL sync (doc) → Caspar restarted with GL sync set.
- [ ] **WO-444** — `sudo systemctl restart casparcg-server` once (row: ONE owner command arms it) → every Apply works after that.
- [ ] **WO-447** — next Apply updates the generated Caspar XML (doc) → screens 2/4 vsync off after Apply.
- [ ] **WO-412** — next Apply shows the port-3 Operator-monitor tick ticked (row) → tick shows ticked.
- [ ] **WO-414** — SOLO the PGM strip in the mixer (row) → solo works on PGM strip.
- [ ] **WO-406** — LISTEN + SOLO on the monitor output (row: "Owner: LISTEN + SOLO") → monitor is clean (no stutter) on the 720p5000 monitor channel.
- [ ] **WO-409** — listening leg gated on the WO-406 Apply + restart (row) → PRV mixer strips audible after Apply+restart.
- [ ] **WO-411** — pop the test pattern once, including a small output (row) → bounce character sized correctly on each output.
- [ ] **WO-401** — post-show deploy: `build:client` → service restart → kiosk F5; then the QA list in WO-401 §3 (row + doc ref) → QA list passes; delta rollback available (HIGHASCG_OSC_WS_DELTA=1).
- [ ] **WO-405** — caspar-internal pass waits for a real show config (row) → owner supplies a real show config so the pass can run.
- [ ] **WO-392** — watch a live tile for >30 s (row) → no blink.
- [ ] **WO-393** — remove-last and add-from-zero in the Devices view (row) → both work.
- [ ] **WO-397** — feel-check mouse lag after the XRANDR freeze fix (row) → no lag (pass not stated).
- [ ] **WO-408** — eyeball the compose UI batch (row: "owner eyeball") → looks right (pass not stated).
- [ ] **WO-410** — eyeball operator holes after Caspar restart (row) → holes populated (pass not stated).
- [ ] **WO-441** — eyeball GPU inspector native mode wrap and input fit (doc) → Hz on one line.
- [ ] **WO-442** — Video Mode section shows only real keys after heal (doc QA) → no 1920/1080 fossils shown.
- [ ] **WO-435** — eyeball Devices header redundant buttons removed (doc) → header clean.
- [ ] **WO-436** — type a Width/Src X value once in a mapping-node output; it sticks (doc) → value sticks; feel check.
- [ ] **WO-451** — one-step drag of a GPU socket lands on first try; mismatch banner stays gone (row/doc) → passes.
- [ ] **WO-443** — save and reload a project; monitor output stays put and absent from file (doc) → passes.
- [ ] **WO-445** — press the snapshot button (⭳) in Devices header (doc) → snapshot saved.
- [ ] **WO-362** — on-glass confirm of route layer10 looks (row) → on-glass correct (pass per row: "ROUTES-ALIVE").
- [ ] **WO-364** — press Apply for the PRV DP-2 cable (row: cable staged to DP-2) → PRV on DP-2.
- [ ] **WO-363** — live factory-reset left to owner (row) → only if owner chooses to reset live.
- [ ] **WO-381** — eyeball the operator GUI dock (row) → dock correct.
- [ ] **WO-522** — drag/owner QA of coalesced sends (row: "Owner QA: drag") → drag feels right, last value lands.

## 3. Media, looks, timeline — web client era (carried over)

- [ ] **WO-340** — open the shader modal and tweak a parameter (row) → modal works.
- [ ] **WO-343** — owner QA on the glass: drag layers with PRV watch on (row) → layers drag with PRV live.
- [ ] **WO-376** — restart needed (row); check live camera image and CEF video permission (row: unverified) → left/right camera channel shows live image.
- [ ] **WO-586** — audition on PRV with music, GPU cost of heavy ones, licence call (row) → chosen subset kept; licence decided (see Decisions).
- [ ] **WO-587** — audition on PRV; licence call (row) → chosen backgrounds kept; licence decided.
- [ ] **WO-588** — watch the bunny test pattern on the LED wall; pick speed, check 50 % colours (doc §4) → acceptable speed/darkness.
- [ ] **WO-589** — watch Confetti Center through Caspar CEF; check smoothness at broadcast rate; decide confetti above/behind card (doc) → chosen.
- [ ] **WO-590** — restart needed; owner QA of template layer position and channel size (row/doc) → template positions on channel.
- [ ] **WO-591** — owner QA: drop a folder with a subfolder; multi-drag to playlist (row) → both work.
- [ ] **WO-592** — owner QA: a clip with trim/mute defaults dropped on a look; remote view thumbnail + waveform; mirror `.stignore` lines on the Mac (row/doc) → each passes.
- [ ] **WO-574** — real-rig timing: recall a 2-screen preset with ▶ and compare the two screens' transition starts (doc) → starts aligned (pass not stated).
- [ ] **WO-576** — kiosk reload + owner QA (row only; no WO doc linked) → pass not stated.
- [ ] **WO-566** — rebuild client, reload kiosk, restart service; confirm both screen-1 slices travel at the same visible rate (row/doc) → same rate.
- [ ] **WO-567** — confirm Font/Color/Border show and work in the Inspector; compact dock visually unchanged (row) → passes.
- [ ] **WO-581** — set an item on a PRV playlist look, take it; PGM opens on that item (row/doc) → PGM opens on the set item.
- [ ] **WO-582** — main ↔ main lista both directions, no visible offset on the shared loop clip (row/doc) → no offset; "couple of frames" gone.
- [ ] **WO-448** — with a look playing, jump the timeline playhead; PGM must not change (doc) → PGM unchanged.
- [ ] **WO-449** — extend a playing clip past its source length (doc) → loops/replays correctly.
- [ ] **WO-518** — PARTIAL: owner to name the WO if they remember the amcp-overrun-on-clip-move work; owner decision on ratio-mismatch resolution (doc) → see Decisions.
- [ ] **WO-519** — A139.2 (a)–(e) on real PGM still owed (row) → each case behaves on real PGM.
- [ ] **WO-528** — row truncated; doc says root cause on the wire (TAKE path cuts) → owner QA on real PGM (UNSURE: row does not state the owner step explicitly).
- [ ] **WO-530** — owner QA on the kiosk: one Label field per DeckLink port; compose surfaces (doc §5) → labels correct.
- [ ] **WO-531** — owner QA of look fill on a different-shaped screen (doc §6) → fill correct.
- [ ] **WO-532** — open a screen-0 look with screen 1 selected; X/Y/W/H match; content-fit Native must not full-bleed (doc §6/row) → passes.
- [ ] **WO-533** — arrange both editors, reset one, reload, check both (doc §5) → both layouts persist.
- [ ] **WO-534** — rename in one inspector; check the other and the label bar (doc §7/row) → renames propagate.
- [ ] **WO-536** — owner QA (§8): looped clip resumes instead of restarting (row) → resumes.
- [ ] **WO-537** — drop a timeline into a look, scrub it in the timeline editor, then take the look (row) → no fade-in killed; part 2 (look-after-timeline mix) also needs QA.
- [ ] **WO-541** — owner QA on real PGM: timeline-only look fades in (row/doc) → fades in.
- [ ] **WO-542** — owner QA on the inspector panel: flag timecode and jump label format (doc) → format correct.
- [ ] **WO-544** — owner QA on real PGM: keyframe vs take fade race (row/doc) → no race.
- [ ] **WO-545** — owner QA on real PGM: going back to a look from timeline mixes, not cuts (row/doc) → mix.
- [ ] **WO-546** — owner QA on real PGM with a timeline-in-a-look take through the pgm/prv exchange (row/doc) → concurrent take survives.
- [ ] **WO-548** — retake the same timeline-only look twice in a row; stays lit (doc) → stays lit.
- [ ] **WO-549** — take a timeline-only look, then a different look; new look shows (doc) → shows.
- [ ] **WO-550** — preview an unrelated look on PRV while timeline is live on PGM; PGM unaffected (doc) → PGM unaffected.
- [ ] **WO-552** — send a look to preview while a timeline is live on program; program unaffected (doc) → PGM unaffected (Critical per doc).
- [ ] **WO-553** — take a timeline-containing look, then a normal look over it; no opacity flash (doc) → no flash.
- [ ] **WO-554** — owner QA + live wire capture during an owner-triggered timeline-look take (doc) → single play, no stuck PRV.
- [ ] **WO-555** — reproduce preview-routing corruption with devtools open, or live capture (doc: needs owner to reproduce) → corruption gone.
- [ ] **WO-556** — owner QA: first click to PRV of another look; timeline exit restart (doc §4) → no flash, no restart.
- [ ] **WO-558** — owner QA of tick cache-clear persisting-channel fix against live capture (doc) → clears correct channel.
- [ ] **WO-559** — owner QA: take leaves preview for flip-flop (doc) → no flip-flop.
- [ ] **WO-560** — owner QA: the false missing-media warning badge is gone (doc) → badge gone.
- [ ] **WO-561** — owner QA + live wire-capture re-verification: timeline replaces normal layer and exits (row/doc) → exits correctly.

## 4. Companion and integrations (carried over)

- [ ] **WO-450** — tick "Button Subscriptions API" in Companion (row/doc: OWNER ACTION) → previews live; then QA: change a button's look in Companion, preview swaps within ~1 s.
- [ ] **WO-394** — restart Companion, pick the dev module, re-save config (row: owner A394.1) → dev module selectable and config saved.
- [ ] **WO-395** — desk QA of configured output presets after Companion restart (row: owner A395.1) → presets work.
- [ ] **WO-585** — Companion toggle visible on/off; take with border on (row) → on/off works on air.
- [ ] **WO-535** — owner QA §6: play through a companion_press flag; playhead press fires; open flag inspector for stale button (doc) → presses fire; status truthful.
- [ ] **WO-543** — re-test with `journalctl -u highascg -f | grep -i companion` open; report what logs (row/doc §3) → log shows press result.
- [ ] **WO-547** — owner QA against real Companion: timeline playhead press fires (doc) → press fires.
- [ ] **WO-380** — add a free Shadertoy API key (row: owner action); keyed fetch still unverified → keyed fetch works.
- [ ] **WO-521** — Zoom integration PLAN ONLY: answer §6 questions before any code: Zoom account raw-data entitlement, whether the Linux SDK exposes the same raw APIs, whether send-into-meeting is needed in v1 (row/doc) → answers recorded; spike phasing in §7 then starts.

## 5. Install, ISO, stick (carried over)

- [ ] **WO-429** — rotate the gh token if any prior ISO left the building (row) → token rotated where applicable.
- [ ] **WO-431** — run the .34 one-liner; on this box run `install-exfat-systemd-units.sh` (row: WO-427 debt) → both done.
- [ ] **WO-432** — mirror `BUILD_STAMP` into the Mac `.stignore` (row); produce and confirm Settings → Updates shows the build date, not 26.05.20 (doc WO-471) → date shows.
- [ ] **WO-434** — next flash: expect `skip: embed-server ISO` at step 4/5 and test-04 green without a drop (row) → as expected.
- [ ] **WO-453** — run the sim on a prep laptop (row: owner QA) → sim runs.
- [ ] **WO-454** — set Ignore Permissions on the Mac and other peers before their first rescan (row/doc) → peers keep ignorePerms.
- [ ] **WO-455** — run the one-liner on machine 2 (WO §Remains) and install `tmpfiles.conf` on this box (row/doc) → GUI update works on machine 2.
- [ ] **WO-457** — retry the exFAT format on the Windows machine (row/doc); if `format.exe` fails, record it (doc) → exFAT stick formats.
- [ ] **WO-458** — reboot a Ventoy stick with the patched scripts (`patch-wo47-exfat-boot-scripts.sh --restart`); confirm `findmnt /home/casparcg/exfat` shows the dm map (row/doc) → exFAT mounts on the stick (dm branch unproven on hardware).
- [ ] **WO-459** — build a new ISO: `sudo HIGHASCG_NVIDIA_DRIVER=595 bash tools/eggs/live-usb/build-highascg-egg.sh` (doc) → build prints Done and slideshow wording check passes.
- [ ] **WO-460** — once per box: `sudo bash scripts/setup/12-passwordless-sudo.sh`; then click shutdown once (row/doc) → button works (not 502).
- [ ] **WO-461** — visible after the next `build-highascg-egg.sh` (row) → GRUB selected entry readable.
- [ ] **WO-462** — recopy the 1221 ISO to the stick (doc §Remains commands); never copy before the build prints `Done. ISO:` (row) → verify-stick-iso.sh passes.
- [ ] **WO-463** — owner QA on the next ISO: automount no longer loops on the Ventoy partition (row).
- [ ] **WO-464** — reboot, then re-run the build (row: not a code failure) → build completes.
- [ ] **WO-466** — walk the stick guide once on a fresh stick; drop in the screenshots (row) → guide accurate.
- [ ] **WO-468** — deploy to highascg7579; restart; Device View shows `enp3s0 — 192.168.0.27`; apply OS layout, `xrandr` shows DP-0 at +8064+0 and DP-2 at +6144+0; re-apply Caspar screen x for operator GUI and PGM2 (doc "Owner QA owed") → layout correct; GPU accepts the 9984 framebuffer.
- [ ] **WO-469** — reload the GUI on highascg7579 after deploy (row) → stick folder shows contents.
- [ ] **WO-470** — re-seed the stick and bridge `configs/` copies (row/doc: still carry old sc60mon entry) → no sc60mon in fresh installs.
- [ ] **WO-471** — one produce + one boot of the ISO: BUILD_STAMP appears; boot without stick → `highascg-exfat-boot.service` ~5 s; boot with stick → exFAT pipeline mounts (doc) → all three pass.
- [ ] **WO-472** — insert stick, start server, reload GUI (F5), open Sources and check both folders (doc) → both folders populated.
- [ ] **WO-473** — next fresh install + one New project; blank on next insert (row/doc) → no outputs/audio/rec shipped.
- [ ] **WO-474** — New project → empty device view; add one of each and confirm Audio 1 / Str1 / Rec1 (row) → passes.
- [ ] **WO-475** — next reinstall gets past partitioning with HIGHASCGDAT; check `~/bridge` is back after installer closes (row/doc) → passes.
- [ ] **WO-478** — four device-view defects in the GUI (row/doc) → all four fixed.
- [ ] **WO-481** — next install (row) → passes.
- [ ] **WO-498** — one `sudo` command per box to remove nginx (row/doc §4) → nginx gone; node serves directly.
- [ ] **WO-499** — refresh the installed GUI-update helper (root, doc §5) → on-box helper current; future updates no longer stop highascg first.
- [ ] **WO-501** — run the doc §5 command once (root) → helper refreshed; updates automatic thereafter.
- [ ] **WO-511** — run the one bootstrap command, then retry the update (row) → update succeeds.
- [ ] **WO-512** — check `/etc/highascg/server-update-rsync-excludes.txt` on .37 (root-owned, may be stale) and re-verify WO-507/509/502 landed (row) → file current.

## 6. Still open from checklist06.08.26 / checklist04.08.26

- [ ] **WO-372** — tick on checklist06.08.26_close_all_wos.md (row).
- [ ] **WO-388** — tick on checklist06.08.26_close_all_wos.md (row).
- [ ] **WO-389** — tick on checklist06.08.26_close_all_wos.md (row).
- [ ] **WO-402** — tick on checklist06.08.26_close_all_wos.md (row).
- [ ] **WO-403** — QA tick on checklist06.08.26_close_all_wos.md (row: deploy leg done).
- [ ] **WO-404** — QA tick on checklist06.08.26_close_all_wos.md (row: deploy leg done).
- [ ] **WO-413** — tick on checklist06.08.26_close_all_wos.md (row).
- [ ] **WO-423** — tick on checklist06.08.26_close_all_wos.md (row).
- [ ] **WO-427** — tick on checklist06.08.26_close_all_wos.md (row).
- [ ] **WO-341** — two-client observation drill, kill-list item 8 (row).
- [ ] **WO-342** — owner eyeball: deck header click clears PRV (row).
- [ ] **WO-366** — still unanswered from checklist04.08: #1 live-audio cheapest resolution, #3 NumLock reset, #6 timeline edit speed on caspar output (row) → see Decisions.

## 7. Decisions owed (carried over)

- [ ] **WO-539** — pick (A) emit `-r:v` so the API tells the truth, or (B) drop the option and have the relay announce the real rate. B is the smaller on-air risk (row/doc §4).
- [ ] **WO-476** — approve a CasparCG rebuild + binary swap on each box so DeckLink fill-only outputs stop asking for an external keyer (doc: "owner decision pending") → decided; no action otherwise.
- [ ] **WO-366** — answer #1 live-audio cheapest resolution, #3 NumLock reset, #6 timeline edit speed on caspar output (row).
- [ ] **WO-513** — decide whether to prune the fossil connector left in the saved graph once `multiview_decklink_device` is cleared (row: suggester only ADDS).
- [ ] **WO-526** — rename propagation: whether multiview cell labels persisted in the saved layout should be rewritten on rename (row §8; CEF templates need `CG UPDATE`).
- [ ] **WO-494** — same hole in `removeMappingOutput`, `handleRemoveEdge`, `handleRemoveAllEdges` (row §4: owner call).
- [ ] **WO-490** — live delete of a screen destination is left for an owner decision (doc: mutates a live playout box).
- [ ] **WO-506** — point the top-bar screen-pill row at the component that renders it (row: "awaits an owner pointer").
- [ ] **WO-518** — name the WO for the amcp-overrun-on-clip-move symptom if remembered; decide the ratio-mismatch resolution rule (doc §5/§8).
- [ ] **WO-471** — ISO defaults: whether the operator GUI binding follows the primary output; whether pointer confinement should refuse a rect the operator cannot reach (doc "Still open").
- [ ] **WO-470** — whether the config-carrying workflow stays; if so, skip `system-audio` consumers whose device is absent (doc "Owner action owed / still open" item 2).
- [ ] **WO-540** — genlock intent for the 8K Pro (doc §5).
- [ ] **WO-500** — DeckLink driver: doc advises staying on 16.2a1 (16.1 and 16.3 in reserve); acknowledge (doc §11).
- [ ] **WO-586 / WO-587** — licence decision for imported shader libraries (row/doc §5 and §4).
- [ ] **WO-521** — Zoom entitlement / SDK / v1 scope (see Companion section).
- [ ] **WO-613** — OAL choice and base decision (see Caspar section).
