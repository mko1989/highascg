# WO-338 — operator GUI edit-latency hardening (web UI ↔ Caspar ↔ punch holes)

**Source:** owner request 2026-07-26 — "making sure the edits between web ui, casparcg and whatever does the punchholes are as quick as possible."

**Status: CLOSED 2026-07-27.** Items 1+2 shipped 13462b1; item 3 (pre-debounce hole feed) evaluated and SKIPPED — with the server debounce already at 50 ms the residual gain is ~one debounce window, not worth a second plan computation on every POST in the hottest operator path; item 4 skipped earlier (per-line route-liveness cache); item 5 shipped 2026-07-27 as a double-spawn guard in operator-shape-overlay.ensureSpawned (in-flight flag, cleared on exit/stop). Related: WO-198 (compose-preview settle latency), WO-318 (hole geometry at 2160p50).

## The two edit paths and their current floors

**A. Compose tile drag (operator rearranges preview windows):** rAF coalesce ~16.7 ms (`client/components/operator-compose-tiles-tile-controller.js:168-171`) → client POST debounce **200 ms** (`client/lib/operator-gui-mode-report.js:14`) → server apply debounce **150 ms** (`src/system/operator-gui-channel.js:41`) → AMCP PLAY/MIXER FILL per cell, serialized, one COMMIT (`operator-gui-channel.js:185-219`); hole rects are computed in the same call and pushed to the python shape helper over stdin with **zero added delay** (`src/system/operator-shape-overlay.js:139`, select-driven pickup in `tools/runtime/operator-shape-overlay.py:150-155`). **Floor ≈ 366 ms + AMCP round-trip.** Both debounces are trailing-edge: during a continuous drag nothing is emitted until motion pauses.

**B. Look/layer edit (drag a layer in the looks editor):** direct DOM update (instant) → `schedulePreviewPush` 16 ms debounce / 200 ms max-wait (`client/components/scenes-preview-runtime.js:14-21`) plus the 90 ms geometry-only mixer nudge (`scenes-preview-runtime-mixer-nudge.js`) → single-flight full AMCP batch to the PRV channel. Already tight; the nudge is the fast path.

Non-hot-path timers (fine as-is): restore debounce 300 ms, heartbeat 60 s, boot guard 10 s, shape reconcile poll 2 s.

## Status update 2026-07-26

Items 1+2 implemented (commit 13462b1): client report is now an immediate-leading-edge 150 ms
throttle; server apply debounce 50 ms. Item 3 not needed for now (holes ride the same call, ahead
of the AMCP loop). Item 4 (batch per-cell AMCP) evaluated and SKIPPED: the per-command
route-liveness cache (`operator-gui-channel.js:203-205`) needs per-line success granularity a
batch loses, and the awaited round-trips are local-TCP-fast — the latency was in the debounces.
Item 5 corrected below (EOF exit already exists).

## Fix direction

1. **Leading-edge + interval emission for the tile drag path:** replace the trailing-edge 200 ms client debounce with throttle-style emission (emit immediately, then at most every ~150 ms during motion) in `operator-gui-mode-report.js:62-68`; holes then track the drag instead of jumping at drag-end. The dedupe on `_lastSentJson` already prevents redundant wire traffic.
2. **Server apply debounce 150 → ~50 ms** (`operator-gui-channel.js:41`): the per-channel promise chain already serializes overlapping applies; the long debounce mostly adds latency.
3. **Split hole update from AMCP work:** in `_doApplyOperatorGuiLayout` (`operator-gui-channel.js:166-219`) the shape feed already happens before the AMCP loop — good; consider feeding holes from the raw POST *before* the debounce window when only rects changed (routes unchanged), so hole tracking is limited by network + SHAPE only (~a frame).
4. **Batch the per-cell AMCP:** PLAY + MIXER FILL are awaited per cell; use `amcp.batchSendChunked` (pattern at `src/bootstrap/caspar-info-ready.js:74`) to send all cell commands + COMMIT in one write.
5. Hygiene (corrected 2026-07-26): the helper DOES exit on stdin EOF (`operator-shape-overlay.py` "stdin EOF — exiting"); the two-helpers observation was a transient spawner race after a manual pkill + rapid rects updates. If it recurs, guard `ensureSpawned` in `src/system/operator-shape-overlay.js` against double-spawn instead.

## Acceptance

- Dragging a compose tile: holes visibly track during the drag (≤ ~100 ms behind the pointer), not only on release.
- Look-editor layer drags keep current behavior or better (nudge path untouched).
- No AMCP command storms: wire traffic during a drag bounded by the throttle interval; dedupe intact; `smoke-wo256-operator-compose-tiles-wiring` + operator-gui smokes pass.
- Killing the node leaves no orphaned shape helper.

## Constraints

- The 2026-07-16 hole/stack contract is untouchable (input∩bounding; see WO-324 ground truth and [[operator-gui-holes-click-dead]]).
- The interaction-suppression path (`operator-gui-mode-report.js:200-224`) must stay immediate — popups over video is the bug it prevents.
- LIVE box; verify on the real display.
