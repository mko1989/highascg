# AMCP Clean Look Fade

This is the working banked look-to-look fade pattern used by HighAsCG for clean program transitions.

## Goal

Prepare the incoming look without touching the layer that is currently visible on program, then crossfade both physical banks with the same transition duration.

For logical look layer `10`, the two physical program banks are:

- Bank A: `10`
- Bank B: `110`

If bank B is currently on program, the next look is prepared on bank A.

## Sequence

Example: channel `1`, current program on `1-110`, incoming look prepared on `1-10`, transition `75` frames.

```text
MIXER 1-10 CLEAR
LOADBG 1-10 "NEW_CLIP"
MIXER 1-10 FILL <x> <y> <scaleX> <scaleY> 0
MIXER 1-10 OPACITY 0 0
MIXER 1 COMMIT

PLAY 1-10
MIXER 1-10 OPACITY 0 0
MIXER 1-10 OPACITY 1 75 linear
MIXER 1 COMMIT

STOP 1-110
MIXER 1-110 CLEAR
MIXER 1 COMMIT
```

## Notes

- Do not send mixer setup to the active program bank. Preparing `MIXER FILL`, `MIXER CLEAR`, or similar commands on the currently visible layer will move or reset the on-air look.
- For banked crossfades, **only the top layer** opacity tweens during the fade window (the bottom layer stays at full opacity so the composite never dips to ~50%):
  - **Incoming on bank B** (`110` above `10`): hide incoming, `PLAY`, fade incoming `0→1`; outgoing stays at full opacity until teardown.
  - **Incoming on bank A** (`10` below `110`): `PLAY` incoming at full opacity underneath, fade outgoing `1→0`; incoming is not pre-hidden or faded in.
- `LOADBG ... MIX ... AUTO` is suitable for native same-layer transitions, but not for this banked crossfade path because the AUTO transition can complete before the prepared bank is visible.
- Teardown of the old bank happens only after the fade window has elapsed.
