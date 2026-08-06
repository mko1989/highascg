# Checklist 06.08.26 — closing ALL open WOs (owner sweep)

Owner directive: "i want to close all open wos today". State after today's sweep:

- **58 OPEN_ISSUES rows corrected** to match their WO status lines (stale since July).
- **Closed by me today**: WO-176 (dup of 155/159), WO-190/215 (not reproduced, re-open on
  sighting), WO-221 (superseded + CI gate), WO-247 (deprecated), WO-262 (superseded by 263),
  WO-390 (evidence expired; §4 nudge-crop DEFER defect fixed today), WO-403/404 (deploy leg
  completed in today's batch).
- **Everything else below needs YOU** — every item is a tick, a one-shot action, or a
  decision. When a section is ticked, tell the session and the rows flip ✅.

## 1. Decisions (blocking their WOs)

- [ ] **WO-180 GDTF fixture import/export** — the ONLY genuinely unimplemented open WO
      (Planned, large). Build it (schedule) or drop it (DEPRECATE)?
- [ ] **WO-157 (second half)** — cross-screen audio fan-out model. Still wanted, or close as
      UI-done?
- [ ] **WO-161 (second half)** — stale-file/backup deletions were owner-gated. Approve the
      deletions or close as hazard-fixes-only?
- [ ] **WO-366** — 3 of 7 yes/no answers still blank (see `checklist04.08.26`).
- [ ] **WO-401 / WO-405** (performance research / monitoring) — both effectively landed their
      flags/baselines. Close as done, or keep open as observability?
- [ ] **11 Syncthing `projects/*.sync-conflict-*` files** (June 24-28, `untitled`/`untitled777`
      copies) — fail repo-integrity locally. OK to delete?

## 2. One-shot actions (each closes/unblocks a WO)

- [ ] **Companion: enable “Button Subscriptions API”** in Companion → Settings (WO-450 —
      previews appear in the picker once on).
- [ ] **Restart Companion** so module v1.0.5 loads (WO-372).
- [ ] **`sudo` nginx reload** for the landed config (WO-402 — needs your password).
- [ ] **Press Apply once** in Devices (WO-440/447 — carries GL-sync env AND the new
      vsync-off XML into Caspar). If you already applied since yesterday, tick.
- [ ] **`sudo systemctl restart casparcg-server`** once, if not done since WO-444 (env
      per-launch fix).

## 3. 60-second eyeballs (features in daily use — confirm & tick)

- [ ] WO-253: mapping-node editor opens; native Pixel Map destination unaffected.
- [ ] WO-255/256: operator GUI — video in the shaped holes, compose tiles drag/resize (your
      daily driver; tick = closes both).
- [ ] WO-257: mario template still plays (keyboard/mouse control is gone by design).
- [ ] WO-205: timer panel mirrors a timer started anywhere; panel-set duration survives
      refresh (no 5-min snap-back).
- [ ] WO-250: playback timers stable across takes; multiview progress bars on movie cells.
- [ ] WO-259: one multi-layer crossfade take on PRV, then live — no stagger artifacts.
- [ ] WO-261: set a stream key in the inspector → saved into the PROJECT, stream starts, key
      absent from `config/*.json`.
- [ ] WO-258: add a Web browser source → appears on host channel; Interact brings it to the
      operator screen and back.
- [ ] WO-388/389, WO-413, WO-423, WO-427: per their WO QA lines (all built + live today).
- [ ] WO-242/243 A-items (pixelmap screens / operator GUI owner checks).
- [ ] **Today's batch (WO-445..451)**: ⭳ snapshot button downloads JSON; timeline scrub with
      a look playing leaves PGM alone; extending a playing clip loops instead of blanking;
      companion picker shows a clickable grid; GPU port one-step drag lands; wiring banner
      stays gone.

## 4. Needs special setup (tick when the occasion arises)

- [ ] WO-194: next USB boot — hostname becomes `highascg####`, no failed unit in journal.
- [ ] WO-179: sACN input — needs a sACN source cabled (now actually wired via WO-446's
      dispatch; pick sACN on the global-border slot).
- [ ] WO-168 / eggs items: verify on next `eggs produce` (excludes + guards).

## 5. Blanket confirmation (fastest path to zero)

The remaining ~70 🟡 rows are July-era features (WO-155…WO-345 span) that have been your
daily production surface for weeks with no open complaint. If you agree they are
"verified by use":

- [ ] **"July-era implemented rows: verified by daily use — flip them ✅"** (say this to the
      session; anything you DON'T trust, name it and it stays open instead).
