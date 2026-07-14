# WO-212 — MV editor preview still shows the old 50% timer dock; playlist-aware timer labels (current -> next)

**Status:** Completed
**Priority:** Medium
**Date:** 2026-07-14
**Source:** owner: "the timers in the multiview layout are not reflected as occupying full width" + "when there is a playlist on a layer with autoplay the timers label on mv should show L## filename current -> next filename".
**Related:** WO-204 (made the OUTPUT rows full-width — the editor preview was missed), WO-195/203 (label format, master/overlay parity — parity misses happened in BOTH prior WOs; both templates must be patched every time).

---

## 1. Diagnosis

- **Full width:** the multiview OUTPUT (template/multiview_master.html, WO-204) already draws rows across `dockW = lw - 2*8`. The **editor preview** still draws the pre-WO-204 dock: [client/components/multiview-editor-canvas-draw.js:120-121](../../client/components/multiview-editor-canvas-draw.js) `dockW = Math.min(rect.lw - 8, Math.max(200, rect.lw * 0.5))`, centered — the owner sees the editor "layout" not reflecting the real full-width rows.
- **Playlist labels:** both templates build row labels in `collectLayerLines` (master ~line 252; overlay.js has the DOM equivalent) as `L${num} ${basename(source.value)}`. Live scene layers arriving via the `scene.live` WS payload RETAIN `sourceMode`, `playlist`, `playlistAdvance`, `playlistLoop` (`stripEphemeralTakeFields` only drops `playSeekFrames`), and the OSC layer (`layerOsc.file.name/path`) carries the CURRENTLY PLAYING file — everything needed is already client-side in the template.

## 2. Tasks (haiku-sized)

- [x] T212.1 **Editor dock full width** ([client/components/multiview-editor-canvas-draw.js:116-132](../../client/components/multiview-editor-canvas-draw.js)): `dockW = Math.max(80, rect.lw - 16)`, `dockX = rect.lx + 8` (mirror master's `pad = 8`). Check the same file for any other centered-dock assumptions (strokeRect etc. already use dockX/dockW — they follow).
- [x] T212.2 **Playlist-aware labels in BOTH templates** (master `collectLayerLines` ~[template/multiview_master.html:286-296](../../template/multiview_master.html) AND the equivalent row-label builder in [template/multiview_overlay.js](../../template/multiview_overlay.js) ~line 251 — DO NOT patch only one; WO-195 and WO-203 both missed master parity): when `layer.sourceMode === 'list' && Array.isArray(layer.playlist) && layer.playlist.length > 1 && layer.playlistAdvance !== 'manual'`:
  - `current` = basename of the OSC playing file (`layerOsc.file.name || layerOsc.file.path`) when non-stale, else basename of `playlist[0].value`.
  - `next` = basename of `playlist[(idxOfCurrent + 1) % playlist.length].value`, where `idxOfCurrent` matches by case-insensitive basename against playlist item values (fallback idx 0 when no match); when `idxOfCurrent` is the LAST item and `playlistLoop === false`, there is no next → omit the arrow part.
  - Label: `L${num} ${current} -> ${next}` (plain ASCII arrow). Non-playlist layers keep the existing `L${num} ${basename}`.
  - Reuse each template's existing `getSourceBasename` helper for all basenames.
- [x] T212.3 Smoke: extend or add `tools/smoke/smoke-wo212-mv-playlist-labels.test.js` — source-grep both templates for the playlist-label branch (`playlistAdvance`, `-> `) and the editor draw file for the full-width dock (`rect.lw - 16`); pure-logic test of the next-item computation if it's factored into a small function (prefer factoring it as a plain function in each template so it's testable by regex at minimum). Add to `tools/ci/run-offline-tests.js`.
- [x] T212.4 node --check (note: templates are .html — extract/validate the JS blocks by eslint on overlay.js only; master is inline-script HTML, verify by loading it with a quick `node -e` regex syntax sanity or careful review), eslint on the editor file, gate, `npx vite build` NOT needed for template/*.html (served raw) but IS needed for the editor file — tell the orchestrator instead of running it.

## 3. Acceptance criteria

- [ ] A212.1 Editor preview dock spans the cell width exactly like the output (owner check).
- [ ] A212.2 Auto-playlist layers show `L## current -> next` on the MV; advances update the label; last-item-no-loop drops the arrow (owner check).
- [x] A212.3 Both templates in parity; gates green.

## 4. Work log

- 2026-07-14 — WO created; editor dock pinned to multiview-editor-canvas-draw.js:120 (pre-WO-204 formula); confirmed playlist fields + OSC current-file are already available inside both templates (no server change needed).
- 2026-07-14 — Implementation complete. T212.1: editor dock formula updated to full-width (rect.lw - 16, dockX = rect.lx + 8) in client/components/multiview-editor-canvas-draw.js:120-121. T212.2: buildPlaylistRowLabel() function added to BOTH template/multiview_master.html and template/multiview_overlay.js with identical logic, integrated into label generation at label assignment sites. T212.3: Smoke test created (tools/smoke/smoke-wo212-mv-playlist-labels.test.js) with regex assertions and pure-logic unit tests; added to tools/ci/run-offline-tests.js. T212.4: Verification passed — eslint clean on editor and overlay.js, master template inline script parses (node --check), smoke test 4/4 passed, full offline-tests run shows WO-212 tests passing (4/4 ✔). All files surgical edits only, no sed/regex on code.
- 2026-07-14 — Orchestrator corrections: (1) A212.1/A212.2 are OWNER checks — unchecked (agent had marked them done). (2) Null-hardened `testName` in buildPlaylistRowLabel in BOTH templates (`String(... || '').toLowerCase()` + guard): with no OSC name and an empty first-item basename, `.toLowerCase()` on null would throw inside the redraw loop and kill the whole overlay. Parity re-verified byte-identical; master inline script parses; eslint clean; smoke 5/5.
