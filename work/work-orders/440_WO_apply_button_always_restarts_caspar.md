# WO-440 — Apply button ALWAYS restarts Caspar (unchanged-gate blocked env-only changes)

**Status: DONE (2026-08-06 — suite 1858/0/2, built + kiosk F5; owner presses Apply once to restart Caspar and arm GL sync)**

Owner (todos06.08.26 item 3): "the apply and restart button should ALWAYS restart caspar.
right now id like to force it to restart so the gl sync takes, but it just says no changes
so no restart."

## Investigation

- The skip is WO-337 #5's unchanged-gate (`src/utils/full-config-apply.js:149`): identical
  on-disk XML + verified xrandr layout → `no_changes`, Caspar left running (built to make a
  "did I already apply?" click cost <1 s instead of ~18 s).
- The gate has TWO blind spots, and the owner hit both today:
  1. **caspar-env drift is invisible to it** — `~/.config/highascg/caspar-env`
     (`CASPAR_GL_SYNC_DISPLAY`, WO-407/439) is rewritten during the apply but is NOT part of
     the XML the gate compares, and it only reaches Caspar at launch. An env-only change can
     therefore NEVER trigger the restart that makes it take.
  2. **No operator override existed in the UI** — the gate's `force` bypass was already
     plumbed (route parses `b.force`, one-shot editor XML forces implicitly) but the Devices-tab
     button never sent it.

## What was done

- `client/components/device-view-actions.js` `applyCasparConfig()`: always sends
  `force: true`. The owner's ruling is encoded at the button: Apply = restart, every time.
- Deliberately NOT forced: `client/lib/project-hardware-apply.js` (background apply on
  project load posts directly without force) — loading a project whose hardware already
  matches must not restart Caspar mid-show. The gate keeps earning its keep there.
- Smoke (`tools/smoke/smoke-wo440-441-apply-force-inspector-fit.test.js`, curated list):
  button sends force; gate keeps its `opts.force !== true` bypass; route parses `b.force`;
  project-hardware apply stays force-free.

## Verified

- Suite **1860 tests, 1858 pass, 0 fail, 2 skip**; built + kiosk reloaded.
- Attempted to fire the forced apply directly (owner asked for the restart "right now") —
  blocked by the session's permission layer on the API POST. **Owner: press Apply once** —
  it now restarts unconditionally; the regenerated caspar-env gains
  `CASPAR_GL_SYNC_DISPLAY=DP-0` (WO-439 verified the resolution against the live config) and
  the relaunched Caspar picks up `__GL_SYNC_DISPLAY_DEVICE=DP-0`. Verify afterwards with:
  `grep CASPAR_GL_SYNC ~/.config/highascg/caspar-env` and
  `tr '\0' '\n' < /proc/$(pgrep -f 'bin/casparcg .*config' | head -1)/environ | grep GL_SYNC`.
