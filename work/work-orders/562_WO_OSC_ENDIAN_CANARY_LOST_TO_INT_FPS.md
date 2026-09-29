**Status: DONE (2026-09-03, verified live on the box)**

## Investigation

Owner report: "the progress timers in the header and in the compose preview stopped working
correctly. they are not showing current remaining time."

`GET /api/state` showed the only actively-playing layers (`ch1/layer110`, `ch2/layer10`, both the
`3825579625-PREVIEW` compose-preview render) with `file.fps`/`name`/`path`/`loop` all populated but
`file.elapsed` / `file.duration` / `file.remaining` / `file.progress` all `null`, despite a fresh
`_lastOscAt` (OSC actively arriving). `INFO 1` over AMCP (port 5250) confirmed Caspar itself knows
the real numbers (`<time>47.56</time><time>60</time>` — elapsed/duration) — the AMCP-INFO periodic
poll that could otherwise gap-fill this (`applyInfoTimingSupplement`, WO-252) is deliberately OFF
whenever OSC is active (`periodic-sync.js`), so the client-facing timers depend entirely on OSC
`file/time` parsing.

Raw-captured the OSC stream (predefined-client tee trick, UDP :6250 — bind a UDP socket there,
then open an AMCP TCP client sourced FROM port 6250 so `disable-send-to-amcp-clients=false` pushes
Caspar's per-connection OSC copy to it) and decoded `.../file/time` both ways:

```
raw= cdcc264200007042  BE=(-428132416.0, 4.03e-41)   LE=(41.70, 60.0)
raw= 48e1264200007042  BE=(461106.06, 4.03e-41)      LE=(41.72, 60.0)
raw= c3f5264200007042  BE=(-490.30, 4.03e-41)        LE=(41.74, 60.0)
```

LE decode advances exactly one frame per tick against a constant `duration=60.0` — matching
`ffprobe` on the actual file (`h264, 24fps, duration=60.000000`) exactly. This is the same
little-endian-float bug `osc-float-endian.js` was built to fix (commit `134c8b7`, WO-235 family):
the 2.6-dev binary writes OSC floats LE, spec says BE, and the auto-detector byte-swaps once it
latches onto a mode via a `.../file/fps` canary (a lone float, sane range 1–1000).

The regression: this box's current binary build no longer sends that canary at all. `file/fps` is
gone; fps now rides as an **int pair** on `.../file/streams/0/fps` (confirmed in the same capture:
`[('i',24),('i',1)]`). Ints were never mis-endian (only floats are), so that address decodes fine
either way and gives the auto-detector nothing to vote on. With zero votes, `latched` stays `null`
forever, `normalize()` never swaps, and every float-bearing address (`file/time`, `file/clip`) stays
raw LE garbage — `isSaneTimingValue` correctly rejects it, `f.elapsed`/`f.duration` never get set,
so `remaining`/`progress` stay `null` — the exact symptom, on both the header PGM timer
(`app-pgm-header-timer.js`) and the compose-preview tile timer
(`operator-compose-tiles-tile-controller.js`), since both mount the same
`mountPgmTopLayerPlaybackTimer` (`playback-timer.js`) reading this OSC state.

## What was done

`src/osc/osc-float-endian.js`: added a second canary. `.../file/time` and `.../file/clip` both
carry `,ff` (elapsed, duration) — the duration arg (second float) is voted the same way the fps
canary was, reusing `osc-state-timing.js`'s existing `isSaneTimingValue` bounds (0, or
1ms–30 days). Live playback traffic supplies this canary continuously regardless of whether the
binary still sends a `/fps` float, so auto-detect self-heals without a config flag or code change
if the binary's OSC schema shifts again. `walkMessage`/`walkPacket`/`createFloatEndianNormalizer`
now thread an optional `onDurationCanary` alongside the existing `onFpsCanary`, both funneled
through one `castVote()` so the latch logic (3 consistent votes, ambiguous = no vote) isn't
duplicated.

Considered and rejected: setting `config/osc.json` → `floatByteOrder: "le"` (the documented escape
hatch for "a stream has no fps traffic to vote on"). Rejected because it's a static workaround that
silently breaks again if a future/rolled-back binary is genuinely BE-compliant, and per CLAUDE.md
the code-level root cause (detector has no signal left, not "the value is fixed forever") is the
fix that belongs in the repo.

## What was verified

- New smoke: `tools/smoke/smoke-osc-float-endian.test.js` — added
  `'2026-09-03 regression: no /fps float canary (fps is an int pair) — file/time duration still
  latches le'` (int fps traffic casts no vote; 3 `file/time` LE-fixture messages with duration=60
  latch `le`; a follow-up `file/clip` message decodes correctly). Full existing suite in that file
  (5 prior tests) still green — BE pass-through, forced modes, ambiguous-no-vote all unaffected.
- `node tools/ci/run-offline-tests.js`: 2405 / 2403 pass / 0 fail / 2 skip (env-gated, pre-existing).
- Live on the box: `kill -TERM $(systemctl show -p MainPID --value highascg)`, waited for
  `active`, then polled `/api/state` — `ch1/layer110` and `ch2/layer10` (`3825579625-PREVIEW`,
  the actual compose-preview render) both now report real, advancing
  `elapsed`/`duration`/`remaining`/`progress` (e.g. `elapsed:33.26, duration:60, remaining:26.74,
  progress:0.554`), matching `ffprobe`'s 60s duration. Not owner-eyeballed on the operator monitor
  itself — the fix is proven at the data source (OSC → `/api/state`) that both the header chip and
  compose-preview tile timers read; owner should confirm the on-screen digits look right too.
