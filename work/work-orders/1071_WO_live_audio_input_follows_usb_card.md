# WO-1071 — Live audio input dead after the USB interface re-enumerated; could not be restarted without Caspar

**Area:** audio
**Status: DONE (13.11.26 — input running again on the box; a killed capture restarted by the watchdog in 15 s; the card-renumber path proven offline only)**

Owner, 13.11: *"my scarlet was failing due to failed usb connections and i cant seem to restart its input (at least
without restarting caspar)"*

## Investigation

1. **The USB side.** `journalctl -k`: the Scarlett Solo (usb 1-13, 1235:8211) disconnected at 15:18:11 and five times
   between 20:53:47 and 20:54:08, with `device not accepting address … error -71`, `device descriptor read/64, error -71`
   and `unable to enumerate USB device`. -71 is EPROTO: the bus itself (cable, port, power), not software.
2. **The card number moved.** After the drops `/proc/asound/cards` has the Scarlett as card **3** and the Radial USB
   Pro as card **4**. The slot is stored by index: `config/caspar_server.json live_audio_input_1_device =
   "alsa://hw:4,0"` (`audio-devices.js:435` notes the Scarlett was card 4 earlier the same day). So every restart of
   the input opened the Radial, which has no capture: `[live-audio-bridge] slot 1: cannot open audio device hw:4,0
   (No such file or directory)` → `ffmpeg exited 251` → `all_variants_failed` (journal 16:10:51, the last server start).
   Restarting Caspar does not help by itself either — it only "worked" when the cards happened to enumerate in the old
   order.
3. **Nothing retried.** From 16:10:53 to 21:00 the journal has no live-audio line at all. The watchdog
   (`meter-health.js`, every 15 s → `live-audio-health.js ensureLiveAudioInputsHealthy`) repairs a slot only when its
   channel's OSC meters are stale (WO-164). The meter null consumer keeps channel 8 ticking with silence, so the meters
   were fresh and the dead capture ffmpeg (`live-audio-bridge.js`) was never looked at.
4. Side effect: the audio FFT source is "live-audio slot 1 bridge tee", so the audio-reactive visuals had no audio for
   the same time.

## What was done

- `src/audio/live-audio-card-follow.js` (new):
  - a slot remembers its card's ALSA id (`live_audio_input_<n>_card`, here "USB") — written by
    `POST /api/audio/live-inputs/config` when the device comes in the body (`rememberPicked`), and by the first
    successful start of a config from before this WO (`rememberRunningCard`);
  - `followCards(ctx)`: the remembered id sits at another index → the stored device is rewritten (`hw:4,0` → `hw:3,0`),
    saved and logged, so the pickers show the right card too;
  - `capturePresent(ctx, slot)`: the card is gone, or the index now belongs to another card, or it has no capture PCM
    → not present, with the reason.
- `src/audio/live-audio-health.js`: the watchdog follows the cards first; a slot whose device is not present is
  waited for (one warn line per reason, no CLEAR / PLAY every 15 s); a slot whose capture process is dead
  (`live-audio-bridge.js isLiveAudioBridgeAlive`) is repaired although its meters are fresh, and so is one whose
  device just came back or moved.
- Why the card id and not `hw:CARD=USB,DEV=0` in the stored device: every reader of the device (`parseAlsaHwIdentity`
  conflict checks, the pickers' selection, the FFT source) matches `hw:N,M`.

## Verified

- Offline suite 6218 pass / 0 fail; new `tools/smoke/smoke-wo1071-live-audio-follows-card.test.js` (6): the cards
  parse, a picked device remembers its card, a moved card rewrites and saves the device, an unplugged one keeps its
  index and is "not connected", a playback-only card at the stored index is absent with what to do.
- On the box, after a server restart with the fix: `[live-audio] slot 1: hw:4,0 (Radial USB Pro) has no capture —
  pick the input's device again — waiting for it` (once). Then `POST /api/audio/live-inputs/config
  {"live_audio_input_1_device":"hw:3,0"}` → stored with `live_audio_input_1_card: "USB"`; `…/apply` →
  `playSucceeded: 1`, `[live-audio] slot 1 capture running on 8-10`. No Caspar restart.
- Watchdog: the capture ffmpeg killed at 21:04:18 → `[live-audio-health] slot 1: capture is not running → restarting
  it on ch8-10` at 21:04:33 → running at 21:04:35.
- **Not proven on hardware:** the renumber itself (it needs the interface to drop and come back at another index;
  no sudo to unbind the USB device). The USB fault is physical and still there.
