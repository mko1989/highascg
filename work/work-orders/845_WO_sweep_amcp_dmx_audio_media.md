# WO-845 — Sweep: AMCP client, Art-Net/sACN, audio and media bugs

**Area:** amcp, lighting
**Status: DONE (30.10) — offline suite + loopback/Xvfb probes; two follow-ups outside this WO's file scope (see §2 "Needs a change elsewhere")**
**Source:** code sweep 29.10 (REPORT §4m, §5 AMCP client / Art-Net-sACN / Audio / Media and thumbnails).

Items: AMCP — single-command timeout resets the send queue (later commands overtake), 500 FAILED swallows the next
reply, PING always times out, stop() doesn't stop auto-reconnect. Art-Net/sACN — ArtDmx Length read little-endian,
sACN 0–100 % treated as 0–255, project disk parse on every changed DMX frame, follow self-loop guard never
re-evaluated. Audio — setDefaultAlsaDevice overwrites ~/.asoundrc, volume controls without a switch parse as OFF,
removed live-audio slot keeps its PGM routes. Media — custom thumbnail upload writes 0 bytes, PRINT capture matches
the newest PNG across channels, inode relink after delete rewrites project references, ffprobe cache never
invalidated. 4m confine-pointer barrier constants (NegX/PosY).


## 1. Investigation (30.10, every finding re-read against the code before touching it)

All items were REAL except where noted. Reproduction harnesses became the new smokes (they fail on the pre-change tree).

**AMCP client** (`src/caspar/`; load-bearing history read first: WO-422 batch COMMIT ack / `amcpPayloadSent`, WO-670 P4b skipped-reply waiter, WO-811 credential prep)
- Queue reset: `amcp-client-transport.js` single-command timeout did `self._amcpSendQueue = Promise.resolve()` (and `amcp-batch.js` COMMIT-ack timeout the same). Commands already chained on the OLD promise keep running while every NEW `_send` chains on the fresh one: two in flight, and a newer STOP overtakes an earlier queued CLEAR. The chain already advances on rejection (`_send`'s `.catch`; the batch job's `.catch(()=>{})`), so the reset only reordered. `rejectAllPendingAmcpCallbacks` keeps its reset (it rejects every waiter, `execute` returns early for settled ones).
- `500 FAILED`: Caspar sends it as ONE line (`AMCPProtocolStrategy.cpp` unknown_error; source tree at `~/caspar-build/src-v2`). `amcp-protocol.js` put code 500 in the SINGLE_LINE-data state (right for `400 ERROR`, which echoes the command on a second line), so the NEXT command's reply was eaten as its "data". Also `504 <cmd> QUEUE OVERFLOW` and `600 <cmd> FAILED` were unknown codes: "Unrecognized data" + return, waiter unsettled until the 15 s timeout (worst exactly when Caspar is overloaded).
- PING: Caspar answers `PONG [token]` with NO status code (same file, `parse()`); the line fell into "Protocol out of sync" and the waiter only ever settled by timeout. The simulator answered instantly and hid it.
- stop(): `casparcg-connection` re-arms its own 5 s reconnect on every socket `close` (`_triggerReconnect`); `stop()` only called `disconnect()` (`socket.end()`) and unbound listeners. After >5 s the socket was back, and the next `start()` saw `_connected` already true → no `'connect'` event → `_handleConnected` (status + health timer) never ran. Same family, verified in a dummy-server harness: `destroy()` called `CasparCG.discard()` which is the AMCP `DISCARD` command (socket + timeout interval leaked); `reconnect()` on a never-started manager opened a socket through the `host`/`port` setters; `stop()`/`reconnect()` left in-flight waiters to time out (the 'disconnect' that rejects them fires after the listener is unbound).

**Art-Net / sACN** (`src/artnet/`, `src/fixtures/follow-service.js`)
- ArtDmx Length was read `readUInt16LE(16)` in `artnet-packet.js`; Art-Net is big-endian (`fixtures/artdmx.js` already is). 24/100/18-channel universes threw `ERR_OUT_OF_RANGE` per packet (reproduced with built packets; 512 only worked by accident).
- sACN: the finding is about LEVELS, not priority. `sacn` 4.6.2 `Packet.payload` returns PERCENT (`val / 2.55`, zero channels omitted); `sacn-receiver.js` stored `Math.round(val)` as 0-255 → DMX 255 read 100, enable channel never ≥ the sticky threshold → border always OFF. Priority is untouched by any of this.
- Disk parse: `reconfigure()` nulls `_projectScenesCache` at its end, so `handleData` → `_globalBorderSlot()` and every WS flush (`broadcastGlobalBorderToClient`) fell to `loadProjectScenes()` (13.96 ms measured by the sweep). Every project change already calls `reconfigure()`/`reconfigureFromProject()` (`routes-data-project-handlers`, `project-activate`, `routes-scene-global-border`, `shared-show-ctx`), so a slot cached by `init/reconfigure` is as fresh as the existing design.
- Follow self-loop guard: `fx.noSend` is computed in `engine.configure()` only, which `apply` skips for an unchanged fixtures slice; its inputs (input port-address from `config.dmx.artnetInput*` / the border slot's `artnetPatch`, box interface addresses) are not in that slice. Reproduced: input universe changed onto a fixture's universe → engine kept broadcasting into :6454 (the box-loops-into-own-input incident). Also `reachesSelf` ignored `0.0.0.0`.

**Audio** (`src/audio/`)
- `setDefaultAlsaDevice(scope:'user')` did `writeFileSync(~/.asoundrc, <3 lines>)` — destroys the box's hand-authored `pcm.sc60mon` (WO-406, live on this box). Route also let `NaN`/negative reach the file.
- `parseControlBlock`: the per-channel regex required `[dB]` AND `[on|off]`; card 0 `PCM` (`pvolume`, `Front Left: Playback 255 [100%] [0.00dB]`) matched nothing → boolean OFF. Reproduced with the box's real `amixer scontents`.
- Removed live-audio slot: the AMCP side is already handled (`stopDroppedLiveAudioPgmRoutes` STOPs the dropped routes), but the persisted `live_audio_input_<n>_pgm_channels` stays and the clients re-send it (web `live-audio-remove-input.js` keeps `routeTargets[s-1]`), and an explicit selection is authoritative (WO-571), so the next device in that slot went straight to PGM.

**Media**
- Upload: `http-server.js` pre-reads (and utf8-decodes) the body of every non-multipart request before routing; the handler then `req.pipe()`d an ended stream → `ch-N.png` truncated to 0 bytes, `{ok:true}`. utf8-decoding is lossy, so the body cannot be recovered from the string.
- PRINT: the reply names no file; Caspar drops a timestamp-named PNG (no channel in the name) and `waitForPrintPngSince` takes the newest PNG since t0. `_captureLocks` is per channel, so two channels captured together (two DeckLink look cards) picked each other's file. Matching by channel is impossible from the name, so the fix is one PRINT + pickup in flight at a time. (`routes-pgm-capture.js` is not affected: it only prints and keeps the still.)
- Relink: `reconcileRegistry` re-pointed a vanished entry to ANY new file with the same `(dev, ino)`; ext4 reuses inodes, and `media-links` then rewrites every reference across projects.
- ffprobe cache: `ctx._mediaProbeCache` / `_mediaProbeTried` keyed by id only, never revisited.

**4m** `confine-pointer-barriers.py`: constants swapped (`NEGATIVE_X=2`, `POSITIVE_Y=4`; header: PositiveX 1, PositiveY 2, NegativeX 4, NegativeY 8). Bigger than the constants: X `directions` = directions ALLOWED to cross ("Barriers define which way is ok, not which way is blocking"), and the table named the OUTWARD direction per edge. Reproduced on an Xvfb (relative motion +900 x / -600 y from inside a 800x500 rect): old → pointer reached x=1700 / y=0 (right and top escape; left/bottom held only because the swapped bits happened to allow just the perpendicular axis).

## 2. What was done

AMCP (`src/caspar/`)
- `amcp-client-transport.js`: deleted the `_amcpSendQueue = Promise.resolve()` on single-command timeout (rejecting `p` already advances the chain).
- `amcp-batch.js`: same deletion on the COMMIT-ack timeout, plus `_resetAmcpProtocol()` so the late `2xx COMMIT` can't be matched by verb to the next single command. `amcpPayloadSent` (WO-422) untouched.
- `amcp-protocol.js`: `500 FAILED` is a one-line error; `504`/`600` added as one-line errors (`QUEUE_OVERFLOW`, `COMMAND_FAILED`); bare `PONG [token]` resolves the `PING` waiter (only in the parser's NEXT state).
- `connection-manager.js`: `_triggerReconnect` vetoed while stopped/destroyed; `stop()` destroys the socket, clears the library's reconnect timer, marks the library disconnected and rejects in-flight waiters/resets parser (`_dropConnectionState`); `start()` clears a stale `_connected` so 'connect' always fires; `destroy()` closes the socket and clears the library interval instead of sending `DISCARD`; `reconnect()` rejects old waiters + resets state when started, and only records host/port (no socket) when not started.

Art-Net / sACN
- `artnet-packet.js`: Length big-endian, capped by the bytes present.
- `sacn-receiver.js`: use `payloadAsBuffer` (raw bytes); percent fallback ×2.55.
- `dmx-border-receiver-base.js` + `artnet-output.js`: `_slotCache` set by `init()`/`reconfigure()`, hot path (`handleData`, WS flush) reads it; `broadcastGlobalBorderToClient(..., knownSlot)`. `getInputStatus` (diagnostic) still re-reads.
- `fixtures/follow-service.js`: `guardKey()` (input port-address + universe + box addresses) is part of `apply`'s change key, `service.reevaluateGuard()` re-runs the patch when it changes, polled every 5 s (unref'd timer, cleared in `stop()`) because interface/config changes have no event reaching this module; `0.0.0.0`/`0.*` now count as local.

Audio
- `audio-devices.js`: `setDefaultAlsaDevice` merges a marked block (`# >>> HighAsCG default device … <<<`) via exported `mergeAsoundrcBlock`, keeps everything else verbatim, one-time `.highascg.bak` of a hand-authored file, tmp+rename, rejects non-integer/negative card/device, `opts.home` for tests. System scope (`/etc/asound.conf`, root/sudo tee) unchanged.
- `alsa-mixer-controls.js`: `[on|off]` (and `[dB]`) optional in the per-channel and Mono regexes; `anyOff` only on a real `[off]`.
- NEW `audio/live-audio-slot-prune.js` `clearRemovedSlotPgmRoutes(cs)`: a slot that ends a save without a device, or beyond `live_audio_input_count`, gets `pgm_channels = ''` ("route to nothing", WO-571 semantics); never-touched slots get no key. Wired into `POST /api/audio/live-inputs/config` in `api/routes-audio.js` (3 lines).

Media
- `live-thumbnail-cache-handlers.js`: upload reads the body bytes itself, requires PNG magic, 20 MB cap, abort handling, tmp+rename; an already-consumed stream is refused with 409 instead of wiping the cache.
- `live-thumbnail-cache-capture.js`: `serializePrint()` — one PRINT + file pickup at a time across channels; cache PNG/meta written via tmp+rename and a short PRINT no longer destroys the previous thumbnail.
- `media-library-registry.js`: inode relink also requires equal size and mtime (±1 ms).
- NEW `media/probe-cache.js` (`statStamp`, `recordProbeStamp`, `dropStaleProbeEntries`) wired into `api/media-catalog.js` `enrichMediaListForHttp` (stamp before ffprobe; stale entries dropped + re-probed).

4m: `tools/runtime/confine-pointer-barriers.py` constants fixed to the header values and the per-edge table now allows only the INWARD direction (left +X, right -X, top +Y, bottom -Y).

**Needs a change elsewhere (outside the file scope of this WO):**
1. `src/server/http-server.js` ~line 301: `const isIngestUpload = reqPath.endsWith('/api/ingest/upload') || reqPath.endsWith('/api/thumbnail/live/upload')`. Until then the upload is REFUSED (409, cache intact) instead of silently wiping the thumbnail — it cannot succeed because the body is pre-read and utf8-decoded.
2. Clients (not changed): web `client/lib/live-audio-remove-input.js` and the Godot equivalent should also null `routeTargets[s-1]` for the removed slot (the server now neutralises it, so this is cleanup); `routes-audio.js` `/api/audio/default-device` could answer 400 instead of 500 for a rejected card/device.
3. Found, not in this WO's list: `artnet-runtime.js applyPatch` clamps the sACN universe to 0..15 (sACN is 1..63999); `sacn-receiver.js` never re-subscribes after a universe change; `artnet-udp.js` leaves a dead socket after a failed bind.

New tests: `tools/smoke/smoke-wo845-amcp-client.test.js`, `smoke-wo845-dmx-input.test.js`, `smoke-wo845-audio.test.js`, `smoke-wo845-media.test.js`, `smoke-wo845-pointer-barrier-constants.test.js` (to be added to the curated list by the coordinator).

## 3. Verified

New smokes (all pass; each fails on the pre-change tree, run against a `git archive HEAD` copy in the scratchpad — except the audio one, deliberately not run against old code because the old `setDefaultAlsaDevice` ignores `opts.home` and would overwrite the real `~/.asoundrc`):
- `smoke-wo845-amcp-client.test.js` (6): timeout does not reorder (MIXER, MIXER, CLEAR queued, STOP after the timeout waits its turn), `500 FAILED` consumes only its own reply, 504/600 settle, bare `PONG` resolves PING < 200 ms, `stop()` leaves no reconnect timer and no server-side socket + in-flight waiter rejected + `start()` after `stop()` emits status and re-probes VERSION, `destroy()` closes the socket without sending DISCARD and `reconnect()` on an unstarted manager opens nothing (loopback dummy server on 127.0.0.1:ephemeral).
- `smoke-wo845-dmx-input.test.js` (4): ArtDmx lengths 2/18/24/100/256/512 + a lying Length; sACN raw 255/128/1 via the real `sacn` `Packet` (+ percent fallback); 40 changed frames → 0 `loadProjectScenes` calls and WS payload carries the cached slices; follow guard flips with `artnetInputUniverse` under an unchanged fixtures slice and clears again (output master OFF, nothing sent; no sockets bound).
- `smoke-wo845-audio.test.js` (3): temp-HOME `.asoundrc` block merge (hand-authored `pcm.sc60mon` preserved, block replaced not duplicated, backup, garbage rejected, real `~/.asoundrc` untouched); PCM/Master/Digital without a switch → `volume`, `[off]` still mutes; route end-to-end for the removed slot.
- `smoke-wo845-media.test.js` (4): upload real bytes / 415 non-PNG / 409 consumed stream with cache intact; two concurrent PRINT captures get their own pictures and the scratch stills are cleaned; reused-inode not relinked, genuine move relinked; probe cache dropped on size and on mtime change, and through `enrichMediaListForHttp`.
- `smoke-wo845-pointer-barrier-constants.test.js` (2): constants pinned to the header, per-edge inward table.

Existing suites: every file in `tools/smoke` + `test` that mentions AMCP (≈100 files), plus the thumbnail/media/audio/pointer-confine/artnet/follow/fixtures ones: 2066 tests, 2044 pass, 19 fail — all 19 are in 5 files that fail IDENTICALLY on the untouched HEAD copy (`smoke-amcp-basic-plan-log.js`, `smoke-amcp-command-plan.js`, `smoke-caspar-cls-id.test.js`, `smoke-live-thumbnail-api.js`, `smoke-wo173-clip-start-batch.test.js`, `smoke-decklink-output-resolve.js`); none touches code changed here. `npx eslint` on the changed files: 0 errors (3 warnings, all pre-existing unused vars). `check-max-file-lines`: nothing over 500 from this WO (largest 488).

Probes: 4m confirmed on a scratch X display with `xdotool mousemove_relative` before/after (old: `{right: 1700, left: 400, up: 0, down: 799}`; new: `{right: 1199, left: 400, up: 300, down: 799}`; rect 400..1200 x 300..800). The display was a pre-existing Xvfb `:97` (my own `Xvfb :97` failed to start because it was already active); the barriers died with the probe process and nothing on `:0` was touched. No AMCP was sent to the live Caspar, no Art-Net/sACN was sent (parsing/stub only), no live API call, no restart.

Not verified live / owner-QA: the real `http-server.js` upload (needs the one-line exemption above), the PGM-route cleanup against a running Caspar with real ALSA slots, and the follow guard's 5 s poll against a real interface change.

## Follow-ups done (30.10)

The items under "Needs a change elsewhere" 2 and 3 (item 1, the `http-server.js` upload exemption, is not part of this pass).

### Investigation
- `src/artnet/artnet-runtime.js:8` (`applyPatch`) clamped `universe` to 0..15 for BOTH protocols. That is right for Art-Net (low nibble of the port-address, `subuni = subnet<<4 | universe&0xf`) and wrong for sACN (1..63999): a sACN universe 100 was silently stored as 15, and 0 (not a valid sACN universe) was accepted.
- `src/artnet/sacn-receiver.js` `_ensureListening()` returned as soon as `this._socket` existed. The `sacn` lib joins its multicast groups in the constructor, so a universe (or port) change from `reconfigure()` kept the OLD group joined and never subscribed the new one; packets of the new universe were never delivered. A bind error from the lib (`err.syscall === 'bind'`) also left the dead receiver in `_socket`.
- `src/artnet/artnet-udp.js` `bindUdpSocket`: `socket.bind()` fails asynchronously (EADDRINUSE/EACCES via the `'error'` event, the socket never reaches `'listening'` and Node does not emit `'close'`), after `receiver._socket = socket` was already assigned. `ensureSocketListening` returns early on a truthy `_socket`, so no later reconfigure could retry. The sync `catch` also left a created socket open. The error was only logged.
- `client/lib/live-audio-remove-input.js` spread `prevUi` (incl. `routeTargets`) into `nextUi`, so the config POST echoed the removed slot's `live_audio_input_N_pgm_channels`. Godot twin: `godot/client/features/devices/input_slots_model.gd` `_shrunk()` (used by `live_audio_remove_plan`).
- `src/api/routes-audio.js` `/api/audio/default-device`: every `setDefaultAlsaDevice` failure answered 500, including the validation rejection WO-845 added (`card and device must be non-negative integers`, e.g. `parseInt('abc')` = NaN).

### What was done
- `artnet-runtime.js`: universe range comes from `receiver._universeRange()` (fallback 0..15); `getInputStatus` also reports `bindError`. `dmx-border-receiver-base.js`: default `_universeRange()` = `[0, 15]`; `stop()` clears the bound universe/port. `sacn-receiver.js`: `_universeRange()` = `[1, 63999]`.
- `sacn-receiver.js`: remembers `_boundUniverse`/`_boundPort`; a change closes the old transport (`_closeTransport()`: listeners detached, a no-op error listener left so a late socket error cannot throw) and creates a new one. A bind error or constructor throw closes + nulls the receiver and sets `_bindError`. Transport creation goes through `_createTransport()` (test seam).
- `artnet-udp.js`: `discardSocket()` closes the socket and nulls `receiver._socket`; used by the async `'error'` handler (only before `'listening'`) and by the sync catch; `receiver._bindError` set on failure, cleared on `'listening'`, shown in `getInputStatus().bindError` (the error was already logged, now it is also queryable).
- Web `live-audio-remove-input.js`: copies `routeTargets`, sets `[s-1] = null`, passes it in `nextUi` (null = "never saved" = no key sent; the server neutralises the slot anyway, WO-845). `npm run build:client` run.
- Godot `input_slots_model.gd` `_shrunk()`: same (`routeTargets[s-1] = null`, padded to MAX_SLOTS). The recorded web golden `tests/golden/devices_host_source.json` (`remove.liveAudio1`, `remove.liveAudioNoStore`) had `live_audio_input_1_pgm_channels: "1,3"` in the expected POST; those two lines were removed because the web module that the golden records now behaves that way.
- `audio-devices.js`: the validation rejection carries `invalid: true`; the route answers 400 for it (log level warn), 500 for every other failure (EACCES, no home, tee missing).

### Verified
- NEW `tools/smoke/smoke-wo845b-followups.test.js`: 6 tests, 6 pass (clamp per protocol; sACN universe change closes old + subscribes new + stop/rebind; sACN failed bind + constructor throw; Art-Net async bind error and sync throw then successful retry; web `removeLiveAudioInputSlot` against a stubbed fetch; default-device 400 vs 500 vs 200 with `setDefaultAlsaDevice` stubbed so `~/.asoundrc` is never written). No sockets, no Art-Net/sACN, no AMCP. Mutation-checked: reverting each fix (range, rebind guard, discard/error handler, routeTargets null, 400 mapping) makes its test fail.
- Added to the curated list `tools/ci/offline-test-files-3.js` (before `smoke-xrandr-custom-mode.js`).
- NEW Godot `tests/test_wo845b_route_targets.gd` (2 tests). Full Godot suite: 23423 passed, 0 failed (the 2 golden cases above failed first, then were updated).
- `node --test tools/smoke/*wo845*`: 25 pass, 0 fail. `*artnet*`, `*lighting*`, `*wo604*` smokes: 100 pass, 0 fail. eslint on the changed JS: clean. `check-max-file-lines`: 0 over 500. prettier: new test file and `sacn-receiver.js` clean; the other changed files were already non-compliant (trailing commas / long lines) and only my own lines were kept in the file's style.
- Not verified live: a real sACN universe change on the box and a real EADDRINUSE on :6454 (hermetic stubs only, by design); no restart was done, so the running node still has the old code until the next restart.
