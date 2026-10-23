# Checklist 23.10.26 — owner checks for today's work orders (WO-690 … WO-707)

Owner, 23.10: *"continue until all todays notes and wos are ready and tested. for my checks"*

Today's notes: `next.md` (ISO on .64, Caspar, project, dock, MVR walls) and the session requests. Every WO below is
committed, pushed (CI green up to WO-706, WO-707 just pushed; WO-705's run was queued at writing) and tested offline. The boxes are what
only you can see: real hardware, the next ISO, or how it feels.

How to use it:
- Tick each box, or write a word next to it: "ok", "no: …", or "skip".
- Tell the session. It flips the matching `OPEN_ISSUES.md` rows.

## 0. One-time host steps (this box, a terminal)

These copy today's helper scripts into `/usr/local/lib/highascg`. Right now the installed copies are older than the
repo: the network helper, both DeckLink libs and the exFAT network apply are outdated, and the DKMS cache lib and the
boot-stick lib are missing.

```
sudo install -m 755 ~/highascg/tools/runtime/highascg-network-apply.sh /usr/local/lib/highascg/highascg-network-apply.sh
sudo bash ~/highascg/scripts/exfat/install-exfat-systemd-units.sh
```

- [ ] Both ran without errors. The first is WO-692 (Wi-Fi scan / join, networkd hand-over). The second is WO-697 /
      702 / 704 on this host. The ISO build installs them itself.

## A. On this box, in the Godot GUI (no extra hardware)

- [ ] **WO-690:** the Programmer is there after a restart (Previs + Tracking modules are on by default).
- [ ] **WO-691:** click a head in 3D (ctrl / shift adds more), then press Delete → confirm → the head is gone. Do the
      same with the Programmer's **Delete** button.
- [ ] **WO-694:** Previs camera → Source lists only what exists: SDI input 1 / 2, Program 1, Preview 1.
- [ ] **WO-699:** Previs Inspector: are the lighting controls grouped by job the way you want?
- [ ] **WO-703: Preset marks.** Lighting → Calibrate heads → **Preset marks** adds 9 marks: DSR, DSC, DSL, SL, USL,
      USC, USR, SR, Centre. They sit on the tracking grid (on this box: X ±3, Y 1.5 / 3 / 4.5). Press it again: nothing
      is added.
- [ ] **WO-706: MVR layers.** Pick *Pabianice Final Patch* → Layers. The Ściana / Podłoga / Ekran rows say
      **"· empty in the file"** and have no eye.
      - The Capture export wrote those layers with nothing in them. There are no walls in the file to turn on.
      - If you want the walls, re-export from Capture with the venue geometry included. Their layers then fill, start
        hidden, and open with their eye.
- [ ] **WO-706:** import any MVR whose wall layers hold geometry: they start with a closed eye, and a click shows them.
- [ ] **WO-705:** the dock (bottom edge) shows HighAsCG | 5 apps | ⋯, once, with no duplicates.

## B. Real lighting rig (console, moving heads)

- [ ] **WO-700 R7: calibrate Focus Profile 1.**
      1. Lighting → Calibrate heads → **Clear**.
      2. Pin 4+ marks, including the far side of the stage: aim with the Programmer, then **Beam is on ‹mark›**.
      3. Each pinned mark should stay exact, and the beam should not drift on the other side.
      - Fine-tune by hand with **Beam offset** Pan / Tilt.
      - If the summary says "the head is probably not where it is patched", check its X / Y in the patch.
- [x] **WO-700, question:** Focus Profile 2 — answered 23.10: both focus are at the right place; left as is.
- [ ] **WO-695:** select both Focus Profiles → Patch → Basic Mode 36ch → Apply.
      - To drive the real heads, patch them on a universe other than the box's lighting input (for example U1), and
        tick that universe under Send ▾.
- [ ] **WO-698:** Previs → Fixtures → **Out via**: pick the lighting NIC. The nodes / DMX viewer should see the
      output.
- [ ] **WO-693:** with a real console feeding the box, the DMX viewer lists its Art-Net node / sACN source and the
      512 grid moves live.

## C. Cameras + people on stage

- [ ] **WO-707: Follow → Auto.**
      1. Select a head (Follow mode) → Follow: **Auto — the tracked person**.
      2. Detection → **Person detection** on; the fixture output on.
      3. Walk into view of cam_1 / cam_2: the head follows you. Step out: it holds where you were.
      - Your own marker (Tracking → Markers → Add marker, pin mode Replace / Assist) still works the same.
- [ ] **WO-701:** cut-outs keep one camera per person. They switch only after another camera has had a better view
      for 2.5 s, so there's no flicker when someone turns.

## D. Network (after step 0)

- [ ] **WO-692:** Settings → Network: Scan, then Join a Wi-Fi network. Set up a port with no cable, then plug the cable
      in: it comes up with those settings.

## E. Next ISO build + live boot on .64 (WO-696, 697, 702, 704, 705)

Build steps (one produce per boot; never Ctrl-C):
1. Reboot the box.
2. `sudo bash ~/highascg/tools/eggs/live-usb/verify-eggs-prepare-host.sh`
3. In tmux: `sudo HIGHASCG_NVIDIA_DRIVER=595 bash ~/highascg/tools/eggs/live-usb/build-highascg-egg.sh`
4. Copy the ISO only after `Done. ISO:` appears.

On .64, booted from the new ISO:
- [ ] **WO-696:** SSH works (`ssh casparcg@192.168.0.64`). The start-up screen question comes up, even while the
      server is still starting, and Caspar starts once it is answered.
- [ ] **WO-702:** `systemctl --failed` is empty. `network.conf` lands on the cabled NIC (enp5s0). There is one hostname
      line. No sda1 mount retries.
- [ ] **WO-704:**
      - The first boot compiles DeckLink as before (about 2 min).
      - The **second boot from the same stick** logs `restored … (no compile)`, and `highascg-decklink-install` takes
        seconds.
      - Check with `journalctl -u highascg-decklink-install` and `/var/log/highascg/decklink-install.log`.
- [ ] **WO-705:** the dock fills with its apps by itself once the server is up, even though the GUI came first.
- [ ] **WO-697:** the boot stick syncs automatically. Plug the same stick into an installed box: nothing syncs on its
      own, and Load → USB stick… works.
