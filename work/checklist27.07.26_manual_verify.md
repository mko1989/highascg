# Manual verification checklist — compiled 27.07.26

Owner walk-through of everything implemented but not yet signed off.
Tick, and drop notes under any item (that's what the `>` lines are for).

## A. Operator kiosk GUI

- [ ] **1. Compose top bar — Reset button** (WO-346)
      PRT PGM is gone; **Reset** is there. Click it → all compose tiles snap back to the default layout.
      >

- [ ] **2. Tile PRT buttons** (WO-346 + todos27 follow-up, deployed ~10:00 today)
      Non-PGM tiles (PRV, mv cells, live sources) have a **PRT** styled like the other tile buttons.
      **PGM tiles show CAPTURE only** — no duplicate PRT.
      Click PRT on a live-source tile → toast + PNG lands in the Caspar media folder.
      >

- [ ] **3. Playlists panel, bottom right** (WO-347)
      Shows **every** playlist defined in the project's looks, not just live ones.
      Non-live entries say "not live"; live ones have 🔴 + channel.
      Select an item on a *non-live* playlist → take that look to PGM → playout starts at that item.
      Transport ⏮ ▶ ⏭ works on the live one.
      >

- [ ] **4. Playlist auto-advance of timeless items**
      Two shaders in a playlist at 20 s: they hop, repeatedly, and after a manual jump the timer re-arms.
      >

- [ ] **5. Shader Live editor** (WO-339/340/348 — glasses-bunny click)
      Compose preview stays in place; params in **two columns** below.
      Per-param **↺** reverts just that one; **Reset all** restores the pristine shader.
      Edits land live on PGM. Deliberately break a value, then revert — the shader must come back
      (the "stopped displaying" case).
      >

- [ ] **6. Deck cards**
      Shaders: **red** border on PGM (not violet), thumbs fill the square.
      Footer buttons small + centered; ✕ top-right red, copy below it; names start from the edge;
      angled 45° panel labels with tight underline.
      >

- [ ] **7. Two-client drill** (WO-329)
      Laptop browser + kiosk side by side — takes, preview recalls, look edits from each.
      Both converge, nothing blocked, no sync-error toasts.
      >

- [ ] **8. Taskbar** (WO-317)
      Open via the small indicator-style button, launch two helpers, toggle chips.
      >

- [ ] **9. Live-audio host channel** (WO-336)
      Device-view host-channel inspector: device swap + FFT source toggle.
      Shader reacts on the Caspar program with music from the DM3.
      >

- [ ] **10. Shader on look band + compose source tiles** (WO-322/323)
      Bank crossfade with a shader on the look band looks right.
      Compose live-source tiles survive drop / remove / restart.
      >

## B. Needs privileges / hardware / a decision

- [ ] **11. Power button root install** (WO-332) — needs a sudo run.
      >

- [ ] **12. Companion deploy** (WO-330) — run the one deploy command in the WO, then desk QA.
      >

- [ ] **13. Headless-GUI flag** (WO-325 Part A) — regenerate Caspar config + restart to take effect.
      >

- [ ] **14. nodm on canvas growth** (WO-315) — on the next real canvas-growth apply, confirm the
      restart decision fires correctly (test suite now green + hermetic).
      >

- [ ] **15. Brightness decay trigger pattern** (3d-meters worst)
      Next time it dims, note: **gradual while idle** or **step per take**? That answer unblocks
      the investigation.
      >

- [ ] **16. Uncommitted runtime diffs** — `config/*.json` + `template/shaders/`
      (modified sh-audio/balatro/…, deleted sh-ext + sh-ios, 7 new untracked shaders).
      Decide: commit as-is, or restore the deletions if unintended.
      >

## C. GitHub (passive)

- [ ] **17. No more failure emails** — CI + Pages both green since this morning (WO-349);
      the Pages site serves the project map again. Just notice the absence of mail.
      >

## D. Added mid-day 27.07 (WO-350 / WO-351)

- [ ] **18. Bar heights** (WO-350)
      Compose preview top bar is ~half its old height; the progress bar above it sits tight;
      the looks-list column head is lower; the mix/duration/tween group is small and
      right-adjusted in the deck toolbar (no more full-width stretch).
      >

- [ ] **19. Playlists compact — Timeless (s) + Set all** (WO-350)
      The footer Playlists panel has a "Timeless (s)" input + **Set all**. After applying,
      the input keeps showing the value you set (not 20) — both here and in the layer
      inspector's "Timeless items (s)".
      >

- [ ] **20. Monitor picker** (WO-351 — needs a fresh-boot pick to see)
      Prompt is black with white centered text and a subtle gray frame.
      After clicking a monitor, the devices tab shows the Operator GUI destination cabled
      to that GPU port (any old cable on that jack replaced).
      >

- [ ] **21. Taskbar** (WO-352 — live-verified by automation, worth an eyeball)
      Chips are circles with the real app icons (red ring = raised, gray = parked, pulsing =
      launching). Open the browser, park it, raise it again — it must come back and STAY
      (the old ~2s steal is fixed). "Back to GUI" then one chip click brings it forward.
      >

- [ ] **22. Playlist rows + ✕** (WO-353)
      Playlist items: tiny drag dots, name gets the space, small seconds box, ✕ delete.
      Trashcans are ✕ everywhere (layer list, preset delete, sources folder too).
      >

- [ ] **23. Playlist edit → preview** (WO-354)
      Edit a playlist, take the look to PGM (new list plays), recall it to preview —
      preview must play the NEW list too (the old-version replay is fixed at the root:
      playlist timers were shared between PGM and PRV).
      >

- [ ] **24. Shader playlist mixing** (WO-354)
      Shaders in a playlist with a MIX transition crossfade again. Editing one of those
      shaders in Shader Live restarts it once (at the first slider move), then edits land live.
      >

- [ ] **25. Shader thumbs on ALL looks** (WO-354)
      Every pure-shader look renders a real thumbnail on its deck card, not just one.
      >

- [ ] **26. Compose footer font + take buttons** (WO-354)
      Current-item name under each screen window is readable (12px); ▶/CUT sit on the LEFT
      of the deck toolbar next to the screen pills.
      >

- [ ] **27. Playlists are PGM-only + stop on take-out** (WO-355)
      Recall a playlist look to preview: it shows one item and sits still. Take a different
      look to PGM: the old look's playlist stops hopping immediately.
      >

- [ ] **28. Shader Live editor** (WO-355)
      Dropdown no longer blinks; params fully visible in both columns (color pickers included);
      ✎ next to any param names it (persists across reload; tooltip shows the raw code context).
      >

- [ ] **29. Wall clock** (WO-355)
      Small HH:MM:SS ticking at the right end of the progress-bar row.
      >

- [ ] **30. Shader params decoded + categorized** (WO-355 follow-up)
      Deep params show human names ("speed", "uv scale", "mix amount", "iterations"…) grouped
      under Colors / Speed & time / Scale & shape / Intensity / Detail — no more code snippets
      as names (those now live in the hover tooltip). ✎ still renames anything.
      >

- [ ] **31. Shader Live v3** (WO-356)
      Categories in bordered boxes, compact rows; mouse wheel over any slider steps it;
      "col"-named values sit in the Colors box (broadcast vec3(1.8) reads "… level").
      Save to library → creates "<shader>-c2" child (source shader untouched); the child shows
      in Sources → Templates. In shaders mode, clicking any shader row there loads it onto
      preview and into the dropdown; outside shaders mode the click does nothing.
      >

- [ ] **32. Shader params: decode + wiggle + take** (WO-356 follow-ups)
      Each auto param shows a plain-language line ("size/radius of the shape", "wave speed"…).
      ≋ wiggles the value on PREVIEW only (~1.2s) then restores — PGM never moves.
      ▶ in the editor bar takes PRV→PGM with the deck's transition. ↺ per-param reset
      visibly snaps the row back now.
      >
