# WO-801 — PRV audio: monitor individual pairs on headphones (not only the mix-down)

**Status: OPEN (29.10) — design needed; the owner's monitor setup is the test**

Owner, 29.10:
> prv channel is always 2audio ch due to either possibility of only one multi audio channel or to make it cheaper. but now when previewing a look with multi audio ch i get a mix down and no way to prv via monitor headphones individual audio pairs.

## Problem

- The PRV channel is built with **2 audio channels** (stereo). A look that carries several stereo pairs
  (for example 8 ch = four pairs: 1+2, 3+4, 5+6, 7+8) is folded to one stereo mix on PRV.
- The owner cannot audition a single pair on the headphones before taking it.
- The source is there: PGM is the full multi-channel channel; the look's layers carry the pairs.

## Investigation to do (agent to fill, file:line)

- Where PRV is built: the PRV channel's `audio` channel count and its consumer (search `prv` /
  `preview` in `src/` and `caspar/` config generation).
- Monitor output path: how the headphone output is chosen today (`config/audio_outputs.json`,
  `config/audio_routing.json`, `src/` monitor / ALSA device code) and whether a PortAudio consumer
  can take a pair selection.
- WO-683 (one PortAudio output next to Enhanced OAL): Caspar's PortAudio is global, so only one PortAudio
  output works. Headphones and the switcher share that constraint — the design must not add a second PortAudio
  consumer.
- WO-249 (`AUDIO-PAIR-PGM2`): the streaming/record bus already has a "Source-audio-pair" dropdown with an
  ffmpeg `pan=` — reuse the same pair concept.

## Options

**A — Monitor pair select on the PRV channel (preferred if the channel can carry 8 ch).**
- PRV carries the full channel audio; the monitor consumer gets a pair selector (1+2, 3+4, …) that
  picks which pair goes to the headphone device.
- Cost: PRV channel count changes (the owner chose 2 ch to save cost) — CPU/decoder cost to measure.

**B — Route-based pair monitor (keeps PRV at 2 ch).**
- A separate monitor channel `route://` from the look's layers, one per pair the owner selects; only the
  selected pair is routed to the headphone output. Costs one extra channel while monitoring.

Pick A if the cost check is fine, else B.

## Acceptance

- Previewing a look with 8 ch audio: the owner can choose pair 3+4 and hear only that pair on headphones.
- PRV tile and program outputs unchanged; no second PortAudio consumer; WO-683 invariant holds.
- Verify on the box with the monitor headphones (owner QA) and with a probe of the monitor device's levels.

## Owner decisions needed

1. Is PRV at 8 ch acceptable (cost) — or route-based B?
2. Which device is the headphone monitor (ALSA hw name)?

## Verified

_(none yet)_
