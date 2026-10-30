# src/audio — sweep 29.10.2026 (batch 068)

Files: 17 · lines: 3683 · findings: 0 BUG-HIGH, 3 BUG, 3 DEAD, 7 RISK, 8 QUALITY

## src/audio/alsa-mixer-controls.js
- `BUG` src/audio/alsa-mixer-controls.js:150-188 — a playback/capture volume control that has no on/off switch is parsed as a `boolean` that is OFF. The per-channel regexes at :150-152 (`withDir`) require a trailing `[on|off]`, and `genericVol` at :160 requires digits straight after the colon, so a line like `Front Left: Playback 255 [100%] [0.00dB]` matches neither. `channels` stays empty and :178-188 returns `{type:'boolean', value: /\[on\]/ ? 1 : 0}`, i.e. value 0. Verified on this box with the real `amixer` output through the exported `parseAmixerScontents`: card 0 `PCM` (`Capabilities: pvolume`, 100 %) comes back `type:boolean value:0` and `Digital` (`cvolume`, 50 %) the same; `Master`/`Headphone` (which have a switch) come back correctly as `volume`. Effect: GET /api/audio/alsa-mixer shows the control as a switch that is off and the slider is lost. Fix: make `\s+\[(on|off)\]` optional in the `withDir` regex (and the Mono variant at :167-169); then `anyOff` only trips when the token is present.
- `RISK` src/audio/alsa-mixer-controls.js:21-30,343,395-403 — every call is `execFileSync` with a 12 s timeout on the node event loop. `setAlsaMixerControl` runs three of them back to back (refresh state, `sset`, refresh state), so a hung `amixer` (USB card yanked mid-ioctl) can freeze AMCP/OSC/WS handling on the live server for up to 36 s. Fix: async `execFile`.
- `RISK` src/audio/alsa-mixer-controls.js:353-364,38-49 — request values go into the argv unchecked. `body.item` / `body.value` that start with `-` become options for amixer (GNU getopt permutes). `body.percent` = `"abc"` goes through `parseInt(...) || 0` (:360) and silently sets 0 % instead of a 400. An `index` with no `name` yields the control id `,3` (:40). No shell is involved, so this is not injection, only wrong results. Fix: validate numerics, pass `--` before positionals, require `name`.

## src/audio/alsa-mixer-enumerate.js
- `QUALITY` src/audio/alsa-mixer-enumerate.js:11-21,29-38 — `AMIXER_BINS`/`ALSAMIXER_BINS` start with the bare names `'amixer'`/`'alsamixer'` and `fs.existsSync(bin)` is evaluated relative to the process CWD, so the first entry never means "on PATH". The PATH lookup only happens via `lookupCommandPath` afterwards. Harmless, but the first entry is dead; drop it.

## src/audio/alsa-mixer.js
- `OK` thin re-export of enumerate + controls (consumers: src/api/routes-audio.js, src/api/system-hardware-gui.js, tools/smoke/smoke-alsa-mixer.test.js).

## src/audio/audio-capture-fft.js
- `QUALITY` src/audio/audio-capture-fft.js:207 — `spawn` always uses `ARECORD_BINS[0]` (`'arecord'`, PATH only), while `listCaptureDevices()` (:93-102) falls back to `/usr/bin/arecord`. Under a minimal systemd PATH the device list works but the capture spawn fails with ENOENT and just retries forever with backoff. Use the same resolved binary for both.
- `QUALITY` src/audio/audio-capture-fft.js:43-46,56-69 — `num(v, fb)` uses `Number(v)`, and `Number(null) === 0`, so a JSON `null` (e.g. `"gain": null`, `"sampleRate": null`) is treated as 0 and clamped to the min (gain 0.1, sampleRate 8000) instead of falling back to the default. Check `v == null` first.
- Checked and fine: stop() clears interval/retry timer/kill/close; stop+start re-creates the engine in audio-capture-lifecycle.js (no stale `exit` handler can respawn, because each engine has its own `stopped`); backoff reset timer is unref'd.

## src/audio/audio-devices.js
- `BUG` src/audio/audio-devices.js:210-232 — `setDefaultAlsaDevice` (POST /api/audio/default-device, src/api/routes-audio.js:216-233) (a) does not validate `card`/`device`: the route only does `parseInt`, so `{"card":"x","device":0}` gives NaN and the file content becomes `defaults.pcm.card NaN`; and (b) in `scope:'user'` it replaces the whole `~/.asoundrc` with `fs.writeFileSync` (:231). On this box `/home/casparcg/.asoundrc` is hand-authored and defines `pcm.sc60mon` (WO-406, the 48 kHz plug view that the WO-801 monitor/headphone consumer uses). One call to this endpoint destroys that definition, and the headset output fails on the next Caspar open. There is no UI/Godot caller (grep: only the route, router.js:232, docs). Fix: reject non-finite/negative numbers; back up the old file and write only a marked block, or refuse if the file does not carry our marker.
- `RISK` src/audio/audio-devices.js:127-146 — `parsePwCliNodes` splits blocks on `/\nid\s+\d+/` (:129) and takes the id with `/^\s*(\d+)/` (:132). `pw-cli list-objects Node` prints each object as a tab-indented `\tid 31, type PipeWire:Interface:Node/3`, so the splitter (needs `id` at column 0) never matches, the whole output is one block, `idm` is null and the function returns `[]`. Not verifiable live (PipeWire is inactive for this user; `/api/audio/devices` reports `sources.pipewire: 0`), so this is from the documented pw-cli format. If right, PipeWire sinks are never listed. Fix: split on `/^\s*id\s+\d+,/m` and use `pw-dump` JSON.
- `QUALITY` src/audio/audio-devices.js:28-41,151-190,316 — `listAudioDevices` runs up to three `execFileSync` calls (`aplay -l`, `aplay -L`, `pw-cli`, timeouts 8+8+5 s) and `listPortAudioDevices` calls it with `refresh:true` on every PA cache miss (every 15 s), then `annotateHdmiSinks` adds a `spawnSync amixer` per card. All on the event loop. Also :36 tries `aplay`, `/usr/bin/aplay`, `/usr/local/bin/aplay` again after any non-zero exit of the first.

## src/audio/beat-detect.js
- `OK` (read in full: flux/onset/tempo/grid maths, ring indexing and `reset()` are consistent; no I/O, no timers).

## src/audio/fft.js
- `OK` (radix-2 FFT, Blackman cache, AnalyserNode byte mapping all correct and pure).

## src/audio/hdmi-iec958-select.js
- `OK` (pure parsers; switch<->PCM resolution refuses on any disagreement as documented; consumers: routes + smoke).

## src/audio/hdmi-sinks.js
- `QUALITY` src/audio/hdmi-sinks.js:126 — `spawnSync('amixer', ...)` uses the bare name, while the sibling `alsa-mixer-enumerate.js` resolves `/usr/bin/amixer` for minimal-PATH systemd. Under a minimal PATH `annotateHdmiSinks` silently drops all sink labels (run returns ''). Reuse `resolveAmixer()`.

## src/audio/input-audio-routing.js
- `BUG` src/audio/input-audio-routing.js:207-221 — `restoreInputRoutes` has no guard for `input.destLayer === null`, which `setRoute` does check (:160). For ALSA slots `liveAudioPgmLayerForSlot` (src/config/live-audio-input.js:348-355) returns null when `live_audio_pgm_layer + slot - 1 > 9`. Failing case: `live_audio_pgm_layer: 3` and slot 8 with the default PGM targets (no `live_audio_input_8_pgm_channels` key): POST /api/audio/live-inputs start (src/api/routes-audio.js:412) reaches :215 and sends `STOP 1-null`, `MIXER 1-null CLEAR`, `PLAY 1-null route://…` to Caspar. Fix: `if (!input.destLayer) return 0` next to the `route` check at :209.
- `RISK` src/audio/input-audio-routing.js:123 — `Math.max(0, Number(o.gain) || 0)` turns a missing/NaN gain into 0 (silence) and has no upper bound. The only caller that forwards raw body fields is src/api/routes-audio.js:194 (`gain: b.volume`): a POST `/api/audio/volume` with `key:"input:5"` and no `volume` mutes that input strip on air (and `mixerState.setGain` stores 0), and `volume: 1e9` sends `MIXER … VOLUME 1e9` (linear coefficient, as intended by amcp-mixer.js, but unclamped). Reject non-finite, clamp to a sane maximum.

## src/audio/live-audio-bridge.js
- `DEAD` src/audio/live-audio-bridge.js:319 `liveAudioBridgeStatus()` — unused. grep: `grep -rn "liveAudioBridgeStatus" src client tools godot index.js scripts` → only the definition and the export (it is also in tools/ci/unwired-exports-baseline.json). The inspector status comes from other paths.
- `RISK` src/audio/live-audio-bridge.js:204-227,271-285 — restart is "SIGTERM the old ffmpeg, delete the map entry, spawn the new one immediately" (`startLiveAudioBridge` calls `stopLiveAudioBridge` then `spawn`). The old process is not awaited. An ALSA `hw:`/`dsnoop:` capture device is opened exclusively by plain `hw:`, so the new ffmpeg can hit "Device or resource busy" while the old one is still closing; `ensureLiveAudioBridge` then returns false after the 700 ms warmup and `playLiveAlsaClipWithRecovery` moves to the next clip variant with the same race. The same pattern is in src/capture/v4l2-input-bridge.js:138 and src/capture/browser-capture-bridge.js:43. No SIGKILL escalation either. Fix: await the old process's `close` (with a kill timeout) before spawning.
- `QUALITY` src/audio/live-audio-bridge.js:39-41 — `ffmpegBinary()` plus the whole spawn/stop/ensure/status/warmup scaffold is copy-pasted three times (here, src/capture/v4l2-input-bridge.js:25, src/capture/browser-capture-bridge.js:28). One shared "ffmpeg bridge" helper would remove ~300 lines and give the restart race a single fix point.

## src/audio/live-audio-health.js
- `QUALITY` src/audio/live-audio-health.js:10-23,65-67 — `infoHasFfmpegProducer`, `infoForegroundBlock` and `sleep` are duplicated verbatim in src/capture/v4l2-input-health.js:10-23,61-63. Move to a shared module (e.g. next to `amcpInfoText`).

## src/audio/live-input-start.js
- `OK` (pure plan resolution + one-input start; failure statuses consistent; consumers in src/api/routes-audio.js and smokes).

## src/audio/meter-health.js
- `RISK` src/audio/meter-health.js:88-94 — the 15 s `setInterval` has no in-flight guard. `repairLiveInputMetersIfStale` can take longer than 15 s when several slots are stale: per slot and per clip variant `playLiveAlsaClipWithRecovery` costs about 0.7 s bridge warmup + 0.15 s + 0.45 s verify + an INFO, so 8 stale slots x 3 variants is roughly 30-40 s. The next tick then starts a second repair of the same slots, and `restartLiveAudioBridge` of the second pass kills the ffmpeg the first pass just started. Fix: skip the tick while a run is pending (the watchdog in src/bootstrap/caspar-amcp-watchdog.js uses a `busy` flag for exactly this).
- `DEAD` src/audio/meter-health.js:115-118 — re-exports `isLiveAlsaProducerHealthy`, `amcpInfoText`, `DEFAULT_STALE_MS`, `WATCH_INTERVAL_MS` are never imported from this module. grep: `grep -rn "meter-health" src client tools index.js` → importers take only `repairLiveInputMetersIfStale`, `broadcastOscSnapshot`, `startLiveInputMeterHealthWatch` (src/config/routing-setup.js:16, src/server/ws-server.js:215), `stopLiveInputMeterHealthWatch` (index.js:392); `DEFAULT_STALE_MS`/`WATCH_INTERVAL_MS` are only in the CI baseline list.

## src/audio/meter-null-consumer.js
- `DEAD` src/audio/meter-null-consumer.js:122 `removeMeterNullConsumer()` — no caller anywhere. grep: `grep -rn "removeMeterNullConsumer" src client tools godot index.js scripts` → definition + export only (also in the CI unwired baseline). Meter consumers are never removed, even when `live_audio_meter_null_consumer` is switched off at runtime.

## src/audio/mixer-state.js
- `OK` (gains are stored linear and validated `>= 0`; keys validated by `KEY_RE`; monitorPair omitted when 'mix').

## src/audio/monitor-pair.js
- `RISK` src/audio/monitor-pair.js:139-203 — `applyMonitorPair` / `reassertMonitorPair` are multi-step (INFO, REMOVE, 250 ms sleep, ADD with retries up to ~3.75 s) with no serialisation. Two overlapping calls (the picker clicked twice within the settle time, or the Caspar-reconnect reassert racing a click) interleave: call B's INFO runs after A's `REMOVE ch-500` but before A's `ADD ch-730`, sees neither port and returns the spurious 409 "has no headphone consumer … Apply the Caspar config first" (:147-149); other orders do REMOVE/ADD in the wrong sequence on the single-open device. The e2e in WO-801 was sequential. Fix: chain calls on a promise queue per monitor channel.
- `QUALITY` src/audio/monitor-pair.js:67-70 — private `amcpParam` quoting does not strip CR/LF or escape backslashes, unlike the central `param()` (src/caspar/amcp-utils.js:17-21, whose header says an embedded newline starts a new AMCP command). The device name comes from config (audio_outputs / audio preview). Use `param()` from amcp-utils.
