# WO-290 — Opt-in operator-GUI monitor picker for a fresh / factory-reset system

**Source:** todos19.07.26 — "idea for opt in operator gui start on a fresh, not configured yet
system (or after a factory reset) it should start a small service that tracks mouse, user hovers
the mouse to the screen he wants to be his gui, clicks left mouse and this gets chosen as the
operator gui, the service sleeps."

## Problem
On a fresh box nothing knows which physical screen the operator sits at, so the operator GUI has
no monitor to open on. Today that is configuration the owner must supply before the GUI is usable.
The wanted interaction: point at the screen you want, click, done — no config, no keyboard.

## Design
A small opt-in picker that runs ONLY when the operator monitor is unconfigured (or when explicitly
invoked), and sleeps immediately afterwards.

1. **Trigger condition — be strict.** Run only when no operator monitor is configured, i.e. the
   same source of truth the launcher and pointer confinement now share
   (`resolveOperatorMonitorRect` in `src/utils/x-display-session.js`, per WO-279). It must never
   run on a configured box, never on every boot, and never steal a click during playout.
2. **Prompt on every screen.** Show an unmissable full-screen hint on each connected output ("Click
   here to make this your operator screen"), so the operator can see where to click regardless of
   which screen they are looking at. Plain X/GTK-free approach preferred — reuse what this repo
   already spawns (the shape-overlay helper `tools/runtime/operator-shape-overlay.py` is a Python/X
   precedent; a simple X window per output is enough — no new heavy dependency).
3. **Pick and persist.** On left click, resolve which output contains the pointer
   (`xrandr` geometry, same resolution logic the launcher uses), persist it to the operator-monitor
   config the launcher reads, tear down every prompt window, and exit. Then the normal operator-GUI
   launch path proceeds on the chosen screen.
4. **Escape hatch.** A timeout (e.g. 2 minutes) and a key (Esc) must abandon the picker without
   selecting anything, leaving the system exactly as before. A headless/one-output box should skip
   the picker entirely and just pick the only output.

## Constraints
- **Never run during playout.** Gate hard on "unconfigured", and log the decision either way so a
  surprise picker is diagnosable.
- Do not restart the highascg service or spawn the picker on this box as a test — it would take
  over the live operator display. Exercise the logic offline.
- Reuse the WO-279 monitor resolution; do not derive outputs a second, independent way.
- Do not run `npm run build:client`.

## Acceptance
- Picker runs only when unconfigured, persists the choice where the launcher reads it, and sleeps.
- Timeout and Esc abandon cleanly; single-output boxes auto-select without prompting.
- Offline smoke test for the pure parts: trigger predicate (configured vs not), pointer→output
  hit-testing, timeout/abandon behaviour, single-output shortcut.
- `npm run test:ci` → 0 fail; no new eslint warnings vs HEAD.
