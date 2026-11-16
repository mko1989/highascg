# HighAsCG takes the fronts under a fader — ChamSys MagicQ

HighAsCG sends the fronts' **final** pan, tilt and dimmer to the desk on a universe the show does not use. Final
means after everything HighAsCG does: tracking, the head calibration (offsets, pins, the calibrated pose), the
3-head spot handover and Auto follow. MagicQ merges that universe into the fronts' channels, and one playback fader
becomes "HighAsCG has the fronts". The desk stays the only thing talking to the rig.

For grandMA3, see [the grandMA3 page](desk-feed-grandma3.md). To send markers instead and let the desk aim, see
[PSN output](psn-output.md).

> Tested on this box with MagicQ PC 1.9.8.3 (demo mode) and the Hilton Wawer rig: 8 × ADJ Focus Profile, 40
> channels, universe 1 (Art-Net 0). Numbers below are from that test.

## What the LD needs from you

- The **feed universe**: a universe number the show does not output (default **200**).
- The **channel table**: Follow → Output → **Copy channel table (CSV)**. It lists, per head, the real patch
  address and the feed address of pan, pan fine, tilt, tilt fine, dimmer and dimmer fine, with the bit depth and
  the pan / tilt range and invert.
- With the **Mirror** layout every channel keeps its number: Focus Profile 1 at 1.001 has pan on feed 200.1, pan fine
  200.2, tilt 200.3, tilt fine 200.4, dimmer 200.15, dimmer fine 200.16. Everything else in the feed is 0.

| Head | Pan / fine | Tilt / fine | Dimmer / fine | Range |
|---|---|---|---|---|
| Focus Profile 1 (1.001) | 200.1 / 200.2 | 200.3 / 200.4 | 200.15 / 200.16 | pan 540° · tilt 270° inverted |
| Focus Profile 2 (1.041) | 200.41 / 200.42 | 200.43 / 200.44 | 200.55 / 200.56 | same |

A rig with fronts on several universes gets one feed universe each: 200, 201, … in rig order.

## In HighAsCG

1. **Previs → Camera → Follow → Output**: tick **Send the fronts to the lighting desk**.
2. **Feed protocol**: Art-Net. **Feed universe**: 200 (or what the LD chose). **Desk address**: the desk's IP. A
   broadcast is refused.
3. **Layout**: Mirror.
4. The fronts follow a marker or **Auto** as usual (spot handover or Split).
5. The status line under it must say **Live: 8 heads · U200 → desk ip:6454 …**. Anything else says why it does
   not send: the universe is a rig output, the levels or grant universe, or it would loop into this box.

The feed has its own switch. It needs neither **Output** nor the **DMX master**: this box never talks to the rig.

## On MagicQ

1. **Setup → View DMX I/O**. On the universe the fronts are patched on (here Uni 1, Out uni Art 0):
   - **In type** = Art-Net (double-click the cell, pick it);
   - **In uni** = 200 (MagicQ shows it as *Art 200 (12-8)*).
   Page right: **In last rx** must keep resetting to a fraction of a second.
2. **Patch → View Chans**. For every front head:
   - **Pan, Pan F, Tilt, Tilt F**: Merge = **Over**. MagicQ fills **From** with the same channel.
   - **Dimmer, Dimmer F**: Merge = **Mul-In**.
   Double-click the Merge cell and pick from the list. Pressing ENTER in that column sets **Copy**, which is wrong
   here.
   The **Input** column now shows the feed, next to **Output**.
3. Record the take-over playback: select the front heads, set **Intensity 100 %**, nothing else, and record it to a
   playback (here PB1). That fader is **HighAsCG has the fronts**.

## Check it works

1. Start a person (or the test puppet) and Auto follow.
2. In Patch → View Chans, **Output** of Pan / Tilt equals **Input**, byte for byte, at any fader position.
3. Bring the take-over fader up: the fronts light where HighAsCG lights them.

## Fader behaviour (measured)

| Take-over fader | Front dimmers out (HighAsCG at full) | Pan / tilt |
|---|---|---|
| 0 % | 0 | HighAsCG's, moving in the dark |
| 49 % | 125 | HighAsCG's |
| 100 % | 254 (of 255) | HighAsCG's |

- The fader is a **proportional crossfade of intensity**, not a snap. Pan / tilt are HighAsCG's at every fader
  level, so the heads are already on their person when the fader comes up: **dimmer first**, no visible swing.
- HighAsCG's own take-overs between heads (the spot handover fade, 1 s) pass through: about 33 in-between values
  per take-over at MagicQ's output rate.
- **The desk can take position back**: a MagicQ programmer or playback that sets the fronts' pan / tilt wins
  (Over). Measured: LOCATE in the programmer put all 8 at 128 / 128; CLEAR gave them back to HighAsCG. A
  playback with the fronts' position does the same. Whether it fades or snaps follows that cue's times (not
  measured).
- Mul-In multiplies each byte on its own, so the 16-bit dimmer is a little coarse below full (under one 8-bit step).

## Fail-safe

- **MagicQ holds the last input when the feed stops.** Measured: feed off → MagicQ's output did not change for
  12 s, lit fronts stayed lit where they were. The manual documents no input timeout (not confirmed).
- So the LD's **take-over fader is the fail-safe**: pulled down, the fronts go dark at once, with or without the feed
  (measured).
- HighAsCG itself never snaps a head to 0 / 0: a head that stops being fed holds its last aim, dimmer 0.

## Troubleshooting

- **In last rx never resets**: the feed is not arriving. Check the desk address on the HighAsCG status line, the
  network, and In uni. With MagicQ on the same computer as HighAsCG, send to the computer's network address: in
  the test, packets to 127.0.0.1 were not taken as input, the LAN address was.
- **Merge shows Copy**: ENTER cycles the cell. Double-click it and pick Over / Mul-In.
- **Fronts dark with the fader up**: HighAsCG has them dark (nobody there, resting head). Check Follow.
- **The desk cannot light the fronts on its own**: with Mul-In, MagicQ's intensity is multiplied by HighAsCG's
  dimmer. For a desk-only scene, set the fronts' Dimmer Merge back to **Norm** (keep a show file for each), or
  use the alternative below.
- **Positions jump when a desk cue runs**: that cue holds the fronts' pan / tilt and beats the feed (Over). Leave
  the fronts' position out of cues that run while HighAsCG has them.

## Other ways on MagicQ

- **DMX In Tracker** (ChamSys' own route, not tested): Setup → View Settings → Network → **Tracker Rx = DMX
  Input**; a position palette set as tracker (**SET TRACKER**, *DMX In Tracker*) with pan / tilt at 0 % (128). While
  that palette is active in a playback, MagicQ takes pan / tilt from the input at the same channel numbers —
  exactly the Mirror layout — and crossfades by the cue's fade times. It needs a MagicQ console or MagicQ PC with
  ChamSys hardware: on this box it showed **[Locked]**. The manual names only pan and tilt (16-bit and dimmer not
  confirmed).
- **Grant fader**: a desk channel sent back to HighAsCG scales the feed's dimmers (Follow → Spot handover →
  Grant). Shown on the [grandMA3 page](desk-feed-grandma3.md); it works with any desk.
- **Merge** (HTP) instead of Over: the highest of desk and feed wins. Pan / tilt then need 0 on the desk whenever
  HighAsCG should have them (MagicQ's own warning).

## Limits

- Only pan, tilt and dimmer. Colour, zoom, gobo, shutter stay the desk's.
- MagicQ PC without ChamSys hardware works for this (the Patch merge is not locked).
- The feed is Art-Net or sACN. With sACN MagicQ takes the highest-priority source and alternates between
  equal ones, so give the feed its own universe.

## Sources

- MagicQ manual 1.9.8.x, *Settings › Input Universes, Testing Output Universes, Using sACN*:
  https://docs.chamsys.co.uk/magicq/1.9.8.x/manual/settings.html
- *Patching › Merging with DMX Input* (Input, Over, Merge, Mult, Mul-In, Copy):
  https://docs.chamsys.co.uk/magicq/1.9.8.x/manual/patching.html
- *Trackers › DMX Input Tracking, Tracker Palettes*: https://docs.chamsys.co.uk/magicq/1.9.8.x/manual/trackers.html
