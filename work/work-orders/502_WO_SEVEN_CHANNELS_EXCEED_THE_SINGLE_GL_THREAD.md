# WO-502 — Every channel runs at ~93 %: seven channels exceed CasparCG's single OpenGL thread

**Status: ROOT CAUSE PROVEN (13.08.2026 — two live ablation tests + the source the binary was built
from). No code change yet: the remedies are a product decision, laid out in §5.**
**Priority:** High (on-air playback speed; this is the residual after WO-500)
**Source:** owner 13.08, after deploying WO-500: *"no real difference between mipmaps high bitdepth
and force linear on or off. the jitter is still present… i still want the jitter to be gone."*
**Predecessor:** [WO-500](./500_WO_PGM1_PLAYS_AT_73_PERCENT_GPU_SATURATED.md) (meter-null consumers
— a real and separate cause, 72.8 % → 92.6 %). This WO is the remaining ~7 %.
**Measurement tool:** `tools/dev/measure-playback-rate.js`, `docs/reference/measuring-playback-rate.md`

---

## 1. It is not ch1, and it is not pixels

The breakthrough was measuring **channel tick rate** instead of one clip's playback. Every
meter-null consumer exposes a per-channel frame counter in `INFO` (`<port_720><frame>`), so the
actual tick rate of any channel carrying one can be read directly:

| channel | raster | content | tick rate |
|---|---|---|---|
| ch2 | 6144×1536 | PRV, no clips playing | **46.35 fps** (92.7 %) |
| ch6 | 1080p5000 | DeckLink input only | **47.00 fps** (94.0 %) |
| ch7 | 1080p5000 | DeckLink input only | **47.35 fps** (94.7 %) |

**Every channel is slow, including two 1080p channels doing essentially nothing** — and they are all
slow by roughly the *same* amount despite ch2 carrying 4.5× the pixels. A pixel-throughput limit
would hurt ch2 far more than ch6. Uniform slowdown across wildly different per-channel loads is the
signature of **N workers serialized behind one shared resource**: each channel's frame waits behind
all the others, so every channel's frame time converges on the same ~21.3 ms instead of 20 ms.

This also retires the previous lead. WO-500 §11b proposed that ch1's stale `enable-mipmaps` /
`high-bitdepth` were the residual cost. **Owner tested it: 92.6 % → 93.6 %, no real difference.**
The config drift was real and worth clearing, but it was not the cost. Recorded as ruled out.

Also worth stating: **GPU utilisation was a red herring.** `nvidia-smi utilization.gpu` reports "was
any kernel resident", not headroom — it reads 100 % whether the GPU is saturated or merely never
idle. The owner flagged this. Every conclusion below rests on tick rates, not on that number.

## 2. Ablation 1 — freeing ONE channel speeds up ALL the others

Removed ch7's only consumer, which stops that channel compositing (the WO-53 mechanism: Caspar runs
a channel's compositor only while at least one consumer is attached), then re-measured **the other
channels**:

| | ch2 | ch6 |
|---|---|---|
| 7 channels compositing | 46.21 fps | 47.21 fps |
| ch7 stopped | **47.74 fps** | **48.87 fps** |
| | **+1.53** | **+1.67** |

Work removed from one channel is handed to every other channel. That is only possible if they share
a serialized resource.

## 3. The shared resource, from the source the binary was built from

`src/accelerator/ogl/util/device.cpp`:

```cpp
io_context                             io_context_;
decltype(make_work_guard(io_context_)) work_;
std::thread                            thread_;      // ← ONE thread
…
thread_ = std::thread([&] { … io_context_.run(); });
```

A single `boost::asio::io_context` run by **exactly one thread**. Every channel's mixer and render
work reaches the GPU through `dispatch_async` / `spawn_async` on it, and `dispatch_sync` is
`dispatch_async(...).get()` — a blocking wait on that same one thread.

**Seven channels at 50 fps is 350 channel-frames per second through one thread, and that exceeds its
capacity by ~7 %.** This is an architectural ceiling in CasparCG 2.6, not a misconfiguration. No
config key makes it multi-threaded.

It also retro-explains WO-485's observations, which never had a mechanism: *"when i added decklink
inputs on ports 3 and 4 it dropped to 50 %"* (two more channels of GL demand) and *"realtime with
the decklink consumer removed"* (one less channel compositing).

## 4. Ablation 2 — the prescription, measured

Stopped both DeckLink **input** channels (ch6, ch7) from compositing:

| | ch1 media rate | ch2 tick |
|---|---|---|
| 7 channels | 91.7 % | 46.17 fps |
| ch6+ch7 stopped | **99.2 %** | **48.57 fps** |

**Two channels of headroom is the whole deficit.** Both were restored immediately after the test.

## 5. Options, ranked — this is a product decision

**A. Do not create channels for SDI inputs that are not in use.** Proven: +7.5 points, straight to
99.2 %. ch6/ch7 exist only to host DeckLink input producers routed into ch4 (multiview) and ch5
(operator GUI). An input that is not on air still costs a full 50 fps channel.
*Cost:* while stopped, their tiles in multiview and the operator GUI freeze, and their audio meters
die. Free if the inputs are genuinely unused this show; not free otherwise.
*Note the irony:* the WO-500 meter-null consumer is what keeps an otherwise-idle input channel
compositing at all. Its per-frame cost is now negligible (§9b there), but its mere presence buys the
channel a full render loop. **Input audio meters cost ~3.5 % of playback rate per idle input channel** —
that is the actual trade, and it is the owner's to make.

**B. `<gpu-texture>true</gpu-texture>` on the screen consumers — keeps all seven channels.**
`screen_consumer.cpp` has two display strategies. The default `host_strategy` does a full-frame
`std::memcpy` (`:875`) and re-uploads to GL every frame — on ch1 that is 37.7 MB per frame round
tripped through host memory. `gpu_strategy` (`:918`) binds `in_frame.texture()` directly: no
download, no memcpy, no re-upload. The key is read at `:1113`
(`config.gpu_texture = ptree.get(L"gpu-texture", …)`) and exists as AMCP param `GPU` at `:1059`.
*Status:* **untested, and HighAsCG has no config key for it** — `screen_N_gpu_texture` would need
adding to the generator. Marked "2.5 feature" upstream and defaults to false, so it may require the
consumer's GL context to share with the device. Worth a spike: it is the only identified option that
keeps every channel.

**C. Shrink the PRV raster.** ch1 and ch2 are 6144×1536 each — 9.44 Mpx per frame apiece, 64 % of
the box's total pixels per frame-set. ch2 is a *preview* whose consumers (`ch4:15`, `ch5:10`) scale
it down anyway. If a PGM/PRV pair tolerates an asymmetric raster, this is a large saving for no
visible loss. **Unverified — Caspar pairs may require matching rasters for routes/transitions.**

**D. Fewer destinations, or a lower project fps.** Effective and unattractive; listed for
completeness.

## 5b. RESOLVED by Option B — owner tested `<gpu-texture>true</gpu-texture>` 13.08

Owner hand-edited it into the generated `casparcg.config` and re-measured. It works, and the tick
rates are the proof — **every channel is back at 50 fps**:

| | ch2 (6144×1536) | ch6 | ch7 | ch1 media rate | GPU |
|---|---|---|---|---|---|
| host_strategy (default) | 46.35 | 47.00 | 47.35 | 91.7–93.6 % | 100 % |
| **`gpu-texture` on** | **51.19** | **49.96** | **50.00** | **100.3–100.6 %** | **75 %** |

All seven channels retained. The GL-thread ceiling in §3 is real but was being hit by *avoidable*
work: `host_strategy` was round-tripping every screen consumer's full raster through host memory and
re-uploading it, on that same single thread. Binding the mixer's existing texture removes it.

**Made a real setting** — the owner's edit was to the *generated* file and the next Apply would have
erased it:

- `src/config/config-generator-screen-xml.js` — `screen_N_gpu_texture` → `<gpu-texture>`, emitted
  explicitly, **default false** (upstream calls it a 2.5 feature and it needs the consumer's GL
  context to share with the device, so it stays opt-in per screen).
- `src/config/defaults-caspar-server.js` — seeded false, agreeing with the generator.
- 4 smokes: default off, `true`/`'true'` honoured, per-screen isolation (screen 2 must not inherit
  screen 1), and the seed agreeing with the generator.

**Owner action:** set `screen_1_gpu_texture: true` (and any other screen you want it on) via the
settings API or Device View, then Apply — otherwise the next Apply reverts to `host_strategy` and
the box drops back to ~93 %.

Options A, C and D are consequently **not needed** and were never applied. Option A's measurement
(+7.5 points from dropping two channels) stands as evidence for the serialization mechanism, not as
a recommendation.

## 5c. On "the jitter is still present"

The owner asked how accurate the tool is, given a 100.3 % median alongside a wide per-sample spread.
The scepticism was correct and the tool was fixed (`tools/dev/measure-playback-rate.js`):

- The headline is now a **least-squares fit** over all samples, not a sum of pairwise ratios — a
  single slow `/api/state` no longer distorts it.
- The per-sample column is relabelled **spread**, and the tool now measures its own poll-interval
  standard deviation and says outright when that dominates. Measured here: **±0.056 s of poll
  wobble**, which moves a ~1 s ratio far more than playback does. The 0.687–1.339 spread was almost
  entirely this tool, not the box.
- **Channel tick rate** (exact monotonic frame counters, immune to poll latency) is now printed with
  every run. It is the honest instrument, and it is what confirmed the fix above.

**Rate is solved.** If jitter is still visible on the glass at ~100 % rate and 50 fps tick, it is a
frame-*pacing* problem — presentation timing, not speed — which is [WO-407](./407_WO_SCREEN_CONSUMER_MICRO_STUTTER.md)'s
territory (GL vblank sync, `docs/reference/multi-head-gl-vblank-sync.md`), and needs judging by eye
on moving content rather than by this tool.

## 6. What was NOT done

- **No change was made.** Both ablations were reverted within seconds; the box is as it was.
- **Option B is unmeasured.** The `gpu_texture` reasoning is read from source, not benchmarked, and
  it needs a generator key before it can even be tried through Apply. Do not treat it as a fix yet.
- **Option C's raster-symmetry constraint is unverified.**
- The per-channel service time of each individual channel was not measured (only ch6/ch7 and the
  aggregate), so the exact cost of ch1 vs ch2 vs the CEF channel ch4 is unknown. If Option A is not
  available, that breakdown is the next measurement worth taking.
- **DeckLink driver version is not implicated.** The bottleneck is a GL thread; the cards are not in
  the path for ch2, which is the slowest channel. The owner has reverted to 16.1 on separate
  grounds (most production hours) — reasonable, and the tool will show if it changes anything.

## 7. Work log

- 2026-08-13 — Opened. Tick-rate measurement showed the slowdown is uniform across all channels;
  two ablations proved serialization and quantified the fix; single-threaded GL device confirmed in
  source. WO-500 §11b's mipmaps/high-bitdepth lead ruled out by owner test.
