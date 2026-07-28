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

## Acceptance
While editing a look on the operator GUI, real Caspar PRV video is visible (with WO-339 chrome);
every click/drag still registers; exiting edit restores normal compose-preview behavior.
