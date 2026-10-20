# WO-627 — locked-aspect layers still wrong on Caspar: half the library never got a resolution

**Status: DONE (20.10 — smoke + box: PRV MIXER FILL 0.7407 0.7407 → 1 0.7407 for the same look; PGM fixes on its next take)**

Owner 20.10: "still something wrong with how layer's width height are calculated versus what is displayed in
casparcg's output." This follows WO-625, which fixed numbered CLS names. This case has a different cause.

## Investigation

- Look "Waves", layer 10: `projects/npcc/Tlo Orange Ball/BAZA 2.mp4`, Fill canvas, aspect locked.
  - Stored fill: `{x 0, y 0, scaleX 1, scaleY 0.7407}`, i.e. 1920×800, which is correct for the real
    3072×1280 (2.4:1, ffprobe).
  - Caspar: PRV `MIXER 2-10 FILL` = `0 0 0.740741 0.740741` (16:9, narrower). PGM `MIXER 1-10 FILL` = `0 0 1 1`
    after the owner's 20:01:38 take (journal `[scene-take] scene=look-3 (Waves) … ch=1`). Both are wrong.
- Node did not know the clip's resolution. The `/api/media` row for `BAZA 2.mp4` had no `resolution`, and neither
  did **225 of 345** video/still files.
  - `enrichMediaListForHttp` (`src/api/media-catalog.js:80`) probes at most 120 files per call. It selects them by
    "raw row has no resolution", but the raw rows never carry the cached probe. So every call picked and re-probed
    the SAME first 120, and files after them (BAZA 2 is row 338) were never probed. This is the WO-497 bug, which
    was fixed only in `/api/state`.
  - `getMediaResolutionFromSelf` then has nothing to use. Its fallback, `fetchCinfResolutionFromAmcp`, gets no
    resolution, because this Caspar build's CINF carries none.
  - `calcMixerFill` therefore assumed 16:9 (`contentAR` fallback, `src/engine/scene-native-fill.js`).
- The editor was right because the client knows the clip's size from elsewhere, so the two disagreed.

## What was done

- `src/engine/scene-native-fill.js`: new `probeResolutionFromDisk(self, clip)`. When neither the rows nor CINF give a
  resolution, `getResolvedFillForSceneLayer`, which every take path uses (pgm/prv, lbg jobs, pgm-only), ffprobes the
  file itself.
  - The file is found with `resolveMediaFileOnDisk`, which handles disk, CLS upper-case and project-relative forms.
  - It runs once per clip: the result goes into `_mediaProbeCache` and the clip into a `_mediaProbeTried` set, so
    later lookups and the ~100 ms preview nudges hit the cache.
  - Routes and URLs are never probed.
- `src/api/media-catalog.js`: the bounded list probe skips ids in `_mediaProbeTried`, so successive calls work
  through the whole library. An empty result also counts as an answer (WO-497 rule). A playback `durationMs`-only
  cache entry does not count. The bookkeeping lives in a Set, so nothing leaks into `/api/media` rows.

## What was VERIFIED

- `tools/smoke/smoke-wo627-unprobed-clip-resolution.test.js` (curated): 4/4 pass.
  - The owner's case end to end: no row resolution, CINF without one, then one probe, cached, giving a fill of
    `1 × 0.7407`. Without the probe the fill is the squeezed `0.7407 × 0.7407` Caspar showed.
  - Routes and missing files are not probed.
  - The list probe covers 120 files, then the remaining 30, with nothing probed twice and no field leaking.
- Full offline suite on a clean export: 2878 tests, 2874 pass, 3 skipped, 1 fail (wo498, archive-only). Lint 217,
  line limit, unwired exports: OK.
- Box, after a node restart:
  - re-staging Waves on PRV (`take-look target=preview`) gives `MIXER 2-10 FILL` = `0 0 1 0.740741`;
  - three `/api/media` calls bring the files without a resolution down from 230 to 111 to 14. Those 14 are audio,
    CLS-only rows (the take resolves those through the disk resolver), and 5 frontex `S_*_START.mov` files that
    ffprobe cannot read.
- Not done, on purpose: PGM (ch1) still shows the 20:01 take's `0 0 1 1`. Looks are not taken to PGM from here. The
  owner's next take of Waves to PGM will use the fixed path.
