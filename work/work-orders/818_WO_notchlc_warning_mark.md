# WO-818 — ⚠ warning mark next to NotchLC files in the media lists (Godot + web)

**Area:** media
**Status: DONE (29.10, Godot suite 22749/0 + smoke 4/4 + offline 3569/0/2 + boot check + Xvfb render of the Godot list; tooltip on hover and the web row on screen are owner QA) · live e2e 29.10: Godot ⚠ missing at boot → /api/media probe-budget fix (media-catalog.js) → PASS at boot; web row + tooltip PASS**

Owner (29.10): "if the difference between playback is so colossal we need a warning sign next to notchLC files with a
tooltip: caspar cant decode notchLC with gpu, transcode to hap."

## Investigation

- **Why:** this box's ffmpeg (8.0.1) has a NotchLC decoder that runs on the CPU only (`ffmpeg -h decoder=notchlc`:
  threads, frame; no hardware path), and Caspar decodes NotchLC through it. The NotchLC intro played on PRV and PGM
  together took about 918% of a core; the HAP version costs much less (the HAP figure is being measured separately).
- **Where the codec is known:** `GET /api/media` rows carry the server's probed `codec` (lower-case ffprobe
  `codec_name`, e.g. `notchlc`, `hap`). Godot builds the quick-look column from it in
  `godot/client/features/live/media_ops.gd` `quick_info` (WO-759; `CODEC_LABELS` maps `notchlc` → "NotchLC"), and
  `media_panel.gd _build()` writes it into column 1 of the media tree. The web list builds its meta tags in
  `client/components/sources-panel-media.js` (codec upper-cased as a `source-item__meta-tag`).
- The folder name is no signal: `projects/frontex_big/NOTCH/…` holds HAP and NotchLC files side by side, so the
  fallback looks at the file name only, and only when no codec was probed.
- The web sources panel already has a not-clickable warning mark: `<span class="source-item__warn" title=…>⚠</span>`
  (shader-template GPU warning, `sources-panel-templates.js:70,132`; CSS `03c-sources-items-effects.css:421`,
  amber, `cursor: help`). Reused as is.

## What was done

- `godot/client/features/live/media_ops.gd` — `NOTCHLC_TIP` (two lines) and `static func is_notchlc(row)`
  (line 192): the probed `codec` decides, case-insensitive and trimmed; with no codec (missing, null, empty) the
  file's base name containing "notchlc" counts.
- `godot/client/features/live/media_panel.gd _build()` — for a NotchLC row the quick-look cell becomes
  "⚠ NotchLC · 3840×1792 · …" (just "⚠" if nothing else is known), coloured `ThemeBuilder.WARN` instead of
  `TEXT_MUTED`, and that cell's tooltip is `NOTCHLC_TIP` (the name cell keeps its "id · info" tooltip). Same column,
  so the tree, its width fitting, sort, filter, selection and drag are unchanged. A Tree cell has one colour, so the
  whole quick-look text of a NotchLC row is amber, not only the ⚠.
- `client/lib/media-notchlc.js` (new) — `isNotchLcMedia(item)` and `NOTCHLC_WARNING`, same rule and text as Godot.
- `client/components/sources-panel-media.js` — the ⚠ span (`source-item__warn`, tooltip `NOTCHLC_WARNING`) right after
  the file label in line 1 of the row. Not clickable; nothing else in the row changes.
- No server change, no codec-detection change, no transcode action (the existing "Encode to HAP…" stays as it was).

Tooltip text: "NotchLC: CasparCG decodes it on the CPU, which costs far more than HAP. / Transcode it to HAP in
HighAsCG before using it on air."

**Text change (29.10):** owner: "no need for the transcode example command when we already support hap transcoding
natively in app". The second line first read "Transcode to HAP (for example with ffmpeg -c:v hap) before using it on
air."; it now points at HighAsCG's own HAP transcode ("Encode to HAP…") with no command. Same text in
`media_ops.gd NOTCHLC_TIP` and `client/lib/media-notchlc.js NOTCHLC_WARNING`; the Godot test and the web smoke now
assert the new wording and that the text contains no "ffmpeg". Verified in a detached worktree at the WO-818 commit
(on top of the WO-811 commit): Godot suite 22266 passed / 0 failed, boot check OK, offline suite 3524 tests / 3515 pass /
0 fail / 9 skipped (worktree-only skips: no companion checkout beside it, no dist-web, CI-only), lint / prettier /
line limit / unwired exports clean. `npm run build:client` on the box: the served `assets/main-B7WXZl96.js` holds the
new text and no "ffmpeg -c:v hap" (no node restart).

## What was verified

- Godot unit test `godot/client/tests/test_media_notchlc_wo818.gd` (codec decides, case, null/empty codec → name
  fallback, folder name ignored, tooltip two lines). Full Godot suite: **22749 passed, 0 failed** (baseline 22736 + 13).
- Web smoke `tools/smoke/smoke-wo818-notchlc-warning.test.js` (4/4; added to `tools/ci/offline-test-files-2.js`):
  the same cases, the web and Godot tooltip texts are identical, the row template renders the mark.
  Offline suite: **3571 tests, 3569 pass, 0 fail, 2 skipped**. Line limit: 0 files over 500.
- `npm run build:client` OK; the node serves `assets/main-BRVOqBGA.js`, which contains the tooltip text (no node
  restart needed).
- Godot boot check (`./run-client.sh --check`): boot OK, no script errors.
- Owner's Godot client restarted (`--autostart --tab=0`); screenshot of :0 shows it up with the media folders collapsed
  (no clicking on the owner's GUI). A second client on Xvfb with `--sources-filter=intro --probe-perf --probe-shot`
  rendered the expanded list: NotchLC rows (`frontex_big/NOTCH/INTRA_…`, `mhp_harder/INTRO_notch`) show
  "⚠ NotchLC · 5760×172…" in amber, the HAP rows next to them stay muted grey. (That probe client posted the usual
  boot-time project autosave, like every client start.)
- **Not verified:** the tooltip on hover (needs the pointer), the web row on screen (bundle checked, not rendered),
  and the owner's eye on both.

## Live e2e (29.10, on the glass — real Godot client on :0, real PGM/PRV)

**FAIL at first → server bug fixed → PASS.**
- Godot first showed no codec, so no ⚠, on the NotchLC files (q818_hover.png, q818_zoom_before.png). After a manual
  refresh the amber "⚠ NotchLC" text and the 2-line GPU tooltip appeared (q818_hover2.png).
- **Cause:** `/api/media` probed only the first 120 un-tried files per call, and Godot fetches the list once at boot. In
  this library (414 files, 135 NotchLC) most rows had no codec until later calls.
- **Fix:** `src/api/media-catalog.js` `enrichMediaListForHttp` now works through the remaining files in batches of 120
  within one call, up to `PROBE_BUDGET_MS = 3000`. `opts.probeBudgetMs` overrides it for tests. A cold real-library probe
  took 1414 ms (414 tried, 394 with a codec, 135 NotchLC). `tools/smoke/smoke-wo627-unprobed-clip-resolution.test.js`
  keeps the 120 → 150 over-two-calls case (budget 0) and adds the one-call case (150 at once). The wo627 and wo497
  smokes pass 12/12.
- **Verified live:** after a node restart (19:59) and a Godot relaunch, the ⚠ NotchLC rows are amber at boot without a
  manual refresh (q818_boot_fixed.png).
- Web row (Firefox): the ⚠ shows next to INTRO_notch.mov with the NOTCHLC tag and its tooltip (web2.png,
  q818_web_tip.png).
- Note: the web "Scenes/Looks" tab showed "No looks for Dioda/Proj" (web1.png). It was not a stale dist-web: it was a real bug, fixed in WO-827 (the deck never repainted after a server import).

Evidence: session scratchpad `live-e2e/` (screenshots were read before they went in here; `onair.log` has every click with its epoch).
