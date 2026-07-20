# Verify now — checklist for the owner (2026-07-20)

Everything below is either **you need to look at it** or **you need to decide it**. Ordered by
what would hurt most if wrong. Server is running the new code; the kiosk needs a reload.

---

## 0. Do this first (one minute)

- [ ] **Reload the kiosk Firefox.** The server restarted, but the browser is still running the old
      bundle. Most of the UI fixes below are invisible until you reload.

---

## 1. Verify — the things I fixed that you reported (highest value)

- [x] **Compose preview layout after restart** (the one I wrongly marked done).
      Restart highascg, watch the operator GUI come up. Your saved tile layout must be there
      *without* triggering a look. Journal proof to compare against:
      `journalctl -u highascg -f -o cat | grep -E "re-apply|first rect report"` —
      you want `first rect report ... cells=3`, not `cells=1`.
      Known cosmetic leftover: the holes close once for ~2s during boot before the layout lands.

- [x] **First look play after a restart.** You reported it fails after a long timeout and freezes
      the app. I fixed an AMCP wedge and have seen no recurrence, but I am NOT claiming it fixed.
      Take a look right after a restart and tell me.

- [x] **PRV precision + realtime.** Play several looks on preview. Watch for: a layer missing, or a
      layer wearing another layer's position/scale. Then drag geometry in the looks editor — edits
      should appear on PRV almost immediately.

- [x] **Route looks land on one frame.** Play the look with 1 media layer + 3 route layers. All four
      must appear together, not one by one.
small edit here. the route shouldnt go to live sources browser but be added as a new layer in that look only.
- [x] **EDIT PGM + CAPTURE** buttons on each PGM tile footer. EDIT PGM opens the on-air look with a
      red "LIVE — EDITING PGM" badge and edits hit air. CAPTURE writes a PNG in the Caspar media
      folder and toasts.

- [ ] **Open window ▾** button in the header (operator GUI mode): DeckLink setup / file browser /
      NVIDIA settings must appear **over** the kiosk and be clickable, the video holes must keep
      showing Caspar output while it is open, and closing it must restore the GUI.
      Also test the crash path: `kill -9` the helper — the GUI must restore within ~1s.
nothing can be shown over the gui. i need to be able as a user use web browser, file browser, setups decklink and nvidia etc.
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

---

## Alt-tab white border

Investigated read-only on this box (2026-07-19). Nothing was changed — no openbox config was
edited and `openbox --reconfigure` was NOT run (live playout session).

### What draws it

Openbox's own **focus-cycle indicator**, not a compositor and not the GTK theme.

Evidence:

- WM is `openbox 3.6.1-12build5` (`dpkg -l openbox`), running as
  `/usr/bin/openbox --startup /usr/lib/x86_64-linux-gnu/openbox-autostart OPENBOX`.
- **No compositor is running** — `pgrep -a 'picom|compton|xcompmgr|mutter|kwin|xfwm|marco'`
  returns nothing. So nothing else is in a position to draw an overlay outline.
- Alt-Tab is bound to openbox's own cycler: `/etc/xdg/openbox/rc.xml:254-262`
  `<keybind key="A-Tab"><action name="NextWindow">…` (A-S-Tab -> `PreviousWindow` at :263).
- The openbox binary contains the indicator routines:
  `focus_cycle_indicator_startup` / `focus_cycle_update_indicator` /
  `focus_cycle_draw_indicator` / `focus_cycle_indicator_shutdown`
  (`strings /usr/bin/openbox`). That indicator is four override-redirect windows forming a
  line-art rectangle around the *candidate* window while the cycle popup is up — which matches
  "white border around the chosen window, only while alt-tabbing".

**There is no config file on this box that owns it.** `~/.config/openbox/` contains only
`autostart` — there is **no user `rc.xml`**, so `/etc/xdg/openbox/rc.xml` is the effective config.

### Why it is white, and why the theme cannot fix it

This is **rc.xml-level, not theme-level.**

- Active theme is `Clearlooks` (`/etc/xdg/openbox/rc.xml:51-52` `<theme><name>Clearlooks</name>`),
  themerc at `/usr/share/themes/Clearlooks/openbox-3/themerc`.
- `libobrender.so.32` exposes **58 colour theme keys**; enumerating them
  (`strings /usr/lib/x86_64-linux-gnu/libobrender.so.32 | grep -E '^(window|menu|border|osd)\.'`)
  shows **no key for the focus-cycle indicator**. The only client-ish keys are
  `window.active.client.color` / `window.inactive.client.color`, and those colour the frame's
  client-area border, which is drawn all the time — not only during alt-tab.
- So the indicator colour is compiled into openbox (white line art), which is why editing
  `osd.*`, `window.active.border.color` or `*.border.color` in the themerc will not touch it.
  Confirmed the Clearlooks themerc does not set `client.color` at all.

Nothing under `osd.*` is the outline either — those keys style the alt-tab *popup panel*
(the window list), which is a separate thing from the rectangle on the target window.

### The change that disables it

Add `<bar>no</bar>` to the cycling actions. `bar` is the openbox option that gates
`focus_cycle_draw_indicator` (the outline); `dialog` gates the icon/list popup — keep `dialog`
alone if the popup itself is still wanted.

Do it in a **user** rc.xml rather than editing the system file:

```sh
mkdir -p ~/.config/openbox
cp /etc/xdg/openbox/rc.xml ~/.config/openbox/rc.xml
```

then in `~/.config/openbox/rc.xml`, for both `A-Tab` (`NextWindow`) and `A-S-Tab`
(`PreviousWindow`) — and `C-A-Tab` if that one is used too:

```xml
<keybind key="A-Tab">
  <action name="NextWindow">
    <bar>no</bar>
    <finalactions>
      <action name="Focus"/>
      <action name="Raise"/>
      <action name="Unshade"/>
    </finalactions>
  </action>
</keybind>
```

### Reconfigure or restart?

`openbox --reconfigure` is enough for an rc.xml that **already exists** — keybindings and their
action options are re-read on reconfigure; no session restart, no X restart.

Caveat for the recipe above: it *creates* `~/.config/openbox/rc.xml` where there was none. A
reconfigure re-resolves the XDG config path, so it should be picked up, but if the outline is
still there after `openbox --reconfigure`, a session restart is the guaranteed pickup. Either way
this is a live-playout box, so schedule it — do not run it mid-show.

### Confidence note

The chain WM -> openbox cycler -> `focus_cycle_draw_indicator` is directly evidenced above.
That `<bar>no</bar>` is the switch for it is from openbox 3.6's action option set, which could
not be re-confirmed from the shipped binary alone: the packaged openbox is stripped (`nm` finds
no symbols) and short option names are suffix-merged into other strings by the linker
(`bar` inside `skip_taskbar`, `dialog` inside `placing dialog`, `linear` inside
`NotifyNonlinear`), so they have no standalone entries. The sibling options from the *same*
option table do appear standalone and adjacent (`raise`, `panels`, `finalactions` at consecutive
offsets), which is consistent. If `<bar>no</bar>` turns out not to take, the fallback is
`<dialog>none</dialog>` plus `<bar>no</bar>` together, which disables the cycling UI wholesale.
