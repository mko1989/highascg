# WO-175 — FTB = fade 0.5 s (project framerate) then full clear; remove the separate Unblock button

**Status:** Planned
**Priority:** Medium (operator UX; supersedes the WO-156 T156.3 affordance)
**Date:** 2026-07-13
**Source:** `work/todos13.07.26` (owner): "the unblock button… should be part of fade to black. ftb should fade everything out in 0.5s (counted from the set project framerate), wait for the fade to finish and fire full channel clear. no need for a prompt… ftb has that implied."
**Related:** WO-156 (added the Unblock button — now folded into FTB).

---

## 1. Investigation findings (2026-07-13)

**The server already does exactly the requested sequence** — only the client needs changing:

- `POST /api/ftb` (`src/api/routes-ftb.js:55-123`) accepts `screenIdx`, `durationFrames`, `tween`, `framerate` (:98-100) → `runFadeToBlackAllLayers` (`src/engine/ftb-pgm-prv.js:84-129`): fades every active layer `MIXER <ch>-<layer> OPACITY 0 <frames> <tween>` (:104), waits `(frames/fps)*1000 + 200 ms` (:120-121), then `clearCasparChannel()` → `CLEAR <ch>` (:125). PGM + PRV both handled; live scene state cleared after (:105-111).
- The client FTB button (`client/components/scene-list-column.js:70-86`) posts only `{ screenIdx }` → server default 25 frames — NOT 0.5 s at the project rate.
- Project framerate client-side: `cm.programResolutions?.[idx]?.fps ?? 50` (pattern at `client/components/scenes-editor-support.js:178`; helper `client/lib/project-fps.js:49-55`).
- The Unblock button (`scene-list-column.js:91-125`, WO-156 T156.3) does a confirm dialog + `POST /api/clear` — now redundant: FTB ends in the same full-channel clear.

## 2. Tasks (haiku-sized)

- [ ] T175.1 FTB button handler (`scene-list-column.js:70-86`): compute `fps = cm?.programResolutions?.[col]?.fps ?? 50`, `durationFrames = Math.round(0.5 * fps)`, post `{ screenIdx: col, durationFrames, framerate: fps }`. No prompt (FTB already implies it).
- [ ] T175.2 Delete the Unblock button block (`scene-list-column.js:91-125` incl. its append) — read the current file first, line numbers may have drifted; remove ONLY the unblock block, keep everything else (the file was edited today by WO-156).
- [ ] T175.3 Update WO-156's log with one line: "T156.3 affordance superseded by WO-175 (FTB fade-then-clear absorbs Unblock)".
- [ ] T175.4 Verify: node --check + eslint on scene-list-column.js; grep client/ for remaining "unblock" references (should be none); manual QA note: FTB on a playing screen → 0.5 s fade → channel fully cleared; a wedged self-route channel is also recoverable via FTB now.

## 3. Acceptance criteria

- [ ] A175.1 FTB fades all layers over 0.5 s at the project framerate then clears the channel; no Unblock button, no prompt (operator check on hardware).
- [ ] A175.2 Gates green on the touched file.

## 4. Work log

- 2026-07-13 — WO created. Server path already implements fade→wait→clear; scope reduced to client button params + removing the Unblock button.
- 2026-07-13 — **T175.1 implemented.** FTB button handler (`client/components/scene-list-column.js:70-86`) now computes `fps = cm?.programResolutions?.[col]?.fps ?? 50`, `durationFrames = Math.round(0.5 * fps)`, and posts `{ screenIdx: col, durationFrames, framerate: fps }` (was posting only `{ screenIdx }`). This makes the FTB action fade all layers over exactly 0.5 s at the project framerate before the server's auto-clear fires.
- 2026-07-13 — **T175.2 implemented.** Deleted the entire Unblock button block (`scene-list-column.js:89-125` incl. comment, button creation, event listener, and appendChild). The FTB button now provides the same recovery path: fade-then-clear.
- 2026-07-13 — **T175.3 implemented.** Updated `work/work-orders/156_WO_ROUTE_SELF_LOOP_GUARD_AND_MULTIVIEW_RESTART_REAPPLY.md` work log with: "- 2026-07-13 — T156.3 Unblock affordance superseded by WO-175: FTB now fades 0.5 s at project fps then fires the same full channel clear."
- 2026-07-13 — **Verification green.** `node --check` + `eslint --quiet` clean; `grep -ri "unblock" client/` returns no matches (affordance and class removed cleanly).
