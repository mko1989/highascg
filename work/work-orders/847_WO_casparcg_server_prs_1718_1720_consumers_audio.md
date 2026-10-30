# WO-847 — CasparCG Server: Screen / OAL / PortAudio consumer enhancements (PRs #1718–#1720)

**Area:** caspar-build, audio
**Status: DONE (30.10) — fork commits e4e1e7ef3/2747aaa47/e8d457ec6 tested on a scratch Caspar (AMCP 5262; two OAL outputs 1.00x/1.00x where the old binary ran 2–3.7x) and swapped live 16:41 (md5 fb955e76, rollback bin/casparcg.pre-wo847); 8 channels PLAYING, show re-applied. Not done: a listen to two <system-audio> outputs on real speakers; PortAudio auto-tune stays a no-op (§ documented)**
**Scope:** Upstream CasparCG/server — merge or ship builds that include three related PRs for professional live / LED wall deployments.  
**Related context:** FFmpeg consumer audio path is fixed at **16 channels** and is not suitable for flexible multi-channel ASIO / event playout; these PRs address that at the consumer layer.

---

## Investigation (2026-10-30)

**Upstream state.** All three PRs (gmeisel01, "CasparCG_Enhanced") were **closed unmerged** on 2026-05-31. #1719 was
withdrawn in favour of **#1714** (dimitry-ishenko, OAL + screen fixes), which was merged into master on 2026-08-10 and
ships in v2.5.1-stable as a squash backport (timespan.h, `alcSetThreadContext`).

**The fork already carries the Enhanced work.** `~/caspar-build/src-v2` (deployed as `~/highascg/bin/casparcg`,
2.5.1 a09a40f12) has the Enhanced screen, OAL and PortAudio commits from WO-233/234/613: 43dbe9a23, 40c48a0b6,
b44f27b85, 2004764a0, 25c3e2026, 36b3d9efe, 617c8c983, 8c8af3c14 and 1ac377d52. WO-613 decided to keep the Enhanced
OAL over #1714's, so this WO does not re-open that. The phases below (an integration branch from main, CI `.deb`,
Windows) assume a stock package workflow the box no longer uses; the relevant question was what the PR heads have
that the fork lacks.

| PR | The PR head vs the fork | Taken? |
|----|-------------------------|--------|
| #1718 | aspect "auto" (0.0 = the format's square dimensions), `W/H` as well as `W:H`, initial `glViewport` = window size (a0c5f9c99f). The fork defaulted to a fixed **16:9**, so a 1600x400 window drew a 711x400 picture. | **Yes**: 2747aaa47 |
| #1719 | The head moved to one OpenAL singleton on a single executor: it serializes all channels and forces one device. | **No**. The #1714 half that matters (a context per device, selected per thread) was ported into the Enhanced consumer instead: e8d457ec6 |
| #1720 | The head is an older, ASIO-only variant. The fork's PortAudio is a superset (host-API selection, substring device match). | **No**, see auto-tune below |

**OAL bug in the deployed build.** Each Enhanced OAL consumer called the process-wide `alcMakeContextCurrent`, so
with two `<system-audio>` consumers every AL call went to whichever context was made current last. Measured on the
deployed binary (bd39a0ee): two channels at **2.06x/2.10x and 3.70x/3.70x** speed, and the first run hung on teardown.
A second consumer on the **same** device failed with "Failed to initialize audio device". That is the "pre-existing"
ADD AUDIO error WO-613 noted. The box has `ALC_EXT_thread_local_context` (openal-soft), which is what #1714 uses.

**Crash in the deployed build.** AMCP `ADD n SYSTEM-AUDIO` segfaults in `swr_alloc_set_opts2`. `SwrContext* raw` is
uninitialized, and the function reuses a non-null `*ps`. The upstream fix is 85fa10952.

**PortAudio auto-tune is inert, and porting it would not help.** `auto-tune-latency` is parsed, but no timing
samples are ever collected, so `perform_auto_tune` never runs. #1720's version measures wake lateness
(`now - target_time`), which does not depend on the compensation it adjusts, so it ratchets: the PR subtracts and
drifts to 0 ms, and the fork's sign would drift to 1000 ms. It stays unported (and documented as a no-op).

**HighAsCG config impact.** The generator always writes `<width>/<height>` for screens (and the fork-only
`<force-linear-filter>`), so the aspect default change does not alter the box's own configs. It affects AMCP
`ADD n SCREEN` and a bare `<screen/>`.

## What was done

Fork commits on `wo742-shm-producer` in `~/caspar-build/src-v2`, on top of a09a40f12. Only these files were staged:
the uncommitted WO-820 NotchLC and WO-800 meter patches in that worktree were left untouched.

- **e4e1e7ef3** `fix(oal)` — `SwrContext* raw = nullptr;` (upstream 85fa10952). Only that one line was staged; the
  rest of oal_consumer.cpp went into e8d457ec6.
- **2747aaa47** `screen` (screen_consumer.cpp) — #1718's final state:
  - default `aspect_ratio = 0.0`; `parse_aspect_ratio` returns 0.0 for empty, default or invalid input and accepts
    `:` or `/`;
  - the constructor overrides the square dimensions only when the aspect is > 0;
  - `effective_aspect_ratio()` is used by uniform/none/uniform_to_fill and by the windowed resize lock;
  - initial `glViewport(0, 0, screen_width_, screen_height_)`;
  - the log prints "auto (format)".
- **e8d457ec6** `oal` (oal_consumer.cpp):
  - a `device` class with a registry (`map<string, weak_ptr<device>>`) keyed by the resolved device name. The name is
    still matched space-insensitively, and an unknown name means the default device;
  - consumers on one device share it and log "OpenAL: sharing the already open device …";
  - `activate()`/`deactivate()` use `alcSetThreadContext` around `initialize`, the destructor and each frame's
    deferred playback. Each frame's release is RAII, which also removed ALSOFT's "Context … current for thread being
    destroyed" error;
  - without the extension it warns and falls back to `alcMakeContextCurrent`.
  - Why not #1714 wholesale: WO-613 keeps the Enhanced dispatch (video-scheduled, stereo downmix). Only the device and
    context ownership was broken.
- `~/caspar-build/build-26.sh` (outside both repos): `-DCMAKE_BUILD_WITH_INSTALL_RPATH=ON
  -DCMAKE_INSTALL_RPATH=$ORIGIN/../lib`. This is WO-848's loader fix; the log prints the RUNPATH and the libcef resolution.
- Patch export: `caspar/patches/wo847-oal-screen-pr1718-1714.patch` (3 commits, `format-patch` a09a40f12..e8d457ec6).
- Docs: `docs/internal/CASPAR_CUSTOM_BUILD.md` intro rewritten to the fork's actual state (it pointed at a
  nonexistent WO-07 and at PR descriptions).

**Build:** `build-26.sh` rc=0 → `~/caspar-build/build-26/shell/casparcg`, version `2.5.1 e8d457ec6 Stable`, md5
`fb955e76f03c4e48414bf0fdceb0db1c`, RUNPATH `$ORIGIN/../lib`. Same libraries as the deployed one (libavcodec.so.62,
boost_log 1.90, icuuc 78).

## What was VERIFIED (2026-10-30)

A scratch Caspar next to the live one (no swap): configs and Python drivers in the session scratchpad (`wo847/`),
AMCP **5262**, OSC to 6299 with `disable-send-to-amcp-clients`, `LD_LIBRARY_PATH=~/highascg/lib`, 2x 1080p50 channels, and a clip in `PLAY …
LOOP`. Speed = media seconds advanced over 10 s of wall time (from INFO).

| Test | Deployed bd39a0ee | New fb955e76 |
|------|-------------------|--------------|
| `<system-audio>` on HDMI 1 (hw:1,7) + HDMI 2 (hw:1,8), two channels | 2.06x/2.10x, then 3.70x/3.70x; the first run hung on exit | **1.00x/1.00x**, clean exit |
| Both channels on the same device | ch2 "Failed to initialize audio device" | "sharing the already open device", **1.00x/1.00x** |
| One device | 1.00x | 1.00x |
| AMCP `ADD 2 SYSTEM-AUDIO` (shared) → `REMOVE 2-500` → `ADD` on HDMI 2 | ADD 404; the later ADD sped both channels to 3.34x | 202 for each step, **1.00x** throughout, clean exit |
| Screen on a private Xvfb :147 with a 1600x400 mode: AMCP `ADD SCREEN` and bare `<screen/>` | 711x400 picture (16:9) | **1600x400** (format) |
| Screen with `<aspect-ratio>3840/1080</aspect-ratio>` | 711x400 (the `/` was ignored) | **1422x400** |
| HTML producer (CEF) from a bundle dir, no LD_LIBRARY_PATH | n/a | html module initialized, `CG ADD` 202, /proc maps `~/highascg/lib/libcef.so` |

Notes: `REMOVE 2 SYSTEM-AUDIO` returns 404 on both binaries: it builds a consumer to compare, and so opens the default
device, which the live Caspar holds. Use `REMOVE 2-<port>`; this is stock behaviour. The pictures were measured from
the Xvfb framebuffer.

## Left

- **Swap** the binary (owner): the commands are in the agent report; rollback is `bin/casparcg.pre-wo847`.
- **Owner A/V check** of two `<system-audio>` outputs on real speakers: the speed measurement proves the clock, not the
  sound.
- PortAudio auto-tune remains a documented no-op; there is no PortAudio test bench (no ASIO on Linux).
- Phases A.1/C (integration branch from upstream main, `.deb`/Windows CI) do not apply: the box ships one fork binary
  (WO-613). Not done.

---

## Original draft

## 1. Objective

Deliver a **CasparCG Server** build (Linux + Windows as applicable) that includes, in a tested combination:

| PR | Title (short) | Primary value |
|----|----------------|----------------|
| [#1718](https://github.com/CasparCG/server/pull/1718) | Screen consumer enhancements | Flexible aspect ratio, brightness/saturation, mipmaps, **multi-display spanning**, always-on-top |
| [#1719](https://github.com/CasparCG/server/pull/1719) | OAL consumer fix | **Video-scheduled audio dispatch**, latency compensation, proper sync with screen consumer |
| [#1720](https://github.com/CasparCG/server/pull/1720) | PortAudio consumer | **ASIO multi-channel output**, **configurable channel count**, fuzzy device name matching, video-scheduled dispatch |

**Success:** Operators can route multi-channel audio to ASIO (and related) devices with channel counts and sync appropriate to LED / live show use cases, without being limited by the FFmpeg consumer’s 16-channel audio path.

---

## 2. Constraints and assumptions

- PRs are **not merged** to `main` at time of writing; they are described as **production-tested** by contributors but require **integration verification** on target OS builds.
- **Dependency order:** #1719 and #1720 logically depend on coherent scheduling/sync work; #1718 is screen-consumer focused but interacts with **shared timing** — expect **merge conflicts** and **ordering** (merge base, rebase chain).
- **HighAsCG** does not need to fork CasparCG **unless** the team chooses to pin a custom binary in the installer; default path is **document + CI** that pulls official/custom artifacts once builds exist.

---

## 3. Phases

### Phase A — Source integration (upstream / fork)

| Task | Description |
|------|-------------|
| **T-A.1** | Create an integration branch from `CasparCG/server` `main` (or agreed release tag), e.g. `integrate/pr-1718-1719-1720`. |
| **T-A.2** | Merge or rebase **#1718** first; run **CMake** configure + full build on **Linux** (CI image) and **Windows** (if in scope). |
| **T-A.3** | Merge/rebase **#1719** onto result; resolve conflicts in consumer / scheduler code; rebuild. |
| **T-A.4** | Merge/rebase **#1720**; resolve conflicts (PortAudio, CMake options, dependencies). |
| **T-A.5** | Document **CMake flags** and **runtime deps** (PortAudio, ASIO on Windows, ALSA/JACK on Linux as per PR). |
| **T-A.6** | Add or extend **automated tests** where the PRs provide hooks; at minimum **smoke tests**: load config with new consumers, start channel, no crash. |

### Phase B — Configuration and ops documentation

| Task | Description |
|------|-------------|
| **T-B.1** | Produce a **minimal example** `casparcg.config` snippets: screen consumer with multi-display / spanning; OAL consumer with video-scheduled dispatch; PortAudio consumer with **channel count** and **device name** examples. |
| **T-B.2** | Document **interaction** between screen + OAL + PortAudio (which consumer owns audio for which channel; sync expectations). |
| **T-B.3** | LED wall: document **resolution / aspect** settings aligned with #1718 (flexible aspect, spanning). |
| **T-B.4** | Add troubleshooting: latency tuning, device not found (fuzzy match), ASIO driver version notes. |

### Phase C — Build & release artifacts

| Task | Description |
|------|-------------|
| **T-C.1** | **CI:** Produce `.deb` / installer artifacts matching current HighAsCG installer expectations (`casparcg-server-2.5` naming or version bump — align with `scripts/install-phase3.sh` and GitHub release filters). |
| **T-C.2** | **Versioning:** Tag clearly (e.g. `2.5.x-custom+pr1718-1720`) so support can distinguish from stock 2.5. |
| **T-C.3** | **Regression:** Run existing CasparCG scenarios: HTML producer, FFmpeg producer, NDI, **existing** consumers still load. |

### Phase D — HighAsCG integration (optional, product)

| Task | Description |
|------|-------------|
| **T-D.1** | If HighAsCG references **minimum Caspar version** or AMCP assumptions, update `README` / `install-config` / smoke scripts only if behavior changes. |
| **T-D.2** | Optional: Settings UI or docs link to **“recommended Caspar build”** for multi-channel audio. |

**Done in-repo (baseline):** `casparServer.caspar_build_profile` (`stock` \| `custom_live`), Settings → Screens, and XML generation for `<portaudio>` + screen extras — see **`docs/internal/CASPAR_CUSTOM_BUILD.md`** and `src/config/config-generator*.js`.

---

## 4. Risks

| Risk | Mitigation |
|------|------------|
| Merge conflicts across three large PRs | Single owner branch; merge in fixed order; nightly builds |
| ASIO / PortAudio licensing or distro policy | Legal review only if redistributing drivers; document user-installed ASIO on Windows |
| Performance on show hardware | Benchmark on reference LED wall machine before production |

---

## 5. Acceptance criteria

1. Integrated tree **builds** on target platforms without disabling unrelated consumers.  
2. **PortAudio** consumer accepts **configurable channel count** and **device selection** per PR #1720 behavior.  
3. **OAL** path exhibits **video-scheduled** audio behavior per #1719 (subjective A/V sync check + logging if available).  
4. **Screen** consumer supports documented **spanning / aspect** features from #1718 on at least one multi-monitor test bench.  
5. Documentation + example config committed under `docs/` or CasparCG fork wiki.

---

## 6. References

- PR #1718 — Screen consumer enhancements  
- PR #1719 — OAL consumer: video-scheduled audio dispatch  
- PR #1720 — PortAudio consumer: ASIO / multi-channel  

---

## 7. Ownership

Assign: **Build/CI owner**, **audio validation owner**, **docs owner**.  
**Out of scope for this WO:** Changing HighAsCG Node server logic unless AMCP contract changes (track under separate WO if needed).

## Swap (coordinator, 30.10 16:41)

- **Swap:** `bin/casparcg` changed from md5 bd39a0ee (kept as `bin/casparcg.pre-wo847`) to fb955e76.
  - AMCP `RESTART` → `202 RESTART OK`; `VERSION` → `2.5.1 e8d457ec6 Stable` within the minute.
  - Node was restarted after checking that no Apply was running; the API answered 200 after 12 s.
- **After the swap:**
  - `INFO` → channels 1–8 PLAYING;
  - the show's batches re-applied (24 + 3 + 8 commands), and the PK BACK TRACK / CLICK layers are back;
  - the Caspar log since the restart has no consumer errors. The one `remote_endpoint` error at 16:42:04 is the node
    socket closing on restart; the 29.10 log has 94 of these;
  - `scripts/setup/check-cef-caspar.sh` → `CEF check: OK (0 warn)` (2 RUNPATH warnings before);
  - the WO-866 test music was re-posted (`test-music` is not stored).
- **Rollback:** `mv -f bin/casparcg.pre-wo847 bin/casparcg`, then AMCP `RESTART` and a node restart.
