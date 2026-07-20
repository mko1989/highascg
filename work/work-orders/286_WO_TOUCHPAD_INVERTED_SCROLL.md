# WO-286 — Inverted two-finger scroll for laptop touchpads

**Source:** todos19.07.26 — "for laptop touchpads we need inverted two finger scroll."

## Problem
HighAsCG is operated both on the playout box (mouse wheel) and from a laptop (touchpad). Wheel
handlers written for a mouse feel backwards under natural/two-finger touchpad scrolling, most
visibly wherever the UI consumes `wheel` to zoom or pan (device graph / cable canvas, compose
canvas, timeline) rather than to scroll a list.

## Scope
1. Find every `wheel`/`onwheel` handler in `client/` (exclude `dist-web/`). Classify each as
   *list scrolling* (browser-native, leave alone) or *custom zoom/pan* (candidate).
2. Add a single user preference — **Invert touchpad scroll** — persisted with the other UI
   preferences (find the existing settings/persistence pattern; do not invent a new store).
   Default **off** so current behaviour is unchanged for mouse users.
3. Apply the inversion in ONE shared helper (e.g. `client/lib/wheel-delta.js`) that returns the
   normalized `{ dx, dy }` for a wheel event, honouring the preference; migrate the custom
   zoom/pan handlers to it. Do not sprinkle `* -1` at call sites.
4. Prefer detecting the device where it is reliable (`event.deltaMode === 0` plus small
   fractional deltas indicates a touchpad) only as a *hint* in the setting's help text — the
   preference is the authority, no silent heuristics changing behaviour on the fly.

## Acceptance
- Preference visible in the UI, persists across reload, defaults off.
- With it on, custom zoom/pan directions invert; native list scrolling is untouched.
- Offline smoke test for the helper: same input event yields opposite `dy` with the flag flipped.
- `npm run test:ci` → 0 fail; no new eslint warnings vs HEAD.
