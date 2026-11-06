# WO-976 — A Caspar channel / screen destination (e.g. Dioda PGM) as the audio-reactive FFT source

**Area:** audio, engine, godot-client
**Status: IN PROGRESS (06.11.26: server + API + engine proven on the box; Godot picker built and headless-tested, but it lives in the live-audio slot inspector, so it is unreachable on a box with no input slot. Open: a slot-independent place for the picker)**

Owner 06.11 (after the show): *"can caspar channels like dioda pgm 1 can be an audio source for audio reactive visuals?"*
→ *"add a work order for the caspar channel/screen destination as an fft source"*.

Related: WO-333 (FFT engine, no WO file), [WO-335](./335_WO_SHADER_AUDIO_PROGRAM_PATH_WS_TIER_PRIORITY.md)
(WS tier), [WO-884](./884_WO_fft_engine_missed_slot_routed_by_project_apply.md) (engine follows the routed slot),
[WO-863](./863_WO_visuals_tab_canvas_flow_send_to_screen.md) (Visuals tab consumer).

## 1. Investigation (06.11, coordinator session)

**Today the FFT source can only be a live-audio input slot.**
- `casparServer.audio_fft_source_slot` (1..8, 0 = none) is set from the input slot's inspector
  (`src/api/routes-audio.js:472`; Godot `features/devices/host_input_controls.gd`, `input_slots_model.gd`) and is
  resolved by `resolveAudioFftSourceSlot` (`src/config/live-audio-input.js:384`).
- The slot's bridge ffmpeg (the only opener of the ALSA device, e.g. the DM3 on slot 1) tees s16le / 48 k / stereo PCM to
  `udp://127.0.0.1:${52220 + slot}` (`src/audio/live-audio-bridge.js:10,53,176-188`).
- The engine binds that port (`src/bootstrap/audio-capture-lifecycle.js:45-60`) and broadcasts `audio_fft` WS frames
  (~30 Hz, freq/wave 512 B). These frames feed the CEF shader player, the Godot Visuals tab and the Caspar shader
  layers alike.
- A Caspar channel's mix (Dioda PGM = channel 2 on this box: `caspar channels` → program [2], preview [3]) is not a
  selectable source.

**Caspar can tee a channel's audio as raw PCM over UDP (probed live on ch2, 06.11 ~22:45, under the box lock):**
```
ADD 2-9299 STREAM udp://127.0.0.1:52299?pkt_size=1316 -vn -codec:a pcm_s16le -ar 48000 -ac 2 -format s16le
→ 202 ADD OK
UDP listener, 6 s: 6792 packets, 8 693 760 bytes (≈1.45 MB/s), peak sample 0 (ch2 was silent at the time)
REMOVE 2-9299 → 202 REMOVE OK
```
- The rate is ≈1.45 MB/s. Stereo s16le at 48 k would be 192 kB/s, so Caspar sends its full channel layout
  (≈16 ch × 2 B × 48 k ≈ 1.54 MB/s, less the startup) and ignores `-ac 2`. Step 1 settles this: either find the
  ffmpeg-consumer option that downmixes (`-filter:a` / `-af pan=stereo|c0=c0|c1=c1`, `-channel_layout`) or let the
  receiver take channels 1+2 out of N interleaved.
- **NOT proven:** non-silent programme audio arriving (the peak was 0 because nothing audible was on ch2), the
  latency, and whether the extra consumer costs the channel frames (check OSC :6250 presented/dropped while it runs,
  memory caspar-osc-output-health).

## 2. Design (to do)

1. **Source model.** Extend the FFT source from a slot number to a tagged source: `{kind:'slot', slot:n}` |
   `{kind:'channel', destination:<screen dest id>, bus:'pgm'|'prv'}`. Store the *screen destination*, not a raw
   channel number, and resolve it to the Caspar channel through the channel map at apply time (operator-first can
   renumber channels: memory operator-first-always-on, never assume PGM = 1). Keep `audio_fft_source_slot` readable
   for old configs/projects (legacy = `{kind:'slot'}`). Settings POST newConfig is hand-listed (memory
   settings-post-newconfig-hand-listed): add the new key there and to defaults-core.js.
2. **Consumer lifecycle (server).** When the source is a channel, HighAsCG adds the STREAM consumer itself, with a
   fixed consumer index (e.g. `ADD <ch>-9276`), to `udp://127.0.0.1:52230` (a port outside the 52221-52228 slot tees),
   and points the FFT engine at that port. It REMOVEs the consumer when the source changes, re-adds it after a Caspar
   restart or config apply (runtime consumers are invisible to config diffs: memory
   runtime-consumers-invisible-to-config-diffs, so it must be in the post-apply re-add list) and after a project load
   that changes the destination→channel map.
3. **Engine.** Accept an N-channel interleaved input (channels 1+2 → stereo) if Caspar can't be told to downmix.
4. **UI (Godot, minimal).** One "Audio-reactive source" picker listing the input slots plus each screen destination's
   PGM (and PRV?). It lives where the slot toggle is today, or in Visuals/Settings. Pick one place and keep the slot
   inspector tick in sync (memory sources-tab-no-inspector: per-input controls live in the device-view host-channel
   inspector).
5. **Tests.** Offline: source resolution (destination → channel through a renumbered map), the ADD/REMOVE AMCP
   strings, the legacy slot config. Box: ch2 with a clip that has audio → `audio_fft` WS frames with rms > 0 that
   follow the programme; switch the source back to slot 1 → the consumer is gone (`INFO 2` consumers) and the DM3
   feed returns; OSC :6250 drop count unchanged while the consumer runs.

## 3. What was done

**Channel-count question settled (probe, ch2, 3 s each, under the lock):** `-ac 2` is ignored (1 525 760 B/s ≈ 16 ch), `-af` is
ignored too, but **`-filter:a pan=stereo|c0=c0|c1=c1` is honoured**: 190 720 B/s = stereo s16le/48 k. So the stream
consumer downmixes at the source and the engine needs no N-channel mode (design step 3 not needed; engine unchanged).

- `src/audio/fft-channel-source.js` (new): source model + consumer lifecycle. casparServer flat keys `audio_fft_source_kind`
  (`slot|channel|none`), `audio_fft_source_dest` (screen destination 1-based), `audio_fft_source_bus` (`pgm|prv`);
  `resolveAudioFftSource` returns the tagged source (legacy `audio_fft_source_slot` without a kind stays `{kind:'slot'}`);
  `resolveFftSourceChannel` maps destination+bus to the Caspar channel through `getChannelMap` (never assumes PGM=1;
  null for a screen beyond the map or no PRV). `ADD <ch>-9276 STREAM udp://127.0.0.1:52230?pkt_size=1316 -vn -codec:a
  pcm_s16le -ar 48000 -filter:a pan=stereo|c0=c0|c1=c1 -format s16le` / `REMOVE <ch>-9276`. `syncFftChannelConsumer(ctx)`:
  REMOVE from a channel the source left, ADD idempotently on the resolved one (INFO check for `port_9276`, so a restarted
  Caspar gets it back), and one sweep per node process for a consumer an earlier process left on any PGM/PRV.
  `applyFftSourceBody` / `describeFftSource` for the API. A slot tick (slot >= 1) switches kind back to `slot`; an untick keeps a channel pick.
- `src/bootstrap/audio-capture-lifecycle.js`: `resolveCaptureConfig` uses the tagged source; a channel source binds the
  existing UDP engine path on :52230 (stereo 48 k), so `syncAudioCapture`'s rebind-on-change covers it.
- `src/config/routing-setup-live-inputs.js`: `setupLiveAudioInputs` (called by live-inputs apply, `ensureLiveAudioRouting`
  on connect / project load / new project) runs `syncFftChannelConsumer` right after the engine sync, before the bridges.
- `src/api/routes-audio.js`: slot body parsing moved to `applyFftSourceBody` (file net -3 lines, was 495); new
  `GET /api/audio/fft-source` -> `{source, channel, options:[{id,label}]}`; `POST /api/audio/live-inputs/config` takes
  `{audio_fft_source: 'none'|'slot:N'|'channel:D:pgm|prv'}` (or the legacy slot field). **Shared file touched:** `src/api/router.js`, +1 route line.
  settings-post.js / defaults-core.js not touched (the keys ride casparServer through live-inputs/config, which saves it itself).
- Godot: `input_slots_model.gd` (`fft_source_requests`, `fft_source_options`), `host_input_controls.gd` (an "Audio-reactive
  source" select under the existing "Shader FFT source" tick; options from the new GET; pick = config + apply; the tick shows off while a channel is the source).
- `docs/wiki/api/contract/http.md` regenerated (550 routes; it also carries other agents' routes if they landed).
- Tests: `tools/smoke/smoke-wo976-fft-channel-source.test.js` (added to offline-test-files-3.js); `smoke-wo333` repointed
  (slot parsing and the resolver now live in fft-channel-source.js; assertions kept, not weakened).

## 4. What was VERIFIED

- Offline suite 5424 tests, 5419 pass, 0 fail (8 new WO-976 tests: legacy slot config, destination->channel via map, AMCP strings,
  body->keys, ADD idempotent + REMOVE on switch, re-ADD after a Caspar restart + leftover sweep, engine binds the channel source).
  Godot headless `--test`: 26079 passed, 0 failed. max-lines 0 over; eslint clean on touched files; `prettier --check tools/ci` clean.
- Live box (node restarted under box2.lock, ch2 = screen 1 program): `GET /api/audio/fft-source` lists none / Screen 1 program (ch 2) /
  Screen 1 preview (ch 3); picking `channel:1:pgm` + apply -> `INFO 2` shows `port_9276`, source resolves ch 2.
  With the consumer on and an audio-only clip looping on a scratch layer `2-95` (`BEAT-TESTS/GTZAN-DISCO.00010`): 239 `audio_fft`
  WS frames in 8 s, rms max 0.219, mean 0.108; before the clip (silent PGM) 90 frames in 3 s with rms 0; after `CLEAR 2-95` rms back to 0.
  Switching back to slot 1 -> `INFO 2` has no `port_9276`, source `slot:1`. Layer 2-95 was cleared; the box is as found
  (kind key now stored as `slot`, `audio_fft_source_slot` 1 unchanged).
- Cost (OSC :6250, ch2 screen consumer, 8 s windows): no consumer 50.00 presented/s, 0 dropped; consumer on 50.00/s, 0 dropped; consumer off 50.00/s, 0 dropped.
  Note that :6250 sends `presented_frames` as int64 (`h`) inside `#bundle`s.
- NOT proven: latency vs. the audio; Godot picker on the glass (no live-audio slot on this box -> the inspector block never renders, so it is
  untested beyond the headless tests); a Caspar restart / project load on the box (the re-add path is smoke-tested with a fake AMCP,
  not exercised live); the DM3 feed returning after the switch back (no slot is configured on this box, `liveAudioCount` 0).
- Follow-up: move or duplicate the picker somewhere slot-independent (Visuals tab or the screen destination inspector).
