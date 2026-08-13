# WO-500 — PGM1 plays at 73 % of realtime; GPU saturated; the progress-bar snap-back is the same fault

**Status: ROOT CAUSE CONFIRMED + FIXED IN REPO (12.08.2026 — owner removed the meter-null consumers
live; PGM1 went 72.8 % → **99.9 % of realtime** with the DeckLink outputs still attached. Code fix
landed with 8 new smokes, suite 2047/2045/0, eslint clean. **NOT DEPLOYED** — needs a `highascg`
service restart, see §10.)**
**Priority:** High (on-air playback speed)
**Source:** owner 12.08 (`todos12.08.26`): *"the playback of media is running slower than 'real time'…
the gui playback progress bar kind of jumps back every second or two. the playback is running at
aprox 80% speed max"*
**Box:** `highascg0916`, 192.168.0.37 (same machine as the .28 of WO-485/487 — IP reassigned across
reboots/reinstalls). Build stamp `2026-08-12T164536Z`, so WO-497/498 are live.
**Supersedes as the active lead:** [WO-487](./487_WO_FORCED_YUV_PIXEL_FORMAT_ON_UHD_SDI.md) (see §4).
**Related:** [WO-485](./485_WO_DECKLINK_TILES_OVERRUN_THE_CHANNEL_RASTER.md) (deprecated, but the
source of the clock-ownership mechanism), [WO-493](./493_WO_DECKLINK_PIXEL_FORMAT_OPTION.md),
[WO-497](./497_WO_UI_LOAD_AND_PROBE_CACHE.md) §7 (which handed this thread over),
[WO-401](./401_WO_MACHINE_PERFORMANCE_RESEARCH_PASS.md) / [WO-405](./405_WO_PERFORMANCE_ROUND_2.md)
(perf baselines — see the hardware caveat in §7).

---

## 1. The deficit, measured

`/api/state` polled at 1 s over 32 s while `3825579625-preview.mp4` (24 fps, 60 s, looping) played on
**ch1 layer 10**. Loop wraps detected and corrected for:

| | |
|---|---|
| media advanced | **+23.32 s** |
| wall clock | **32.03 s** |
| **rate** | **72.8 % of realtime** |
| backward steps in source `elapsed` | **0** of 28 samples |

The owner's "approx 80 % max" is confirmed and slightly optimistic. Per-sample ratios ranged
0.58–0.88 — a **throughput deficit with jitter**, not a clean fractional clock.

## 2. Live load, measured

`/api/host-stats` during the same window:

| metric | value |
|---|---|
| **GPU utilization** | **100 %** (nvidia-smi; 1783 / 20475 MiB VRAM) |
| casparcg | **639.6 % CPU**, 3.22 GB RSS |
| highascg (node) | 69.4 % CPU, 408 MB RSS |
| load1 / load5 / load15 | 10.33 / 10.07 / 10.37 |
| cores / RAM | **20** / 32 GB (7.9 GB used) |

**The GPU is pegged.** That is sufficient on its own to explain a channel that cannot hold its
50 fps tick, and it reframes the whole investigation: this is a capacity problem, not a
configuration-correctness problem.

## 3. The progress bar jumping back is NOT a second bug

The server-side `elapsed` never regresses (§1, 0 backward steps). The jump is client-side, in
`client/lib/playback-timing-clock.js:159-166`:

```js
const extrapolated = clock.anchorElapsed + Math.max(0, (now - clock.anchorMs) / 1000)
if (Math.abs(elapsed - extrapolated) <= SNAP_TOL_SEC) { /* keep the smooth clock */ }
```

The extrapolator advances at a hardcoded **1.0×** wall clock. At 72.8 % real speed it gains
`1 − 0.728 = 0.272` s of error per wall second, crosses `SNAP_TOL_SEC = 0.5` after

> **0.5 / 0.272 = 1.84 s**

and falls through to the re-anchor branch, snapping the bar backward by ~0.5 s. That is exactly the
owner's *"jumps back every second or two"* — the observation is a precise measurement of the
deficit.

The comment block above that code records that this snapping was already fought once, with the
tolerance band added to absorb per-tick OSC jitter. **A tolerance band cannot absorb a systematic
rate error**; it only sets the period of the snap. Fix the rate and the bar goes smooth with no
client change. Do **not** widen `SNAP_TOL_SEC` — that hides the only honest on-glass indicator we
have of the underlying fault.

## 4. Why WO-487 is no longer the lead

WO-487 was left OPEN as *"hypothesis unmeasured"*: PGM1 slow because the DeckLink consumer owns the
channel's synchronization clock (`decklink_consumer.cpp:1266` true vs `screen_consumer.cpp:1020`
false) and a forced `<pixel-format>yuv</pixel-format>` was starving it.

**The config it was written against no longer exists.** Live `INFO`/`INFO CONFIG` on the box today:

- **ch1 (6144×1536, the slow channel) has NO DeckLink consumer** — screen consumer only.
- The DeckLinks moved to ch3 and ch4 at **1080p5000**, and both already carry
  `<embedded-audio>true</embedded-audio>` + `<latency>normal</latency>` + **no `<pixel-format>`** —
  i.e. precisely the "proven rig" column of WO-487's own diff table.

So the clock-ownership mechanism cannot be pacing ch1, and the pixel-format hypothesis has nothing
left to act on. **WO-487 should be closed as superseded by this WO**, not carried forward. WO-493's
per-output pixel-format control stands on its own merits and is unaffected.

## 5. The actual load map (live `INFO 1`–`INFO 7`)

```
ch1 6144x1536   consumers=[screen, ffmpeg -> udp://127.0.0.1:52001]   layers=[10:clip]
ch2 6144x1536   consumers=[        ffmpeg -> udp://127.0.0.1:52002]   layers=[]
ch3 1080p5000   consumers=[decklink, screen, ffmpeg -> :52003]        layers=[]
ch4 1080p5000   consumers=[decklink, ffmpeg -> :52004]                layers=[10:html, 11:route<-ch6,
                                                                              12:route<-ch7, 13:route<-ch1,
                                                                              14:route<-ch3, 15:route<-ch2, 60:html]
ch5 1080p5000   consumers=[screen, ffmpeg -> :52005]                  layers=[10:route<-ch2, 11:route<-ch1,
                                                                              12:route<-ch3, 13:route<-ch6, 14:route<-ch7]
ch6 1080p5000   consumers=[        ffmpeg -> :52006]                  layers=[3:decklink in]
ch7 1080p5000   consumers=[        ffmpeg -> :52007]                  layers=[4:decklink in]
```

**ch2 is legitimate and must stay** — owner: *"ch2 is preview for screen 1 ch1. its neccesery for the
media server workflow."* Confirmed in the map: it feeds `ch5:10` (operator GUI) and `ch4:15`
(multiview). An earlier read of the generated XML alone made it look unconsumed; it is not. Recorded
here so nobody re-proposes deleting it.

## 6. Ranked suspects, and the test that separates them

### S1 — Seven fly-added `ffmpeg` meter-null consumers, two of them at 6144×1536@50 ⟵ PRIME

`src/audio/meter-null-consumer.js` adds `ADD <ch>-720 STREAM udp://127.0.0.1:520<ch> -format null`
to **every** channel on connect, so channels with `<consumers/>` still tick their mixer and publish
OSC audio meters. None of these appear in `config/casparcg.config`; they are runtime-only, which is
why every previous config-diff investigation (WO-485, WO-487) was blind to them.

The module's docstring asserts *"no video encode"*. That is the claim to test, because it is only
half of the cost that matters:

- `-format null` may skip the **encode**, but Caspar's `output` still pulls a frame for every
  consumer every tick and waits on the returned future. Frame fetch + any pixel-format conversion
  still happens.
- At 6144×1536 that is a **9.4 Mpixel readback, 50× per second, on ch1 and again on ch2**.
- `INFO` confirms they are live and ticking, not idle: ch5's shows `<fps>50</fps><frame>79095</frame>`.

The module was written for channels that would otherwise have *no* consumer (WO-53). **ch1 already
has a screen consumer**, so its meter-null consumer buys nothing the screen consumer isn't already
providing — the channel would tick regardless. Same for ch3 and ch5. Only ch2, ch6, ch7 genuinely
need one.

### S2 — `enable-mipmaps` + `high-bitdepth` on the ch1 screen consumer

Live `config/casparcg.config`, ch1 screen consumer only:

```xml
<enable-mipmaps>true</enable-mipmaps>
<force-linear-filter>true</force-linear-filter>
<high-bitdepth>true</high-bitdepth>
```

ch3's and ch5's screen consumers carry **none** of the three. Mipmap-chain generation over a
9.4 Mpixel surface every frame, at 16-bit, is a large and permanent GPU cost, and it is applied to
exactly the one channel that is slow. Unverified as a cost on this hardware — ranked below S1 only
because S1 is reversible without a Caspar restart and S2 is not.

### S3 — Route back-pressure from ch1 into ch4/ch5

ch1 is route-sourced by `ch4:13` and `ch5:11`. ch4 carries a DeckLink consumer and therefore a
synchronization clock. Whether a slow destination can back-pressure a `route://` source on this
build is unverified and worth a source read of `route_producer.cpp` before testing.

### The A/B test (NOT RUN — needs authorization)

Fully reversible, no Caspar restart, ~90 s. Cost of being wrong: ch1 loses OSC audio meters until
restored.

```bash
# baseline: measure ch1 layer 10 rate over ~16 s   (see §1 method)
# A — remove ch1's meter consumer only (isolates back-pressure on the slow channel itself)
curl -X POST http://192.168.0.37:4200/api/amcp/raw -H 'Content-Type: application/json' \
  -d '{"cmd":"REMOVE 1-720 STREAM udp://127.0.0.1:52001?localport=62001"}'
# re-measure
# B — remove all 7 (isolates shared GPU contention)
#     ch2..ch7: REMOVE <n>-720 STREAM udp://127.0.0.1:5200<n>?localport=6200<n>
# re-measure, then RESTORE every one:
curl -X POST http://192.168.0.37:4200/api/amcp/raw -H 'Content-Type: application/json' \
  -d '{"cmd":"ADD 1-720 STREAM udp://127.0.0.1:52001?localport=62001 -format null"}'
```

**Reading the result.** A → realtime means per-channel consumer back-pressure; the fix is to skip the
meter-null consumer on channels that already have one (a `listMeterNullTargetChannels` filter).
A → no change but B → realtime means shared GPU contention; the fix is the same filter plus dropping
it from the 6144×1536 preview. Neither → the deficit is S2/S3 and the mipmap/high-bitdepth flags are
next, which costs a Caspar restart.

## 7. Hardware caveat — every prior perf baseline was taken on a different machine

This box is **20 cores / 32 GB**. WO-401's baseline (caspar 431 % CPU, 18,656 OSC msg/s) and
WO-405's idle floor were both measured on a **28-core / 64 GB** machine. None of the targets or
"headroom" conclusions in those two WOs have been re-validated against this hardware, and load1 of
10.3 on 20 cores is a materially different picture from 7 on 28. Treat WO-401/405 numbers as
non-comparable until re-taken here.

## 8. RESULT — S1 confirmed, and it was the whole deficit

The owner removed the meter-null consumers live (the classifier had refused the agent's mutating
AMCP call; owner ran it from the web UI). Re-measured immediately, same clip, same method as §1:

| metric | all 7 attached | 6 removed |
|---|---|---|
| **ch1 playback rate** | **72.8 %** | **99.9 %** (31 samples, +31.64 s over 31.68 s) |
| GPU utilization | 100 % | **81 %** |
| casparcg CPU | 639.6 % | **311.6 %** |
| load1 | 10.33 | 6.92 |

**The measurement is not confounded.** `INFO` taken in the same window confirms the DeckLink
consumers were *still attached* throughout (ch3 port 301, ch4 port 302), and ch2 *still carries its
own meter-null consumer at 6144×1536* — and PGM1 is at realtime anyway. So:

- **S1 was the entire deficit.** Halving caspar's CPU (639.6 → 311.6 %) for consumers whose
  docstring claimed "no video encode" tells its own story: the encode was never the cost, the
  per-tick frame fetch was.
- **S2 (mipmaps / high-bitdepth) and S3 (route back-pressure) need no action.** ch1 still carries
  `enable-mipmaps` + `high-bitdepth` + `force-linear-filter`, all true, and still hits 99.9 %. Left
  alone — they are not free, but they are affordable and changing them costs a Caspar restart for no
  measured gain. Recorded here so the next investigation does not re-suspect them.
- **A single 6144×1536 meter-null consumer is affordable** (ch2 proves it). It was the pile of
  seven — above all the redundant one on ch1, the very channel being measured — that broke pacing.
- **WO-487 is now definitively dead.** Realtime playback with DeckLink outputs attached leaves the
  clock-ownership hypothesis nothing to explain. Close 487 as superseded.

## 9. The fix (in repo, not deployed)

The live removal is **not persistent**: `ensureAllMeterNullConsumers` re-attaches all seven at
`src/config/routing-setup.js:218` (routing setup) and `:364` (`ensureLiveAudioRouting`), so the next
Caspar connect, project load or Apply would have brought the deficit straight back.

- `src/audio/meter-null-consumer.js` — new `channelHasNonMeterConsumer(infoText)`; the existing
  idempotency `INFO` call now also skips the ADD when the channel already carries any port other
  than 720. No extra AMCP round-trip. An `INFO` failure still attaches (**fails open** — meters win
  over performance when the consumer state is unknown).
- `ensureMeterNullConsumer(amcp, ch, { force })` — new opt-out.
- `src/audio/meter-health.js` — the staleness-driven repair passes `{ force: true }`. That path only
  fires on *measured dead OSC*, which is proof the channel is not ticking whatever its consumer list
  claims, so it must override the skip. This is what makes the skip safe: if a channel ever loses
  its real consumer, the health watch notices and re-attaches.
- Batch path logs skips explicitly: `[meter] skipped 1, 3 — already have a consumer (WO-500)`.

On this box the new rule attaches to **ch2, ch6, ch7** (genuinely consumer-less) and skips
**ch1, ch3, ch4, ch5** (screen/decklink already ticking them).

**Verified:** `tools/smoke/smoke-wo500-meter-null-skips-consumed-channels.test.js` — 8 tests, all
passing, registered in the curated CI list. Covers the parser, the skip, the still-attach case,
idempotency, the `force` override, fail-open on `INFO` error, the batch split (3 ADDs not 5), and a
source assertion that meter-health still passes `force`. Full offline gate **2047 tests, 2045 pass /
0 fail / 2 skip**; eslint 0 errors; no file over 500 lines.

## 9b. `-format null` was never videoless — the second fix

Owner asked what makes these consumers as negligible as possible. Read from the source the binary
was built from:

- `ffmpeg_consumer.cpp:543` — a video stream is built whenever `oformat->video_codec !=
  AV_CODEC_ID_NONE`.
- FFmpeg's **`null` muxer declares `video_codec = wrapped_avframe`**, not NONE
  (`ffmpeg -h muxer=null`: *"Default video codec: wrapped_avframe"*). So `-format null` always built
  a video stream. The module's "no video encode" was wrong about the part that costs.
- Each frame then went through `make_av_video_frame` (`util/av_util.cpp:323-332`):
  `av_frame_get_buffer` of the full raster, then a **row-by-row `std::memcpy` of the whole picture**
  — under upstream's own `// TODO (perf) Avoid extra memcpy` — handed to `wrapped_avframe`, which
  discards it.
- `has_synchronization_clock()` is **false** and `send()` is a non-blocking `try_push`, so this was
  never clock ownership or future-blocking. It was raw memory bandwidth and allocator churn
  competing with the render threads.

Per-second memcpy on the 12.08 show config:

| channel | pixel format | per frame | at 50 fps |
|---|---|---|---|
| ch1 6144×1536, `high-bitdepth=true` → BGRA64 | 8 B/px | 75.5 MB | **3.8 GB/s** |
| ch2 6144×1536 → BGRA | 4 B/px | 37.7 MB | 1.9 GB/s |
| each 1080p50 → BGRA | 4 B/px | 8.3 MB | 0.4 GB/s |

≈ **7.8 GB/s across the seven** — the 639 % CPU, explained.

**Fix:** use a muxer that declares no video codec. `s16le` is raw PCM — audio codec `pcm_s16le`,
video codec NONE, no container header, no seeking (ideal for a discard UDP socket). The video
branch then never runs; only `make_av_audio_frame` does, ~60 KB/frame instead of 37.7 MB.

`METER_NULL_FORMAT_ARGS = '-format s16le'` replaces the inline `-format null`.

**Verified live on the box** (single 720p5000 channel, so the CPU delta was not measurable — this is
a functional proof, not a perf measurement):

| | `-format null` | `-format s16le` |
|---|---|---|
| `ADD` result | ok | **`202 ADD OK`** |
| consumer `<fps>` in INFO | **`<fps>50</fps>`** | **absent** |
| consumer `<frame>` advancing | yes | **yes** |
| OSC audio meters ticking | yes | **yes** |

`state_["file/fps"]` is assigned **only inside the video branch** (`ffmpeg_consumer.cpp:549`), so its
absence is direct evidence no video stream was created, while the advancing `<frame>` proves the
channel still ticks — which is the consumer's entire purpose. The box was restored to `-format null`
after the test; the change is live only after the §10.1 restart.

**Note this subsumes S2's remaining risk.** `high-bitdepth=true` doubled the memcpy (8 B/px vs 4),
but high-bitdepth implies a screen consumer, which §9's skip already excludes from getting a meter
consumer at all. The two fixes compose: nothing that carries high-bitdepth will carry a meter
consumer.

**Still cheaper, not done:** the honest fix is upstream — let a channel tick its mixer with
`<audio-osc>true</audio-osc>` and no consumer at all, which is what the module's header says this
build does not support. Worth a CasparCG issue alongside WO-154's §T154.3.

## 10. Owner actions outstanding

1. **`highascg` service restart** to make the fix live. Until then the old behaviour is one Caspar
   reconnect / Apply away from returning.
2. **ch6 and ch7 have NO consumer at all right now** — their meter-null consumers were removed along
   with the rest, so the DeckLink *input* channels are not ticking their mixers and their OSC audio
   meters are dead. The restart in (1) restores them (they are on the attach list). Until then,
   expect no audio meters on the two DeckLink inputs.
3. Nothing to do about the progress bar — §3 predicts it goes smooth on its own at realtime.

## 11. DeckLink driver version — suspected, but the evidence does not support a swap

Owner 12.08: previously on **16.1**, currently **16.2a1**, **16.3** downloaded; *"blackmagic is known
to screw something up in the drivers."* A fair prior, and exactly the right instinct given WO-487's
framing (*what differs from a rig that works*). Measured, it does not hold here:

- Installed: `desktopvideo` / `desktopvideo-gui` **16.2a1**, DKMS `blackmagic/16.2a1` +
  `blackmagic-io/16.2a1` on 6.8.0-117-generic — one consistent version, no mixed state.
- PGM1 reaches **99.9 % of realtime with both DeckLink consumers attached** on 16.2a1. A driver that
  was throttling playout could not produce that.
- `log/caspar_2026-08-12.log`: the 47 `Failed to schedule primary video` errors are all from
  **11:45**, tagged `[3-2|2160p5000]` — the *previous* 2160p config, before the box was rebuilt to
  the current 1080p5000 DeckLink layout. **Zero errors after 15:00.**

**Recommendation: stay on 16.2a1 for now.** Swapping drivers would inject an unvalidated variable
into a system that currently measures healthy, and 16.3 is untested against this Caspar build. Keep
16.3 and 16.1 in reserve. Revisit only on a *DeckLink-specific* symptom — `Failed to schedule
primary video` on the current config, SDI frame drops, card enumeration faults — and if that day
comes, test 16.1 first: it is the version with production hours behind it, whereas 16.3 is new on
both counts.

## 11b. Post-deploy: 92.6 %, and the remaining deficit is a STALE config

Owner deployed 13.08 and re-measured with the new tool (`--seconds 60`):

| | before | after §9 + §9b |
|---|---|---|
| ch1 rate | 72.8 % | **92.6 %** |
| casparcg CPU | 639.6 % | 361.8 % |
| GPU | 100 % | **100 %** |

**Both halves of the fix are confirmed live**, not assumed: the consumer list shows meter consumers
on ch2/ch6/ch7 (no other consumer) and *absent* from ch1/ch3/ch4/ch5 (already consumed) — exactly
what §9's skip produces — and `INFO` on all three remaining ones shows **no `<fps>` element**, which
is §9b's proof that the video stream is gone.

The residual ~7 % is **GPU saturation** (still pegged at 100 %), and the cause looks like config
drift rather than genuine load. The live generated `casparcg.config` disagrees with the saved
settings on four independent keys for ch1's screen consumer:

| key | live `casparcg.config` | `/api/settings` |
|---|---|---|
| `enable-mipmaps` | **true** | `screen_1_enable_mipmaps = false` |
| `high-bitdepth` | **true** | `screen_1_high_bitdepth` absent → false |
| `always-on-top` | true | `screen_1_always_on_top = false` |
| `interactive` | false | `screen_1_interactive = true` |

(`vsync`, `borderless`, `windowed`, `stretch`, `colour-space` all agree.)

**Verified by running the real generator against `.37`'s live settings**, not by reading it:
`buildScreenConsumerExtrasXml(cfg, 1)` returns `""` and `buildProgramScreenConsumerInnerXml(cfg, 1, …)`
emits `<high-bitdepth>false</high-bitdepth>`. `buildScreenPairChannels` threads a single `ctx.n`
through every key, so an index mismatch is ruled out — the config on disk is simply **older than the
settings**, and a service restart does not regenerate it. Note the two true values happen to match
`screen_3_*`/`screen_4_*` (both true); those are DeckLink outputs where the flags are inert, so it
is a coincidence of values, not a cross-wire.

Why it plausibly matters: ch1 is **6144×1536 = 9.4 Mpixel**. `high-bitdepth` renders that at 16-bit
(double the framebuffer/texture bandwidth of the largest surface on the box) and `enable-mipmaps`
regenerates a mipmap chain over it every frame. No other screen consumer on the box carries either.

**Next action — one Apply** (WO-440: Apply always restarts Caspar), then re-measure:

```bash
# after Apply, confirm the flags actually went away
curl -s http://<box>:4200/api/state | python3 -c "import sys,json,re; \
  print(re.findall(r'<(?:enable-mipmaps|high-bitdepth)>[^<]*<', json.load(sys.stdin)['serverInfo']['config']))"
node tools/dev/measure-playback-rate.js --host <box>:4200 --seconds 60 --label "mipmaps+16bit off" --json ~/rates.jsonl
```

Prediction: `<enable-mipmaps>` gone, `<high-bitdepth>false</high-bitdepth>`, GPU below 100 %, rate
above 92.6 %. **If GPU stays at 100 % the drift was not the cost** and the next candidates are the
6144×1536 PRV channel (ch2 — owner-confirmed necessary, feeds `ch4:15` and `ch5:10`) and the CEF
templates on ch4 with `<html><enable-gpu>false</enable-gpu>`.

Related drift precedent: WO-442 (fossil keys), WO-421 (config durability).

## 12. What was NOT done

- **The agent changed nothing on the live box.** The consumer removal was run by the owner; every
  agent measurement is from read-only `/api/state`, `/api/host-stats` and `INFO`.
- **Not deployed** — see §10.1. The repo fix is unexercised in production.
- **The progress bar has not been re-observed at realtime.** §3's prediction (snap-back disappears
  once the rate is 1.0×) is arithmetic, not an on-glass confirmation. Owner QA.
- **No commit.** Files changed and left in the working tree: `src/audio/meter-null-consumer.js`,
  `src/audio/meter-health.js`, `tools/ci/run-offline-tests.js`, plus the new smoke.
- S2 and S3 remain unmeasured, now deliberately — §8 explains why they need no action.
- 16.3 / 16.1 driver behaviour is untested; §11 argues against testing it now.

## 13. Work log

- 2026-08-12 — Opened. Rate deficit measured at 72.8 %; GPU measured at 100 %; progress-bar
  snap-back traced to the client extrapolator and shown to be the same fault; WO-487 ruled out
  against the current config; seven runtime meter-null consumers identified as the prime suspect.
  A/B test blocked by the permission classifier.
- 2026-08-12 (later) — Owner removed the consumers live. **99.9 % of realtime, DeckLink outputs
  still attached**; caspar CPU halved, GPU 100 → 81 %. S1 confirmed as the whole deficit. Skip
  logic + `force` override implemented, 8 smokes, full gate green. Driver-swap question examined
  and answered against (§11). Awaiting service restart.
- 2026-08-13 — §9b: traced the actual per-frame cost to `make_av_video_frame`'s full-raster memcpy
  and established that `-format null` declares `wrapped_avframe`, so it never was videoless. Swapped
  to `-format s16le`, functionally verified live (no `<fps>`, meters still tick). Suite 2048/2046/0,
  eslint clean.
  **Box state changed overnight and the earlier show config is gone:** IP is now **192.168.0.30**
  (something else answers .37), Caspar restarted (PID 568733 → 4059273), GPU is a different card
  (RTX PRO 4000 Blackwell, 24467 MiB vs 20475 MiB), `BUILD_STAMP` is empty, and the 7-channel
  6144×1536 config has been replaced by a **single 720p5000 channel**. The 12.08 measurements
  cannot be reproduced until a real show config is back — and the meter consumer had already
  re-appeared on ch1 after the Caspar restart, confirming §9's non-persistence warning in the wild.
