# src/ptz — sweep 29.10.2026 (batch 089)

Files: 4 · lines: 682 · findings: 0 BUG-HIGH, 2 BUG, 1 DEAD, 1 RISK, 7 QUALITY

Method: all four files read in full; callers traced (src/tracking/auto-routes.js:17-37, src/tracking/auto-ptz.js:10-21), beam-offset.js (`addPin`, `normalizeMap`, `blend`) read for the pin maths, WO-711 / WO-713 R2 intent respected (fire-and-forget UDP, 10 Hz, 0.3 deg deadband are design). Repros used the injectable `send` of `createPtzService`, so no datagram left the process.

## src/ptz/ptz-calibrate.js
- `BUG` src/ptz/ptz-calibrate.js:77-81 — a jog that carries only `zoom` also moves pan/tilt. `p`/`t` are always computed (`(pan ?? cur.pan ?? 0) + (dpan ?? 0)`) and always put in the patch, so on a camera that has never been driven (`cur.pan === null`, the state right after `start`) the hold gets pan 0 / tilt 0 (clamped into the range). Failing case: `start` then `jog {zoom: 8000}` on a camera with pan.min 20. → repro: reply `{pan: 20, tilt: 0, zoom: 8000}`, and the next `step()` emitted both `81010447010f0400ff` (zoom) and `810106020c0a0001020000000000ff` (absolute pan/tilt move). A zoom nudge physically swings the camera to centre (WO-713 documents "deltas start at 0/0" for unknown positions, not for zoom-only jogs). Fix: include `pan`/`tilt` in the patch only when one of `pan/dpan/tilt/dtilt` was given.
- `BUG` src/ptz/ptz-calibrate.js:87-92 — `point {marker: null}` is accepted as marker 0. `data.marker === undefined` is the only presence check, then `Number(null)` is 0. → repro: reply 200 with `points[0].marker === 0`, pinned against marker 0's position. A client that sends `marker: null` instead of omitting it silently calibrates against the wrong mark. Fix: test `data.marker == null`, and reject non-integer markers (`Number('abc')` is NaN and ends in the message "no marker abc").
- `QUALITY` src/ptz/ptz-calibrate.js:124 — the return value of `ptz.hold(id, {})` (TTL refresh) is ignored; the following `jog`/`point` carries on for a camera whose hold refresh was refused (e.g. disabled meanwhile). Harmless today (jog re-checks via its own `hold`), but `point` would still push a pin.
- `QUALITY` src/ptz/ptz-calibrate.js:135 `ACTIONS` export — no importer (auto-routes.js and the smoke import only `createPtzCalibrate`).

## src/ptz/ptz-model.js
- `QUALITY` src/ptz/ptz-model.js:197 — a junk `zoom` becomes a fixed zoom of 0 instead of "no fixed zoom". → repro: `normalizeCamera({zoom:'abc'}).zoom === 0` and `normalizeCamera({zoom:true}).zoom === 0` (`int()` falls back to its default `0`, only `null/undefined/''` give `null`). On the next follow start the camera is zoomed fully wide. Use `null` as the fallback for non-numeric input.
- `QUALITY` src/ptz/ptz-model.js:169-173 — `num([])` → 0 (`Number([])` is 0), so an array in a numeric field passes as 0 instead of the default.
- `QUALITY` src/ptz/ptz-model.js:165 `MAX_PINS = 32` shadows beam-offset.js's `MAX_PINS = 64`, and `normalizeMap` already slices to 64 before :188 slices to 32. Intentional per the comment, but the same name with two meanings invites mistakes.

## src/ptz/ptz-service.js
- `DEAD` src/ptz/ptz-service.js:293 `MIN_INTERVAL_MS`, `DEADBAND_DEG` exports — zero importers anywhere (src, tools, tests, client); they are used only inside the file. Not in the unwired baseline.
- `RISK` src/ptz/ptz-service.js:157-159,228-230,226 — design (WO-711) but worth noting: UDP is fire-and-forget and the deadband suppresses any resend, so a single lost datagram leaves the camera short of a static target until the aim drifts by 0.3 deg or more. No reply listener exists (camera ACK/completion packets are dropped). A periodic low-rate refresh (e.g. every 2 s) would make this self-healing.
- `QUALITY` src/ptz/ptz-service.js:42-51,152 — `fresh()` does not define `heldZoom`; it appears only after the first `Object.assign` in `release()/heldAt()`. Works through `undefined !== number`, but the shape is implicit. `status()` (:264) reads `holds` without purging expired holds, which linger until the next `heldAt`.

## src/ptz/visca.js
- `QUALITY` src/ptz/visca.js:1-23,388-402 — the header says the byte formats were checked against docs only ("no real camera was available"), so every encoder is unverified on hardware (PTZOptics raw UDP :1259, Sony-style IP framing :52381). `nibbles16`, `ipFrame` and `ipCommand` are exported but used only by smoke tests. The encoders themselves match the documented examples (checked `panTiltAbsolute` against the 0x0990 nibble example, header 8 bytes, length = payload length).
