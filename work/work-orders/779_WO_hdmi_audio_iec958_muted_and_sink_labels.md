# WO-779 — HDMI/DP audio muted at the card (IEC958 switches off) + Devices audio list names what is plugged in

**Status: DONE (26.10). Verified: IEC958 switches on, hw:1,3 RUNNING 8 ch 48 kHz, labels live over the API, offline
suite and Godot tests green. Owner QA: audio on the P80's meters.**

Owner, 26.10, after WO-778:
> yes, build that. the audio still doesnt reach the p80 switcher

"That" = the WO-778 follow-up: label each NVIDIA "HDMI n" with what is connected to it.

Parent: [WO-778](./778_WO_portaudio_8ch_to_switcher_dp4.md) (output moved to the switcher's PCM hw:1,3).

## Investigation

- **Caspar mixed audio correctly.** Test tones on PGM layer 1-200 (scratch media `_audiotest/`, since deleted) were
  tested: mono, stereo and 8-ch. The channel's audio levels showed mono → 1, stereo → 1+2, 8 ch → 1..8. The look on air
  carries a mono LTC wav (layout unknown), routed to output 3 at -6 dBFS. `INTRO_v3.mov` is NotchLC with no audio track.
  `pcm3p/sub0` was RUNNING (S32_LE, 8 ch, 48 kHz), so PortAudio was writing samples to the right PCM.
- **The card muted them.** `amixer -c 1 controls` lists `IEC958 Playback Switch` numid 5/11/17/23, one per NVIDIA
  PCM. All four read `off`. HDA HDMI codecs come up with these off. On a desktop PulseAudio/PipeWire turns them on when
  it opens the sink. This box runs neither (Caspar owns ALSA), so nothing ever turned them on.
  `alsa-restore.service` restores `/var/lib/alsa/asound.state`, which was saved at 06:19 with the switches off. That
  reproduces the mute on every boot.
- **The label confusion.** The NVIDIA PCMs are named "HDMI 0..3" even on DisplayPort, and they bind to pins
  dynamically. The data that identifies the sink is per PCM:
  - The `ELD` control (`iface=PCM,name='ELD',device=N`) holds bytes with the monitor name, HDMI/DP and SADs.
    For hw:1,3 it reads `P80`, DisplayPort, LPCM 8 ch and DSD 6 ch; empty PCMs have 0 bytes.
  - `HDMI/DP,pcm=N Jack` is on only for pcm 3.
  - ELD bytes 16..19 equal EDID bytes 8..11 (manufacturer `NOV` plus product `0xe45e`). That is how a PCM maps to an
    xrandr output.
  - DP-0 and DP-4 both carry the same "P80" EDID. Only DP-4's CEA block declares audio, which is what separates them.
  - The sysfs DRM names on NVIDIA (card1-DP-1/DP-3) differ from xrandr's names (DP-0/DP-4). Matching therefore uses
    the xrandr-verbose rows only.

## What was done

- **Unmute, now:** `amixer -c 1 cset numid=5/11/17/23 on`.
- **Unmute, every Caspar launch:** `tools/runtime/unmute-hdmi-audio.sh` turns on every `IEC958 Playback Switch` on
  cards whose `/proc/asound/cards` line says NVidia/HDMI; onboard S/PDIF is left untouched. It is best-effort and prints
  one summary line. `run.sh` `run_caspar()` calls it before Caspar starts and logs the line through
  `caspar_supervisor_log`. It runs per launch, not once at install, because alsa-restore can bring the "off" state back
  on any boot. `alsactl store` would need sudo, which this box doesn't allow without a prompt.
- **Labels:** new module `src/audio/hdmi-sinks.js`:
  - It runs one `amixer -c C contents` per HDMI card.
  - `parseAmixerContents` reads the jack state and ELD bytes per device, and `parseEld` (HDA ELD v2 baseline) decodes
    the ELD.
  - `matchConnectors` picks the xrandr outputs whose EDID has the same manufacturer and product and declares CEA audio
    (`edidHasAudio`). It uses the cached `probeGpuEdidCatalog`.
  - `annotateHdmiSinks` adds `label` and `sink` to the HDMI entries. A connected sink's LPCM channel count replaces
    the placeholder 16 in `maxOutputChannels`, so the layout options cap at 8.
  - `id` and `name` are unchanged, because they are what gets saved and what Caspar matches.

  `listPortAudioDevices` calls it on every list. That covers `/api/audio/portaudio-devices`, the device-view snapshot
  `live.audio.portaudio` and the system inventory.
- **Clients:** web `device-view-inspector-audio.js` and Godot `vcam_audio_model.gd` show `label` when it is present,
  in place of name, channel count and description.

## Verified

- On the box, `/api/audio/portaudio-devices?refresh=1&outputsOnly=false` after a node restart returns:
  - `hw:1,3` → `HDMI 0 → DP-4 · P80 (DisplayPort, 8 ch)`, maxOutputChannels 8.
  - `hw:1,7/8/9` → `HDMI n — nothing connected`.

  `/api/device-view` `live.audio.portaudio` carries the same labels.
- IEC958 numid 5/11/17/23 all read `on`. `pcm3p` is RUNNING, S32_LE, 8 ch, 48000 Hz.
- The helper was tested from the shell: it turned on the unused numid 23 and printed `cards: 1 — 4 IEC958 switch(es) on`.
  The `run.sh` hook runs on the next service start; the running supervisor still holds the old file.
- `tools/smoke/smoke-wo779-hdmi-sinks.test.js` passes 5/5 with fixtures taken from the box: the ELD bytes, the amixer
  layout, and DP-0/DP-4 plus a sysfs alias. The offline suite passes 3370, fails 0. Godot `run_tests.gd`: 21865 passed;
  `run-client.sh --check` reports boot OK. `npm run build:client` succeeded.
- Not verified: sound on the switcher. Owner QA is to check the P80's audio meters. Channel 3 should show the LTC; the
  intro clip has no audio.
