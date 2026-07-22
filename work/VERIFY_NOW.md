# Verify now — outstanding only (rewritten 2026-07-20 14:50)

Everything you already confirmed has been stripped out. What is left is: **things to test**,
**things only you can do**, and **decisions already closed** (listed so they stop coming up).

---

## 0. Do this first

- [ ] **Reload the kiosk Firefox.** Every client fix below is built into `dist-web/`, but the
      running browser still has the old bundle. A service restart does not reload it.

---

## 1. Test these — every one is something you reported as broken

- [ ] **Open window ▾** (header, operator-GUI mode) — browser / file browser / DeckLink setup /
      NVIDIA settings must appear **over** the kiosk and be clickable, with the video holes still
      showing Caspar. Closing it must restore the GUI. Also `kill -9` the helper: the GUI must come
      back within ~1s.
      *Why it failed: the probe for xdotool ran `/usr/bin/command`, which does not exist (it is a
      shell builtin), so an installed xdotool was reported missing and the window lookup was blind;
      and the raise used an xdotool subcommand your version does not have, failing silently.*

- [ ] **Cable re-grab** — select a cable, click one end, drop it on another port. An invalid drop
      must restore, never disconnect.
      **This is the least-proven fix I have shipped.** There is no browser test harness in this
      repo, so hit-target size and z-order at real geometry are unverified by me.
      *Why it failed: clicking a cable's visible end cleared the very selection the gesture needs.*

- [ ] **Cabling must NOT restart CasparCG** — connect a screen destination to a DeckLink output.
      Output must keep running and the **Apply** button should light up instead.
      *This was deliberate, with a test asserting the restart. A graph edit now only marks apply
      pending; you decide when output is interrupted.*

- [ ] **Live audio input Start** — stop an input, then start it again from the mixer strip (▶) or
      the inspector. *There was no start control anywhere before; only a whole-rig apply (which
      glitches inputs still on air) or a Caspar restart could revive capture.*

- [ ] **Routes on preview** — a look with a route layer must show it on PRV, not just PGM. And
      creating a route from a layer (↗) should land with the **same position and size** as its
      source. *The editor's live preview bypassed the take pipeline and told PRV to play a route
      pointing at the program channel.*

- [x] **Compose preview layout survives a restart** — restart highascg; your saved tile arrangement
      must be there without triggering a look.
      Check: `journalctl -u highascg -f -o cat | grep -E "re-apply|first rect report"` → want
      `cells=3`, not `cells=1`.
      *Two bugs: the kiosk reported a provisional 1-tile layout over the restored one, and a client
      disconnect persisted an EMPTY layout, wiping your saved arrangement.*

- [x] **Reset layout** in the compose preview — should pack tiles much better now (measured on a
      1920x1080 canvas: +15% video area for 2 tiles, +143% for 3, +23% for 5).

- [ ] **PGM always-on-top** — the PGM screen consumer should stay above other windows, and the
      setting must survive a config generate.
      *A worse bug sat underneath: the operator-GUI destination was overwriting the PGM consumer's
      settings on every generate — not only always-on-top but all 16 fields, including x, y, name,
      stretch and colour space.*

- [ ] **Modal backgrounds** — fully transparent: no blur and no tint.

- [x] **Alt-tab white border** — should be gone. I created `~/.config/openbox/rc.xml` with
      `<bar>no</bar>` and ran `openbox --reconfigure`; the system file is untouched, so deleting the
      user copy reverts it. If the outline persists, add `<dialog>none</dialog>` in the same block.

- [ ] **DeckLink camera — power it on.** Then check the mixer strip shows real VU, the looks
      thumbnail uses the captured frame, and there is **no false "no signal" badge** on a live
      input. That last case is the one I could not test without a live camera.

- [ ] **Yamaha DM3 capture** — should be running; worth a listen. *It was failing on every respawn:
      the DM3 is S32_LE only and the configured `dsnoop:` device does no format conversion. It now
      falls back to `plughw:` and remembers what worked. Verified live in the journal.*

---

## 2. Only you can do these

- [x] **Snap cleanup (~1.5GB off the ISO).** One at a time. The earlier error was that `--purge` is
      a flag, not the target — it needs a snap name after it:
      ```bash
      sudo snap set system refresh.retain=2
      sudo snap remove --purge gnome-46-2404      # 607M — base for the Firefox snap you removed
      sudo snap remove --purge gtk-common-themes  # 92M
      sudo snap remove --purge mesa-2404          # 797M across both revisions
      ```
      Verified nothing else uses these. Keep `tailscale` and `core24`.

- [ ] **Re-run the eggs produce**, then tell me the new ISO size. Expect ~4.1GB from the excludes
      already committed, or ~3.0GB once the snaps above are gone (it was 5.9GB).

---

## 3. Closed — recorded so they stop coming up

Services stay reachable on **LAN + Tailscale**; no security layer wanted on the local network.
**No Chrome needed** (CEF for Caspar, Firefox for everything else). **Previs parked** and excluded
from the release, source kept in git. **Deprecated scripts excluded** from eggs. **`hw:2,0` is
correct** — the DM3 is card 2 now the mixer is on, so it was never a bug. Openbox edits are fine on
this box ("dev box, dont worry"). `apt --fix-broken` and the NVIDIA persistence unit are done and
verified (persistence is Enabled and the unit is enabled at boot).

---

## 4. Where the detail lives

- `work/work-orders/copy_todos1.md` — per-item status with commit refs
- `work/work-orders/todos19.07.26` — your original list, with a short status note under each item
- `work/work-orders/281_WO_CASPAR_LOG_AUDIT.md` — why the Caspar log looked like the wild west
  (one powered-off camera; `amcp_batch` was never actually enabled)
- `work/work-orders/282_WO_BROWSER_SOURCE_AUDIO_AND_VIRTUAL_DISPLAY.md` — why shader audio cannot
  work on this box today (no sound server at all, so no loopback device exists)
- `work/LOCALHOST_CHANNEL_VIEW.md` — low-latency Caspar channel in the browser (keep the holes for
  the operator, add an NVENC stream for the laptop view)
- `work/NATIVE_GUI_PROPOSITIONS.md` — native Ubuntu GUI options (recommendation: do not port)
