# WO-982 — Optimization sweep: what is HighAsCG's load on CasparCG (251 % CPU on 07.11)

**Area:** caspar-build, engine
**Status: DONE (07.11.26) — investigation only, no code change: the 251 % is ONE owner clip (4K ProRes HQ loop on PRV), not a
HighAsCG polling/consumer leak. Proposal with measured gain below (owner decision).**

Owner, 07.11: "run an optimazation sweep where you check code for possible optimazation tweaks." Baseline 00:30, project
a_s, casparcg 251 % CPU / 6.1 GB RSS (WO-405 §4 recorded 8 % on a post-produce config in August).

## Investigation

Box state (live `INFO` per channel, `/api/state`, config): 5 channels — ch1 1080p50 operator GUI (shm consumer `opgui`,
route layers 10-12 = PRV pictures for the GUI), ch2 2560x640 PGM (screen + portaudio, no layers), ch3 2560x640 PRV (no
screen; runtime `ffmpeg` s16le meter-null on port 720), ch4 1080p50 DeckLink 8K Pro host, ch5 64x36 monitor
(system-audio). No v4l2/compose/STREAM-FFT consumers and no CEF/HTML layers alive. Shader layers: none.
route:// only ch1 <- ch3, both 50 fps (no fps mismatch). `INFO` consumers of ch3/4/5 = meter-null only (`-format s16le`,
audio only; its consumer threads are < 0.2 % each).

Per-thread view (`top -H`, 10 s windows; ptrace/perf are blocked, yama=1 / paranoid=4): while ch3 layer 10 plays,
4 threads `av:prores:df0-3` ≈ 17 % each (68 %), ~20 unnamed Caspar threads ≈ 116 % in total (ffmpeg filter graph /
swscale slice threads), OpenGL device 6-7 %, every `channel-N` / `stage` thread ≤ 1.3 %. Node's AMCP load is small:
~1 INFO per channel per minute plus take traffic (Caspar log, 3000-line sample).

What plays on ch3 layer 10: `media/projects/a_s/Tła na diodę/abstract-falling-neon-lines-…utc.mov` — **3840x2160 ProRes
HQ yuv422p10le, 30 fps, 610 Mbit/s** (763 MB), `loop`, into a 2560x640 channel (the Dioda).

### Attribution by measurement (AMCP `PAUSE 3-10` / `RESUME 3-10` under box2.lock, /proc/PID/stat deltas)

| state | casparcg CPU |
|---|---|
| ch3-10 playing the 4K ProRes HQ loop (baseline) | 249 %, 249 %, 247 % |
| ch3-10 paused (2 s settle, 8 s window) | 44 % |
| same, thread view | named threads ≈ 7 %, remaining ≈ 37 % spread over 144 idle-waking pool threads |

=> the clip costs **~200 % CPU (~80 % of the process)**; the floor with it paused is ~40 %.
Two later pause runs read 267 % / 312 % — not contradictions: another agent was taking looks onto PRV at the same
time (Caspar log: LOADBG/PLAY 3-10 every few seconds), which restarts the decode. The first run was taken with no
traffic. `PAUSE 4-1` (DeckLink) did not move the number (capture keeps running regardless).

Offline cross-check with ffmpeg (`-benchmark`, 4 threads, 120 frames, same machine, niced):

| file | decode CPU (utime) | per clip frame |
|---|---|---|
| current: 3840x2160 ProRes HQ 10-bit | 4.83 s | 40 ms (x30 fps = 1.2 cores, before the bgra convert/scale that Caspar adds: +1-3 s per 120 frames) |
| 2560x1440 ProRes Proxy (profile 0) | 0.48 s | 4 ms |
| 2560x1440 HAP | 0.47 s | 4 ms (CPU decode here; Caspar's HAP path would be GPU) |
| 1920x1080 H.264 sibling .mp4 | 0.36 s | 3 ms |

Filter-graph threads: ffmpeg `-filter_threads` 1 / 4 / 28 gave 6.1 / 7.3 / 8.2 s user for the same scale+bgra job, i.e.
the 28-way slice threading Caspar's graph gets by default (it never sets `graph->nb_threads`,
`~/caspar-build/src-v2/.../av_producer.cpp:598`) costs ~35 % extra CPU over 1 thread. That is Caspar-internal.

### Not HighAsCG-caused (checked, nothing to fix)

- Consumers HighAsCG adds: only the meter-null s16le consumer, already skipped on channels that have a real consumer
  (`src/audio/meter-null-consumer.js:67-80`, WO-500) and sized to 64x36 on audio-only channels (WO-898).
- No consumer/producer left behind on ch2/ch5; `INFO` port lists match the config + the designed runtime set.
- AMCP polling is light; no CEF templates, no shader layers, no fps-mismatched routes.
- 6.1 GB RSS: 3.1 GB of it is shared (shm `opgui` + GPU mappings); ffmpeg 4K frame queues account for the rest. Not changed.
- The 144-thread idle floor (~37 %) cannot be attributed further without perf/ptrace (both need root).

## What was done

Nothing in the tree changed (read-only investigation; every pause was resumed — `INFO 3-10` shows `paused=false`,
casparcg back at ~247 %). No files outside this WO.

## Proposals (owner decides; measured expected gain)

1. **Show-quality media sized for the output** (biggest lever, ~200 % → ~30-40 % casparcg): the Dioda is 2560x640, the
   loop is 4K ProRes HQ. A 2560-wide ProRes Proxy/LT or HAP version cuts decode ~10x (table). Deliver it as a new
   version (WO-592/775 versions) — owner ruled out auto-proxies on 04.10, so this is a media-prep choice, not a code change.
2. **Caspar ffmpeg filter-graph thread cap** (build-v2 patch, ~25-35 % of a heavy clip's cost, est. from the ffmpeg
   `-filter_threads` A/B): set `graph->nb_threads` (e.g. 4) next to the `<ffmpeg><producer><threads>` knob
   (`av_producer.cpp:226`, WO-790). Needs a rebuild + swap; not done here (no extra Caspar, changes Caspar internals).
3. PRV could pause its decode while nobody watches it — needs a "GUI is looking at PRV" signal the server does not
   have; not started.

## What was VERIFIED

- Attribution A/B above on the live box (3 baseline windows, 1 clean paused window), restored and re-checked.
- No code touched → no gates affected (max-lines / offline suite / lint not run for this WO; `check-wos` INDEX is the
  coordinator's).
- NOT proven: the real Caspar gain of a proxy/HAP file or of the thread cap (only ffmpeg-CLI numbers); no perf stacks.
