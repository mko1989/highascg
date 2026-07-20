# Verify now — checklist for the owner (2026-07-20)

Everything below is either **you need to look at it** or **you need to decide it**. Ordered by
what would hurt most if wrong. Server is running the new code; the kiosk needs a reload.

---

## 0. Do this first (one minute)

- [ ] **Reload the kiosk Firefox.** The server restarted, but the browser is still running the old
      bundle. Most of the UI fixes below are invisible until you reload.

---

## 1. Verify — the things I fixed that you reported (highest value)

- [ ] **Compose preview layout after restart** (the one I wrongly marked done).
      Restart highascg, watch the operator GUI come up. Your saved tile layout must be there
      *without* triggering a look. Journal proof to compare against:
      `journalctl -u highascg -f -o cat | grep -E "re-apply|first rect report"` —
      you want `first rect report ... cells=3`, not `cells=1`.
      Known cosmetic leftover: the holes close once for ~2s during boot before the layout lands.

- [ ] **First look play after a restart.** You reported it fails after a long timeout and freezes
      the app. I fixed an AMCP wedge and have seen no recurrence, but I am NOT claiming it fixed.
      Take a look right after a restart and tell me.

- [ ] **PRV precision + realtime.** Play several looks on preview. Watch for: a layer missing, or a
      layer wearing another layer's position/scale. Then drag geometry in the looks editor — edits
      should appear on PRV almost immediately.

- [ ] **Route looks land on one frame.** Play the look with 1 media layer + 3 route layers. All four
      must appear together, not one by one.

- [ ] **EDIT PGM + CAPTURE** buttons on each PGM tile footer. EDIT PGM opens the on-air look with a
      red "LIVE — EDITING PGM" badge and edits hit air. CAPTURE writes a PNG in the Caspar media
      folder and toasts.

- [ ] **Open window ▾** button in the header (operator GUI mode): DeckLink setup / file browser /
      NVIDIA settings must appear **over** the kiosk and be clickable, the video holes must keep
      showing Caspar output while it is open, and closing it must restore the GUI.
      Also test the crash path: `kill -9` the helper — the GUI must restore within ~1s.

- [ ] **Cable re-grab** (never exercised in a real browser): select a cable, click one end, drop it
      on a different port. Invalid drops must restore, not disconnect. Also check connections now
      apply faster (~375ms → ~144ms typical).

- [ ] **DeckLink**: input strips now appear in the audio mixer with VU meters; a DeckLink layer's
      looks thumbnail uses the captured frame. **Power the camera on** to check both properly, and
      watch for a false "no signal" badge on a live input (see note in the mixer commit).

- [ ] Smaller ones: modal backgrounds no longer blur; looks-editor canvas shows a checkerboard;
      compose panel resize keeps tile sizes; project load actually loads; screen-destination custom
      height sticks; DeckLink 3 destination change takes effect; touchpad scroll inversion in
      Settings > Defaults > Input.

---

## 2. Decide — I deliberately did not do these

- [ ] **SECURITY, decide before the ISO cut.** `ss -ltn` shows NoMachine on `0.0.0.0:4000` and
      CasparCG AMCP on `0.0.0.0:5250`, and `config/casparcg.config` ships
      `<lock-clear-phrase>secret</lock-clear-phrase>`. Every box installed from your ISO is a
      network-reachable remote desktop **plus unauthenticated playout control**. Options: bind to
      localhost, firewall the ports, or ship with the services disabled.

- [ ] **No Chrome binary on the ISO.** Chromium is not installed and the fallback path points into
      `~/.cache`, which is excluded — so template thumbnail rendering will fail on a freshly
      installed box. Either install a chromium package into the image or accept the loss.

- [ ] **`config/casparcg.config` PortAudio is `hw:2,0`, a card that does not exist** (you have cards
      0 and 1 only). Channel 1's audio consumer is aimed at nothing — this is what produces the
      repeated `ALSA lib ... snd_func_card_id returned error` lines in your journal.

- [ ] **Another ~1.6GB of ISO** is in `var/lib/snapd`, ~1.1GB of it provably dead (duplicate
      revisions, plus GNOME/theme bases for the Firefox snap you removed). The fix is on the build
      host **before** produce — `snap remove --purge` the orphans and `snap set system
      refresh.retain=2` — NOT an exclude line, because excluding the images leaves broken mount
      units at boot. Would take the ISO to ~3.0GB.

- [ ] **`scripts/` ships whole in the release tarball and exFAT drop-update.** Consolidating into
      `deprecated/` did not shrink the payload. One-line exclude available; it changes the live
      update path, so it is your call.

- [ ] **wo47 recovery fallback has drifted** from its twin: `wo47-highascg-exfat-boot.sh` is missing
      the network-apply queue block, so a host recovered via the fallback boots without
      network-apply. Only matters when something has already gone wrong.

- [ ] **Monitor picker is not wired to boot.** It works and refuses to run on a configured box
      (verified here), but nothing calls it automatically. One line to enable — your call.

- [ ] **Previs may be dead code** (4,324 lines): it loads three.js from `/vendor/three/`, which does
      not exist in this checkout. Confirm and it can be deleted outright.

---

## 3. Sudo tasks still outstanding

- [ ] `sudo apt --fix-broken install` — the nvidia-595 firmware dependency error you pasted.
- [ ] `sudo cp scripts/setup/highascg-nvidia-persistence.service /etc/systemd/system/ && sudo
      systemctl daemon-reload && sudo systemctl enable --now highascg-nvidia-persistence.service`
- [ ] Re-run the eggs produce once you are happy, and tell me the new ISO size.

---

## 4. Where the details live

- `work/work-orders/copy_todos1.md` — per-item status with commit refs.
- `work/work-orders/todos19.07.26` — your original list, now with a short status note under each.
- `work/work-orders/281_WO_CASPAR_LOG_AUDIT.md` — why your Caspar log looked like the wild west
  (short answer: one powered-off camera; `amcp_batch` was never actually enabled).
- `work/work-orders/282_WO_BROWSER_SOURCE_AUDIO_AND_VIRTUAL_DISPLAY.md` — why shader audio cannot
  work on this box today.
- `work/NATIVE_GUI_PROPOSITIONS.md` — the native GUI answer (recommendation: don't port).
