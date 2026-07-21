# WO-310 — One unit on the volume wire (kill the dB/linear double-send)

**Status: OPEN** (documented residue of f343e5e)

## Context — observed on the live box
Every fader/mute action sends TWO MIXER VOLUME commands ~20ms apart to the same target:
audio-mixer-volume-api.js first fires AMCP `MIXER ch-l VOLUME <dB>` via postAmcpPreviewPipeline
(comment claims "Layer VOLUME uses dB on this stack"), then mirrors REST /api/audio/volume with
LINEAR volume. Caspar log 2026-07-21 13:31-13:32: `VOLUME -60` then `VOLUME 0`;
`VOLUME -0.1198` then `VOLUME 0.9862` (same gain, two units). The take pipeline uses LINEAR
(scene-take-pgm-only.js `MIXER ${cl} VOLUME ${vol}`), and last-write-wins means linear is what
sticks — the dB command is at best a no-op, at worst an audible glitch frame and a false trail
in the caspar log. The f343e5e fanout only rides the REST/linear path.

## Task
- Establish the truth: what does THIS caspar build accept for MIXER VOLUME (linear coefficient)?
  Verify once via AMCP (set 0.5, read back) and write it down in amcp-mixer.js.
- Delete the dB variant: buildAudioVolumeAmcpCommands emits linear only (or drop the direct AMCP
  send entirely and let the REST path be the single writer — it already carries the fanout).
- volumeApiPayload keeps volumeDb for DISPLAY only; nothing on the wire in dB.

## Acceptance
- One MIXER VOLUME line per fader settle in the caspar log, linear value.
- Mute→unmute round-trips to the exact prior gain; fanout still fires (existing smoke).
