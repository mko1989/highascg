# WO-155 — Looks editor: clip restarts on every param change; edit→PRV mirror; stale PRV thumbnail

**Status:** Planned
**Priority:** High (every edit restarts playback — worst operator annoyance in the list)
**Date:** 2026-07-13
**Source:** `work/todos13.07.26` (owner)
**Related:** WO-150 (looks operator bugs), WO-63/71 (compose preview thumbs), WO-144/159 (compose preview jpeg + blocklist), WO-05 (live preview settings).

---

## 1. Problems (owner-reported)

1. "when changing any parameter in the looks editor the clip restarts each time."
2. "when editing a look it should be sent to prv if available."
3. "in gui i have some stale thumbnail to represent prv ch."

## 2. Investigation findings (2026-07-13)

### B155.1 Clip restart — root cause found: one-key snapshot asymmetry defeats the no-restart fast-path

Editor edits drain into `pushSceneToPreviewImpl` (`client/lib/scenes-preview-push-scene.js:196`), which per layer chooses MIXER-only update (video keeps playing) vs full re-`PLAY` (clip restarts):

- `:248-259` builds `prevContent` from the stored snapshot with **8 keys** (`value, loop, straightAlpha, contentFit, audioRoute, volume, muted, pipOverlays`).
- `:247` builds `curMeta` via `layerContentMetaForSnapshot` (`client/lib/scenes-preview-snapshot.js:30-43`) — which returns **9 keys**: the same 8 **plus `browserAsCg`** (always present, `!!layer.source.browserAsCg`).
- `:260` compares them with `JSON.stringify` equality → **`contentUnchanged` is always false**.
- The same asymmetry breaks `isGeometryOnlyPreview` (`scenes-preview-snapshot.js:46-73` — 8-key `pContent` at :58-67 vs 9-key meta at :52) → **`geometryOnly` is always false**.
- With both gates stuck false, `:264-284` re-issues `PLAY <ch-layer> <clip>` on **every** change — even opacity/rotation — restarting the media. The correct MIXER-only branch (`:213-245,:262-263`, `MIXER … DEFER` + `COMMIT`, no PLAY) already exists and works; it is simply unreachable.

Fix: make the key sets symmetric — add `browserAsCg` to `buildPreviewContentSnapshot` (`scenes-preview-snapshot.js:5-28`), to `isGeometryOnlyPreview`'s `pContent` (:58-67), and to `prevContent` (`push-scene.js:248-259`) — or drop it from `layerContentMetaForSnapshot` (:41) if it never gates a restart.

### B155.2 Edit→PRV — already implemented; behavior is gated, may just be disabled/misconfigured on the rig

Editor pushes DO target the mapped PRV channel: `resolvePreviewAmcpChannel` (`client/lib/scenes-preview-look-stack.js:140-147`) returns `cm.previewChannels[mIdx]`, gated by `isPreviewBusAvailable` (:116-123) which returns false when `previewEnabledByMain[mIdx] === false`, PRV channel missing/≤0, or `prv === pgm`. When unavailable the push silently `continue`s (`push-scene.js:113-115`) and the edit shows only on the local canvas. Note: on this rig main 2 is PGM-only (no PRV) — so "if available" already matches the design; and B155.1 made PRV pushes restart the clip constantly, which plausibly read as "edits aren't sent to PRV properly." Verify with owner after B155.1 lands whether a real gap remains (e.g. want a server-take path `pushSceneToPreviewViaServer`, `scenes-preview-runtime.js:129`, currently only used for deck/recall).

### B155.3 Stale PRV thumbnail — two production modes, both with staleness holes

- **Canvas mode (default, `client/lib/compose-preview-url.js:8-12`):** deck PRV cell is a client-side composite of source *still* thumbnails over `sceneState` (`scenes-editor-deck-thumb.js:87-94`, `drawSceneComposeStack`) — it never reflects live PRV output; MIXER-only changes produce no new still URL so the cached `Image` is reused forever.
- **ffmpeg_jpeg mode:** staleness when (a) PRV channel's FILE consumer is blocklisted → no JPEG ever written but client keeps painting the last cached image (see WO-159 — same defect class), (b) the settle gate defers broadcasts (`compose-preview-ffmpeg-jpeg.js:218` + `compose-preview-activity.js:209-243`), and (c) the client look-stack PRV push goes via `POST /api/amcp/batch` (`src/api/routes-amcp.js:90-116`) which never calls `scheduleSettle`/`onProgramMutation` for the touched channel — preview edits don't nudge the JPEG pipeline. Also noted: `compose-preview-activity.js` capture-gating helpers (`shouldCaptureOnTick` etc.) are defined but never called in the live path; its `contentSig` (:141-153) is OSC-clip-only (blind to MIXER changes) if ever re-enabled.

## 3. Tasks

- [x] T155.1 **Fix the snapshot key asymmetry** (files/lines above). Every param edit that doesn't change the clip/loop/content must go through the MIXER-only branch — zero `PLAY` lines in the AMCP batch (assert in smoke). Decide `browserAsCg`'s correct home (it *should* force a re-PLAY when it actually flips).
- [x] T155.2 **Smoke:** feed `pushSceneToPreviewImpl` (or the snapshot helpers) a sequence: opacity change → expect no PLAY; clip change → expect PLAY; loop flip → expect PLAY; geometry drag → geometryOnly path.
- [ ] T155.3 **Verify edit→PRV behavior with owner post-fix:** confirm `previewEnabledByMain`/`previewChannels` config on the rig; document the availability gate in operator terms; only if a gap remains, extend (e.g. option to mirror edits via server take).

  **Operator-terms note (documentation half of T155.3 — owner-verification half stays open):** `isPreviewBusAvailable` (`client/lib/scenes-preview-look-stack.js:116-123`) decides, per main, whether a looks-editor edit is mirrored to PRV or stays canvas-only:
  - If **"Preview enabled"** is switched off for a main, or that main has no PRV channel configured at all, your edits show only on your local editor canvas — nothing goes out to the PRV output.
  - If a main's PRV output is set to the **same physical channel as its PGM output** (no separate preview bus — e.g. main 2 on this rig is PGM-only), edits also stay canvas-only, because there is no distinct PRV channel to send them to. This is expected, not a bug.
  - Otherwise — a real, separate PRV channel is configured and enabled for that main — every edit in the looks editor is pushed live to PRV as you make it, so the PRV canvas should match the actual PRV feed (and, after T155.4a/b, the deck PRV thumbnail should too).
- [x] T155.4 **PRV thumbnail freshness:** canvas mode — invalidate/redraw the deck PRV cell when a preview push completes (hook after `pushSceneToPreviewImpl` returns, `scenes-preview-runtime.js:214`, and `scenes-editor-deck-thumb.js:59-70`); ffmpeg_jpeg mode — make the `/api/amcp/batch` PRV push mark the channel (`scheduleSettle`/`onProgramMutation` in the `routes-amcp.js:113` region). Blocklist/stale-file display is WO-159's scope — don't duplicate.
- [ ] T155.5 Gates green after each fix; dated work-log entries (root cause → fix → verification).

## 4. Acceptance criteria

- [ ] A155.1 Operator confirms on hardware: dragging/typing any looks-editor parameter no longer restarts the playing clip on PRV; content changes (clip swap, loop toggle) still reload as expected.
- [ ] A155.2 Smoke proving MIXER-only vs PLAY decision matrix (output in work log).
- [ ] A155.3 PRV deck thumbnail visibly updates after edits in both compose-preview modes; owner confirms the stale-thumbnail complaint is gone (jointly with WO-159).
- [ ] A155.4 Gates green (`lint`, `test:ci`).

## 5. Work log

- 2026-07-13 — WO created from `work/todos13.07.26`. Root cause of the clip restart isolated to the `browserAsCg` key asymmetry between `layerContentMetaForSnapshot` (9 keys) and the stored/compared snapshots (8 keys), which pins both `contentUnchanged` and `geometryOnly` to false so every edit re-issues PLAY. Edit→PRV push already exists (gated by `isPreviewBusAvailable`); PRV thumbnail staleness mapped for both compose-preview modes.

#### 2026-07-13 — T155.1 + T155.2 fixed (snapshot key asymmetry; decision-matrix smoke)

Root cause (B155.1): four hand-rolled content key sets had drifted — `layerContentMetaForSnapshot`
returned 9 keys (incl. `browserAsCg`), but the stored snapshot (`buildPreviewContentSnapshot`),
`isGeometryOnlyPreview`'s `pContent`, and `prevContent` in `pushSceneToPreviewImpl` all built
8-key objects. The `JSON.stringify` comparisons therefore never matched, pinning both
`contentUnchanged` and `geometryOnly` to false, so every preview push took the re-`PLAY` branch
and restarted the clip on any parameter edit.

Fix (`client/lib/scenes-preview-snapshot.js`, `client/lib/scenes-preview-push-scene.js`): kept
`browserAsCg` in the compare set — it changes the producer type (HTML producer + CG vs media
producer), so a real flip SHOULD force a re-PLAY — and made the four sites provably symmetric via
one shared projection, new exported `previewContentCompareKey(entry)`, now used on BOTH sides of
every content comparison (`isGeometryOnlyPreview` and the `contentUnchanged` gate in
push-scene.js:247-250). `buildPreviewContentSnapshot` now stores `...layerContentMetaForSnapshot(l)`
plus its geometry extras (`effects/fill/rotation/opacity/keyer`), and `layerContentMetaForSnapshot`
returns through the same projection — a key added in one place can no longer silently drift out of
the others. `!!` normalization inside the projection means stored snapshots from before this fix
(no `browserAsCg` key → `undefined`) compare equal to a fresh meta (`false`) — no one-off spurious
restart after upgrade.

Verification: `node --check` clean on both files + smoke; eslint --quiet 0 on all three; new
`tools/smoke/smoke-preview-snapshot-restart.test.js` 7/7 pass — builder key-symmetry, opacity-only
→ geometryOnly+contentUnchanged true, rotation drag → true, clip change / loop flip / browserAsCg
flip → content changed (PLAY path), legacy 8-key snapshot + unchanged layer → contentUnchanged true.
Existing `smoke-preview-push-import.test.js` still green. Operator QA (A155.1) pending on hardware.
T155.3/T155.4 (PRV mirror verification, thumbnail freshness) intentionally untouched here.

#### 2026-07-13 — T155.4 fixed (PRV deck thumbnail freshness, both compose-preview modes) + T155.3 doc note

**(a) Canvas mode.** The deck PRV cell is a client-side composite of source *still* thumbnails
drawn over live `scene.layers` geometry (`scenes-editor-deck-thumb.js` `drawSceneComposeStack`
branch). A MIXER-only preview push (fill/rotation/opacity, no `PLAY`) never changes a source
thumbnail URL, so nothing told that composite to repaint. Fix: `scenes-preview-runtime.js`
`pushSceneToPreview` now calls a new `scheduleDeckThumbRedraw()` after every successful
`pushSceneToPreviewImpl` result (debounced 120ms so rapid inspector drags coalesce into one
repaint), which dispatches `window.dispatchEvent(new CustomEvent('scenes-deck-thumb-redraw'))` —
reusing the repo's existing `window` CustomEvent redraw-signal convention (`timeline-redraw-request`,
`dmx-redraw`) rather than adding a new event bus. `scenes-editor-deck-thumb.js`'s
`createDeckThumbPainter` now listens for that event and calls its own `repaintDeckThumbs()` (which
already safely no-ops while the editor is open, since deck cards aren't mounted then — the deck
picks up current geometry on its own next render when the editor is exited).

**(b) ffmpeg_jpeg mode.** `POST /api/amcp/batch` (`routes-amcp.js`) is the transport
`postAmcpPreviewPipeline` uses for the scenes-editor look-stack PRV push (MIXER…DEFER lines for
fill/rotation/opacity, PLAY for content changes — channel-level `MIXER <ch> COMMIT` is always sent
separately via `/api/raw`, never inside the batch). Unlike `/api/play`, `/api/stop`, `/api/clear`,
this endpoint never called into `compose-preview-activity`. Fix: added
`touchedAmcpBatchChannels(lines)` (regex-parses the same `<VERB> <ch>[-<layer>] …` shape
`playback-tracker.recordAmcpLines` matches — PLAY/LOAD/LOADBG/STOP/CLEAR/MIXER/CG all qualify) and
call, per touched channel, a new small export `compose-preview-activity.onAmcpBatchMutation(channel)`
— a thin wrapper around the existing `scheduleSettle(channel, STILL_SETTLE_MS)`, matching the
short CUT-style settle window `routes-mixer.js:181`/`onProgramMutation` use for
duration-less/still-style mutations (AMCP batch lines carry no transition/duration metadata to
compute a longer window from). Kept the endpoint scope to `/api/amcp/batch` only, per B155.3
finding (c) and T155.4's task text — `/api/amcp/raw-batch` and `/api/raw` (which carries the
COMMIT line) were left untouched; the channel is already marked by the preceding batch call in the
same push, so no freshness gap remains from skipping those.

**T155.3 documentation half:** added the 3-bullet operator-terms explanation of
`isPreviewBusAvailable` under T155.3 above (owner-verification half of T155.3 stays open).

Verification: `node --check` clean on all 5 touched files. eslint (installed standalone in
scratchpad — not in repo `node_modules` — run via `NODE_PATH` against the repo's
`eslint.config.js`) `--quiet` → 0 warnings/errors on all 5. New
`tools/smoke/smoke-amcp-batch-compose-preview-activity.test.js` 3/3 pass: MIXER-only batch settles
the touched channel; an untouched channel stays settled; PLAY/STOP/CLEAR lines are also extracted.
Re-ran `smoke-preview-snapshot-restart.test.js` (7/7), `highascg-health-api-amcp.test.js` (9/9 + 1
skip), `smoke-compose-preview-activity.test.js` (11/11) — all green, no regressions from T155.1/2.
Two pre-existing failures found elsewhere during the sweep (`smoke-amcp-offline-migration.test.js`
CG-clear assertion, `smoke-compose-preview-dirty.test.js` PNG-vs-JPEG content-type assertion) are
unrelated to any file this task touched and reproduce in isolation on an unmodified checkout — not
caused by this change; flagged for separate follow-up, not fixed here (out of T155.4 scope).

Coverage note: (b) is exercised by an automated smoke (offline router + simulated AMCP). (a) is a
DOM/canvas repaint with no headless DOM harness in this repo's smoke suite — not unit-tested here;
manual QA steps for A155.3 (canvas mode half):
  1. Open the looks editor on a look that is live on a main with a separate PRV bus, with that
     look's deck card visible (split view, or a second browser tab on the deck).
  2. Drag opacity/rotation/fill on a layer (MIXER-only edit — clip must keep playing, not restart).
  3. Confirm the deck card's PRV thumbnail visibly updates within ~120ms of the drag settling,
     without needing to exit the editor.
  4. Exit the editor back to the deck — thumbnail should already match, not "pop" to a different
     image.

#### 2026-07-14 — T155.4(b) partially reverted by WO-198 (T198.1)

The `/api/amcp/batch` → `onAmcpBatchMutation` coupling (T155.4(b) fix) was well-intentioned but
caused a latency regression: every editor drag tick issues a batch, and each call scheduled a
150 ms settle window (STILL_SETTLE_MS). Continuous editing = perpetually restarted settle window =
frames withheld until the operator stops. Live investigation on 2026-07-14 found the nudge was
unnecessary: the FILE consumer is live-writing continuously, and the 40 ms mtime poll broadcasts
changes by itself — the settle gate exists to hide mid-TAKE transition frames (live choreography
via OSC), not editor tweaks. Reverted in WO-198 T198.1: removed the call and the now-unused wrapper
function. Deck-thumb redraw (T155.4(a)) stays — it's correct and has no downside.
