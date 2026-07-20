# WO-287 — No modal may blur the background

**Source:** todos19.07.26 — "NO modal should blur the background making the rest of ui
unreadable. NONE!"

## Problem
Modal overlays apply a backdrop blur, which makes the rest of the interface unreadable. In a live
playout context the operator must be able to read the surrounding UI (bus state, timers, alarms)
while a dialog is open. This is a hard rule, not a preference.

## Scope
1. Grep `client/styles/` for every `backdrop-filter`, `-webkit-backdrop-filter`, and any
   `filter: blur(...)` applied to an overlay/backdrop/scrim element. Include modal, drawer,
   popover, confirm, toast-scrim and shader/CG-studio modal stylesheets.
2. Remove the blur. Keep the overlay readable and clearly layered using a plain translucent
   scrim only (adjust the existing background alpha if contrast needs help). Do not replace blur
   with opacity so high that the background becomes unreadable in a different way — the
   requirement is that surrounding UI stays legible.
3. Check for blur applied from JS (inline styles / class toggling) as well as CSS.
4. Frosted-glass *content* styling that belongs to a lower-third template
   (`template/lower-thirds/lt-frosted-glass.html`) is on-air artwork, NOT UI chrome — do not
   touch it. This WO is strictly about application modals.

## Acceptance
- No `backdrop-filter`/blur remains on any modal or overlay backdrop in `client/styles/`.
- A regression test greps the stylesheets and fails if a backdrop blur is reintroduced.
- `npm run test:ci` → 0 fail; no new eslint warnings vs HEAD.
