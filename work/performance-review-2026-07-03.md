# Performance Review — HighAsCG + System

Date: 2026-07-03 09:20–09:30 UTC
Host: highascg7579 (Ubuntu, kernel 6.8.0-117-generic, up 1d 18h)

## Executive summary

The machine has a lot of raw power and is nowhere near its limits: ~85% CPU idle
under current playout load, 55 GB of 64 GB RAM free/cache, GPU at 11–30%
utilization and 28 W of a 145 W budget, zero thermal throttling since boot, and
zero late frames in today's CasparCG log.

One critical runaway was found **and stopped during this review** (see finding
1). The remaining recommendations are tuning and hygiene items, roughly in
order of impact: CPU governor is `powersave`, the DeckLink 8K Pro is running at
half its PCIe width, unattended-upgrades can fire mid-show, and there are stale
test/ffmpeg processes lying around.

---

## 1. CRITICAL (fixed during review): runaway ffmpeg consumer writing 156 MB/s to disk

**What happened.** Channel 1 had an ffmpeg consumer streaming raw yuv4mpegpipe
(1080p50 yuv420p ≈ 156 MB/s) to `/tmp/caspar_v4l2.sock`. The external ffmpeg
relay processes that were supposed to listen on that unix socket were suspended
(Ctrl+Z, state `TL`) in a terminal, and the socket path had been `rm`-ed and
recreated several times. CasparCG ended up writing to a **regular deleted file**
(fd 375 → `/tmp/caspar_v4l2.sock (deleted)`, pos ≈ 390 GB).

**Impact measured:**
- ~411 GB written in ~50 minutes (≈560 GB/hour of pointless SSD wear on the
  1 TB root NVMe).
- Root filesystem usage climbed 375 → 410 GB; would have filled the remaining
  ~480 GB in under an hour.
- IO pressure (PSI): `full avg10=4.1%` — real IO stalls visible to all
  processes.

**Action taken:** removed the consumer via AMCP (`REMOVE 1-119776` → `202
REMOVE OK`). Verified: write rate dropped to ~0, disk usage fell to 55 GB
(deleted-file space reclaimed when the fd closed), IO pressure fell to ~0.

**Still to clean up / prevent recurrence:**
- Kill the three suspended ffmpeg jobs in the interactive terminal (PIDs
  811215, 814699, 815325): `kill %1 %2 %3` in that shell, or `kill -9 <pids>`.
- If the v4l2 relay is meant to be permanent, run it as a systemd unit
  (`Restart=always`) and only ADD the Caspar consumer after the listener is
  confirmed bound; REMOVE the consumer when the relay dies.
- Consider having the relay use an abstract socket or a path under `/run`
  (tmpfs) so a missing listener can never turn into a giant on-disk file.
  Note `/tmp` on this host is **on disk**, not tmpfs.

## 2. CPU: strong hardware, conservative power settings

- i7-14700KF: 8 P-cores + 12 E-cores (28 threads), max 5.6 GHz. P-cores
  observed boosting to 5.5 GHz, turbo enabled, **zero throttle events** since
  boot. Package temp ~75 °C under load — acceptable, but keep an eye on cooling
  headroom; sustained all-core loads will push this higher.
- Governor is `powersave` (intel_pstate) with EPP `balance_performance`. For a
  dedicated playout box where consistent frame timing beats power savings, set
  performance mode:

```bash
# one-shot
echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor
echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/energy_performance_preference
# persistent: install cpupower or add a small systemd oneshot unit at boot
```

  Practical effect: eliminates ramp-up latency when load spikes (TAKE with
  heavy templates, stream starts). Idle power will rise somewhat.
- CasparCG main process affinity is `0-15` — exactly the P-cores + their HT
  siblings. That is the right call for playout (keeps the render path off
  E-cores). I could not find where this is set (not in the systemd unit or
  `run.sh`) — worth documenting so it survives upgrades. If it is unintentional
  it still works in your favor; leave it.
- Load average ~7 on 28 threads with 85% idle = healthy. CasparCG uses ~3.5
  cores for 2×1080p50 channels + preview/UDP consumers; the node control
  server ~0.15 core.

## 3. GPU: RTX PRO 4000 Blackwell — barely working up a sweat

- Driver 595.71.05, CUDA 13.2. 1.4 GB / 24 GB VRAM used, 11–31% utilization,
  28 W / 145 W, 52 °C, pstate P3/P5.
- **Persistence Mode shows "Disabled"** even though `nvidia-persistenced` is
  running — verify the daemon is registered (`nvidia-smi -pm 1` or check
  persistenced logs). Low impact on a machine where X holds the GPU open, but
  cheap to fix.
- PCIe reports x16 at 5.0 GT/s (max 32 GT/s): this is normal ASPM
  downtraining at low load, not a problem — it retrains to full speed under
  load.
- Optional for latency purists: lock clocks (`nvidia-smi -lgc <min>,<max>`) to
  avoid pstate transitions during a show. At current load this is likely
  unmeasurable; there is enormous headroom.
- `ForceCompositionPipeline On` (xorg conf) — deliberate anti-tearing choice
  per `docs/reference/screen-consumer-vsync-nvidia.md`; costs ~1 frame of
  latency. Fine.
- CEF `enable-gpu=false` in casparcg.config — HTML templates render on CPU.
  Deliberate (stability) and there is plenty of CPU headroom, but if template
  load ever grows, this is the knob that moves it to the GPU.

## 4. DeckLink 8K Pro: running at half PCIe width

`lspci` device 72:00.0 negotiated **x4 of x8** lanes at 8 GT/s (Gen3):
≈3.9 GB/s usable instead of ≈7.9 GB/s.

- Enough for: several 1080p50 capture/playback channels (each ~0.26 GB/s
  10-bit).
- Not enough for: full 4× 2160p50/60 or 8K workflows the card supports.

Likely cause: the card sits in a slot that is only wired x4 (common on
consumer boards where the second x16-shaped slot shares chipset lanes). If
higher-bandwidth capture is ever planned, move it to a CPU-attached x8+ slot
(mind sharing with the GPU slot) or accept the limit knowingly.

## 5. Memory and swap

- 64 GB RAM, ~7 GB used, rest cache. No pressure (`PSI memory = 0`).
- **No swap and no zram at all.** With this much RAM it works, but a single
  misbehaving process (see finding 1 — it can happen) can push the box to OOM
  with no buffer. Recommend a small zram device (e.g. 8 GB, `zram-tools`) as a
  crash cushion; it costs nothing when unused.
- `vm.swappiness=60` is a no-op without swap; if you add zram set it to ~100
  (zram likes high swappiness) or leave default.

## 6. Storage

- Root: Lexar NM790 1 TB NVMe, ext4, now 7% used after the runaway file was
  released. Scheduler `none` — correct for NVMe.
- Bridge volume: NM790 2 TB, exFAT partition mounted at `~/bridge` — exFAT has
  no journaling; fine for media drops, don't put anything critical on it.
- NVMe temps 43–59 °C — fine.
- SSD wear note: finding 1 wrote ~0.4 TB in under an hour. NM790 1 TB is rated
  ~1000 TBW, so no lasting harm, but worth checking
  `smartctl -a /dev/nvme0` occasionally (needs sudo) for
  `Percentage Used`.

## 7. Services and background load

Running and worth keeping as-is: nginx (`worker_processes auto`, sendfile,
gzip — fine for the web UI), companion, casparcg-scanner, tailscale,
syncthing (correctly niced, `SN`).

Items to address:

- **`unattended-upgrades` is enabled** (`APT::Periodic::Unattended-Upgrade
  "1"`). On a playout machine an automatic kernel/NVIDIA/ffmpeg upgrade or a
  dpkg run mid-show is a real risk. Recommend disabling and updating manually
  in maintenance windows:
  `sudo dpkg-reconfigure -plow unattended-upgrades` (or set the Periodic keys
  to "0").
- **Stale `node --test` process** (PID 214749) has been running the full smoke
  suite for **1 day 3 hours** — it is hung, not testing. Kill it. Some smoke
  tests talk to the live AMCP port, so a hung test run can also poke the
  production server.
- Zoom is installed (apparmor profile loaded) — make sure it does not autostart
  on show machines.
- cursor-server / IDE tooling accounts for a few % CPU — irrelevant when
  developing, close remote sessions for shows.

## 8. Kernel and sysctl

- Generic HWE kernel. A `lowlatency` kernel (1000 Hz, preempt) is a possible
  upgrade for playout jitter, but with zero late frames in the logs there is
  no evidence you need it. Skip unless drops appear.
- `kernel.sched_rt_runtime_us=950000` default; CasparCG runs at nice 0 without
  RT priorities and performs fine.
- Network buffers are stock (`net.core.rmem_max=212992`). The internal UDP
  consumers (`udp://127.0.0.1:5200x`) at 1080p50 raw are loopback and fine.
  Only if you add high-bitrate SRT/RTP over the NIC, raise
  `net.core.rmem_max`/`wmem_max` to 8–16 MB.
- 1 GbE (`eno2`) up; second NIC (`eno1`) down/unused. 1 GbE caps any network
  streaming at ~110 MB/s — fine for compressed streams, not for raw/NDI
  multichannel. NDI auto-load is enabled in casparcg.config; if NDI sources are
  used heavily, consider wiring both NICs or upgrading the link.

## 9. HighAsCG application observations

- Node v24.16.0, `NODE_ENV=production`, service `Restart=always` — good.
- casparcg-server unit has a sensible supervisor (`run.sh`) with hang
  detection, crash-loop backoff, and CEF cache clearing on segfault. Solid.
- Today's CasparCG log: **0 late/dropped frames**. The 44 "buffer/late" grep
  hits are config echo lines and benign ffmpeg latency info.
- Recurring warning in `highascg-node.log`: `[live-audio] slot 1 PLAY OK but
  producer dead on udp://127.0.0.1:52201 ... all_variants_failed`, retrying
  every ~15 s (from Jul 1). Functional bug rather than performance, but the
  retry loop spawns an ffmpeg capture process each cycle — worth fixing or
  backing off exponentially.
- AMCP debug logging (`AMCP → INFO 8-10` every few seconds) at `debug` level —
  harmless, but rotate/size-cap `highascg-node.log` if not already done.

## 10. Prioritized action list (status updated 2026-07-03 ~11:45)

| # | Action | Status |
|---|--------|--------|
| 1 | ~~Remove runaway v4l2 ffmpeg consumer~~ | done during review (AMCP `REMOVE 1-119776`) |
| 2 | ~~Kill 3 suspended ffmpeg relays + hung `node --test`~~ | done — PIDs 811215/814699/815325/214749 killed, `/tmp/v4l2-relay.pid` removed (v4l2 was a one-off test, not to be revived) |
| 4 | ~~Disable unattended-upgrades~~ | scripted — `scripts/setup/10-playout-performance.sh` (run with sudo to apply on this host) |
| 5 | ~~CPU governor + EPP `performance`~~ | scripted — same script installs `highascg-cpu-performance.service`; documented in `scripts/setup/README.md` + `MANUAL_INSTALL.md` step 10 |
| 7 | Live-audio slot 1 retry loop | root-caused — see section 11 below; config already back to `live_audio_input_count: 0`, loop not active today |
| 9 | ~~DeckLink x4~~ | root-caused — PCH root port `00:1d.0` is wired x4 max; card can do x8 but no wider slot exists (GPU holds the only CPU x16). Board limitation, no action possible |
| 6 | Add small zram swap as OOM cushion | open |
| 8 | Verify nvidia persistence mode registers | open |
| 10 | Document the CPU 0-15 (P-core) affinity source for casparcg | open |

## 11. Live-audio workflow review (follow-up 2026-07-03)

**Symptom (Jul 1):** `[live-audio] slot 1 PLAY OK but producer dead on
udp://127.0.0.1:52201 ... all_variants_failed`, retried every 15 s.

**Root cause — stale ALSA card index.** The device picker
(`src/audio/audio-devices.js`) stores capture devices as numeric ids
(`hw:${card},${dev}`, e.g. `hw:2,0`). ALSA card numbers are assigned in probe
order at boot and shift when USB devices are re-plugged or enumeration order
changes. On Jul 1 slot 1 was configured as `hw:2,0`; today card 2 is the
**NVIDIA HDMI codec, which has zero capture devices** (the USB Audio CODEC is
now card 1). The ffmpeg capture bridge (`src/audio/live-audio-bridge.js`)
therefore always died instantly, and the health watchdog
(`src/audio/meter-health.js`, 15 s interval) re-spawned bridge + CLEAR/PLAY
forever.

**Current state:** `config/caspar_server.json` now has
`live_audio_input_count: 0` and empty device fields — the loop is inactive
(zero live-audio journal entries today). Nothing to clean up on the host.

**Recommended workflow hardening (dev tasks):**

1. Store stable ALSA identifiers instead of indices: `hw:CARD=CODEC,DEV=0`
   (card *name* from `arecord -l` bracket field / `arecord -L`). Names survive
   reboots and re-plugs; indices do not.
2. Validate at configure time and at bridge start that the target card
   actually has a capture PCM (`/proc/asound/cardN/` or `arecord -l` match);
   fail with a clear "device gone / renumbered" status in the UI instead of a
   silent retry loop.
3. Add backoff to the watchdog: after N consecutive `all_variants_failed` for
   the same slot, drop from 15 s to e.g. 5 min retries and surface a warning
   in the web UI. Each failed cycle currently spawns an ffmpeg process and a
   CLEAR/PLAY against the production AMCP socket.

## Raw data snapshot (at review time)

- CPU: i7-14700KF, 28 threads, governor powersave/EPP balance_performance,
  turbo on, 0 throttle events, pkg 75 °C
- RAM: 64 GB total, 7.1 GB used, 0 swap
- GPU: RTX PRO 4000 Blackwell 24 GB, driver 595.71.05, 11–31% util, 28 W/145 W, 52 °C
- Disks: NM790 1 TB (root, ext4, 7% used post-fix), NM790 2 TB (ntfs + exfat bridge)
- DeckLink 8K Pro: PCIe x4/x8 @ 8 GT/s
- Network: eno2 1 GbE up, eno1 down, tailscale active
- casparcg: 2 channels 1080p5000, ~3.5 cores, affinity 0-15, 0 late frames today
- PSI after fix: cpu some ~5%, io ~0%, memory 0%
