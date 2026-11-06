# WO-976 — A Caspar channel / screen destination (e.g. Dioda PGM) as the audio-reactive FFT source

**Area:** audio, engine, godot-client
**Status: OPEN**

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
— (open)

## 4. What was VERIFIED
— only the feasibility probe in §1.
