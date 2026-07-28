# WO-343 — look editor shows the REAL preview channel video (screen consumer) while editing

**Source:** owner 2026-07-26 — "especially in the operator gui on the server i need to see the
actual preview channel on the casparcg screen consumer while editing layers on a look. i mean in
the look editor not only in the compose preview."

**Status: IMPLEMENTED 2026-07-26 late; DESIGN-2 UPGRADE 2026-07-28: pointer-drags on preview surfaces now re-open the holes 150ms into the drag (press-time blank kept) — the X implicit pointer grab (button held, press landed on Firefox pixels) keeps delivering motion/release across the hole, so the operator sees REAL video through the drag. Modal/dropdown suppression unchanged. Owner QA: drag layers with PRV watch on; revert = DRAG_REOPEN_MS in operator-gui-interaction-suppress.js. — owner's own design won:** reuse the SAME screen consumer
under the kiosk. A 'PRV' toggle in the edit bar punches a hole over the edit canvas routed to that
main's preview channel (new 'lookedit' surface, role prv+mainIndex); the WO-339 edit_chrome ON the
channel is the "transparent overlay" (Firefox cannot draw over a hole). WATCH mode by design:
layer strip / inspector / toolbar stay clickable (Firefox pixels), toggle off to mouse-drag inside
the frame — the X SHAPE input contract makes in-hole clicks impossible, documented on the button.
Withdrawn on toggle-off / editor exit; re-reported on resize/tab switch. Owner validates on the
real display.**

**Status (original): OPEN — this is the WO-339 v2 visibility design.** The naive version (hold the punch-hole
open during editor interaction) shipped and was REVERTED same night (9cc305a): X SHAPE input =
input∩bounding, so every click inside an open hole falls through to the input-dead consumer —
"not every gui click registers" ([[operator-gui-holes-click-dead]]).

## Design directions to evaluate (pick at pickup)
1. **Hole-with-input-islands:** keep the hole open during edit but make the drag interactions
   happen on a THIN chrome margin/handles OUTSIDE the hole rect (hole inset by ~12px so handles
   and rulers remain clickable Firefox pixels; the interior video is view-only). Drags on the
   interior start from the handle ring instead. Preserves the input contract untouched.
2. **Suppress-on-press, restore-on-release, per-cell:** today's suppression blanks holes for the
   whole pointer interaction; instead re-open the hole DURING the drag once the drag has captured
   the pointer (pointer capture keeps events flowing to the Firefox element that received
   pointerdown even if the pointer moves over the hole — verify X SHAPE doesn't break pointer
   capture in Firefox; if capture holds, the hole can re-open 1 frame after pointerdown).
   This is the cleanest if capture survives the shape hole.
3. **Dedicated PRV consumer window:** wire the dormant `preview_screen_consumer` setting
   (declared `src/config/defaults-caspar-server.js:53`, read by nothing) into the config
   generator so PRV renders in its own screen-consumer window placed beside/under the editor
   (second monitor or a reserved rect) — zero interaction conflicts, real video always visible.
   Owner said "on the casparcg screen consumer" — this may be the intended reading.

WO-339's on-channel edit chrome (edit_chrome layer 990, already implemented) pairs with any of
these: the operator sees real video + outlines while input stays reliable.

## Test coverage (added 28.07.26)

This shipped, was reverted once (`9cc305a`), shipped again in `9f0e2d8` + `ba8970f` — and had **no
test at all**. `tools/smoke/smoke-wo343-prv-watch-suppression.test.js` (9 tests, curated list) now
pins the suppression state machine BEHAVIOURALLY against a stub DOM, not by source text:

- press on a preview surface blanks the holes **immediately** (the press must never race an open
  hole — the X SHAPE input∩bounding contract that killed v1);
- still held past `DRAG_REOPEN_MS` → holes re-open, so the operator sees real video through the drag;
- release returns to idle and the reopen latch does **not** survive into the next press;
- a short click never leaves the holes reopened (the timer must not fire after release);
- presses outside a preview surface are ignored, so GUI chrome stays live;
- a modal blanks regardless and is never uncovered by the reopen timer;
- an HTML5 drag suppresses for its whole duration (drop targets under holes).

Timing note for whoever touches this next: two timers gate the observable state — the detector's
`DRAG_REOPEN_MS` (150) and the report layer's `RESTORE_DEBOUNCE_MS` (300, `operator-gui-mode-report.js`).
Blanking is immediate; **un**-blanking is debounced. A test that waits only past the reopen latch
will see the old state and look like a failure of the feature.

## Acceptance
While editing a look on the operator GUI, real Caspar PRV video is visible (with WO-339 chrome);
every click/drag still registers; exiting edit restores normal compose-preview behavior.

**Still owner QA on the real display** (that is what this WO waits on — the code is in and now
tested): drag layers with the PRV watch toggle on; the revert knob is `DRAG_REOPEN_MS`.
