# WO-07 — CasparCG Server: Screen / OAL / PortAudio consumer enhancements (PRs #1718–#1720)

**Status:** Draft work order  
**Scope:** Upstream CasparCG/server — merge or ship builds that include three related PRs for professional live / LED wall deployments.  
**Related context:** FFmpeg consumer audio path is fixed at **16 channels** and is not suitable for flexible multi-channel ASIO / event playout; these PRs address that at the consumer layer.

---

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

**Done in-repo (baseline):** `casparServer.caspar_build_profile` (`stock` \| `custom_live`), Settings → Screens, and XML generation for `<portaudio>` + screen extras — see **`docs/CASPAR_CUSTOM_BUILD.md`** and `src/config/config-generator*.js`.

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
