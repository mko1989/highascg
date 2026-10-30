# src/osc — sweep 29.10.2026 (batch 085)

Files: 8 · lines: 1545 · findings: 0 BUG-HIGH, 2 BUG, 2 DEAD, 3 RISK, 10 QUALITY

Method notes: all eight files read in full. Float endianness was NOT judged wrong: `osc-float-endian.js` implements the
documented little-endian float behaviour of the 2.6-dev binary (WO-235 / WO-401 notes in the header), auto-detects with
canaries and latches per process (known: restart node after a binary swap). Bounds checks in the byte walker
(`skipPaddedString`, `p + size > end`, blob length, bundle element size, unknown tag -> stop) are sound; I found no
out-of-range read or write. Live check: node listens on `0.0.0.0:6251/udp` (`ss -uln`).

## src/osc/osc-config.js
- `RISK` src/osc/osc-config.js:28 — `listenAddress` defaults to `0.0.0.0` (also in config/defaults-core.js:78), so the unauthenticated OSC state machine is reachable by anything on the LAN, not just Caspar on the same box. Given the unbounded allocations in osc-state-audio.js (below) this is a remote hang. Caspar and node share the box, so `127.0.0.1` is enough unless a remote Caspar is configured.
- `OK` otherwise.

## src/osc/osc-float-endian.js
- `QUALITY` src/osc/osc-float-endian.js:226-228 — once latched to `'be'` (spec-compliant binary) `normalize()` still calls `walkPacket` on every datagram with `swap=false`; it walks every message and does nothing. At the measured ~18.6k msg/s (osc-listener.js comment) that is pure waste. Skip the walk when `latched === 'be'`.
- `RISK` src/osc/osc-float-endian.js:188-206 — the latch is permanent for the process (3 consistent votes). A Caspar swapped to the other lineage without a node restart keeps being byte-swapped (documented in the repo notes, so deliberate; flagging that nothing re-validates afterwards, e.g. a periodic canary check that would unlatch on contradicting evidence).
- `OK` otherwise (bounds, bundle recursion bounded by datagram size, try/catch around the walk, canary address string built only pre-latch).

## src/osc/osc-listener.js
- `QUALITY` src/osc/osc-listener.js:50-65 — `start()` has no guard against being called twice (a second call opens a second UDP port and overwrites `this._port`, leaking the first). The lifecycle (bootstrap/osc-lifecycle.js) always stops first, so no live failing path; `this._endian` is also not initialised in the constructor.
- `OK` otherwise (no per-message allocation beyond what osc.js does; the sample-address set is capped at 40; the 'bundle' handler is intentionally absent, WO-715; `stop()` closes the port).

## src/osc/osc-state-audio.js
- `BUG` src/osc/osc-state-audio.js:46-53 and :96-101 — unbounded loop driven by wire values. `/channel/N/mixer/audio/nb_channels` with an int of e.g. 2000000000 runs `while (c.audio.levels.length < n) levels.push(...)` (line 48) until the heap is exhausted; `/channel/N/mixer/audio/<idx>/dBFS` with `idx` 2000000000 does the same in the `while (a.levels.length <= idx)` loop at line 96. Failing case: one UDP datagram from any host that can reach `0.0.0.0:6251` hangs/OOMs the node process (the playout controller), since the listener's try/catch cannot stop a loop. A legitimate Caspar sends 2-16. Fix: clamp (`n <= 64`, `idx < 64`) and ignore the message otherwise.
- `RISK` src/osc/osc-state.js:63-66 (`_ensureChannel`, called from this file too) — channel numbers are taken from the address with no bound, and channels are never pruned (only layers are, osc-state-layer.js `_pruneStaleLayers`). A stream of `/channel/<n>/...` for distinct n grows `_channels`, and every emit deep-clones all of them (`JSON.parse(JSON.stringify(this._channels))`, osc-state.js:234-239).
- `QUALITY` src/osc/osc-state-audio.js:18 — `if (n < 0 && n >= -12000) return n / 100` is unreachable: the preceding line 17 already returns for every `n >= -120000`. Either the centibel interpretation was meant to win for the smaller range (then the two branches are in the wrong order) or the branch is dead.
- `QUALITY` src/osc/osc-state-audio.js:121-170 — `_layerAudio` entries are pruned only inside `getLayerAudioLevels`, which is called only by `GET /api/osc/audio-layers`. With no client polling, entries for layers that stopped keep their last levels in memory (bounded by the layer count, so minor).
- `OK` otherwise.

## src/osc/osc-state-layer.js
- `BUG` src/osc/osc-state-layer.js:89-91 together with :116 — `tail.startsWith('background/')` is stripped and recursed into at the top of `_routeLayer`, so the `else if (tail === 'background/type')` branch (line 116) can never match and its message is handled by the plain `tail === 'type'` branch (line 103) instead, which ignores `fileTarget` and writes `layer.type`. Failing case: an old-lineage `/channel/1/stage/layer/10/background/type ,s empty` clears `layer.type`, `layer.file`, `layer.backgroundFile` and the template of the layer that is PLAYING in the foreground (lines 107-113), and never sets `backgroundType`. The 2.6-dev binary uses `.../producer`, which is handled correctly with `fileTarget`, so the live box is unaffected; the dual-lineage promise in the comments is not kept for this address.
- `DEAD` src/osc/osc-state-layer.js:116 `else if (tail === 'background/type')` — unreachable as above (the `background/` prefix is consumed at line 89). grep: `background/type` appears in no other src or tools file.
- `QUALITY` src/osc/osc-state-layer.js:30-45, :60 — `_routeLayer` allocates (`_ensureLayer`) for any `stage/layer/<n>/...` address, including tails that are not routed, so junk addresses create empty layer objects until the 10 s prune.
- `OK` otherwise (timing sanity guard, monotonic-elapsed handling and clip-window logic are consistent with the WO notes).

## src/osc/osc-state-timing.js
- `DEAD` src/osc/osc-state-timing.js:83 `SANE_MAX_SECONDS` export — used only inside this file. grep -rlw `SANE_MAX_SECONDS` over src tools client godot scripts index.js -> no other file.
- `OK` otherwise.

## src/osc/osc-state.js
- `QUALITY` src/osc/osc-state.js:98-107, :146, :169 — hot path allocations per message: `_argValues` maps a new array, then up to three regex `match()` calls build match arrays (`/^\/channel\/(\d+)\/(.+)$/`, then `stage/layer` or `output/port`). At ~18.6k msg/s that is a few tens of thousands of short-lived arrays per second. A single manual parse of the address (indexOf/slice) would remove most of it. Not a correctness issue.
- `QUALITY` src/osc/osc-state.js:192-200, :207-222 — in the default full-snapshot mode (`wsDeltaBroadcast` false) every tick deep-clones the whole state and emits `change` even when nothing changed (the value-aware `_dirtyChannels` result is discarded by `_dirtyChannels.clear()`), so the 20 Hz WS/variables work is unconditional. Snapshots also leak internal fields to clients (`_nbChannelsFromOsc`, `_lastUpdateAt`, `_lastProducerSig`, `_meterIndexBase`).
- `QUALITY` src/osc/osc-state.js:287-291 — `clear()` is only called from `tools/smoke/smoke-wo800-per-layer-audio.test.js` (test-only, so still live by the sweep rule); it resets `_channels` but the variables map is cleared elsewhere, so using it in production would leave stale `osc_*` variables.
- `OK` otherwise.

## src/osc/osc-variables.js
- `QUALITY` src/osc/osc-variables.js:93-101 — the JSDoc block above `applyOscSnapshotToVariables` is duplicated verbatim.
- `QUALITY` src/osc/osc-variables.js:153-205 — a channel that disappears from the snapshot (e.g. after `OscState.clear()` or a Caspar channel removal) never has its `osc_ch<N>_...` variables cleared, only layers are tracked in `_oscVarsSeenLayers`. `clearOscVariables` handles a full restart only.
- `OK` otherwise.
