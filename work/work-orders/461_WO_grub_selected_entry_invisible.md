# WO-461 — Branded GRUB menu: the selected entry is invisible

**Status: IN PROGRESS (fixed + guarded 2026-08-10; visible on the next ISO build)**

Owner (todos10.08): *"in the branded grub menu the chosen boot option is invisible as its almost
the same color as the background."*

## 1. Investigation

`tools/eggs/live-usb/highascg-eggs-theme/theme/livecd/grub.theme.cfg` had:

```
desktop-color: "#0c1220"          <- line 6
...
+ boot_menu {
  menu_bg_color = "18, 26, 42"          <- line 17
  selected_item_bg_color = "94, 179, 255"  <- line 18
  item_color = "#b8c4d8"                <- line 20
  selected_item_color = "#0c1220"       <- line 21
```

**`selected_item_color` was byte-identical to `desktop-color`.** The author's intent is legible
from lines 17-18: dark text on an accent-blue highlight bar. The bar never existed —
**GRUB's gfxmenu `boot_menu` component has no background-colour properties at all.** Its property
set (grub-core/gfxmenu/gui_list.c) covers `item_color` / `selected_item_color`, the `item_font` /
`selected_item_font` pair, geometry, scrollbar, and `*_pixmap_style`; backgrounds come **only**
from pixmap styles. `menu_bg_color` and `selected_item_bg_color` are unknown properties, parsed
and silently discarded. So the highlighted entry rendered as `#0c1220` text on a `#0c1220`
desktop — invisible, exactly as reported, while the idle entries at `#b8c4d8` looked fine.

**Why no gate caught it.** `verify-iso-boot-branding.sh:159-161` did this:

```bash
if grep -q 'menu_bg_color' "$THEME_CFG"; then
    ok "theme.cfg sets boot_menu menu_bg_color (visible labels on dark splash)"
fi
```

It rewarded the presence of a property GRUB ignores, and reported "visible labels" for an ISO
whose selection was unreadable. A check that asserts the *cause* of a bug is present is worse
than no check — it converts the defect into a green line.

## 2. What was done

- `grub.theme.cfg` — dropped both phantom properties; `item_color` dimmed to `#8fa0ba`,
  `selected_item_color` set to `#ffffff`. With no highlight bar available, selection is carried by
  **text colour alone**, so it now reads as bright-white against dim slate on the dark splash.
  A comment records that the two properties do not exist, so they are not re-added.
- `verify-iso-boot-branding.sh` — the menu_bg_color reward is replaced by a real contrast gate on
  the ISO's `theme.cfg`: **fail** if `selected_item_color` is missing, equals `desktop-color`
  (the shipped bug), or equals `item_color`; **fail** if either phantom property is *assigned*.
  The assignment regex is anchored (`^[[:space:]]*name[[:space:]]*=`) precisely so the theme's own
  warning comment does not fail a good ISO — the first draft used a bare `grep -qE` on the names
  and would have failed every future build; the smoke test below caught it before commit.
- `tools/smoke/smoke-wo461-grub-selected-entry-contrast.test.js` (registered in the curated list)
  — parses the theme and asserts selected ≠ desktop, selected ≠ item, and a real **luminance gap**
  (>0.4 vs desktop, >0.2 vs idle items) rather than mere inequality, so a future "dark navy on
  slightly-less-dark navy" cannot pass. Also pins the verifier's new gate and the absence of the
  old one.

Pixmap-based highlight bars (`selected_item_pixmap_style`) were considered and skipped: they need
a set of sliced PNGs baked into the theme for a purely cosmetic gain, where a colour swap fully
solves the reported problem.

## 3. What was VERIFIED to work

- `smoke-wo461-grub-selected-entry-contrast.test.js` — **5/5 pass**.
- Full offline suite: **1910 pass / 0 fail / 2 skip** (256 suites).
- The new verifier logic was executed directly against both themes: the current file reports
  `sel=#ffffff` vs `desk=#0c1220` → OK; a copy with the old `selected_item_color = "#0c1220"`
  reports **WOULD FAIL (invisible)**. The gate demonstrably catches the exact ISO that shipped.
- `bash -n` clean; the anchored grep confirmed not to match the theme's warning comment.

**Remains (owner):** visible only after the next `build-highascg-egg.sh` — the theme is baked into
the ISO at produce time. The build's own `verify-iso-boot-branding.sh` step now aborts the build
if the contrast regresses, so a completed build is the proof.

Unrelated but hit while running the gates: `tools/ci/check-tdz-reads.js` died with
`Cannot find module 'acorn'` — the eggs produce had run `npm prune --omit=dev` in the live tree
(known pattern). `npm install --include=optional` restored it.
