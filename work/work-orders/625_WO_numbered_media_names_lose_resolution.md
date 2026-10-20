# WO-625 — numbered media names ("4. Tło 4 …") lost their resolution, so locked-aspect layers rendered stretched

**Status: DONE (20.10 — box: `MIXER 2-10 FILL` 0 0 1 1 → 0 0 1 0.622 for the same look; offline smoke)**

Owner 20.10: "we seem to have a bug in layer sizing calculations. the gui shows the layer with locked aspect
correctly with a blue border, but the caspar image is stretched to fill. there was a whole system in place to convert
highascg pixel count into casparcg 0-1 system"

## Investigation

**Live state (box, 20.10 ~19:30).**
- Look "Waves" was on PRV (channel 2). Its layer L10 has:
  - source `PROJECTS/AIRPORT/4. TŁO 4 - DELIKATNE FALE`, the Caspar CLS id;
  - `contentFit: "horizontal"` (Fill width), `aspectLocked: true`, fill `{x 0, y 0, scaleX 1, scaleY 0.6222}`.
- The Godot look editor drew the box at 1920×672.
- `MIXER 2-10 FILL` answered `0 0 1 1`, the full frame. PGM's look-1 (`MIXER 1-10 FILL` = `0 0.144 1 0.711`) was
  correct.

**The pixel → 0–1 system is fine; its input was wrong.**
- `calcMixerFill` (`src/engine/scene-native-fill.js:295`) maps Fill width to `outH = layerW / contentAR`.
  - With the real clip (ffprobe: 3840×1344, 20:7), that gives 1920×672, i.e. scaleY 0.622, which matches the editor.
  - Without a resolution, `contentAR` falls back to 16/9, giving 1920×1080, i.e. `0 0 1 1`. That is what Caspar got.
- `getMediaResolutionFromSelf` (`:180`) found no resolution:
  - Caspar's CINF on this build carries none (`CINF "PROJECTS/AIRPORT/4. TŁO 4 - DELIKATNE FALE"` →
    `MOVIE 136441531 20260928172855 3000 1/50`).
  - The CLS row in `state.media` has none.
  - The probe cache holds it only under the disk id `projects/airport/4. Tło 4 - delikatne fale.mp4`, and the
    normalized-id loop could not match the two ids.
- **Root cause:** `normalizeMediaIdForMatch` (`scene-native-fill.js:41-48`) strips "the extension" with
  `/\.[^./]+$/`.
  - A CLS id has no extension, so for a numbered name the regex eats everything after the first dot:
    `4. TŁO 4 - DELIKATNE FALE` → `4`.
  - The disk id loses only `.mp4`: `4. tło 4 - delikatne fale`.
  - Reproduced offline: the numbered name gave `null`; the same setup with a plain name `FALE` gave `{w:3840,h:1344}`.
- **Same regex, same failure:**
  - `canonicalMediaBasenameKey` in `src/utils/media-browser-dedupe.js:34`: the CLS row and the disk row of a numbered
    or dotted name never merge, so `/api/media` listed this clip twice. Its own doc example
    (`… 3.16.2026 REV3`) cannot merge under this regex either.
  - The web's `normalizeMediaIdForMatch` in `client/lib/mixer-fill.js:114`.
- The correct rule already existed: `MEDIA_FILE_EXT` in `src/media/caspar-cls-id.js:17`, "Last-segment extensions
  Caspar strips from CLS media ids".

## What was done

- `src/utils/media-browser-dedupe.js` now owns `MEDIA_FILE_EXT`, moved from `caspar-cls-id.js` with webp, tif/tiff
  and ogg added. Caspar strips every extension from CLS ids, so the extra types are correct there too.
  `canonicalMediaBasenameKey` strips only a match. The module is exported, and `caspar-cls-id.js` imports it from here
  (it already imported this module, so there is no import cycle).
- `src/engine/scene-native-fill.js` `normalizeMediaIdForMatch` uses it. This covers the take, the PRV push and the
  mixer nudge.
- `client/lib/mixer-fill.js` `normalizeMediaIdForMatch` (web, KEEP IN SYNC) has the same list, and dist-web is
  rebuilt.
- I chose a known-extension list over a tighter generic pattern (`\.[a-z0-9]{2,4}$`) because a CLS id such as
  `CLIP 3.16` would still lose `.16` under the generic one.

Side effect, intended: numbered or dotted names now merge into one row in `/api/media`. The disk row wins (it has the
resolution and the extension), as for every other clip. Before, this clip was listed twice, once as
`PROJECTS/AIRPORT/4. TŁO 4 - DELIKATNE FALE` with no resolution and once as the disk row.

## What was VERIFIED

- Offline:
  - new `smoke-wo625-numbered-media-names.test.js` (curated, 4 pass) checks the basename keys (numbered, dotted
    `3.16.2026 REV3`, `.mov`, `.webp`), the take resolution for the CLS id (3840×1344), Fill width scaleY 672/1080
    (and 1 without a resolution, the stretched case), the dedupe merge, and the web copy's list;
  - full suite 2867 pass / 1 known fail (smoke-wo577);
  - `smoke-caspar-cls-id.test.js` (not curated) fails the same 7 tests with the committed files and with this change,
    so those failures predate it (project-folder fixtures) and are untouched here.
- Box (node restarted):
  - `/api/media` now lists only `projects/airport/4. Tło 4 - delikatne fale.mp4` with resolution `3840×1344`.
  - Re-staging Waves on PRV (`POST /api/scene/take-look` look-3, preview, the look already on PRV) gave
    `MIXER 2-10 FILL` `0 0 1 0.622222` instead of `0 0 1 1`. PGM's `MIXER 1-10 FILL` stayed `0 0.144444 1 0.711111`.
  - Screenshot: the PRV picture fills exactly the 1920×672 blue box in the Godot look editor.
- Owner QA: other looks with numbered clip names (the airport project) should now render at their box size on take.
