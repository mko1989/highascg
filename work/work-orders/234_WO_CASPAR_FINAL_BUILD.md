# WO-234 — Assemble + build the final (for now) CasparCG for highascg

**Status:** In progress | **Date:** 2026-07-15
**Owner directives:** Enhanced's audio (PortAudio) work is CRUCIAL — all Enhanced differentiators go in. Re-review the seed PRs code-level (#1762 mixer effects, #1751 Pixel consumer — fair second look, owner sees pixel mapping as a good fit, #1727 stream reconnect). Then build the final version.

## Merge plan (from WO-233, owner-amended)
- BASE: firecraftgaming/caspar-server `improved-artnet` (= upstream PR #1752; closest to current master).
- MUST: ALL CasparCG_Enhanced differentiator commits (screen GL/aspect, OAL video-scheduled audio, PortAudio/ASIO/JACK consumer — file-disjoint from artnet per WO-233).
- SHOULD (apply unless review finds rot): #1763 DeckLink teardown UAF, #1691 NDI leak (needs rebase), #1761 CG payload escaping.
- REVIEW-GATED (T234.1 decides): #1762 (mixer color/effects series — evaluate the whole series), #1751 (Pixel consumer — is it complementary to improved-artnet for the owner's pixel-mapping workflow, e.g. arbitrary mapping files / other outputs, or redundant?),
Its a media server. i can see multiple uses for pixel consumer.
 #1727 (ffmpeg STREAM auto-reconnect).
- SKIP: per WO-233 (stale/dirty/orthogonal).

## Tasks
- [x] T234.1 Deep code-level PR review (sonnet): read the actual diffs of #1762(-series), #1751, #1727 (+sanity on #1763/#1691/#1761); verdict per PR: MERGE / SKIP with code-level rationale, conflict forecast vs the base+MUST tree, and any needed follow-up patches. Append verdicts here.
- [x] T234.2 Assemble branch `highascg-build-v1` in a scratchpad clone: base + Enhanced commits re-applied + approved PRs cherry-picked; resolve conflicts; record every commit hash + resolution in the work log; push NOTHING (bundle the tree as a tar + git bundle under /home/casparcg/Downloads/caspar-build-kit/).
- [x] T234.3 Build kit: `build.sh` with two variants — (a) docker (Enhanced's documented recipe, CPU-limited flags) and (b) bare-metal deps list (exact apt packages from the repo's docs/CI) + cmake/ninja bootstrap; includes CEF 142 prebuilt fetch per the tree's mechanism; output: casparcg binary + verification steps (strings check for artnet+portaudio symbols, --version).
- [ ] T234.4 BUILD: blocked on owner choice — (a) install docker or cmake+deps on this box (root) → orchestrator builds niced/CPU-limited; or (b) owner runs the kit on the original 'serwer' build machine. Deploy plan after: place binary as bin/casparcg.new, owner swaps + restarts Caspar in a maintenance window (NEVER auto-swap on the live box).
- [ ] A234.1 Owner: new binary passes soak (playout + audio via PortAudio + artnet consumer smoke) before replacing bin/casparcg.

---

## T234.2 — Assembly work log (2026-07-15)

Assembled entirely in the scratchpad (no push, no build, no root, nothing written
into this repo except this log): `/tmp/claude-1000/-home-casparcg/b4cdb261-14b7-4963-8345-f31015d113e3/scratchpad/caspar-assembly/highascg-build-v1`, branch `highascg-build-v1`.

Started assembling base + MUST + SHOULD before T234.1's verdicts landed in this file
(per the original instruction to leave the review-gated PRs for later); T234.1's
verdicts (and the owner's #1751 override) appeared in this file mid-assembly, so the
review-gated PRs were cherry-picked too, in the WO's revised apply order, rather than
leaving them for a separate pass — no reason to defer work that already has a MERGE
verdict sitting right here.

**Base:** `firecraftgaming/caspar-server:improved-artnet` tip `6b065c8` (= upstream
CasparCG/server master + firecraft's 8 artnet feature commits, PR #1752).

**Final HEAD:** `bb4c32d` — 34 commits on top of the base. `git status` clean, no
conflict markers anywhere in the tree at completion, `casparcg.config` re-validated as
well-formed XML after all merges.

**Apply order (matches CASPAR_BUILD_MANIFEST.md / T234.1's revised list exactly):**
base → Enhanced's 18 differentiator commits → #1763 → #1761 → #1691 → #1727 → #1751 →
#1762 (last, touches shared mixer core).

**MUST — CasparCG_Enhanced differentiator commits (0a6b136..enhanced/main, 18 found):**
12 applied (2 with conflicts, resolved — see below), 3 were no-ops against this base
(content already present via the base's newer upstream lineage: `dcfe220`, `e8ea793`,
`14167fa`), 3 deliberately skipped as non-functional README/branding churn (`235b0ec`,
`cae75e2`, `55ee517`). **PortAudio module (CRUCIAL per owner) is in** — commit `6804b16`
applied clean, creates `src/modules/portaudio/` wholesale. Screen GL/aspect-ratio work
and OAL video-scheduled-audio work are both in.

**Conflicts hit + resolved (4 total, all in the MUST commits — full detail + rationale
in `SOURCES.txt`):**
1. `decklink_producer.cpp` (`dcfe220`) — base's `Filter()` has a newer `hdr_` param
   Enhanced predates; kept base's signature, patch became a no-op (already present).
2. `oal_consumer.cpp` (`f658029`, destructor + `send()`) — took Enhanced's
   video-scheduled-dispatch side wholesale (matches commit intent + already-merged rest
   of the file).
3. `screen_consumer.cpp` (`f658029`, window creation) — base has an SFML3 compat branch
   Enhanced predates; left SFML3 untouched (conservative), ported Enhanced's
   spanning-aware borderless-window logic into the SFML2/Linux branch this box runs.
4. `oal_consumer.cpp` (`e70425e`, `initialize()`) — took Enhanced's "deferred future
   sync" rewrite; verified byte-identical to Enhanced's own target after resolution.

**SHOULD PRs (fetched via `git fetch upstream pull/<n>/head`):**
- **#1763** (DeckLink teardown UAF) — applied clean.
- **#1761** (CG payload escaping) — applied clean.
- **#1691** (NDI memory leak) — WO-233 flagged `mergeable_state: unstable` against bare
  upstream master; against this narrower assembled base it applied clean (one automatic
  merge on `casparcg.config`). No rebase struggle needed in practice.

**Review-gated PRs, now MERGE-verdicted by T234.1 and applied:**
- **#1727** (ffmpeg STREAM auto-reconnect) — MERGE per T234.1 (thread-safety verified
  against the real call chain). 1 commit, applied clean.
- **#1751** (Pixel consumer) — SKIP→MERGE via owner override ("Its a media server. i can
  see multiple uses for pixel consumer."). 14 commits, all applied clean (new module
  `src/modules/pixel/`, a couple of mechanical auto-merges on `CMakeLists.txt`/
  `casparcg.config` shared with the artnet/portaudio insertions — no manual resolution
  needed).
- **#1762** (MIXER BLUR/SHARPEN/GRAIN) — MERGE alone per T234.1 (its 3 siblings
  #1758/#1765/#1766 all patch the identical 6 files/same `operator==()` statement —
  not a clean cherry-pick stack, DEFERRED, not part of this build). 4 commits, applied
  clean, zero overlap with Enhanced or #1751.

**Syntactic verification performed (no build, no cmake invoked):**
- `src/modules/{artnet,oal,portaudio,pixel,screen,decklink,newtek,ffmpeg,html,image,
  flash,bluefish}/` all coexist, no path collisions.
- `src/modules/CMakeLists.txt` lists every module including `portaudio`, `artnet`,
  `pixel`.
- `src/CMakeLists.txt` has a PortAudio `find_path`/`find_library`/`PORTAUDIO_FOUND`
  block. Module registration is CMake-macro driven (`INIT_FUNCTION "portaudio::init" |
  "artnet::init" | "pixel::init" | ...`) — no central registry file needed hand-editing.
- `src/shell/casparcg.config` re-parsed with Python's `xml.etree.ElementTree` after all
  merges — still well-formed XML.
- No `.orig`/`.rej` files; recursive conflict-marker grep across `src/`/`dependencies/`
  came back empty.

**Deliverables (under `/home/casparcg/Downloads/caspar-build-kit/`):**
- `highascg-build-v1.bundle` — git bundle of the assembled branch (verified with
  `git bundle verify`), HEAD `bb4c32d`.
- `SOURCES.txt` — every commit hash (original + re-applied), origin, and full conflict
  notes with file names, kept in sync with `work/CASPAR_BUILD_MANIFEST.md`.
- Working tree left in the scratchpad (path above).

**Not included (unchanged from T234.1):** #1758/#1765/#1766 (color-grading series
beyond #1762 — DEFER, needs a manual-merge pass, not a cherry-pick), #1670, #1737,
#1731, #1755/#1756, #1692 — see `SOURCES.txt` SKIP section for the full rationale on
each.

---

## T234.3 — Build kit work log (2026-07-15)

Delivered under `/home/casparcg/Downloads/caspar-build-kit/`:
- **`build-docker.sh`** — follows this tree's own documented Docker recipe
  (`tools/linux/Dockerfile` + `tools/linux/build-in-docker` +
  `tools/linux/extract-from-docker`) verbatim, adds `docker build --cpus=8` CPU limiting,
  restores the source tree from the bundle if not already present, extracts output to
  `./out/casparcg_server/`. Does not touch the live box; does not build on this box.
- **`build-baremetal.sh`** — exact apt package list taken from this tree's own
  `tools/linux/install-dependencies` (the same script the Dockerfile and CI both use),
  plus `portaudio19-dev` added explicitly (that script predates the MUST PortAudio module
  and does NOT include it — a real gap this WO had to catch, documented in the script's
  header comment) and `casparcg-cef-142-dev` from `ppa:casparcg/ppa` per `BUILDING.md`'s
  system-CEF path. Bootstraps a portable CMake 3.29.6 / Ninja 1.12.1 from GitHub release
  tarballs if no usable (>=3.28) system cmake/ninja is found. Builds `nice -n 15`,
  `--parallel 8`. Both scripts pass `bash -n` syntax checks; neither was executed
  (no builds performed on this box, per WO-234 constraints).
- **`DEPLOY.md`** — verification steps (`file`, `--version`, `strings … | grep -i artnet`,
  `strings … | grep -i portaudio`, `ldd … | grep -i portaudio`, OAL/screen symbol checks,
  config-schema diff note for the changed artnet schema), then the manual deploy procedure:
  stage as `bin/casparcg.new` only (the one filesystem change this WO authorizes on the
  live box), owner-only swap + restart in a maintenance window, rollback via
  `casparcg.prev`. States explicitly and repeatedly: **no script ever auto-swaps, restarts,
  or touches the live `bin/casparcg` — that is always a deliberate owner action.**

---

## T234.1 verdicts (2026-07-15)

Method: fetched full `.diff` + PR JSON for every PR in scope directly from GitHub (`CasparCG/server` PRs #1751, #1762, #1758, #1765, #1766, #1727, #1763, #1691, #1761), read every changed file end-to-end, and cross-checked conflict surface against the two scratchpad clones from WO-233 (`firecraftgaming/caspar-server:improved-artnet` = base, `gmeisel01/CasparCG_Enhanced:main` = MUST-tier differentiator commits) via `git log --oneline 0a6b136..HEAD -- <path>` per file. Also pulled current `CasparCG/server:master` copies of `ffmpeg_consumer.cpp` and `core/consumer/output.cpp` to verify the STREAM-reconnect PR's threading claims against the real call chain (not just the diff in isolation). No code changes to highascg, no builds.

### 1. #1751 "Pixel consumer" — VERDICT: SKIP (WO-233's shallow read confirmed, now with hard evidence)

Full diff read (12 files, new `src/modules/pixel/` module + a refactor of `src/common/endian.h` + a small `oscpack` cleanup). This is **not** a config-file mapping tool in the same sense as improved-artnet — it's architecturally a completely different model:

- **Protocol support:** despite a `<protocol>` XML field suggesting extensibility, `pixel_consumer.cpp`'s `create_preconfigured_consumer()` hard-throws `"Unsupported or unspecified protocol."` for anything except `artnet` (case-insensitive string compare). ArtNet-only, same as improved-artnet.
- **Region/mapping model — this is the real finding:** the pixel consumer has **no fixture/region concept at all**. `send()` takes `frame.image_data(0)`, wraps the *entire raw frame buffer* as a `std::span<pixel>`, and pipes every pixel in raster order straight through the color grader to `artdmx_sink::push()`. There is no `x`/`y`/`width`/`height`/`rotation`, no per-fixture anything. The "mapping" is implicit: you must define a custom CasparCG `<video-mode>` whose resolution *is* your physical LED grid (the PR's own sample config does exactly this: an `18×16` `matrix` video-mode) and dedicate a whole channel to it. That channel can't also carry normal broadcast-resolution program output.
- **Color correction:** one global `coef{r,g,b,w}` + one `gamma`, LUT-precomputed (decent code quality) — but it's **one setting for the whole consumer**, not per-fixture. improved-artnet's `fixture_flux{r,g,b,w}` is per-fixture-group.
- **Pixel types:** `luma`/`rgb`/`rgbw`/`rgbx` (global, not per-fixture) — improved-artnet has equivalent RGBW awareness via per-fixture flux.
- **Networking:** one host/port/universe per consumer instance, flat-address-space overflow to `universe+1` — comparable to improved-artnet's multi-universe support, but **no per-fixture host/port** (improved-artnet's "artnet per fixture networking" commit).
- **Nothing arbitrary-mapping-table or config-file-dynamic** — still config-file-only, same operating model as improved-artnet (restart on remap), so it doesn't touch the dynamic-config gap either.

Feature table:

| Capability | improved-artnet (#1752, base) | Pixel consumer (#1751) |
|---|---|---|
| Region/fixture positioning | Per-fixture `x/y/width/height/rotation/mirror`, arbitrary regions sampled from a normal program feed via `sws_scale` | None — whole video-mode resolution = whole pixel grid, 1:1, no sampling |
| Works alongside normal PGM output on the channel | Yes (samples a region of a normal-resolution feed) | No (channel must run a bespoke matrix-resolution video-mode) |
| Per-fixture color correction | Yes (`fixture_flux` per group) | No (one global `coef`/`gamma`) |
| Per-fixture networking | Yes | No (one host/port/universe) |
| Grid definition | `fixture-count` `N` or `WxH`, multiple fixture groups | Implicit via video-mode dimensions |
| Protocols | ArtNet only | ArtNet only |
| Dynamic (AMCP) remap | No (both config-file-only) | No |

Owner's actual workflow (regions sampled from a live composited feed, arbitrary per-fixture placement, JS-side live remap on top — WO-179/228) matches improved-artnet's model, not this one. **Verdict unchanged from WO-233, now on much firmer footing: SKIP.** Revisit only if a future rig is a dedicated native-resolution LED matrix channel with no shared PGM output — not this rig's setup.

### 2. #1762 + series (#1758/#1765/#1766) — VERDICT: MERGE #1762 alone; DEFER #1758/#1765/#1766 (do not bundle)

**Important correction to WO-233's framing:** these are **not a clean stacked series**. All four PRs (#1758 ACES `MIXER COLORSPACE`, #1762 `BLUR`/`SHARPEN`/`GRAIN`, #1765 primary grading, #1766 advanced grade tools) independently branch from a **clean `master`** and each touches the **identical six files** (`accelerator/ogl/image/image_kernel.cpp`, `accelerator/ogl/image/shader.frag`, `accelerator/ogl/util/transforms.cpp`, `core/frame/frame_transform.{cpp,h}`, `protocol/amcp/AMCPCommandsImpl.cpp`), and all four independently patch the **same statement** — `operator==(const image_transform&, const image_transform&)` in `frame_transform.cpp` at the same line (`... && lhs.perspective == rhs.perspective ... || lhs.enable_geometry_modifiers == rhs.enable_geometry_modifiers`), inserting their own new field comparisons ahead of the trailing `||`. Only #1762 additionally reshapes `get_rgba_color()` to take a `uv` parameter (needed for its neighbor-sampling blur/sharpen); #1758/#1765/#1766 leave it as the original zero-arg function. **Combining any two of these four requires manual, non-mechanical merge work in the same functions/structs** — cherry-picking them in sequence will hard-conflict, not soft-conflict. This is worth flagging back to the owner: WO-233's "bundle-test as a set" plan is more expensive than it looked.

Per-PR quality/risk read:
- **#1762 (BLUR/SHARPEN/GRAIN, seed):** clean, self-contained AMCP command implementation (`mixer_blur_command`/`mixer_sharpen_command`/`mixer_grain_command` in `AMCPCommandsImpl.cpp`, standard `transforms_applier`/tween pattern matching existing `MIXER LEVELS` etc.). Shader gating is correctly zero-cost-when-disabled (`blur_enable`/`sharpen_enable`/`grain_enable` boolean uniforms, early return in `get_blurred_color()`). **Crash risk in the mixer hot path: low** — parameter parsing uses `.at()`/`std::stod` which throw on bad input, consistent with the rest of `AMCPCommandsImpl.cpp`'s existing convention (exceptions are caught by the AMCP command dispatcher, not a new risk class). **GPU cost when enabled:** the `lens` blur mode samples up to 400 texels per pixel, `gaussian`/`zoom`/`tilt_shift` up to 100–120 — this runs on the GPU shader path (not the CPU tick/mixer thread the owner cares about for A/V sync), but is worth a caveat for a 28-core-but-GPU-shared box: heavy blur on a full-frame layer at high radius could cost real frame time if the GPU is already loaded by CEF/DeckLink/NDI compositing. Off by default, opt-in, acceptable.
- **Pre-existing quirk (not introduced by this PR, but perpetuated):** the `operator==` chain's `&&...&&...||` structure already existed pre-#1762 (checked the unmodified line before the diff) — it's a pre-existing correctness oddity in transform change-detection, not a new bug. Flagged as a possible separate follow-up ticket, out of scope here.
- **#1758/#1765/#1766:** same architectural pattern/quality as #1762 (parameter parsing via `.at()`/`std::stod`, same AMCP command registration style, same `operator==`/`tween` plumbing edits). No standout implementation red flags in the parts read, but **zero review comments on any of the four**, same single AI-assisted author, and — per the conflict finding above — **not safe to combine without a dedicated manual-merge pass** that this WO's scope doesn't cover.

**Verdict: MERGE #1762 only** (real live-graphics value, self-contained, off-by-default). **DEFER #1758/#1765/#1766** to a separate future WO if the owner wants the wider color-grading toolkit — budget it as a manual-merge effort (reconcile 3 independent diffs into the same functions), not a cherry-pick.

### 3. #1727 ffmpeg STREAM auto-reconnect — VERDICT: MERGE, high value, thread-safety verified sound

Read the full diff plus the **current unmodified `master` copy** of `ffmpeg_consumer.cpp` and `core/consumer/output.cpp` to check the real call chain, since this PR's `connect()` calls `initialize()` synchronously from inside `send()` — initially looked like it could block the channel tick thread with FFmpeg network I/O (`avio_open2`/`avformat_write_header`).

**Verified this is not the case:** in `master`'s (and this PR's, since it reuses the same `initialize()`) implementation, `initialize()` only does trivial synchronous bookkeeping (`format_desc_`/`channel_index_` assignment, graph text) and then spawns `frame_thread_ = std::thread([=, this] { ... })` and **returns immediately** — the actual blocking FFmpeg calls (`avformat_alloc_output_context2`, `avio_open2`, `avformat_write_header`) live *inside* that background thread's lambda, not in `initialize()`'s caller-visible body. Confirmed via `core/consumer/output.cpp`'s `do_send()`, which calls every consumer's `send(field, frame)` **sequentially in a plain for-loop on the channel's own output-dispatch path** (shared by every consumer on that channel, including DeckLink program output) — so if `connect()`/`initialize()` were blocking here it would stall the whole channel including DeckLink outputs. It isn't: `connect()` is bookkeeping-only and returns fast.

Residual, smaller caveat: `disconnect()` (invoked from `send()`'s catch block when the packet thread reports failure) does call `frame_thread_.join()` synchronously — if the frame thread is mid-blocked-syscall in a dying socket write when this fires, `join()` could add bounded latency to that tick. This is the same class of risk as the *existing* (pre-PR) teardown code elsewhere in this file (e.g. the destructor's `packet_thread.join()`), just triggered from a new caller context (a live reconnect event, not only consumer removal) — not a new category of bug, but worth the owner's awareness: **a STREAM consumer's socket-death moment can, in the worst case, add a brief stall to every consumer sharing that channel.** Recommend the owner keep STREAM/SRT/RTMP consumers on a channel that isn't also carrying the primary DeckLink program feed, as deployment guidance (not a code blocker).

Backoff logic itself (1s→2s→4s→8s→16s, 25 attempts/level, capped 30s, tracked via `std::atomic<bool> connected_`/`reconnect_timeout_` a `std::async` sleep-only timer) is correct and matches the PR description; `realtime_` flag correctly gates reconnect-vs-propagate so file recordings still fail loudly. **No file overlap with Enhanced's 18 commits** (`git log` confirms zero Enhanced commits touch `ffmpeg_consumer.cpp`) — clean cherry-pick.

**Verdict: MERGE.** High value given the owner streams; thread-safety checked against the real call chain, not just the diff.

### 4. Sanity re-verify: #1763, #1691, #1761

- **#1763 DeckLink teardown UAF — SHOULD confirmed.** Full diff read: adds `playback_stopped_`/condition-variable pairs to both `decklink_consumer` and `decklink_secondary_port`, waits (2s timeout, logs a warning if exceeded) for the driver's `ScheduledPlaybackHasStopped()` callback before `SetScheduledFrameCompletionCallback(nullptr)` + teardown — textbook fix for the described race, matches Blackmagic's own documented teardown sequence. Small, surgical, single file. **`git log` confirms Enhanced never touches `decklink_consumer.cpp`** — zero conflict risk.
- **#1691 NDI leak — SHOULD confirmed, good engineering, still needs a rebase.** Full diff read: replaces the old unbounded `std::queue` + `std::condition_variable` + `boost::thread::interrupt()` design with `tbb::concurrent_bounded_queue<core::const_frame>` (bounded via `buffer-size`, default 16, configurable), `try_push` with a `dropped-frame` diagnostic tag instead of unbounded growth, and a clean sentinel-frame shutdown (push an empty `const_frame{}` to wake the send thread) replacing the fragile `boost::thread::interrupt()` pattern. Adds a de-jitter pre-roll (half the buffer capacity) before playout starts. This is a materially better design, not a band-aid. **Still `mergeable_state: unstable`** as of this review (conflicts against current `master`, independent of Enhanced) — confirmed via the PR JSON re-fetch. **No Enhanced overlap** (`git log` shows only an unrelated `chore: update ndi sdk` touching `src/modules/newtek/`, no line-level overlap with this diff's hunks). Rebase is mechanical (2 files, +101/-89) but must happen at assembly time (T234.2), not now.
- **#1761 CG payload escaping — SHOULD confirmed.** Tiny, clean diff (`html_cg_proxy.cpp`, 1 file): now escapes `\`, `\n`, `\r`, `\t` in addition to the existing `"` escaping before building the JS `update("...")` call. Correct fix for the stated bug class (malformed/crashing CG UPDATE payloads with control chars). **No Enhanced overlap.**

### 5. Conflict forecast — base (improved-artnet) + Enhanced tree

| PR | Files touched | Overlap with Enhanced's 18 commits | Overlap with improved-artnet's 8 commits | Risk |
|---|---|---|---|---|
| #1763 (decklink UAF) | `decklink_consumer.cpp` | None | None | None |
| #1761 (CG escaping) | `html_cg_proxy.cpp` | None | None | None |
| #1691 (NDI leak) | `newtek_ndi_consumer.cpp`, config | None (only unrelated SDK-version chore touches the dir) | None | Low — but PR itself is `mergeable_state: unstable` against current master; needs its own rebase pass regardless of this tree |
| #1727 (STREAM reconnect) | `ffmpeg_consumer.cpp` | None | None | None |
| #1762 (BLUR/SHARPEN/GRAIN) | `image_kernel.cpp`, `shader.frag`, `transforms.cpp`, `frame_transform.{cpp,h}`, `AMCPCommandsImpl.cpp` | None (`git log` confirms Enhanced never touches these) | None | None from this tree; real risk is only if #1758/#1765/#1766 are added later (see §2) |
| #1751 (pixel, SKIP) | new `src/modules/pixel/`, `common/endian.h`, `modules/CMakeLists.txt`, `oscpack`, config | `modules/CMakeLists.txt` (Enhanced adds `add_subdirectory(portaudio)`) and `casparcg.config` (Enhanced adds screen/system-audio blocks elsewhere in the file) — both trivial/mechanical if it were ever added, N/A since skipped | None (pixel's config insertion point is right after `</artnet>`, matching improved-artnet's own artnet-block-then-`</consumers>` structure) | N/A (not merging) |

`src/modules/CMakeLists.txt` and `src/shell/casparcg.config` will each receive independent, non-overlapping insertions from improved-artnet (artnet block), Enhanced (portaudio module + screen/system-audio config), and #1691 (`buffer-size` line in the ndi config block) — one careful manual pass at T234.2 assembly time, not a per-PR conflict.

### Final cherry-pick list (APPLY ORDER)

1. **Base:** `firecraftgaming/caspar-server:improved-artnet` (= upstream PR #1752) — start here, per WO-233.
2. **Enhanced's 18 differentiator commits** (`0a6b136..gmeisel01/CasparCG_Enhanced/main`) rebased on top — screen GL/aspect, OAL video-scheduled audio, PortAudio ASIO/JACK. Do this early since everything else is file-disjoint from it and it's the largest/most owner-critical chunk.
3. **#1763** DeckLink teardown UAF — isolated file, apply anytime, doing it early derisks DeckLink-heavy soak testing later.
4. **#1761** CG payload escaping — isolated file, trivial.
5. **#1691** NDI memory leak fix — **needs a rebase first** (mergeable_state: unstable); resolve against current master's `newtek_ndi_consumer.cpp` at assembly time, then apply.
6. **#1727** ffmpeg STREAM auto-reconnect — isolated file, apply after the above so any STREAM-consumer soak testing exercises the final tree.
7. **#1762** MIXER BLUR/SHARPEN/GRAIN — apply **last**, deliberately: it's the only merge-tier item touching shared core mixer files (`frame_transform.h/cpp`, `AMCPCommandsImpl.cpp`, ogl image kernel/shader), making it both the easiest to isolate/revert independently if the owner's smoke test doesn't like it, and the one most likely to see upstream churn in those files before the build actually happens.

**Not included:** #1751 (pixel consumer, SKIP — see §1), #1758/#1765/#1766 (color-grading series, DEFER — see §2), everything already marked SKIP in WO-233 (#1670, #1737, #1731), everything WO-233 marked COULD-but-untested (#1755/#1756 ffmpeg teardown hardening — AI-authored/self-described-draft, not re-reviewed in this pass, still needs the owner's own soak test before trusting; #1692, #1663 — minor, not re-reviewed here, no change to WO-233's COULD-tier).

### Follow-up patches needed

- **#1691 rebase:** at T234.2, re-diff `newtek_ndi_consumer.cpp` against the actual assembled tree (post improved-artnet + Enhanced) rather than trying to `git am` the stale PR patch directly — the fix is conceptually simple (bounded `tbb::concurrent_bounded_queue` + sentinel shutdown) and worth reapplying by hand if the literal patch doesn't apply cleanly.
- **`src/modules/CMakeLists.txt` / `src/shell/casparcg.config`:** expect to hand-merge independent insertions from improved-artnet, Enhanced, and #1691 during T234.2; none are logically conflicting, just textually adjacent.
- **`frame_transform.cpp` `operator==`:** the pre-existing `&&...&&... || lhs.enable_geometry_modifiers == rhs.enable_geometry_modifiers` precedence oddity (predates #1762) is inherited as-is. Not a blocker for this build, but worth its own follow-up ticket if the owner ever revisits transform change-detection correctness — do not conflate with #1762's own code quality, which is otherwise clean.
- If the owner later wants #1758/#1765/#1766 on top of #1762, budget that as its own manual-merge WO (not a cherry-pick) — see §2's conflict finding.

## 2026-07-15 — OWNER OVERRIDE on #1751
"Its a media server. i can see multiple uses for pixel consumer." → #1751 verdict SKIP is OVERRIDDEN to MERGE (generic full-frame pixel raster output has standalone value beyond the fixture-mapping use case: raw grid walls, external processors, analysis taps). Revised apply order: base → Enhanced 18 → #1763 → #1761 → #1691 → #1727 → **#1751** → #1762 (mixer core last). Conflict note from review: #1751 is a self-contained new consumer module — no overlap with improved-artnet files expected; verify at cherry-pick.
Owner also requires: **full provenance documentation** — see work/CASPAR_BUILD_MANIFEST.md (which feature comes from which PR/repo, kept current through the build).

## 2026-07-15 — BUILT ON THIS BOX (owner: dev machine, full power)
- Deps installed by owner; configure: cmake 3.28.3/ninja, Release, USE_SYSTEM_CEF=OFF, CEF pre-seeded from the kit tarball (hash-verified). PortAudio found.
- One compile fix required: Enhanced's oal/portaudio consumers used C++17 `[=]` this-captures — error under base's gnu++20 -Werror. Patched to `[=, this]` (6 lambdas), branch commit b96e58d.
- Build: 108/108 targets, linked shell/casparcg (9.3MB), sha stamped 2.6.0 Dev (Revision: 253c16c).
- Verified: artnet_consumer/pixel_consumer/portaudio/oal/reconnect symbols present; BLUR/SHARPEN/GRAIN shader code present; ldd with the production LD_LIBRARY_PATH resolves /home/casparcg/highascg/lib/libcef.so — which is BYTE-IDENTICAL (sha256 fa0993fa...) to the pinned v.142 tarball's libcef.so, so the existing lib/ tree needs NO changes.
- STAGED: bin/casparcg.new (old binary untouched). Bundle regenerated UNSHALLOWED + self-tested (clone from bundle OK) — the earlier bundle was shallow/incomplete.
- REMAINING (owner): maintenance-window swap per DEPLOY.md — mv bin/casparcg bin/casparcg.prev && mv bin/casparcg.new bin/casparcg && restart Caspar; soak: playout + PortAudio audio + artnet consumer + a MIXER BLUR smoke; rollback = swap back.
