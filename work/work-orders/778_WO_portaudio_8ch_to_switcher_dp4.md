# WO-778 — 8 ch PortAudio to the switcher on DP-4: the output pointed at an empty NVIDIA "HDMI 3"

**Area:** audio
**Status: DONE (26.10, config fix applied on the box; ALSA hw:1,3 RUNNING S32_LE 8 ch 48 kHz) — hearing 8 ch through the
switcher = owner QA (PGM was empty after the restart).**

Owner, 26.10:
> im trying to make multichannel audio work. im not sure which output to choose, because in audio the outputs are hdmi
> while in xrandr dp. i send from a switcher edid with custom resolution and audio enabled. but highascg does not
> output this audio. check whats going on. i want this to be a portaudio 8ch output

Parents: [WO-683](./683_WO_single_portaudio_output_and_host_apis.md) (one PortAudio output, host APIs),
[WO-773](./773_WO_portaudio_init_fails_without_pulse_server.md) (PortAudio init without PulseAudio — holding).

## Investigation

- **Which output carries audio.** EDIDs via `xrandr --verbose`: DP-0 (1920×1080) and DP-4 (3840×1792 custom) both
  name "P80", mfg "NOV". Only DP-4's CEA block has audio: basic audio, SAD LPCM 8 ch, SAD DSD 6 ch. DP-0: no audio.
- **Which ALSA device that is.** NVIDIA names every HDA PCM "HDMI n" whatever the connector. Of 16 pins
  (`/proc/asound/card1/eld#0.*`) only `eld#0.4` is valid: `monitor_name P80`, `connection_type DisplayPort`, LPCM 8 ch
  32/44.1/48 kHz. Jack controls: only `HDMI/DP,pcm=3 Jack` = on (ELD control device=3 filled). So **DP-4 = hw:1,3 =
  "HDMI 0"** (the `*` in "HDMI 0 *" marks the connected one in PortAudio's name).
- **What HighAsCG had.** `config/audio_outputs.json` audio_1: PortAudio, `deviceName hw:1,9` ("HDMI 3" — nothing
  connected), `hostApi JACK` (no JACK server on this box by design), 8ch. The running `casparcg.config` matched; the
  Caspar log: `Using PortAudio device: "HDA NVidia: HDMI 3 (hw:1,9)" (ALSA)`, stream started, `portaudio[1|3840x1792|8ch]
  Initialized` — PortAudio itself fine (WO-773 lib holds; JACK fell back to ALSA), it just played into an
  unconnected pin. `/proc/asound/card1/pcm9p` RUNNING, `pcm3p` closed.

## What was done

- `POST /api/settings { audioOutputs }` (the Devices view's own save path) with audio_1 → `deviceName hw:1,3`,
  `hostApi ALSA` (no reliance on the JACK → ALSA fallback); every other field unchanged (8ch, 128 frames, 40 ms, FIFO
  50 ms; audio_2 System Audio untouched). Then `POST /api/caspar-config/apply {force:true}` (Caspar restart).
- Not a code change: config/ is live runtime state (not committed).

## Verified

- Generated `casparcg.config`: `<portaudio>` device `hw:1,3`, host-api `ALSA`, 8 output channels; channel 1
  `discrete-8ch` with `<portaudio/>`.
- Caspar (pid started 14:20:20) log: `Using PortAudio device: "HDA NVidia: HDMI 0 * (hw:1,3)" (ALSA)`, stream started,
  `portaudio[1|3840x1792|8ch] Initialized`. `/proc/asound/card1/pcm3p/sub0`: RUNNING, hw_params S32_LE 8 ch 48000 Hz;
  `pcm9p` closed.
- Not verified: audible signal — PGM had no layers after the restart. Owner QA: take a look with audio to PGM, check
  the switcher's audio meters (stereo clips land on 1/2 of the 8; discrete sources fill 1–8).

## Follow-ups (not done)

- The device list (`/api/audio/portaudio-devices`) could label each NVIDIA "HDMI n" with its ELD (connected monitor
  name, DP/HDMI, max channels) so the operator does not have to map "HDMI" to "DP-x" — the exact confusion reported.
- NVIDIA assigns PCMs to pins dynamically: re-cabling the switcher to another port can move it to another "HDMI n".
