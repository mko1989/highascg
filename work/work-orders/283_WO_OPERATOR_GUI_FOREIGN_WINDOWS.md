# WO-283 — Operator GUI prevents opening any window on top of it

**Source:** todos19.07.26 — "the operator gui prevents opening any windows on top, like decklink
setup, nvidia, file browser, web browser for operator."

## Why this is a design change, not a bug
The operator GUI is a kiosk Firefox whose window has X SHAPE holes punched through it so the
CasparCG output shows through (WO-255/WO-263). The shape is applied to BOTH the bounding and input
regions, which is what makes the video holes click-dead **by design** — pointer events inside a
hole go to whatever is behind it. Combined with kiosk/fullscreen and always-on-top behaviour, any
other application window either lands behind the kiosk or is unreachable.

So "let windows open on top" means deliberately changing the kiosk's stacking/input contract. Do
not silently weaken the shaped-overlay guarantees to achieve it.

## Required: investigate and write options BEFORE implementing
Produce a short options section in this file covering at least:
- **A. Temporary un-kiosk**: on request, drop always-on-top / lower the kiosk window (or unmap the
  shape) while a foreign window is open, then restore. Cheapest, but the video holes stop working
  while it is active — state clearly what the operator sees during that window.
- **B. Foreign window on a different output**: open helper apps on a non-operator screen where no
  kiosk window exists. Zero risk to the shaped overlay; useless on a single-screen box.
- **C. Managed launch + raise**: launch the helper via the server (like the existing browser/
  DeckLink launch paths, see `src/api/routes-system-browser.js` and
  `tools/runtime/highascg-launch-operator-firefox.sh`), then explicitly raise it above the kiosk
  with `wmctrl`/`xdotool` and restore focus on close. Keeps the shape intact; needs the WM to
  honour the raise.
- **D. Window-manager layer change**: run the kiosk below a dedicated "utility" layer in openbox
  so helpers naturally stack above.

Recommend ONE, with the reasoning, and implement only that. Prefer the option that keeps the
shaped-video contract intact.

## Requirements for whichever option wins
1. The operator must be able to open, use, and close the helper without a keyboard shortcut they
   have to memorise — a button in the operator GUI is the expected entry point.
2. Closing the helper must restore the previous state exactly: kiosk stacking, shape, pointer
   confinement, and focus. A crashed/killed helper must not leave the operator GUI unusable —
   include a restore-on-exit path that runs even if the helper dies.
3. Nothing may change while the operator has not asked for it: no permanent weakening of the
   always-on-top or shape behaviour.
4. Log each transition (helper launched, kiosk lowered/raised, restored) so a stuck state is
   diagnosable from the journal.

## Constraints
- LIVE box: do NOT restart the service, relaunch the kiosk, or mutate the running X session. The
  owner validates on the real display. Read-only X queries (`xrandr`, `xprop`, `wmctrl -l`) are ok.
- Reuse the WO-279 monitor resolution and the existing launcher helpers rather than new mechanisms.
- Offline smoke tests only for the pure logic (state machine: idle → helper open → restored;
  restore-on-crash decision). `npm run test:ci` → 0 fail; no new eslint warnings vs HEAD.
