# CasparCG highascg-build-v1 — provenance manifest

Every component of the final binary, mapped to its source. Keep current through assembly/build.
(Exact commit hashes get filled by the assembly step — see SOURCES.txt in the build kit for the raw list.)

| # | Component | Source | What it provides | Why we carry it |
|---|-----------|--------|------------------|-----------------|
| 1 | **Base tree** | `firecraftgaming/caspar-server` branch `improved-artnet` = upstream **PR #1752** (tracks recent CasparCG/server master) | Core server close to current upstream; **improved Art-Net consumer**: per-fixture region config with native `sws_scale` box-averaging (fixes LED-wall rasterization) | Newest stable core + the artnet quality fix; base for everything below |
| 2 | **PortAudio/ASIO/JACK consumer** | `gmeisel01/CasparCG_Enhanced` differentiator commits | Low-latency system audio output paths | **Owner-critical audio** (the reason Enhanced was built) |
| 3 | **OAL video-scheduled audio** | CasparCG_Enhanced | OpenAL audio consumer scheduled against video clock | Enhanced audio stack; A/V sync behavior the rig relies on |
| 4 | **Screen consumer GL/aspect fixes** | CasparCG_Enhanced | Fixes GL scaling/aspect on screen consumers | Live PGM screen consumers on this rig |
| 5 | **DeckLink teardown fix** | upstream **PR #1763** | Use-after-free on DeckLink consumer teardown | Crash-class fix; DeckLink is the primary output |
| 6 | **CG payload escaping** | upstream **PR #1761** | Correct escaping of CG UPDATE payloads | We drive countdown/timer CG UPDATE constantly |
| 7 | **NDI memory-leak fix** | upstream **PR #1691** (rebased during assembly) | Bounded queue + clean shutdown in NDI consumer | NDI in production; leak kills long shows |
| 8 | **STREAM auto-reconnect** | upstream **PR #1727** | ffmpeg STREAM consumer reconnects after network drops | Owner streams; deployment note: keep STREAM off the primary DeckLink channel (disconnect thread-join latency) |
| 9 | **Pixel consumer** | upstream **PR #1751** — OWNER PICK | Generic full-frame pixel raster output over Art-Net (grid = video-mode resolution, config-file) | Media-server general tool: raw grid walls / external pixel processors; complements (not replaces) #1 for fixture mapping |
| 10 | **MIXER BLUR/SHARPEN/GRAIN** | upstream **PR #1762** | New mixer effects, off-by-default | Live-events look tools; zero cost when unused; applied LAST (touches mixer core) |

**Deliberately NOT included** (revisit later): #1758/#1765/#1766 color-grading series (all patch the same 6 files — manual-merge project, deferred); #1755/#1756 crash-hardening drafts (unreviewed, need owner soak); #1670 (stale); #1737/#1731 (large, orthogonal).

**CEF (PINNED, owner-mandated):** the EXACT owner build from https://github.com/mko1989/highascg/releases/tag/v.142 (`cef_build_minimal_no_root`), sha256 `2a03fa6b9da0e374fb318903d9502e098ac91ba2ec5be83e96ae076b5aa63cc9` — pinned by URL+hash in Bootstrap_Linux.cmake (branch commit 253c16c). The upstream mirror ships a DIFFERENT binary under the same filename; the hash pin makes any substitution fail the build. The tarball itself is included in the build kit for offline builds.
**Assembly hashes:** base `6b065c8` (improved-artnet), final HEAD `253c16c` (34 source commits + CEF pin); full per-commit provenance in the kit's SOURCES.txt.
**Build/deploy:** kit at ~/Downloads/caspar-build-kit/ (docker + bare-metal variants); binary lands as bin/casparcg.new; owner swaps in a maintenance window; previous binary kept as casparcg.prev.
