# Checklist 22.10.26 — owner tests for when the right setup is in place

Owner, 22.10: *"write owner tests file that i can come back to when i have a correct setup and check it."*

How to use it:
- Find the section that matches the setup you have today (cameras, lighting rig, LED wall, stick, …).
- Do its checks. Tick each box, or write a word next to it: "ok", "no: …", or "skip".
- Tell the session. It flips the matching `OPEN_ISSUES.md` rows.

This file covers WO-633 … WO-670. Older checks up to WO-632 are in
[checklist20.10.26_owner_checks.md](./checklist20.10.26_owner_checks.md). Its section 1 has the tracking / follow / PSN /
lighting checks (WO-615, 616, 624, 630, 631, 632). Do those in the same session as section A or B below.

## A. Cameras + tracking (two solved tracking cameras, people on stage)

Setup, once:
1. Tracking cameras calibrated (Previs → Tracking).
2. Previs → Tracking → Detection: model `yolo26n-seg.onnx`.
3. Body pose: `yolo26n-pose.onnx`.

- [ ] **WO-665: cut-out cards.** Previs 3D toolbar → People: **cut-outs**. Each tracked person is a flat card with
      their own picture, cut out by the mask, standing at their spot, turning to face you as you orbit. The card height
      matches the person.
- [ ] **WO-666: painted dummies.** People: **dummies**. Each person is a mannequin painted from the cameras that
      see them, with the front and sides from the camera on that side. The back (no camera) takes the person's mean
      colour.
- [ ] **WO-667: posed dummies.** With Body pose on, raise an arm, step wide, crouch: the dummy follows within
      about ⅓ s.
      - With one camera only, the limbs sit on a flat plane facing that camera. That is expected.
      - With both cameras, the limbs get real depth (an arm pointing at the audience comes forward).
- [ ] **WO-667: speed.** Two cameras with seg + pose on CPU: is the detect rate (Tracking status) good enough to
      follow? About 9 fps per camera was measured with one camera. If it's too slow, say so; the next step is GPU
      inference.
- [ ] **WO-666: colour match.** Do the two cameras' colours differ visibly on one dummy? Per-camera gain/tint was
      deferred until this answer.

## B. Real lighting rig (console, moving heads, a show MVR)

- [ ] **WO-633:** in a real show file, replace a stub fixture type with the file from GDTF Share. Also check the
      X-Dot Max: only 6 of its 9 modes pair.
- [ ] **WO-637:** a new MVR import, end to end: placeholders resolve from GDTF Share by themselves. A placeholder
      that is only *offered* ("choose") still lists only imported types under Replace….
- [ ] **WO-641:** Fixtures → pick a type → Body colour. The heads on the live rig previs take that colour.
- [ ] **WO-677:** Previs → MVR Layers → colour "Default Layer". Models stay solid from every side (no hollow,
      see-through walls).
- [ ] **WO-678:** Previs → heads without a GDTF colour are black. Click a head: its MVR layer row lights up. Colour
  that layer (e.g. "5. Sharpy Plus") → those heads take it; a fixture-type Body colour still wins.
- [x] **WO-679:** *(owner: good, 22.10)* Previs 3D → right-click a head, hold and move: the beam follows the mouse across the floor; with
  several heads selected, right-drag one of them aims the group. Left-drag still orbits.
- [x] **WO-680:** *(owner: good, 22.10)* Programmer → Groups ▾ → By position / By address: rows per fixture type (audience L / R halves, · all)
  and one group per universe. Pick one → those heads select in 3D. Your own groups are still listed first.
- [ ] **WO-681:** full path: Previs → MVR scene → Import… a .mvr → it patches; map a wall (Map). Pick
  "— no MVR scene —": the dialog names the fixtures and walls it takes; OK → heads and wall gone (Cancel keeps
  them). Pick the scene again → it re-patches. Remove → same, plus the scene leaves the box. In 3D, ctrl- or
  shift-click heads adds them; ctrl-click again drops one.
- [ ] **WO-643:** re-import a newer version of the same MVR. Confirm the prompt; the scene stays where it was, and
      there is no second set of heads.

## C. LED walls / multiple screens

- [ ] **WO-634:** MVR object → LED screen with the show's real sending-card map: edit the crops per wall. The
      destination runs at the show's real raster.
- [ ] **WO-638 / WO-645:** a real power-cycle with two or more screens.
      1. A "Start operator here / Run headless" window appears on each screen.
      2. Caspar is held until you answer.
      3. Try **Run headless** once, then the Settings → Start-up autostart switch (with and without GUI).

## D. Next ISO / stick build (WO-669)

- [ ] After `eggs produce`, run `tools/eggs/live-usb/verify-iso-squashfs-excludes.sh` on the ISO. It must say
      `present: home/casparcg/.local/opt/godot/godot`, with no `bad` lines.
- [ ] Install the stick on a spare machine. "Start operator here" opens the Godot GUI. Before WO-669 the GUI binary
      was not on the ISO.
- [ ] Before the produce, `passwd` on the build box must be `highascg`. The prepare script warns otherwise.
- [ ] On the installed machine, `ssh casparcg@<ip>` works and the host key differs from the build box's
      (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on both).
- [ ] After section A passes: decide whether to ship the tracking venv + models (+375 MB).

## E. Audio on air (a live-audio input routed)

- [ ] **WO-662: beat-reactive shaders.**
      1. Route the FFT source (DM3 slot) in the live-audio inspector.
      2. Put an audio-reactive shader on air.
      3. Set flash / bump in Shader FX and save: it pulses on the beat without a re-take.
      4. Does the Godot Shader FX dialog's Beat row look right?

## F. Another machine on the network (web UI)

- [ ] **WO-646:** open the web UI from a laptop. The Looks compose preview shows HQ thumbnails; Settings → Compose
      preview offers Canvas / Caspar JPEG only.
- [ ] **WO-661:** web Templates tab: Templates / Lower thirds / Shaders groups, ⚠ tooltip on shaders. After turning
      GPU on + a Caspar restart, the ⚠ disappears.

- [ ] **WO-670 P1: Godot GUI on a laptop.** Run the Godot client on another machine with
      `--server=http://<box-ip>:4200`. The Live tab shows live PGM / PRV pictures (about 15 fps, ¼ s behind is
      normal). Tell the session the laptop's OS: Windows / macOS export presets are the next step.
- [ ] **WO-670 P2a: link a second server.** On box B (any HighAsCG, headless is fine): Devices → Servers → + →
      Scan the network (or type B's address) → Link. B shows green with its version, "media ✓ / differs", its own
      rear panel and cables, and per destination "backup" (cabled on both) or "extension" (only on B). Pull B's
      network: within ~5 s it turns red "offline"; plug back: green. ✕ unlinks it (B is untouched).
- [ ] **WO-670 P2b: Send media.** On A press "Send media" on B's card before B has linked A: red "B has not
      linked this server…". On B link A, then Send again on A: "Sending media… %" → "Media sent", and B's card turns
      "media ✓" (may take ~30 s for B's media signature to refresh).
- [ ] **WO-670 P3a: master + failover.** A and B linked both ways. On A: "Make this server master" → both show
      "Master: …" with A. Pull A's network cable: within ~15 s B shows "Master: this server · epoch N+1". Plug A back:
      A shows B as master within ~5 s (it stepped down). Untick "Auto failover", pull B: nobody takes over.
- [ ] **WO-670 P3b: the client follows.** Godot on a laptop connected to A (master). Pull A's cable: within ~25 s
      the laptop reconnects to B by itself. On B, "Make master" on A: the laptop shows "Master changed… 5 s" and
      goes back to A. "Stay here" keeps it on B.
- [ ] **WO-670 P4a: takes reach the other box.** A master, B linked both ways, `replication.enabled` off on both.
      Cable the same destination on both (backup): take a look on A, and B's output shows the same look within a
      frame or two. Uncable it on A only (extension): the take still shows on B. Uncable it on B: B stops following.
- [ ] **WO-670 P4b: B catches up, B's own takes wait.** With a look on air on A, restart B's Caspar (or unplug
      B's network for 10 s): B shows A's look again (clips restart from the top). Devices → Servers on A: B's card
      says "Takes forwarded: … caught up". Open a client on B with "follows the master" off: the panel says "PGM here is
      driven by the master"; a take there changes PRV only.

## G. At the desk, no special setup (Godot GUI on the box, a scratch look)

- [ ] **WO-663:** drop `STUDIO/LT-GRADIENT-WAVE-MARCIN` on a look.
      1. Both inspectors show "Lower Third", pre-filled.
      2. Take without typing: the baked text shows.
      3. Change the title, take again: the new text shows.
- [ ] **WO-650:** in the look editor, delete the only layer of a look: PRV goes empty at once.
- [ ] **WO-652:** Live 2D → Times, with a multi-layer look and a playlist layer.
- [ ] **WO-658:** Live 2D Auto.
      1. Drag the Live / deck splitter smaller: the windows shrink.
      2. Move a window: Auto turns off.
      3. A second screen gets a second column.
- [ ] **WO-671:** with Auto on, click a PGM / PRV window (no drag): Auto stays on. Drag the Live / deck splitter:
      the windows follow.
- [ ] **WO-672:** Devices → Cable loops 1 / 2: the cables hang in curves and the loops hang below them. Drag the
      splitter or resize the window: the cables swing and settle within about 1 s.
- [ ] **WO-673:** Live 3D: the Lights toggle is a bulb. Lit yellow = beams on; click it: white outline, beams off,
      heads stay.
- [ ] **WO-674:** Devices → Cable loops: step through 0 1 2 4 8 16 32 chaos. Chaos is a tangle between the ports,
      never over a button. Restart the client: the slider keeps its value.
- [ ] **WO-675:** Previs → Camera → Presenters: open one of the URLs on a phone, take a photo, name + mic, tick
      consent, Send. The presenter appears with the photo. Walk into a camera: "Looks like P… — confirm?" → Confirm.
      Give a zone the action `presenter` and the presenter On enter `companion:<page>/<row>/<col>`: walking in presses it.
- [ ] **WO-675 round 2:** on the phone type `http://<box>:4200/intake` (short address) → the intake page. After
      sending one person (with a note, e.g. their role): select a lower-third layer in a look → Inspector →
      "Presenters (backstage list)" → tap the name: Title = name, Subtitle = the note.
- [ ] **WO-675 P2 (body):** at intake take a WHOLE-BODY photo. Previs → Camera → Presenters shows "Not on stage"
      (or "· body only" if the face was hidden). Walk into a WIDE camera shot: within ~3 s "Looks like P… by body
      (NN %) — confirm?". Two people in similar clothes: no suggestion. Close-up: "by face + body".
- [ ] **WO-668:** the Live 2D button shows "2D" in a box; switching 3D ↔ 2D doesn't change its size. The
      Inspector title is white.
