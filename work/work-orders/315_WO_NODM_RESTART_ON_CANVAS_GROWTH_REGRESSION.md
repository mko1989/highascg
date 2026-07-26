# WO-315 — VERY IMPORTANT: nodm restart on desktop-canvas growth stopped firing

**Status (2026-07-26 audit): DONE — the decision inputs were root-caused and fixed 2026-07-21 per this WO; canvas-growth nodm path observed working in the WO-337 measurements (2026-07-24 apply). Verify on the next real canvas-growth apply.**

**Source:** todos21.07.26 — "VERY IMPORTANT — when total resolution of the planned gpu outputs
desktop xrandr is bigger than current the restart needs a nodm restart too. this was already
coded in but either got deleted or stopped working."

## Status of the mechanism: NOT deleted — present and wired

Traced 2026-07-21, all still in place:
- Decision: `needsNodmRestartForLayout` — `src/utils/xrandr-layout-verify.js:158`. Computes
  `plannedCanvas` = bounding box of `plannedHeadsFromLayout(calculateLayoutPositions(config))`,
  reads `currentCanvas` from the live `xrandr` `Screen 0: … current WxH` line
  (`parseXrandrScreenCurrentCanvas`, line 122), returns `needed` when planned W or H exceeds
  current — because live xrandr cannot grow the X framebuffer; only an X restart can.
- Consumer: `applyFullServerConfig` — `src/utils/full-config-apply.js:88-131`. When `needed`
  (or `opts.forceNodmRestart`): restart nodm (`restartDisplayManager`, os-config.js:19-25,
  `sudo -n systemctl restart nodm`), wait for X stable, re-apply live xrandr, kill the
  wrong-layout autostart Caspar, relaunch. When not needed: live xrandr only.
- Entry point: `src/api/routes-caspar-config.js:173` (the config-apply route).

## Why it stopped working — the decision's INPUTS went bad, not the decision

`plannedHeadsFromLayout` (`xrandr-layout-verify.js:17-43`) takes each head's
`x/y/width/height/sysId` straight from `calculateLayoutPositions` — the same layout math that
carried the two bugs root-caused and fixed earlier today (see
`318_WO_SHAPE_HOLES_BROKEN_AT_2160P50.md` and `tools/smoke/smoke-operator-gui-4k-layout-rect.test.js`):

1. **Mode-token type confusion** (os-layout-calculator-place.js): the operator head's Caspar
   mode id ("2160p5000") was trusted as an xrandr token, failed the WxH parse, and the head
   silently computed **1920x1080 instead of 3840x2160**. Planned canvas understates by the
   difference → `plannedCanvas <= currentCanvas` → `reason: canvas_fits` → **nodm restart
   skipped** exactly when the desktop needed to grow for the new 4K head.
2. **Stale pinned sysId with no A/B pair resolution** (xrandr-output-resolve.js): a pinned
   "DP-5" that is live as "DP-4" could fuzzy-resolve onto a name already in the planned set;
   `plannedHeadsFromLayout` dedupes on resolved sysId (line 30 `seen.has(sysId) → continue`),
   silently **dropping the whole head** from the canvas computation — same effect, planned
   canvas too small, nodm skipped.

Both fixes are in the working tree (not yet committed) with offline tests. This WO is the
verification + hardening pass so the canvas-growth path can never silently under-decide again.

## Tasks

1. **Regression test for the decision itself** (the missing piece — today's tests cover the
   layout math, not the nodm decision). Offline test for `needsNodmRestartForLayout`-level
   logic with injected layout/current-canvas fixtures:
   - planned 6912x2160 vs current 4992x1728 → `needed: true, reason: canvas_expansion`;
   - planned fits → `needed: false`;
   - the 2026-07-21 shape: a multiview head whose osMode is a Caspar mode id must contribute
     its REAL WxH to plannedCanvas (this test must fail if the mode-token guard is reverted —
     prove non-vacuous by reverting the guard once);
   - a head pinned to the non-live A/B sibling name must still be COUNTED (not deduped away).
   The pure parts (`plannedHeadsFromLayout`, `boundingBoxFromHeads`,
   `parseXrandrScreenCurrentCanvas`, `currentXrandrCanvasSize`) take injectable inputs already;
   `needsNodmRestartForLayout` itself calls `getDisplaysXrandrDetailed()` directly — add an
   opts injection seam like its siblings rather than mocking the module.
2. **Never skip silently on degenerate inputs.** Today `reason: 'no_planned_heads'` and
   `'no_live_canvas'` both return `needed: false` and the apply continues without nodm. If the
   planned canvas is degenerate while heads exist in config, or the current canvas is
   unreadable, log at WARN with the raw values — a silent `canvas_fits` is how this regression
   stayed invisible.
3. **Log the decision inputs once per apply.** full-config-apply.js:98/101 already logs
   planned vs current when expansion is needed; add the same numbers to the "fits — skipping"
   line so a wrong skip is diagnosable from the journal after the fact.
4. **Check the stale-canvas side.** `getDisplaysXrandrDetailed()` serves a cache/boot-snapshot
   fallback (WO-309). Confirm a config apply reads a FRESH `Screen:` line, not a snapshot
   taken before a previous nodm restart — a stale CURRENT canvas causes the mirror-image bug
   (unnecessary nodm restarts, or skipped ones after an external xrandr change).
5. **Live verification with the owner** (this is also the WO-318 sequence): with the 4K
   operator monitor planned and current desktop smaller, a config apply must log
   "Desktop canvas expansion required (planned 6912x2160 > current …) — nodm restart will run",
   restart nodm, and come back with the full 4K layout applied. Also verify the inverse: an
   apply with no canvas growth must NOT restart nodm (it never should on a live box).

Note the interaction with the stale `screen_3` duplicate (WO-318 item 1): while that override
persists, the planned canvas is OVER-stated (duplicate head stacks x to 6912+3840) — which
would make nodm restarts fire when not strictly needed. Harmless-but-disruptive; goes away
with the owner's UI cleanup. Don't tune the decision around it.

## Acceptance
- The four fixture tests above in the ci gate, proven non-vacuous; `npm run test:ci` → 0 fail.
- Journal shows planned + current canvas on EVERY apply decision, both branches.
- Live: growing the planned desktop triggers nodm restart automatically; non-growing applies
  never do.

## Constraints
- LIVE box: nodm restart drops the whole X session (kiosk, Caspar windows, shape overlay) —
  live verification only with the owner present, at a time they choose.
- The fix for the two input bugs is already done (working tree, 2026-07-21); do not re-fix,
  do not revert. This WO adds the decision-level tests, observability, and live proof.
