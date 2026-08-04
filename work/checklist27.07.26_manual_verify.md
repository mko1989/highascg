# Manual verification checklist — compiled 27.07.26

Owner walk-through of everything implemented but not yet signed off.
Tick, and drop notes under any item (that's what the `>` lines are for).

## A. Operator kiosk GUI

- [x] **1. Compose top bar — Reset button** (WO-346)
      PRT PGM is gone; **Reset** is there. Click it → all compose tiles snap back to the default layout.
      >but still reset layout button inside the compose prv.

- [x] **2. Tile PRT buttons** (WO-346 + todos27 follow-up, deployed ~10:00 today)
      Non-PGM tiles (PRV, mv cells, live sources) have a **PRT** styled like the other tile buttons.
      **PGM tiles show CAPTURE only** — no duplicate PRT.
      Click PRT on a live-source tile → toast + PNG lands in the Caspar media folder.
      >

- [x] **3. Playlists panel, bottom right** (WO-347)
      Shows **every** playlist defined in the project's looks, not just live ones.
      Non-live entries say "not live"; live ones have 🔴 + channel.
      Select an item on a *non-live* playlist → take that look to PGM → playout starts at that item.
      Transport ⏮ ▶ ⏭ works on the live one.
      >in the list it seems like movie files have 5s set as their time. also the grab and drop dots have a space between them not needed just taking up space. i have media now from inside some folders and most of the label in the list is path to the file instead of the filename, inside this playlist editor we just need file name, its full path doesn't matter unless its missing.
      here we enter something that hasent been done yet properly, which is status check and message to the user if anything is missing or input hasent started properly and failed bring alive pass. 

- [x] **4. Playlist auto-advance of timeless items**
      Two shaders in a playlist at 20 s: they hop, repeatedly, and after a manual jump the timer re-arms.
      >although when i just dropped the png inbetween two movie files it did not play its seemingly default 5s. again after loop the set 5s on a png fails to play.

- [ ] **5. Shader Live editor** (WO-339/340/348 — glasses-bunny click)
      Compose preview stays in place; params in **two columns** below.
      Per-param **↺** reverts just that one; **Reset all** restores the pristine shader.
      Edits land live on PGM. Deliberately break a value, then revert — the shader must come back
      (the "stopped displaying" case).
      >

- [x] **6. Deck cards**
      Shaders: **red** border on PGM (not violet), thumbs fill the square.
      Footer buttons small + centered; ✕ top-right red, copy below it; names start from the edge;
      angled 45° panel labels with tight underline.
      >

- [x] **7. Two-client drill** (WO-329)
      Laptop browser + kiosk side by side — takes, preview recalls, look edits from each.
      Both converge, nothing blocked, no sync-error toasts.
      >

- [x] **8. Taskbar** (WO-317)
      Open via the small indicator-style button, launch two helpers, toggle chips.
      >doesnt realy work automaticaly as it should, just clicking on the gui should push the window under the caspar consumer.
      minimaizing firefox forinstance makes it disappear from the "task bar"
seems to work. doesnt need the back to gui button.

- [x] **9. Live-audio host channel** (WO-336)
      Device-view host-channel inspector: device swap + FFT source toggle.
      Shader reacts on the Caspar program with music from the DM3.
      >

- [x] **10. Shader on look band + compose source tiles** (WO-322/323)
      Bank crossfade with a shader on the look band looks right.
      Compose live-source tiles survive drop / remove / restart.
      >

## B. Needs privileges / hardware / a decision

- [x] **11. Power button root install** (WO-332) — needs a sudo run.
      >casparcg@highascg7579:~/highascg$ sudo install -m 755 /home/casparcg/highascg/tools/runtime/highascg-power-button-listen.sh \
  /usr/local/lib/highascg/highascg-power-button-listen.sh
sudo systemctl restart highascg-power-button.service
[sudo] password for casparcg: 

- [x] **12. Companion deploy** (WO-330) — run the one deploy command in the WO, then desk QA.
      >although the module needs work later. it should also work in dev mode which would be easier to work on.

- [ ] **13. Headless-GUI flag** (WO-325 Part A) — regenerate Caspar config + restart to take effect.
      >

- [x] **14. nodm on canvas growth** (WO-315) — on the next real canvas-growth apply, confirm the
      restart decision fires correctly (test suite now green + hermetic).
      >worked, the last i checked.

- [x] **15. Brightness decay trigger pattern** (3d-meters worst)
      Next time it dims, note: **gradual while idle** or **step per take**? That answer unblocks
      the investigation.
      >when i do some tweaks so it looks how i want it stops dimming.

- [ ] **16. Uncommitted runtime diffs** — `config/*.json` + `template/shaders/`
      (modified sh-audio/balatro/…, deleted sh-ext + sh-ios, 7 new untracked shaders).
      Decide: commit as-is, or restore the deletions if unintended.
      >not sure

## C. GitHub (passive)

- [x] **17. No more failure emails** — CI + Pages both green since this morning (WO-349);
      the Pages site serves the project map again. Just notice the absence of mail.
      >

## D. Added mid-day 27.07 (WO-350 / WO-351)

- [x] **18. Bar heights** (WO-350)
      Compose preview top bar is ~half its old height; the progress bar above it sits tight;
      the looks-list column head is lower; the mix/duration/tween group is small and
      right-adjusted in the deck toolbar (no more full-width stretch).
      >

- [ ] **19. Playlists compact — Timeless (s) + Set all** (WO-350)
      The footer Playlists panel has a "Timeless (s)" input + **Set all**. After applying,
      the input keeps showing the value you set (not 20) — both here and in the layer
      inspector's "Timeless items (s)".
      >it still displays 5s for media clips with time.

- [ ] **20. Monitor picker** (WO-351 — needs a fresh-boot pick to see)
      Prompt is black with white centered text and a subtle gray frame.
      After clicking a monitor, the devices tab shows the Operator GUI destination cabled
      to that GPU port (any old cable on that jack replaced).
      >not yet checked.

- [x] **21. Taskbar** (WO-352 — live-verified by automation, worth an eyeball)
      Chips are circles with the real app icons (red ring = raised, gray = parked, pulsing =
      launching). Open the browser, park it, raise it again — it must come back and STAY
      (the old ~2s steal is fixed). "Back to GUI" then one chip click brings it forward.
      >other issues detailed above.

- [x] **22. Playlist rows + ✕** (WO-353)
      Playlist items: tiny drag dots, name gets the space, small seconds box, ✕ delete.
      Trashcans are ✕ everywhere (layer list, preset delete, sources folder too).
      >the space between the two columns of dots is unnecesserily wide.

- [x] **23. Playlist edit → preview** (WO-354; reworded 04.08 per WO-371 option C —
      the original wording contradicted item 27 and its "failure" was item 27's designed
      behaviour) Edit a playlist, take the look to PGM (new list plays), recall it to
      preview — preview shows the NEW list's start item, frozen (playback never runs on
      PRV), and the Playlists panel's ⏮/⏭ step the preview render through the new list
      to verify order and content without going on air.
      >superseded: "stops after first item" IS the design (item 27); stepping added by WO-371.

- [x] **24. Shader playlist mixing** (WO-354)
      Shaders in a playlist with a MIX transition crossfade again. Editing one of those
      shaders in Shader Live restarts it once (at the first slider move), then edits land live.
      >all shaders doesnt mix well now, even from look to look.
seems fine
- [x] **25. Shader thumbs on ALL looks** (WO-354)
      Every pure-shader look renders a real thumbnail on its deck card, not just one.
      >mostly true.

- [x] **26. Compose footer font + take buttons** (WO-354)
      Current-item name under each screen window is readable (12px); ▶/CUT sit on the LEFT
      of the deck toolbar next to the screen pills.
      >

- [x] **27. Playlists are PGM-only + stop on take-out** (WO-355; wording confirmed 04.08 by
      WO-371 option C) Recall a playlist look to preview: it never advances on its own — it
      sits on whichever item the Playlists panel's ⏮/⏭ stepped it to (start item by default).
      Take a different look to PGM: the old look's playlist stops hopping immediately.
      >

- [x] **28. Shader Live editor** (WO-355)
      Dropdown no longer blinks; params fully visible in both columns (color pickers included);
      ✎ next to any param names it (persists across reload; tooltip shows the raw code context).
      >

- [x] **29. Wall clock** (WO-355)
      Small HH:MM:SS ticking at the right end of the progress-bar row.
      >needs to have bigger font and be closer to the eyes, minimum padding.

- [x] **30. Shader params decoded + categorized** (WO-355 follow-up)
      Deep params show human names ("speed", "uv scale", "mix amount", "iterations"…) grouped
      under Colors / Speed & time / Scale & shape / Intensity / Detail — no more code snippets
      as names (those now live in the hover tooltip). ✎ still renames anything.
      >needs further work but later.

- [x] **31. Shader Live v3** (WO-356)
      Categories in bordered boxes, compact rows; mouse wheel over any slider steps it;
      "col"-named values sit in the Colors box (broadcast vec3(1.8) reads "… level").
      Save to library → creates "<shader>-c2" child (source shader untouched); the child shows
      in Sources → Templates. In shaders mode, clicking any shader row there loads it onto
      preview and into the dropdown; outside shaders mode the click does nothing.
      >

- [x] **32. Shader params: decode + wiggle + take** (WO-356 follow-ups)
      Each auto param shows a plain-language line ("size/radius of the shape", "wave speed"…).
      ≋ wiggles the value on PREVIEW only (~1.2s) then restores — PGM never moves.
      ▶ in the editor bar takes PRV→PGM with the deck's transition. ↺ per-param reset
      visibly snaps the row back now.
      >

- [x] **35. Shader names + no more file fights** (Syncthing fix)
      Rename a shader in the edit modal → the templates browser shows the NEW name (may take
      one refresh, 15s cache). Files in template/shaders stop being "touched" constantly and
      deleted shaders STAY deleted. NOTE: add the same two .stignore lines
      (/template/shaders, /data/shaders) on the MacBook's copy — stignore doesn't sync itself.
      >

- [x] **36. Shader Live ▶ + PGM stack** (WO-357)
      ▶ next to the instance dropdown takes PRV→PGM (deck transition). Right column lists PGM
      layers 10–20: with a PRV shader selected, clicking L10 exchanges it with what's on air
      (MIX), clicking an empty 11–20 fades the shader onto that layer — stacking works, the
      row lights up, and editing the landed shader restarts it once then rides live.
      >

- [x] **37. Global border: area / secondary color / pulse 0** (WO-358)
      Effect inspector has "Area %" X/Y/W/H — border draws inside that rect (slices still
      override with their own rects). "Enable secondary color" reveals the second color +
      transition-time slider; the glow breathes between the two. Pulse speed and min-opacity
      sliders reach 0 (speed 0 = pulse off).
      >

- [x] **38. Route looks rock solid** (WO-359)
      Take a look with a source layer + routes of it (Look 12), CUT-retake it several times and
      MIX between it and its copy — the source and BOTH routes must survive every take (the bug
      was cut retakes sweeping the unchanged source layer away). Automated 6-cycle drill passed;
      confirm by eye on the glass.
      >

- [ ] **39. Status surfacing v1** (WO-360)
      Misspell a clip in a playlist: the row and the Playlists panel show ⚠ red with the full
      path in the tooltip; taking the look toasts "Missing in Caspar media: <name>". Unplug /
      break a live input: a red toast names the slot and reason; recovery toasts green.
      >it displays correctly. the issue is with in the list it displays the timeless value even on media clips that have their own values which should be displayed.

- [ ] **40. Companion dev mode** (WO-361)
      Run tools/eggs/companion/dev-mode.sh once, then: edit module src → npm run package:dev →
      sudo systemctl restart companion. README in the module repo has the loop (commit it there).
      >no, there is no dev to choose meaning companion doest run with correct flags. where is it defined?

