# Manual verification checklist — compiled 28.07.26

Supersedes `checklist27.07.26_manual_verify.md`. Everything you ticked on the 27th **and left no
note on** has been dropped — it is signed off and does not come back. What is here is:

- **§A** — items you ticked but wrote a problem next to. A fix landed since; these need a *re-check*, not a first look.
- **§B** — items you never ticked. Never QA'd.
- **§C** — new since the 27th (todos28 + work landed on the 28th).
- **§D** — decisions only you can make. Nothing to test.

Tick, and drop notes under any item — that is what the `>` lines are for.

Basis: repo at `637965c`, offline suite **1559 pass / 0 fail / 2 skip**, 500-line gate clean.
Deploy state matters for a few of these and is called out inline.

---

## A. You reported a problem — a fix landed, please re-check

- [ ] **A1. Compose preview has ONE reset** (was item 1: *"but still reset layout button inside the compose prv"*)
      Fixed in `a059051`. The inner "Reset layout" button is gone; the header **Reset** is the only one.
      Click it → tiles snap back to the default layout.
      >

- [ ] **A2. Playlist rows show file names, not paths** (was item 3)
      You said: *"most of the label in the list is path to the file instead of the filename"* and
      *"the grab and drop dots have a space between them not needed"*. Both in `a059051`: rows show
      the basename, full path moved to the tooltip, drag-dot columns tightened.
      Load a playlist with media from inside folders — names should be short and readable.
      >

- [ ] **A3. Movie files no longer show a fake 5 s** (was items 3 + 19)
      You said: *"movie files have 5s set as their time"* and *"it still displays 5s for media clips
      with time"*. Now the `(Ns)` tag and the duration box appear **only on timeless items**
      (images, shaders) — movies carry their own length and show no seconds box at all.
      Check both the Playlists panel and the layer inspector.
      >

- [ ] **A4. A PNG dropped between two movies plays its seconds** (was item 4)
      You said: *"i just dropped the png inbetween two movie files it did not play its seemingly
      default 5s. again after loop the set 5s on a png fails to play."*
      Root cause was that playlist edits made while the look was LIVE never reached the running
      engine. `a059051` adds an `update_live` path that patches the live scene state, which the OSC
      advance loop reads every tick. Proven by an offline smoke; **needs your on-glass check**:
      edit the list *while it is playing*, and let it wrap at least once.
      >

- [ ] **A5. Taskbar: click-to-park and minimized helpers** (was item 8)
      You said: *"just clicking on the gui should push the window under the caspar consumer"* and
      *"minimaizing firefox forinstance makes it disappear from the task bar"*. Both in `98c80e3`
      (live-verified with screenshots): clicking anywhere on the GUI parks every raised helper, and
      a minimized helper keeps its chip — clicking the chip de-iconifies and raises it.
      >

- [ ] **A6. Shaders mix again — including look to look** (was item 24)
      You said: *"all shaders doesnt mix well now, even from look to look."* Two separate causes,
      both fixed:
      1. `3731045` — the crossfade preroll was 180 ms but a WebGL page needs ~400–900 ms to first
         frame, so the fade ramped a blank layer. Shader takes now wait 600 ms
         (`HIGHASCG_SHADER_WARMUP_MS`) before the ramp.
      2. `80ed3b3` (WO-362) — for a look whose only content is CG-hosted, the whole crossfade batch
         was being **dropped**, so outgoing fades became hard cuts.
      Test both directions and a bank-B take (take twice in a row).
      >

- [ ] **A7. Missing-media / failed-input surfacing actually appears** (was item 3's second half)
      You asked for *"status check and message to the user if anything is missing or input hasent
      started properly"*. WO-360. Worth pointing out: the feature shipped **dead** — the init calls
      were dropped in a batch edit and only restored in `6e53abe`. So this has never been seen
      working by you.
      Misspell a clip in a playlist → row + Playlists panel show a red ⚠ with the full path in the
      tooltip; taking the look toasts "Missing in Caspar media: <name>". Break a live input → red
      toast naming slot and reason; recovery toasts green.
      >

- [ ] **A8. Wall clock sits between the eyes and the progress bar** (was item 29)
      You said: *"no, it needs to be between the eyes and progress bar."* Third placement attempt,
      `1d1dca0`, plus `a6ac9f1` closing the eyes gap 21px → 6px.
      >

- [ ] **A9. Shader thumbnails on every look** (was item 25: *"mostly true"*)
      Partially addressed. WO-354 made every pure-shader look eligible for a real thumbnail, but the
      **quality** work — content-aware crop, synthetic audio so reactive shaders aren't black, fill
      compositing instead of borders + alpha void — is WO-344 and is still **open**.
      If you can, say which looks still get a bad thumb and what it looks like (black? bordered?
      wrong crop?) — that picks the WO-344 approach.
      >

---

## B. Never QA'd — first look

- [ ] **B1. Shader Live editor, the recovery case** (WO-339/340/348)
      Compose preview stays in place; params in two columns below. Per-param **↺** reverts one;
      **Reset all** restores the pristine shader. Deliberately break a value until nothing displays,
      then revert — the shader must come back. This is the original *"i messed with some parameters
      and now it stopped displaying at all"* case and it is the one that matters.
      >

- [ ] **B2. Headless-GUI flag** (WO-325 Part A) — needs a Caspar config regenerate + restart to take.
      >

- [ ] **B3. Monitor picker on a fresh boot** (WO-351 — was item 20, *"not yet checked"*)
      Prompt is black, white centered text, subtle gray frame. After clicking a monitor, the devices
      tab shows the Operator GUI destination cabled to that GPU port, replacing any old cable on
      that jack.
      >

- [ ] **B4. Playlist edit → preview plays the NEW list** (WO-354)
      Edit a playlist, take the look to PGM (new list plays), recall it to preview — preview must
      play the new list too. Root cause was playlist timers shared between PGM and PRV.
      >

- [ ] **B5. Shader Live v3** (WO-356)
      Categories in bordered boxes, compact rows, mouse wheel over any slider steps it. Save to
      library → creates a `<shader>-c2` child, source untouched, child appears in Sources →
      Templates. In shaders mode, clicking a shader row there loads it to preview and into the
      dropdown; outside shaders mode the click does nothing.
      >

- [ ] **B6. Shader params: decode, wiggle, take** (WO-356 follow-ups)
      Each auto param shows a plain-language line. **≋** wiggles the value on PREVIEW only (~1.2 s)
      then restores — PGM must never move. **▶** in the editor bar takes PRV→PGM with the deck's
      transition. **↺** per-param snaps the row back visibly.
      >

- [ ] **B7. Shader renames stick, deleted shaders stay deleted** (Syncthing fix, `3f6613c` + `c4e2871`)
      Rename a shader in the edit modal → templates browser shows the new name (may take one
      refresh, 15 s cache). Files in `template/shaders` stop being touched constantly.
      **Still owed on your side:** add the same two `.stignore` lines (`/template/shaders`,
      `/data/shaders`) on the MacBook — `.stignore` does not sync itself. See also **D3**.
      >

- [ ] **B8. Shader Live ▶ + PGM stack** (WO-357)
      ▶ next to the instance dropdown takes PRV→PGM. Right column lists PGM layers 10–20: with a PRV
      shader selected, clicking L10 exchanges it with what is on air (MIX), clicking an empty 11–20
      fades the shader onto that layer. The row lights up; editing the landed shader restarts it
      once then rides live.
      >

- [ ] **B9. Global border: area / secondary colour / pulse 0** (WO-358)
      Effect inspector has Area % X/Y/W/H — the border draws inside that rect, slices still override
      with their own. "Enable secondary color" reveals the second colour + a transition-time slider;
      the glow breathes between the two. Pulse speed and min-opacity sliders reach 0 (speed 0 = off).
      >

- [ ] **B10. Route looks rock solid** (WO-359) — see also **C1**, which supersedes the diagnosis.
      Take a look with a source layer + routes of it (Look 12), CUT-retake several times, MIX between
      it and its copy. Source and both routes must survive every take.
      >

- [ ] **B11. Companion dev mode** (WO-361)
      Run `tools/eggs/companion/dev-mode.sh` once, then: edit module src → `npm run package:dev` →
      `sudo systemctl restart companion`. The README with the loop is written but **still uncommitted
      in the module repo** — see **D2**.
      >

---

## C. New since the 27th

- [ ] **C1. Routed looks play every time** (todos28 §1 → WO-362, `9f51b5f` + `80ed3b3`)
      Your report: *"looks with routes pointing to layer 10 are failing to play correctly on most
      trys."* **Read this one before testing** — the first diagnosis was wrong and you rejected it;
      the second pass found the real cause: for a look whose only non-route content is CG-hosted
      (shaders have no PLAY lines), the crossfade batch was dropped *and* the leading commit skipped,
      so the incoming bank's pre-hide `OPACITY 0` was applied **after** the route fade-ins. Every
      bank-B take landed fully transparent. Bank-A takes survived by accident.
      Post-fix drill: 4 alternating MIX takes, every frame fully opaque, both route panes live —
      including the bank-B takes that used to fail.
      **Test: take the look at least twice in a row** (once is not enough — it alternates banks).
      >

- [ ] **C2. Factory reset lands on canvas thumbnails, not the JPEG stream** (todos28 §2 → WO-363, `2ad162b`)
      Verified offline only — an actual factory reset was **deliberately not run**, it would destroy
      this box's real config. Only you can confirm it on a box you are willing to reset.
      >

- [ ] **C3. PRV as a real output — cable it and Apply** (WO-364, `71aa5a1`)
      Built and verified offline + against the running server, but **not applied**. The real cable is
      staged in the graph (destination PRV → `gpu_p1`), and `/api/caspar-config/generate` already
      emits the PRV head channel. Applying restarts Caspar and extends the X canvas to 7040 px, so
      expect a session-restart prompt — **your call when**.
      After Apply: PRV output on DP-2 at 2560x896, PGM on DP-6 and operator GUI on DP-0 untouched.
      >

- [ ] **C4. Look-editor holes reopen mid-drag** (WO-343 design-2, `ba8970f`)
      Pointer-drags on preview surfaces re-open the video holes 150 ms into the drag. Drag a layer on
      the looks-editor canvas and check the Caspar video is visible under your hand rather than the
      hole closing for the duration.
      >

- [ ] **C5. Server responsiveness during Apply** (WO-337 final, `5ca2624`)
      `applyX11Layout` is now async — the synchronous `xrandr` execs used to freeze the whole server.
      Next time you Apply a layout, the UI should stay live rather than going unresponsive.
      >

### Known broken, do not re-report — WO written, not yet fixed

- **todos28 §3 — matrix view + cable anchor → [WO-365](./work-orders/365_WO_matrix_prv_duplicate_row_and_cable_anchor.md).**
  Your report (*"in matrix view the prv is listed twice now. and in standard view the cable comes out
  of pgm node dot instead of the prv one"*) is a regression from WO-364 and both halves are confirmed
  in the code and against your live graph:
  - the matrix dedupe key changed to `id#half`, so the "remaining edges" fallback no longer
    recognises the destination and adds a **third** bare row under "Other Sources" — and that row
    cables with no PRV note, i.e. it silently acts as a second PGM row;
  - both pair dots carry the same `data-connector-id`, and the cable renderer picks the first match
    in DOM order, which is always PGM.
  Nothing to test; it is diagnosed and waiting on your go-ahead to fix.

---

## D. Decisions — nothing to test, I need an answer

- [ ] **D1. Shader library has no second copy** ([WO-368](./work-orders/368_WO_shader_store_git_ownership.md) — this is checklist27 item 16, where you said *"not sure"*)
      The `.stignore` fix stopped the peers fighting over shaders, but git still **tracks** them, and
      the two disagree. Right now: 11 shaders tracked, 16 on disk, 2 tracked-and-deleted, 9 untracked
      — including the WO-356 `-c2/-c3/-c4` children the Shader Live editor writes when you save.
      Two consequences: any `git checkout` touching that folder **resurrects the shaders you
      deleted**, and the nine new ones exist on this box only — Syncthing is told not to replicate
      them and git is not tracking them.
      The WO lays out three options (git stops tracking / commit the current state / split a tracked
      seed set from an untracked user store) with costs. **The question that decides it: what should
      back up your shaders, and should a freshly imaged box ship with a library?**
      >

- [ ] **D2. Commit the Companion README** (WO-361 residue)
      `companion-module-highpass-highascg/README.md` is untracked in that repo — the dev-mode loop is
      documented only on this box. One commit there closes it. Want me to do it?
      >

- [ ] **D3. Mirror `.stignore` on the MacBook** (from B7)
      Add `/template/shaders` and `/data/shaders`. `.stignore` does not sync itself, so until this is
      done the Mac can still push stale shaders back.
      >

- [ ] **D4. Live-on-air apply outside edit-on-PGM?** (WO-326, open since 24.07)
      Today, in normal editing mode PGM only updates on take; live apply is the edit-on-PGM compose
      mode, by design. You have been asked twice whether you want that changed. Yes or no is enough.
      >

- [ ] **D5. Media continuity between looks — needs 15 minutes with you** (WO-328, open since 24.07)
      The continuity machinery exists (visual-equal skip, SWAP TRANSFORMS, seek-resume); the WO lists
      five ranked suspects for why your case restarts instead. It cannot progress without a live
      repro — most likely candidates are the same media on a *different layer number*, or a
      property-delta reload whose seek-resume falls back to frame 0.
      >

- [ ] **D6. Seven items from 21.07 were never triaged** ([WO-366](./work-orders/366_WO_todos21_untriaged_backlog.md))
      The top of `todos21.07.26` was skipped when that day's work orders were written, and the 26.07
      audit worked by work-order so it never saw them. No coverage anywhere for: live-audio channel
      created at full video resolution instead of PAL/NTSC; **PGM2 cabled to the record output but
      PGM1 got recorded**; numlock flipping between restarts; media-browser drags not landing on the
      timeline; timeline clips missing settings in the inspector; timeline edits slower than looks
      edits on the Caspar output; the timeline editor's compose-preview label bar filling the width.
      These are a week old and the timeline has been refactored since — **which of these still
      happen?** The recording one is the one with real consequence, so start there if you only check
      one.
      >

- [ ] **D7. CI cannot catch dead code** ([WO-367](./work-orders/367_WO_lint_ratchet_and_unwired_code_gate.md))
      Three "written but never called" bugs were found on the 28th alone, all by hand. One of them
      (**A7** above) meant a feature you asked for shipped doing nothing while its work order said
      DONE and live-verified. ESLint runs in CI with no warning cap, so nothing stops the next one.
      The WO proposes a warning ratchet plus an unwired-export check. Low risk, small; say go and it
      lands with the next batch.
      >

---

## Audit note — what "complete" means for 14.07 → 28.07

Every todo file in the range was read and checked against the work orders, `OPEN_ISSUES.md` and
git history:

- **14.07 → 19.07** — triaged into WO-185…WO-305; the 19.07 file carries per-item answers inline.
  Still red from that era and genuinely waiting on **you**, not on code: WO-190 (multiview crop
  mismatch) and WO-215 (multiview cell scaling) both need a repro capture; WO-180 (GDTF) is gated on
  WO-179 QA. WO-221's file-split phases B–E are nominal — the 500-line CI gate reports 0 files over.
- **21.07** — second half triaged into WO-306…WO-314, all resolved. First half never triaged → **D6**.
- **22.07** — WO-320…WO-325. Note the 24.07 audit caught two work orders (322, 323) claiming DONE
  with *zero code in the tree*; both were rebuilt for real (`baf8211`, `f8cc0ce`).
- **24.07 / 25.07** — WO-326…WO-333, all landed and independently re-verified. Open: **D4**, **D5**.
- **27.07** — WO-346…WO-358, all DONE; your QA is folded into §A and §B above.
- **28.07** — WO-360…WO-364 done; §3 of that file is the new regression, **WO-365**.
