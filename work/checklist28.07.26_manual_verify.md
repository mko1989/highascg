# Manual verification checklist — compiled 28.07.26, revised after your 14:26 notes

Supersedes `checklist27.07.26_manual_verify.md`. Your 14:26 pass signed off most of it — items 8,
15, 22, 24, 29, 31, 32, 35, 36, 37, 38 are done and are not repeated here.

Every problem you left in a note now has a work order. **Nothing below has been implemented** —
you asked for orders first. What is here is: what still needs your eyes (§A), what is diagnosed
and waiting on a go-ahead (§B), and what is waiting on an answer only you can give (§C).

Basis: repo at `dc8b2c4`, suite **1559 pass / 0 fail / 2 skip**, 500-line gate clean.
`dist-web/` built 28.07 14:02, kiosk reloaded 14:02:17 — so everything below describes the UI you
are actually looking at.

---

## A. Still needs your eyes — never QA'd

- [ ] **A1. Shader Live editor, the recovery case** (WO-339/340/348)
      The one that still matters from the original list. Compose preview stays in place, params in
      two columns below, per-param **↺** reverts one, **Reset all** restores the pristine shader.
      Deliberately break a value until nothing displays, then revert — the shader must come back.
      This is your *"i messed with some parameters and now it stopped displaying at all"* case.
      >

- [ ] **A2. Monitor picker on a fresh boot** (WO-351 — item 20, still *"not yet checked"*)
      Black prompt, white centered text, subtle gray frame. After clicking a monitor, the devices
      tab shows the Operator GUI destination cabled to that GPU port, replacing any old cable on
      that jack.
      >

- [ ] **A3. Headless-GUI flag** (WO-325 Part A) — needs a Caspar config regenerate + restart to take.
      >

- [ ] **A4. Routed looks play every time** (todos28 §1 → WO-362)
      **Take the look at least twice in a row** — once is not enough, it alternates banks and only
      the bank-B take used to fail. The first diagnosis of this was wrong and you rejected it; the
      second pass found the real cause (the whole crossfade batch was being dropped for looks whose
      only content is CG-hosted, so the incoming bank stayed at opacity 0). Post-fix drill: 4
      alternating MIX takes, every frame fully opaque, both route panes live.
      >

- [ ] **A5. Look-editor holes reopen mid-drag** (WO-343 design-2, `ba8970f`)
      Drag a layer on the looks-editor canvas — Caspar video should stay visible under your hand
      instead of the hole closing for the duration of the drag.
      >

- [ ] **A6. Server stays responsive during Apply** (WO-337 final, `5ca2624`)
      `applyX11Layout` is async now; the synchronous `xrandr` execs used to freeze the whole
      server. Next Apply, the UI should stay live.
      >

- [ ] **A7. Factory reset lands on canvas thumbnails** (todos28 §2 → WO-363)
      Verified offline only — an actual factory reset was deliberately **not** run, it would
      destroy this box's config. Only worth doing on a box you are willing to reset.
      >

- [ ] **A8. PRV as a real output — cable it and Apply** (WO-364)
      Built and verified, **not applied**. The cable is staged (destination PRV → `gpu_p1`) and the
      generator already emits the PRV head channel. Applying restarts Caspar and extends the X
      canvas to 7040 px, so expect a session-restart prompt — **your call when.** Note **B1** below
      before you do: the matrix/cable display for this is currently wrong.
      >

---

## B. Diagnosed, work order written, waiting on your go-ahead

Nothing to test. Each of these has a root cause and a plan; say go and it lands.

- **B1. Matrix lists the PRV destination twice, cable leaves the PGM dot** → [WO-365](./work-orders/365_WO_matrix_prv_duplicate_row_and_cable_anchor.md)
  *(todos28 §3)* Both halves confirmed against your live graph. The matrix dedupe key changed to
  `id#half`, so the fallback no longer recognises the destination and adds a **third** bare row
  under "Other Sources" — and that row cables with no PRV note, i.e. it silently acts as a second
  PGM row. Separately, both pair dots carry the same `data-connector-id` and the renderer takes the
  first DOM match, which is always PGM.

- **B2. Playlist rows show `5` on movies instead of their real length** → [WO-370](./work-orders/370_WO_playlist_rows_real_media_durations.md)
  *(your item 39 note)* You were right and it is not a stale bundle. `a059051` fixed the Playlists
  panel and missed the layer-inspector row, which renders a seconds box for **every** item with a
  hardcoded `5` fallback and no timeless check. The real lengths are already in the media list the
  client receives (`durationMs`), so this is cheap. One trap recorded in the WO: some assets appear
  twice with contradictory durations (one clip reads 52 s from ffprobe and 8.4 **hours** from CINF),
  so the lookup has to pick correctly rather than take the first match.

- **B3. "Back to GUI" button + wall clock sizing** → [WO-369](./work-orders/369_WO_checklist27_ui_notes_batch.md)
  *(your items 8 and 29 notes)* Remove the redundant button; clock gets a bigger font and minimum
  padding to the eyes, staying where it is. Batched so they ship in one build + reload.

- **B4. Record output can record the wrong bus** → [WO-373](./work-orders/373_WO_record_bus_wrong_source_channel.md)
  *(todos21, never triaged)* Your *"connected pgm2 to rec output and pgm1 got recorded"*. When two
  destinations are cabled to one record sink, the winner is decided by **edge insertion order** —
  the older cable wins permanently, which is exactly the symptom. The mechanism is proven in the
  code; your 21.07 cable state is gone, so §3 of the WO has a 5-minute repro to confirm it. This is
  the one with real consequence — a recording that captures the wrong bus is not recoverable.

- **B5. Shader thumbnail quality** → WO-344 *(your item 25, "mostly true")*
  Every pure-shader look is now eligible for a thumbnail; the quality work (content-aware crop,
  synthetic audio so reactive shaders aren't black, fill compositing instead of borders + alpha
  void) is still open. **If you can, say which looks still look wrong and how** — black? bordered?
  wrong crop? That picks the approach.

---

## C. I need an answer — nothing to test

- [ ] **C1. In PRV the playlist stops after the first item** → [WO-371](./work-orders/371_WO_prv_playlist_preview_playback.md)
      *(your item 23 note)* Worth reading, because you signed off both sides of this. Item 27 —
      *"recall a playlist look to preview: it shows one item and sits still"* — you ticked as
      correct. Item 23 you flagged as broken. They are the same behaviour: WO-355 made playlists
      PGM-only on your instruction, which invalidated WO-354's acceptance wording, and nobody
      rewrote item 23.
      No code is broken. But the real question underneath is unanswered: **after editing a
      playlist, how do you confirm the new list without putting it on air?** Three options in the
      WO — leave PRV frozen and fix the wording; let PRV play while the look is off air; or add
      ⏮/⏭ to step the preview through the list. **I'd recommend the stepper** — it answers the need
      without re-creating the dual-timer mess WO-354 had to untangle.
      >

- [ ] **C2. Companion has no dev version to choose** → [WO-372](./work-orders/372_WO_companion_dev_module_not_selectable.md)
      *(your item 40 note)* Your direct question first: it is defined in
      `/etc/systemd/system/companion.service.d/override.conf`, which appends
      `--extra-module-path /home/casparcg/companion-module-dev` to the service.
      That part is fine — I checked the running process, the symlink resolves, and Companion loaded
      the module cleanly at 14:17. The actual problem is that **both copies declare
      `highpass-highascg` version `1.0.4`**, so there is only one version for the picker to offer
      and nothing marks either as a dev build. Worse than failing loudly: which copy is running
      depends on scan order, so you can't tell whether your edit took.
      The fix is to stamp dev builds with a distinct version. **Want me to do that?**
      >

- [ ] **C3. Shader library has no second copy** → [WO-368](./work-orders/368_WO_shader_store_git_ownership.md)
      *(item 16, where you said "not sure")* The `.stignore` fix stopped the peers fighting, but git
      still tracks these files and the two disagree: 11 shaders tracked, 16 on disk, 2
      tracked-and-deleted, 9 untracked — including the `-c2/-c3/-c4` children Shader Live writes
      when you save. Any `git checkout` touching that folder **resurrects the shaders you deleted**,
      and the nine new ones exist on this box only.
      **The question that decides it: what should back up your shaders, and should a fresh image
      ship with a library?** Three options with costs in the WO.
      >

- [ ] **C4. Six more items from 21.07 that were never triaged** → [WO-366](./work-orders/366_WO_todos21_untriaged_backlog.md)
      The record one became **B4**. The rest have no coverage anywhere and are a week old, with the
      timeline refactored since — **which of these still happen?**
      live-audio channel created at full video resolution instead of PAL/NTSC · numlock flipping
      between restarts · media-browser drags not landing on the timeline · timeline clips missing
      settings in the inspector · timeline edits slower than looks edits on the Caspar output ·
      the timeline editor's compose-preview label bar filling the width.
      >

- [ ] **C5. Live-on-air apply outside edit-on-PGM?** (WO-326, open since 24.07)
      Today, in normal editing mode PGM only updates on take; live apply is the edit-on-PGM compose
      mode, by design. Asked twice now. Yes or no is enough.
      >

- [ ] **C6. Media continuity between looks — 15 minutes with you** (WO-328, open since 24.07)
      The machinery exists (visual-equal skip, SWAP TRANSFORMS, seek-resume); five ranked suspects
      are in the WO. It cannot move without a live repro — most likely the same media on a
      *different layer number*, or a property-delta reload whose seek-resume falls back to frame 0.
      >

- [ ] **C7. Let CI catch dead code** → [WO-367](./work-orders/367_WO_lint_ratchet_and_unwired_code_gate.md)
      Three "written but never called" bugs were found by hand on the 28th. One of them meant the
      missing-media surfacing you asked for shipped **doing nothing**, while its work order read
      DONE and live-verified — you only saw it work after `6e53abe`. ESLint runs in CI with no
      warning cap, so nothing stops the next one. Low risk. Say go and it lands with the next batch.
      >

- [ ] **C8. Mirror `.stignore` on the MacBook**
      Add `/template/shaders` and `/data/shaders`. `.stignore` does not sync itself, so until this
      is done the Mac can still push stale shaders back.
      >

---

## Still open, already tracked, no action needed from you

Carried so nothing looks forgotten: **WO-190** (multiview crop) and **WO-215** (multiview cell
scaling) both need a repro capture whenever you next see them. **WO-180** (GDTF) is gated on
WO-179 QA. **WO-253** (mapping node) is gated on WO-243. **WO-232** (Mario) is partially
deprecated. **WO-341** item 8 is the two-client observation drill. **WO-221** phases B–E are
nominal — the 500-line CI gate reports 0 files over.

Corrected while auditing: **WO-342** and **WO-345** were still marked Open in the queue but are
both implemented (WO-342's handler is live at `scene-list-column.js:64`; WO-345's own status line
records the hot-recompile as live-verified, and WO-348/355/356/357 built it out — all of which you
signed off today).
