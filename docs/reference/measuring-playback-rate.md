# Measuring playback rate vs realtime

How to get a number for "the media is playing slower than realtime" instead of an impression, so
different configs can be compared honestly. Written out of [WO-500](../../work/work-orders/500_WO_PGM1_PLAYS_AT_73_PERCENT_GPU_SATURATED.md).

---

## TL;DR

```bash
# from the repo root, on any machine that can reach the playout box
node tools/dev/measure-playback-rate.js --host 192.168.0.37:4200 --seconds 30 --label "baseline"
```

Play a clip on the channel you care about first. The tool finds it, measures for 30 s, and prints
the rate plus everything needed to explain a bad one.

---

## 1. What it measures, and why that is the right thing

Caspar publishes each playing layer's position over OSC as `file.elapsed`. The tool polls
`/api/state`, watches `elapsed` against the wall clock, and reports the ratio.

- **~100 %** — healthy. The channel is holding its frame deadline.
- **< 100 %** — the channel cannot produce frames fast enough. Everything on it runs slow: clips,
  timers, transitions, and anything routed from it.

Wall-clock ratio is the honest measure because it is what the audience sees. Caspar's own frame
counters can look perfect while the channel tick itself has stretched.

**This is not the same as dropped frames.** A channel can hit 100 % here and still tear or stutter
on the glass (that is WO-407's territory — GL vblank sync, `docs/reference/multi-head-gl-vblank-sync.md`).
Rate answers "is time passing correctly"; stutter answers "is each frame presented cleanly".

## 2. Reading the output

```
RATE       85.5 % of realtime   [baseline]
           9.38 s media over 10.976 s wall, 10 samples
jitter     min 0.652  median 0.882  max 1.082
backward   0 source-side regressions, 0 loop wraps
bar snap   expect the GUI progress bar to jump back every ~3.44 s
load       GPU 100%  caspar 349% CPU  node 81.4%  load1 7.27/20

consumers per channel (AMCP INFO):
  ch1 6144x1536   screen(600)
  ch2 6144x1536   ffmpeg(720)
  ...
```

| Line | What it tells you |
|---|---|
| **RATE** | The headline. Below ~97 % is real. |
| **jitter** | Spread of per-sample ratios. A *throughput deficit* jitters (0.65–1.08); a *clock* problem sits flat at a fraction (a hard 0.50 every sample). Different causes — see §5. |
| **backward** | `elapsed` going backwards **at the source**. Should be 0. If not, that is a separate fault (stale OSC layers shadowing the live one — WO-151), not slow playback. |
| **bar snap** | Predicted period of the GUI progress-bar jump-back, derived from the rate. Lets you sanity-check a number against what you see on screen. |
| **load** | GPU / CPU at the moment of measurement. A rate below 100 % with **GPU at 100 %** means you are GPU-bound and no config tweak short of reducing work will fix it. |
| **consumers** | Per-channel consumer list from AMCP `INFO`. **Read this every time** — see §4. |

Exit code is `1` when the rate is under 97 %, `0` otherwise, so it can gate a scripted A/B.

## 3. Why the progress bar "jumps back every second or two"

It is not a separate bug and it is not the server. `file.elapsed` never regresses (the tool proves
this — `backward` is 0). The client extrapolates between OSC updates at a hardcoded **1.0×**
(`client/lib/playback-timing-clock.js`), so at 85 % real speed it gains 0.15 s of error per wall
second, crosses its `SNAP_TOL_SEC = 0.5` tolerance after ~3.4 s, and re-anchors — snapping the bar
backwards.

**The snap period is a measurement of the deficit**: `0.5 / (1 − rate)`. A bar that jumps every
~1.8 s means ~73 %; every ~3.4 s means ~85 %; no jump means realtime. Do not widen the tolerance —
it is the only on-glass indicator of the underlying fault.

## 4. Always read the consumer list

The single most important habit. Consumers added **at runtime over AMCP never appear in
`config/casparcg.config`** — meter-null consumers (index 720), compose-preview (701), the v4l2
bridge (710/711), DMX sampling (97), streaming/record (96). WO-485 and WO-487 both chased the wrong
cause for days because they diffed the generated XML, which cannot show them.

A channel's real consumer list is the union of the XML and whatever the app attached on connect.
The tool prints it with every measurement for exactly this reason.

## 5. Interpreting a bad number

Work down this list; each step is cheap and rules out a whole class.

1. **GPU at 100 %?** You are GPU-bound. Reduce work: fewer/smaller channels, drop
   `enable-mipmaps` / `high-bitdepth` / `force-linear-filter` on large screen consumers, remove
   unused consumers. No amount of pacing config helps a saturated GPU.
2. **A consumer that should not be there?** Compare the consumer list against what the config asks
   for. Anything at index 7xx/9x was added at runtime.
3. **Flat ratio at an exact fraction (0.50, 0.25)?** That is a clock problem, not throughput —
   a consumer owning the channel's synchronisation clock, or a long-loop producer decay (WO-154).
   Jittery ratios are throughput.
4. **Is the deficit on a channel with a DeckLink consumer?** DeckLink returns
   `has_synchronization_clock() = true`; the screen consumer returns `false`. A channel with a
   DeckLink output ticks at whatever the cards sustain. Test by measuring with the DeckLink consumer
   removed.
5. **Only under load / only after a while?** Long looping clips have their own failure mode with a
   different signature — see WO-154 (locks to loop wraps, decays toward 50 %).

## 6. A/B-ing two configs

```bash
RATES=~/playback-rates.jsonl

# take the baseline while the current config is live
node tools/dev/measure-playback-rate.js --host 192.168.0.37:4200 \
    --seconds 60 --label "7ch + all meter consumers" --json "$RATES"

# ...change one thing, Apply, let Caspar settle ~10 s, then...
node tools/dev/measure-playback-rate.js --host 192.168.0.37:4200 \
    --seconds 60 --label "7ch, meters skipped" --json "$RATES"

# compare
python3 - "$RATES" <<'EOF'
import json,sys
for l in open(sys.argv[1]):
    r=json.loads(l)
    print('%-34s %5.1f%%  GPU %3s%%  caspar %5s%%' % (
        r['label'] or '-', r['ratePct'],
        (r['hostAfter'] or {}).get('gpuPct'), (r['hostAfter'] or {}).get('casparCpuPct')))
EOF
```

**Rules for a trustworthy A/B:**

- **Change one thing.** Two changes and you learn nothing about either.
- **Same clip, same channel, same layer.** Rate is per-channel; a different clip has different
  decode cost. Prefer a long clip so no loop wrap lands inside the window.
- **≥ 30 s windows**, 60 s when the difference is small. Short windows are noisy — a 12 s window can
  read several points off.
- **Let Caspar settle ~10 s after any Apply or restart** before measuring.
- **Record the consumer list with every run** (the tool does this) — it is the usual explanation for
  a result that makes no sense.
- **Verify what you changed actually took effect.** An Apply regenerates the config; a hand-edit of
  `config/casparcg.config` is overwritten by the next Apply, and env-only changes need the Caspar
  relaunch (WO-444).

## 7. Options

```
--host <ip:port>    default 127.0.0.1:4200
--channel <n>       default auto (first channel with a playing layer)
--layer <n>         default auto (first layer with file.elapsed)
--seconds <s>       measurement window, default 30
--interval <s>      poll interval, default 1
--label <text>      tag the run — use for A/B
--json <path>       append the result as one JSON line
--quiet             summary only, no per-sample rows
```

Pick the layer explicitly when several are playing on one channel — `--channel 1 --layer 10`.
Auto-detect takes the lowest-numbered layer with an `elapsed`, which may be a preview rather than
the clip you care about.

## 8. Manual spot check, no tooling

```bash
H=192.168.0.37:4200
E() { curl -s http://$H/api/state | python3 -c \
  "import sys,json;print(json.load(sys.stdin)['osc']['channels']['1']['layers']['10']['file']['elapsed'])"; }
A=$(E); sleep 10; B=$(E); echo "rate: $(python3 -c "print(f'{($B-$A)/10*100:.1f}%')")"
```

Consumers on one channel:

```bash
curl -s -X POST http://$H/api/amcp/raw -H 'Content-Type: application/json' \
  -d '{"cmd":"INFO 1"}' | python3 -m json.tool | grep -E 'port_|consumer'
```

## 9. Related

- [WO-500](../../work/work-orders/500_WO_PGM1_PLAYS_AT_73_PERCENT_GPU_SATURATED.md) — the 72.8 %
  investigation, the meter-null consumer cost, and why `-format null` was never videoless.
- [WO-154](../../work/work-orders/154_WO_LONG_LOOP_HALF_SPEED.md) — long-loop decay toward 50 %.
- [WO-407](../../work/work-orders/407_WO_SCREEN_CONSUMER_MICRO_STUTTER.md) /
  `multi-head-gl-vblank-sync.md` — stutter with a correct rate.
- `screen-consumer-vsync-nvidia.md` — driver-level pacing (consumer-vsync row superseded by WO-447).
