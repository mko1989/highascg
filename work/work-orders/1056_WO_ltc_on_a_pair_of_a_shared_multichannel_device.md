# WO-1056 — LTC out on its own channel pair of a multichannel interface that also carries program audio

**Area:** audio
**Status: OPEN (13.11 — owner want recorded; stereo case done by configuration, see below)**

Owner, 13.11: *"i want to seperate the ltc from audio, when working in stereo (when working in multichannel id like to
seperate the ltc to a specific pair. but in this setup i want the ltc to take over the playback on the scarlet"*.

## Investigation

- **Stereo case (done 13.11, configuration only).** LTC out has its own ALSA device (WO-974 `src/timecode/ltc-output.js`,
  `aplay -D <device>`), separate from Caspar's audio outputs (`config/audio_outputs.json`: audio_1 PCH `hw:0,0` portaudio,
  audio_2 `hw:2,0` monitor). Set through `POST /api/ltc/config`:
  `output.device = plughw:CARD=USB,DEV=0` (Scarlett Solo), channels 2, channel 1.
  - Persisted in `config/general.json`.
  - Live: `aplay -q -D plughw:CARD=USB,DEV=0 … -c 2` running, `/proc/asound/card4/stream0` Playback Running.
  - The Scarlett's playback now belongs to LTC: output 1 carries LTC, output 2 is silent.
  - With source `timeline`, LTC only runs while a timeline plays; a stopped encoder sends silence.
- **Multichannel case (open).** `aplay` opens the whole device. One interface cannot be shared that way by Caspar's audio
  consumer (portaudio / system-audio on the same `hw:`) and LTC's `aplay`: the second open fails with EBUSY.

## Proposed design (not built)

- ALSA **`dshare`** on the interface: two PCMs over one `hw:` slave, defined in the managed `~/.asoundrc` block that
  `src/audio/audio-devices.js` already owns (WO-845 `mergeAsoundrcBlock`).
  - `hcg_prog_<card>`: bindings = the program channels.
  - `hcg_ltc_<card>`: bindings = the LTC pair.
  - Caspar's audio output uses the program PCM and LTC's `aplay` uses the LTC PCM.
  - Both run at the slave's fixed rate and format (48 kHz, the interface's sample format); `plug` converts in front.
- Settings ▸ LTC ▸ Output: "Share the device with program audio" + "LTC pair" (e.g. 7/8). Audio outputs: the same device shows
  its remaining channels.
- To decide with the owner: LTC on **both** channels of the pair, or on one channel of the pair with the other silent.
- Alternative considered: mixing LTC into a Caspar channel's audio (an audio-only layer routed to that pair). Rejected for
  now: it would put LTC under Caspar's mixer and volume, and a Caspar restart would cut timecode.

## What was done

Nothing for the multichannel case yet. Stereo: the configuration above.

## What was verified

Stereo: `GET /api/ltc` config shows the Scarlett device, `aplay` is on the Scarlett, and its playback stream is Running.
