# WO-683 — One PortAudio output next to Enhanced OAL: enforce the single device, Linux host APIs, keep cabled OAL

**Area:** audio
**Status: DONE (22.10, offline smoke 6/0 + Godot 21044/0 + `--check`; box: generator dry run on the live config, node restarted clean, Godot GUI relaunched). Owner QA: a real PortAudio output on a device with a signal (checklist below).**

Owner, 22.10 (after the WO-613 OAL question): *"I'd like to add to the current enhanced oal, an additional single
portaudio output to be able to be configured."* Then: *"Yes fix both gaps."*

## Investigation (22.10)

The configuration path already exists: Devices → Audio output → Type "PortAudio (multi-ch)" (Godot
`vcam_audio_model.gd`, web `device-view-inspector-audio.js`) → `applyAudioOutputOverridesToScreens`
(`src/config/build-caspar-generator-config-audio.js`) → root `<portaudio>` + a `<portaudio/>` consumer on the cabled
channel. The box enumerates `hw:0,0` (ALC1220) and NVIDIA HDMI/DP `hw:1,3/7/8/9` (`/api/audio/portaudio-devices`).
Three gaps:

1. **A second PortAudio output is accepted and silently breaks.** The v2 build's PortAudio consumer
   (`~/caspar-build/src-v2/src/modules/portaudio/consumer/portaudio_consumer.cpp:631-640`) reads only the global
   `configuration.portaudio.*`. The factories ignore the per-consumer ptree (`:997-1015`). With two PortAudio
   outputs, `countPortAudioConsumers === 1` (WO-488) is false, so no root block is written and every consumer opens
   the default device in stereo. Nothing tells the operator. New audio rows have no `type`, and the server reads a
   missing type as `portaudio`, so the second "Add audio output" already makes the conflict.
2. **The host API list is wrong for this platform.** Both clients offer Auto / ASIO / ALSA / CoreAudio / WASAPI.
   `resolve_host_api_type` (`portaudio_consumer.cpp:145-171`) on Linux knows ALSA and JACK; ASIO/WASAPI are Windows
   and CoreAudio is not handled at all (warning, falls back to ALSA). JACK is missing from the list.
3. **OAL and PortAudio cannot share a destination.** `reconcileCustomLivePortAudioVsOpenAl`
   (`build-caspar-generator-config-audio.js`, from the July sweep d0a6c73e, no WO) sets
   `screen_N_system_audio_enabled = false` on any channel with a PortAudio consumer. Its comment's aim is the
   *unrequested* OAL sink fighting PortAudio. It also kills an OAL output the operator cabled to that destination on
   purpose, which is exactly the owner's "Enhanced OAL + one PortAudio" setup.

## Plan

- `src/config/portaudio-output.js` (new, shared by the server paths):
  - `portAudioOutputId(audioOutputs)` → the first enabled row whose type is PortAudio (missing type = PortAudio,
    as everywhere else); the only one that may become a Caspar consumer.
  - `normalizeHostApi(v)` → `auto | ALSA | JACK`, anything else → `auto`.
- Generator: other PortAudio rows are skipped. Explicitly cabled OAL is marked (`*_system_audio_cabled`) and
  `reconcileCustomLivePortAudioVsOpenAl` leaves it on.
- Bus-width mirrors follow the same "only the PortAudio output" rule: server `program-audio-layouts.js`,
  `routes-streaming-channel-shared.js`, web `client/lib/program-audio-layouts.js`, Godot `audio_rows.gd`.
- `settings-post.js`: `hostApi` normalised on save.
- Clients (Godot + web):
  - The type select offers PortAudio only on the PortAudio output, or when no other row has it.
  - A row saved as PortAudio that is not the PortAudio output shows a warning that it is skipped.
  - A new audio row is created as System Audio once a PortAudio output exists.
  - Host API: Auto (ALSA, then JACK) / ALSA / JACK.

Found while verifying: **`buildConfigXml` runs `mergeAudioRoutingIntoConfig` a second time** (`config-generator.js:36`),
after the cable pass. Its old rule "PortAudio (PR #1720) replaces OpenAL program output" (`config-generator-audio-routing.js:89`)
then switched the cabled OAL off again, so fixing only the reconcile was not enough. The box dry run caught it: the flags
said OAL on, the XML had no `<system-audio>`.

## What was done (22.10)

- `src/config/portaudio-output.js` (new): `portAudioOutputId`, `isPortAudioRow`, `normalizeHostApi`, `PORTAUDIO_HOST_APIS`.
- `src/config/build-caspar-generator-config-audio.js`:
  - only `portAudioOutputId` becomes a PortAudio consumer;
  - `hostApi` goes through `normalizeHostApi`;
  - a cabled OAL output sets `<prefix>system_audio_cabled`, and `reconcileCustomLivePortAudioVsOpenAl` leaves it on.
- `src/config/config-generator-audio-routing.js`: the second-merge "PortAudio replaces OpenAL" rule skips a cabled OAL.
- Bus-width mirrors skip the other PortAudio rows:
  - server: `src/config/program-audio-layouts.js`, `src/api/routes-streaming-channel-shared.js`;
  - web: `client/lib/program-audio-layouts.js` (+ exported `portAudioOutputId`);
  - Godot: `godot/client/features/audio/audio_rows.gd`.
- `src/api/settings-post.js`: `hostApi` normalised on save.
- Web: `client/components/device-view-inspector-audio.js`, `client/components/device-view-bands-render.js`.
- Godot: `godot/client/features/devices/vcam_audio_model.gd`, `output_ports_model.gd` (`portaudio_output_id`).
- In both clients:
  - the type select offers PortAudio only when this row is the PortAudio output, or no other row has it;
  - a row saved as PortAudio that lost out shows "⚠ … skipped on Apply";
  - "Add audio output" creates a System Audio row once a PortAudio output exists;
  - host APIs: Auto (ALSA, then JACK) / ALSA / JACK. Older saved ASIO / CoreAudio / WASAPI show and save as Auto.
- Why first-row-wins over refusing the save: rejecting a second PortAudio row in `/api/settings` would make every later
  audio save fail on a box that already has two. Skipping is deterministic, and the clients say which row is skipped.
- Goldens: `devices_output_ports.json` host-API option lists; `audio_mixer.json` busCount case 9 (8 → 4). That
  number was recomputed by running the web `programBusChannelCountForChannel` under Node, not edited by hand.
  `a1` (no type = PortAudio) is the PortAudio output; `a3` (`"PortAudio"`, 8ch) is skipped.

## What was VERIFIED (22.10)

- `tools/smoke/smoke-wo683-single-portaudio.test.js` 6/0 (added to the curated CI list):
  - first-row rule;
  - second output = no consumer and no bus widening;
  - cabled OAL kept, uncabled OAL still off;
  - host-API normalisation;
  - end to end through `buildConfigXml`.
- `test:ci`: 2811 pass, 1 fail. The failure is `smoke-wo308-pointer-confine-split.test.js:34`, which probes the box's live
  displays (operator monitor on port 3) and fails on the box only; CI on HEAD is green and the code is untouched.
- Lint 0 errors; no file over 500 lines; `build:client` OK.
- Godot `--test` 21044/0 (+10 in `test_single_portaudio`); `--check` boot OK.
- Box dry run (`ConfigManager` on `config/` + `buildCasparGeneratorFlatConfig` + `buildConfigXml`, nothing written; the
  config md5 was the same before and after). Setup: HDMI 0 `hw:1,3` 8ch (hostApi ASIO), onboard `hw:0,0` 16ch, OAL, all
  cabled to PGM 1. Result:
  - root `<portaudio>`: `hw:1,3`, `host-api auto`, 8 output channels;
  - channel 1 `discrete-8ch` with `<system-audio />` + `<portaudio/>`;
  - no `hw:0,0` anywhere.
- Box: node restarted (new pid up, no journal errors); Godot GUI relaunched.

## Owner QA

- Devices → add an Audio output → PortAudio, HDMI 0 (`hw:1,3`) or a USB interface, 8ch → cable PGM 1 → add a second
  output (it comes up as System Audio, PortAudio not offered) → cable PGM 1 → Apply + Caspar restart → signal on both.
- NVIDIA HDMI/DP carries more than 2 channels only when the monitor or receiver accepts them. The device list's "16ch"
  is a placeholder (naudiodon not installed, so the list comes from `aplay`).
