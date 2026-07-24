# WO-324 — Operator GUI "stuck together" with the Caspar screen consumer (triage first)

**Source:** todos22.07.26 — "operatort gui in kiosk sticked togheter with caspar screen consumer."

## Why this is a triage WO
"Stuck together" is under-specified and maps to at least four distinct behaviours — only some of
which exist in the codebase. **The owner must supply one live observation before the fix is scoped**
(see §Repro). Do not start coding until the mechanism is pinned; the wrong assumption here risks the
hole-alignment contract that took two prior redesigns to settle (box memory, 2026-07-16).

## Current architecture (both windows are pinned to the SAME operator-monitor rect, by design)
Two independent paths place the two windows on the identical rect from one source of truth:

- **Firefox kiosk (operator GUI):** rect from `resolveKioskMonitorRect` → `resolveOperatorMonitorRect`
  (fallback `resolveOperatorGuiMonitorRect`) — `src/system/operator-gui-launcher.js:184-204`; moved/
  sized + verified with backoff (FULLSCREEN off/move/on escalation) in `placeKioskWindow`
  (`:270-319`), driven from `positionFirefoxWindow` (`:327-348`). Kept ABOVE + top-asserted by the
  shape helper (`tools/runtime/operator-shape-overlay.py:416-419`, re-asserted every poll).
- **Caspar screen consumer:** placed once at config-generation time at `<x>posX</x><y>posY</y>` with
  `posX/posY = rect.x/rect.y` from `resolveLayoutRectForOperatorPort`
  (`src/config/config-generator-operator-gui.js:71-80`), `always-on-top=false`, `borderless=true`
  (`:90-91`). Forced BELOW + input-dead at runtime by `enforce_caspar_under`
  (`operator-shape-overlay.py:340-369`).
- **Shared rect (the key):** both resolve through `resolveOperatorGuiPort` →
  `resolveLayoutRectForOperatorPort` (`src/utils/x-display-session-layout.js:139`); the feeder
  `resolveOperatorGuiMonitorRect` (`src/system/operator-gui-channel.js:105-117`) comments it must
  "always match where the generator actually placed the screen consumer window." Firefox and the
  Caspar window are **required to occupy the identical rect** so the holes punched in Firefox (monitor-
  relative pixels, `operator-shape-overlay.py:26-32,390-401`) line up over the video behind — the
  helper even matches Firefox by exact monitor-rect geometry (`:213`).

## What the investigation ruled OUT
- **No runtime code repositions one window to follow the other.** The generator sets Caspar x/y once
  (`config-generator-operator-gui.js:80`); the overlay only ever changes Caspar's SHAPE/EWMH-state/
  stacking, never its x/y (`enforce_caspar_under` issues no configure-move). So a literal "drag one,
  the other travels with it" is **not** explained by this stack — it would be Openbox/WM behaviour or
  a new coupling, not existing code.
- `operator-snap-home.js` is a **red herring** — it fixes `~/snap` directory ownership for Firefox,
  nothing to do with window snapping.

## The four candidate mechanisms (owner's repro picks one)
- **(a) Same position / full overlap** — EXPECTED, by design (shared rect). If this is the complaint,
  the real ask is "let the operator move the GUI / compose preview independently," which conflicts
  with the hole model and is a redesign, not a bug fix.
- **(b) Resize-/move-locked (drag one → the other tracks its on-screen position)** — **not in this
  codebase**; would be Openbox or a new coupling. Needs confirmation and a different fix surface.
- **(c) Focus/z-order-linked (can't bring the video forward / can't send Firefox back)** — BY DESIGN
  via the 2s watchdog `enforce_caspar_under` (`operator-shape-overlay.py:362-368`), which reverts any
  inversion within `POLL_INTERVAL_SEC = 2.0` (`:67`). If this is the complaint, the fix is a
  scoped/relaxable watchdog rule, not a geometry change.
- **(d) Both move when the operator drags a taskbar/helper window** — would implicate the helper-
  window promotion path (`src/utils/x-display-session-runtime.js:173-224`, `resolveHelperWindowRect`),
  separate machinery (cf. WO-317).

## Repro the owner must capture (single observation, decides everything)
On the box, grab the operator GUI's title/edge and drag it, and separately try to bring the video
window forward. Report which happens:
- the **other window's on-screen position changes** → (b)/(d);
- only **stacking/focus** reverts, positions unchanged → (c);
- **nothing moves** because they simply always occupy the same rect → (a).
Also note: is the compose/screen-consumer video visibly offset from where the GUI holes are (holes
revealing wrong content), or perfectly aligned?

## Ground truth to read first
- `src/system/operator-gui-launcher.js:184-319` — Firefox rect resolve + placement.
- `src/config/config-generator-operator-gui.js:71-91` — Caspar consumer x/y + flags.
- `tools/runtime/operator-shape-overlay.py:26-32,213,241-266,340-369,390-419,542-545` — hole coords,
  window matching (Firefox by geometry, Caspar by WM_CLASS `casparcg`/title "Screen consumer"),
  `enforce_caspar_under`, above-lock, poll.
- `src/system/operator-shape-overlay.js:117-164` — helper respawn (lazy on `updateShapeRects`) +
  reapply on Caspar reconnect (`reapplyOperatorShapeOverlay`).
- `src/utils/x-display-session-layout.js:139` + `src/system/operator-gui-channel.js:105-117` — shared
  rect source of truth.
- Prior context: WO-279 (monitor placement), WO-283 (foreign windows), WO-308 (split monitor from
  pointer-confine), WO-317 (multi helper windows), WO-318 (shape holes at 2160p50).

## Constraints (whatever the fix turns out to be)
- **Do NOT revisit input=full ideas** — the X SHAPE input∩bounding reality is documented at
  `operator-shape-overlay.py:283-298` and settled 2026-07-16; hole clicks always reach the window
  below (box memory: [[operator-gui-holes-click-dead]]).
- The holes reveal video ONLY because the two windows are co-located — **naively moving them apart
  breaks the hole contract** (`operator-shape-overlay.py:26-32,390-401`, geometry matcher `:213`).
- Any fix must survive fresh window ids: helper respawns lazily and re-feeds on Caspar reconnect with
  none of its runtime state (`operator-shape-overlay.js:117-164`); watchdog is a 2s poll.
- LIVE box: the operator monitor is in use during shows.

## Acceptance
- The observed "stuck together" behaviour (per the owner's repro → one of a/b/c/d) is reproduced,
  named, and either fixed or — if it is (a) by-design co-location — documented back to the owner with
  the trade-off, and the real underlying ask (independent movement?) turned into a follow-up WO.
- If (c): the watchdog change lets the intended interaction through without inverting the hole/stack
  contract; holes still align, Firefox still input-live, Caspar still input-dead-below.
- If (b)/(d): the coupling is identified (Openbox rule or helper-window path) and removed without
  disturbing the shared-rect alignment.
- Helper respawn + Caspar reconnect still re-assert the correct state within one heartbeat; no hole
  misalignment on the operator monitor. Verify on-box (this subsystem has no offline test coverage).

## Ambiguities for the owner
1. **The repro observation above — required before implementation.**
2. If the true ask is "move the GUI independently of the video" (mechanism a), confirm whether that
   is wanted at all, given it conflicts with the current holes-reveal-video model — that would be a
   larger redesign WO, not this fix.
