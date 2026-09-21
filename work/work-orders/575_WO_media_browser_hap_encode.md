**Status: IMPLEMENTED (2026-09-21) — offline suite 2486 pass / 0 fail / 2 skip incl. 33 new tests (one runs the REAL ffmpeg), client build clean, and the three formats encoded + measured on a real 5 s slice of `s_INTRO`. NOT yet live-verified through the running app: needs `highascg` service restart (server routes) + kiosk reload, then owner QA (V7).**

# WO-575 — Media browser: "Encode to HAP" for selected files

Owner request (this session): add a HAP encoder to the media browser. User selects one or many
files, hits **Encode to HAP**; output goes in the **same folder**, **same file name + `_HAP`
suffix**. Two toggles: **Alpha** and **HQ**; defaults **standard quality, no alpha**. It should
"basically do what was done by hand" (see Investigation).

Owner note that shapes the design: the source clips are 30 fps but the destinations are 50 fps, and
"it needs to be prepared for anything" — so the encoder must never assume or force a frame rate
(see Requirement R6).

## Investigation

### Why (measured on this box, 2026-09-21)

The intro clips (`media/projects/frontex_big/NOTCH/INTRA_OUTRA/{L,s}_INTRO.mov`) are **NotchLC**,
12-bit 4:4:4:4, 30 fps, 3069 frames: L = 5760×1728 @ ~1.84 Gbit/s (23.5 GB), s = 1920×2304 @
~435 Mbit/s (5.6 GB). NotchLC is a good codec in players that decode it on the GPU; **CasparCG here
does not** — it links system FFmpeg 6.1 (`libavcodec.so.60`, `ffmpeg -decoders` lists only the
software `notchlc` decoder, frame-threaded), and the busy CasparCG threads were named `av:notc…`.

Both intros looping on two screen destinations:

| State | CasparCG CPU | CPU package | GPU |
|---|---|---|---|
| Idle (nothing playing, 12:37) | 20–40 % of a core | 49 °C | 10 % |
| NotchLC, both clips | ~718 % (~7 cores) | 82–90 °C (single core hit 88; crit = 100) | 52 %, 63 °C |
| HAP Alpha, both clips | 436–480 % (~4.6 cores) | 72–88 °C | 32 %, 58 °C |

No thermal throttling in either case (clocks peaked 5.4 GHz, GPU throttle reasons 0). Owner
report that prompted this: fans go to turbo when both intros run.

**Honest read of the result:** HAP cut CasparCG's CPU by roughly a third and dropped the average
temperature a few degrees, but ~4.3 cores above idle remain for two clips. The `av:hap` decode
threads were only ~18 % each, so the remaining load is **not** codec decode — it is CasparCG's own
upload/composite/consumer work (a `video-e…` thread and the OpenGL thread were busy) and is
**not yet investigated**. This WO delivers the encoder; it does NOT claim to fix the fan noise.
Root-causing the residual load is a separate follow-up.

### The manual encode this WO productizes

Run twice in parallel, `nice -n 10`, output to `*.part` then renamed:

```
ffmpeg -nostdin -hide_banner -v warning -progress <file> -nostats \
  -i X_INTRO.mov -map 0:v:0 -map 0:a? \
  -c:v hap -format hap_alpha -compressor snappy -chunks 4 -pix_fmt rgba \
  -c:a copy -f mov X_INTRO_HAP.mov.part
```

Results: `s_INTRO_HAP.mov` 2.7 GB (3.14× realtime), `L_INTRO_HAP.mov` 15 GB (1.08× realtime, while
also running s). Verified after: same frame count (3069), same duration (102.3 s), same
resolution, audio (PCM 44.1 kHz stereo) copied, 30 fps kept, alpha range preserved (L @ 90 s:
original 130–255 avg ~136, HAP 128–255 avg ~133). **Not verified:** picture quality by eye
(12-bit→8-bit DXT5 banding risk in gradients on L), and playback in CasparCG was only checked for
CPU numbers above, not visually.

### FFmpeg HAP encoder facts that constrain the UI (from `ffmpeg -encoders | grep hap`, `-format`)

FFmpeg's `hap` encoder offers `-format hap | hap_alpha | hap_q`. There is **no HAP Q Alpha**.

| Alpha | HQ | `-format` | Raw texture size | Note |
|---|---|---|---|---|
| off | off | `hap` (DXT1) | ~0.5 B/px/frame | **the default in this WO — lowest quality, NOT what the manual test used and NOT yet tried** |
| on | off | `hap_alpha` (DXT5) | ~1 B/px/frame | what the manual test used |
| off | on | `hap_q` (YCoCg DXT5) | ~1 B/px/frame | |
| on | on | — | — | **not encodable** (see Owner decision D1) |

Measured compression from snappy on real material: L 30.5 GB raw → 15 GB, s 13.6 GB raw → 2.7 GB.

### Existing code this plugs into (file:line as of f4d361c)

- **Selection bar / batch actions:** `client/components/sources-panel-media-selection.js`
  (`createMediaSelection` → `runMediaTransfer`, `runMediaDelete`); buttons are wired in
  `client/components/sources-panel.js:288,302` on the `#sources-media-selection-bar` element from
  `sources-panel-shell.js:19`. Selected ids live in `selectedMedia`.
- **Client API helpers:** `client/lib/media-file-ops.js` (99 lines: `moveMediaFiles`,
  `copyMediaFiles`, `deleteMediaFiles`, `formatMediaOpResult`).
- **Modal precedent:** `client/components/media-folder-picker-modal.js` (used by move/copy).
- **Server routes:** `src/api/routes-media.js` (465 lines) + registrations in
  `src/api/router.js:311-318` (all `requireCaspar: false`); the catch-all
  `routes.post('/api/media/*', …, { requireCaspar: true })` at `router.js:418` sits AFTER them, so a
  new specific route must be registered before it.
- **Media id → file:** `resolveMediaFileOnDisk(config, id)` at `src/media/local-media-paths.js:105`
  (handles `MEDIA/` prefix, NFC/NFD, extension-less ids, rejects `..`). Ids may be extension-less,
  so the output path must be derived from the RESOLVED file, not the id string.
- **Rescan after a file op:** `triggerMediaRescan(ctx)` (`routes-media.js` ~270 →
  `ctx.runMediaLibraryQueryCycle`). Scanner (`SCAN_EXT`, `local-media-paths.js:11`) is
  extension-based, so `*.part` is invisible until renamed.
- **ffprobe:** `probeMedia` in `src/media/local-media-ffmpeg.js:14` — returns `codec`, `fps`,
  `resolution`, `durationMs`, `hasAudio` but NOT `pix_fmt`/alpha and NOT frame count; and it spawns
  a bare `ffprobe` (ignores `streaming.ffmpeg_path`). ffmpeg binary elsewhere:
  `config.streaming.ffmpeg_path || process.env.FFMPEG_PATH || 'ffmpeg'`
  (`src/sampling/dmx-sampling-ingress.js:69`).
- **Progress push:** `ctx._wsBroadcast(type, payload)` (declared `src/app-context.js:32`; used by
  `src/media/usb-drives.js:105`); client side `wsClient.on('usb:attached', …)`
  (`sources-panel-ingest-ui.js:153`) is the consumption pattern.
- **File-size pressure:** `local-media-ffmpeg.js` is 446 lines and `routes-media.js` 465 — the
  500-line CI limit means **new code goes in new files**, not appended there.
- **Syncthing:** `media` is in `.stignore`, so `.part` / `_HAP` files are not synced. No action.

## Requirements (what to build)

**R1 — Trigger.** Selection bar gets an **Encode to HAP** action (next to Move/Copy/Delete). Works
for 1..N selected files. Opens a small modal: list of files (count + names), **Alpha** toggle,
**HQ** toggle, Encode / Cancel. Toggles are **always off when the modal opens** — do not persist
last-used state (owner specified the defaults).

**R2 — Output naming.** Same folder as the source; `<basename>_HAP.mov` (source `L_INTRO.mov` →
`L_INTRO_HAP.mov`; source `clip.mp4` → `clip_HAP.mov`; HAP lives in MOV). **Never overwrite**: if
the target exists, skip that file and report it. Never touch the original.

**R3 — Format mapping.** Per the table above. Encoder args (baseline, from the manual test):
`-map 0:v:0 -map 0:a? -c:v hap -format <fmt> -compressor snappy -chunks 4 -pix_fmt rgba -f mov`,
audio `-c:a copy` when the source audio fits MOV, otherwise `pcm_s16le` (test with an mkv/opus and
an mp4/aac source — a failed audio copy must not fail the whole job silently).

**R4 — Safety on a live, on-air box.**
  - **Serial queue, concurrency 1** (the manual test ran two at once; that is not acceptable as a
    default on a production box). Constant, not user-facing.
  - Run under `nice -n 10`. Consider capping `-threads`.
  - Write to `<name>_HAP.mov.part`, rename atomically only after verification (R5). On failure or
    cancel, delete the `.part`.
  - Pre-flight free-space check with `fs.statfs` against an upper bound of
    `width × height × frames × bytes/px` from the table (conservative — real output was 20–50 % of
    that). Refuse the file, don't start, if it doesn't fit.
  - If anything is currently playing (`state.playback.matrix` has a `playing` entry), the modal
    shows a warning that encoding uses many cores and can cause dropped frames; it does not block.
    (Untested — see Verification V6.)
  - A `highascg` service restart kills the child (systemd cgroup) and the job is **not
    resumable**. On startup, sweep stale `*_HAP.mov.part` files. The UI must show an interrupted
    job as failed, not as still running.

**R5 — Per-file pre-checks and post-verification.**
  - Skip with a stated reason: already HAP (`probeMedia().codec === 'hap'`), no video stream,
    still image / single frame, target exists, file not found.
  - After ffmpeg exits 0, ffprobe the `.part`: codec `hap`, same resolution, frame count/duration
    within one frame of the source. Only then rename. Then `triggerMediaRescan(ctx)`.
  - One file failing must not abort the rest of the batch.

**R6 — Frame rate is passthrough.** Do NOT pass `-r`, do NOT resample. The source's rate
(23.976 / 25 / 29.97 / 30 / 50 / 59.94 / 60 / VFR) must come out unchanged; use
`-fps_mode passthrough` so a VFR source isn't dup/dropped. A 30 fps clip on a 50 Hz channel does
not divide evenly (5 output frames per 3 input), so it will not play with an even cadence — an
fps-conform option is a candidate **follow-up**, explicitly out of scope here.

**R7 — Progress + cancel.** Parse `-progress` output; broadcast
`ctx._wsBroadcast('media:hap-encode', { jobId, items: [{ id, state, pct, speed, outId, reason }] })`
throttled to ~1/s, `state` ∈ queued | running | done | skipped | failed | cancelled. A GET returns
current job state so a reloaded client (kiosk F5) can re-attach. UI: minimal — selection bar / status
line shows `Encoding 2/5 · 43 %` with a cancel ✕ (minimalism is the standing UI principle). Cancel
kills the ffmpeg child and removes the `.part`.

**R8 — API.**
  - `POST /api/media/hap-encode` `{ ids: string[], alpha: boolean, hq: boolean }` → `202
    { jobId, items }` (400 on empty `ids`); validates ids through `resolveMediaFileOnDisk`.
  - `GET /api/media/hap-encode` → current/most-recent job state.
  - `POST /api/media/hap-encode/cancel` `{ jobId }`.
  - Register in `router.js` with `requireCaspar: false`, BEFORE line 418.

## Owner decisions needed (blocking only D1)

- **D1 — Alpha + HQ both on.** FFmpeg cannot encode HAP Q Alpha. Options: (a) **recommended** —
  encode HAP Alpha (DXT5) and show an inline note under the toggles ("HAP Q has no alpha here —
  will encode HAP Alpha"), because silently dropping alpha is worse than not using the Q colour
  path; (b) grey out HQ while Alpha is on; (c) refuse the combination. Implement (a) unless told
  otherwise.
- **D2 (optional, small)** — when Alpha is off but the source has an alpha plane, warn in the
  modal ("alpha will be dropped"). Needs `pix_fmt` from ffprobe (not in `probeMedia` today). Cheap
  and prevents a silent loss like the intro clips would have suffered (their alpha does vary,
  down to ~130/255). Default: include it.

## Suggested file layout (500-line limit)

- `src/media/hap-encode-args.js` — pure: format mapping, arg builder, output-path derivation,
  free-space estimate. Fully unit-testable.
- `src/media/hap-encode-queue.js` — job queue, spawn, `-progress` parse, cancel, verify, rename,
  startup `.part` sweep.
- `src/api/routes-media-hap.js` — the three routes; thin.
- `client/components/media-hap-encode-modal.js` — modal + toggles.
- `client/lib/media-file-ops.js` — add `encodeMediaToHap(ids, { alpha, hq })` (currently 99 lines).
- Wire the button in `sources-panel.js` / `sources-panel-media-selection.js`.

## What was done

The manual encodes from the Investigation are still on disk: `L_INTRO_HAP.mov`, `s_INTRO_HAP.mov`
in `INTRA_OUTRA/` (hap_alpha, snappy, chunks 4).

### Server (new files — `routes-media.js` 465 / `local-media-ffmpeg.js` 446 were not grown)

- **[hap-encode-args.js](../../src/media/hap-encode-args.js)** — pure: format mapping (D1 → alpha wins),
  `<stem>_HAP.mov` / `.part` naming, size estimate, `pix_fmt` alpha detection, audio copy-vs-PCM
  choice, `-progress` parser, ffmpeg argv, output verification, `hapSafeSize`, `summarizeStderr`.
  argv has **no `-r`** and uses `-fps_mode passthrough` (R6), never `-y`.
- **[hap-encode-probe.js](../../src/media/hap-encode-probe.js)** — own ffprobe wrapper (returns `pix_fmt`,
  `nb_frames`, audio codecs; ignores cover-art "video"; 30 s timeout).
- **[hap-encode-queue.js](../../src/media/hap-encode-queue.js)** — `HapEncodeQueue`: strictly serial across
  all batches, `nice -n 10` (bare-spawn fallback if `nice` is missing), `.part` → probe-verify →
  atomic rename → `runMediaLibraryQueryCycle`, per-file skips with reasons, free-space refusal before
  ffmpeg starts, cancel (SIGTERM, SIGKILL after 5 s, `.part` removed), 1 Hz throttled
  `_wsBroadcast('media:hap-encode', snapshot)`, `process.on('exit')` kills the child.
- **[routes-media-hap.js](../../src/api/routes-media-hap.js)** + 4 registrations in `router.js`
  (before the `/api/media/*` wildcard, all `requireCaspar: false`): `POST /api/media/hap-encode`
  (202), `POST …/probe` (D2), `POST …/cancel`, `GET /api/media/hap-encode`.

### Client

- Selection bar **Encode to HAP…** button + a **Cancel HAP** button beside the status line
  (`sources-panel-shell.js`, wired in `sources-panel.js`).
- **[media-hap-encode-modal.js](../../client/components/media-hap-encode-modal.js)** — Alpha / HQ toggles,
  **both unchecked on every open, nothing persisted**; file list; warnings (D1 note, alpha-will-be-dropped,
  skipped files, on-air).
- **[sources-panel-hap-encode.js](../../client/components/sources-panel-hap-encode.js)** — job map, status
  line (`Encoding HAP Alpha 2/5 · 43%`), finished summary, re-attaches to a running job after a kiosk
  reload via GET, refreshes the media list when something was encoded.
- **[hap-encode-status.js](../../client/lib/hap-encode-status.js)** — pure text/decision helpers;
  `media-file-ops.js` got the four API calls.

### Where this deviates from the plan above, and why

- **NEW R9 — width/height not a multiple of 4 are resized to the nearest multiple of 4.** Found by the
  real-ffmpeg test, not by reading docs: FFmpeg's hap encoder aborts with "Video size … is not
  multiple of 4" (a 70×50 source failed; 1366×768 and 854×480 would too). Resize (`scale=…:flags=lanczos`,
  ≤2 px) was chosen over padding, which would leave a thin black/transparent edge. The item carries a
  `note` and the finished summary says "N resized to a multiple of 4". Verification compares against the
  resized target size.
- **Stale `.part` sweep runs when the queue is first created** (first HAP API call after a restart), not
  at process boot — a stale `.part` is invisible to the scanner and only holds disk, so a boot hook wasn't
  worth touching bootstrap for. It runs before the first job can start, so it can never delete a live `.part`.
- **`-map 0:a` (not `0:a?`) + `-c:a copy|pcm_s16le`** is chosen from the probe (`pickAudioMode`): copy
  only for codecs MOV can hold (pcm*, aac, alac, mp3, ac3, eac3), else PCM; no audio → no audio map.
- **Failure text**: ffmpeg's first error-looking stderr lines, not the last (the generic "nothing was
  written" line hid the real cause in the first failing test).
- D1 implemented as recommended (a); D2 implemented (the modal pre-check route).

## What was VERIFIED

- **Offline suite:** `node tools/ci/run-offline-tests.js` → **2488 tests, 2486 pass, 0 fail, 2 skip**
  (skips pre-existing). New: `tools/smoke/smoke-hap-encode-{args,queue,routes,client}.test.js`, 33 tests, all
  added to the curated `FILES` list. `check-max-file-lines` 0 over, `check-tdz-reads`,
  `check-dom-escape-duplicates`, `check-script-paths` pass; prettier + eslint clean on every new file.
  `npm run build:client` clean.
- **V1 ✅** all four toggle combos, naming, no `-r` ever, size estimate (bounds the real 15 GB / 2.7 GB encodes).
- **V2 ✅ (real ffmpeg, in the suite; skips if ffmpeg has no hap encoder)** each of default / Alpha / HQ /
  Alpha+HQ over 25, 29.97, 50, 59.94 fps sources: **frame rate identical to the source** (`r_frame_rate`
  compared), odd size (70×50 → 72×52, 64×64 untouched), qtrle alpha source keeps alpha, mkv/opus source
  (audio → PCM), mp4 with no audio, originals kept, no `.part` left. **Not covered:** a truly VFR source.
- **V3 ✅ (fake ffmpeg)** target exists (never overwritten), already-HAP, still image, no video stream, file
  not found (batch continues), non-zero ffmpeg exit, verification failure (wrong size / unreadable result →
  nothing published, `.part` removed), disk-space refusal before ffmpeg starts, cancel mid-run, `nice`
  missing → bare ffmpeg, strictly serial across two batches, duplicate ids collapse. **Not done:** restart of
  the service mid-encode (stale-`.part` sweep is unit-tested only).
- **Real material, 2026-09-21:** a 5 s slice of the actual `s_INTRO.mov` (NotchLC, 1920×2304, 30 fps) through
  the real queue: default `hap` 91 MB in 1.3 s, `hap_alpha` 117 MB in 1.4 s, `hap_q` 195 MB in 1.7 s.
  PSNR vs the NotchLC original (60 frames, RGB): **default 40.2 dB, HAP Alpha 40.2 dB, HAP Q 44.5 dB**;
  alpha plane bit-identical on that slice (PSNR ∞ — the slice is opaque, so this proves nothing about
  soft alpha; the earlier L-clip alpha range check still stands). A 1:1 crop of original | default | HAP Q
  is visually indistinguishable (no banding) on a gradient-heavy blue background. **So the default DXT1
  setting is acceptable on this material** — the open question in the Investigation table is answered for
  `s_INTRO`; L_INTRO (5760×1728) was not re-checked in DXT1.
- **Not run:** V4 (list/thumbnail after rename), V5 (visual playback of each variant in CasparCG), V6
  (encode while a look is playing — R4's warning is untested against real dropped frames), V7 (owner QA).
  Also unverified: the modal/status DOM itself (no jsdom on the box; only pure helpers + source pins are
  tested) and the WebSocket delivery of `media:hap-encode` to a real browser.
- **Pre-existing gate failures, not from this WO:** `check-require-integrity` (11 Syncthing
  `*.sync-conflict-*` files under `projects/`) and `check-unwired-exports` (`AUDIO_ONLY_TRANSITION`,
  WO-572 work in progress).

## To activate

Server: `kill -TERM $(systemctl show -p MainPID --value highascg)` — **do this BEFORE reloading the
kiosk**, otherwise the new button 404s. Client: `dist-web/` is already rebuilt; reload the kiosk.

## Verification plan (do not mark DONE until each is proven and recorded here)

- **V1 Offline tests** for `hap-encode-args.js`: all four toggle combos (incl. D1 behaviour),
  `_HAP` naming for `.mov`/`.mp4`/extension-less ids, no `-r` ever in args, `-fps_mode passthrough`
  present, free-space estimate. Add new test files to the curated `FILES` list in
  `tools/ci/run-offline-tests.js`; wire every new export (unwired-exports gate is shrink-only);
  `node tools/ci/check-max-file-lines.js`.
- **V2 Real encodes on the box**, each with ffprobe before/after (frames, duration, resolution,
  fps, audio): the default combo (DXT1 — never produced yet), Alpha, HQ, Alpha+HQ; a 25 fps and a
  50/59.94 fps source (proves R6), a VFR source, a source whose width or height is not a multiple
  of 4, an mkv/opus and an mp4/aac source (audio path), and a file that is already HAP (skipped).
- **V3 Failure paths:** target exists (skipped, not overwritten); disk-space refusal; kill ffmpeg
  mid-file (`.part` removed, batch continues); cancel; restart `highascg` mid-encode (stale `.part`
  swept, UI shows failed).
- **V4 Media list:** encoded file appears in the media browser + CasparCG CLS after rename and gets
  a working thumbnail.
- **V5 Playback:** each HAP variant plays in CasparCG on a real channel; look at frames (gradient
  banding on L, alpha edges).
- **V6 On-air load:** run a batch encode while a look is playing; record CasparCG CPU, package
  temp and any dropped frames. If it hurts, tighten R4 (`-threads` cap, ionice, or block-while-playing).
- **V7 Owner QA:** modal defaults, toggle wording, progress line, cancel, reload-during-encode.

## Out of scope / follow-ups

- fps conform / resample option (R6 note).
- Converting the other 14 NotchLC clips in that folder (`*_AKT_*`, `*_OUTRO*`) — will work through
  this feature once it exists.
- Root-causing the ~4.3 cores CasparCG still uses for two HAP clips (Investigation, "Honest read").
- Restart/deploy: server halves need `kill -TERM $(systemctl show -p MainPID --value highascg)`;
  client needs `npm run build:client` + kiosk reload.
