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

## Options — investigated 2026-07-19 (read-only X queries on the live box)

### Measurements that decide this
```
$ DISPLAY=:0 xprop -id 31457325 _NET_WM_STATE      # the kiosk, "HIGHASCG-OPERATOR-GUI — Mozilla Firefox"
_NET_WM_STATE(ATOM) = _NET_WM_STATE_FULLSCREEN, _NET_WM_STATE_ABOVE
$ DISPLAY=:0 xprop -root _NET_SUPPORTED | tr ',' '\n' | grep STATE_ABOVE
 _NET_WM_STATE_ABOVE
$ DISPLAY=:0 xrandr --query | grep ' connected'
DP-0 connected 3072x1728+0+0 ...
DP-5 connected primary 1920x1080+3072+0 ...
$ which wmctrl        # -> not found (xdotool IS installed; use it, per operator-gui-launcher.js:24)
```
The kiosk client permanently carries `_NET_WM_STATE_ABOVE` — `operator-shape-overlay.py`'s
`lock_window_above()` re-sets it on every `apply_holes()`, and that is exactly what stops a click
routed through a bounding hole from letting Openbox raise the Caspar consumer over the GUI. Openbox
stacks strictly by layer (below < normal < ABOVE < fullscreen) and **clamps every restack request
to the window's own layer**.

- **A. Temporary un-kiosk.** Works, but during the helper the bounding holes stop showing video —
  the operator sees a grey/blank Firefox where the previews were. Rejected: it breaks the exact
  guarantee the WO says not to weaken.
- **B. Foreign window on another output.** DP-0 is the 3072x1728 PROGRAM head. Putting a file
  browser there means putting it on air. Rejected on this box.
- **C. Managed launch + explicit raise.** ✅ **CHOSEN — viable, with two corrections the WO did not
  spell out.** A bare `xdotool windowraise`/`windowactivate` on a helper is a **no-op** against the
  kiosk, because the helper is a NORMAL-layer window and the kiosk is ABOVE-layer. C works once:
    1. the helper is promoted into the same layer — `xdotool windowstate --add ABOVE <wid>`; and
    2. the shape overlay's per-payload top-assert (`toplevel.configure(stack_mode=X.Above)` at the
       end of `apply_holes()`) is suspended while the helper is up, or the next rects payload
       re-raises the kiosk over it.
  A third, box-specific trap: the helper Firefox is the SAME binary as the kiosk, so no WM_CLASS
  filter can separate them — the lookup excludes the kiosk by its `HIGHASCG-OPERATOR-GUI` title
  marker. (Also note `GUI_WINDOW_CLASS.firefox = 'Navigator'` is Firefox-ESR's res_NAME here, so
  `xdotool search --class Navigator` matches nothing; the new lookup tries `--classname` too.)
  `windowactivate` is still needed and still load-bearing: the kiosk's FULLSCREEN state promotes it
  to Openbox's fullscreen layer **only while focused**, so giving the helper focus drops the kiosk
  back to ABOVE where the helper can sit over it. This is Openbox's designed "fullscreen yields
  when unfocused" behaviour, not a hack.
- **D. WM layer change.** Would require editing openbox rc and restarting the WM on a live box, and
  it permanently demotes the kiosk — the opposite of requirement 3. Rejected.

### What C does and does NOT touch
Untouched in every state: the bounding holes, the kiosk's own `_NET_WM_STATE_ABOVE`, the Caspar
consumer's input-dead lock, and the pointer confinement. The ONLY thing that changes while a helper
is open is that one `stack_mode=X.Above` call is skipped — and only after the operator pressed the
button. The shaped-video contract is intact throughout, including while the helper is on screen.

### Implementation map
| Piece | File |
| --- | --- |
| State machine + watchdog + restore | `src/system/operator-helper-window.js` (new) |
| `helperOpen` flag on the overlay protocol | `src/system/operator-shape-overlay.js` (`setOperatorShapeHelperOpen`) |
| Skips the top-assert when `helperOpen` | `tools/runtime/operator-shape-overlay.py` (`apply_holes`) |
| `--add ABOVE` + kiosk-excluding lookup | `src/utils/x-display-session-runtime.js` (`promoteGuiWindowsAboveKiosk`, `findGuiWindowIds`) |
| Child handle for the exit watch | `src/api/system-hardware-gui.js` (`spawnGuiDetached` `onSpawn` hook) |
| API | `POST`/`GET /api/system/operator-helper-window` |
| Operator button | `client/components/header-bar-operator-helper.js` → header mid group |
| Offline tests | `tools/smoke/smoke-wo283-operator-helper-window.test.js` (17 tests) |

### Restore-on-crash
Restore is driven by a **750ms watchdog poll**, not by a clean-close handler. Each tick samples
"is a helper X window still mapped?" (`xdotool search --onlyvisible --class`) plus whether the
direct child exited, and feeds the pure `decideRestoreOnExit()`. A mapped window outranks a dead
child (thunar forks and its launcher exits immediately); a vanished window restores even if the
exit event was never seen (`kill -9`); a child that dies before mapping anything restores at once;
and a helper that never appears within 8 ticks (6s) restores anyway. Restore is idempotent, so the
exit event and the poll racing cannot double-restore.

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
