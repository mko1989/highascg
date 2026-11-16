# HighAsCG takes the fronts under a fader — grandMA3

> **Not tested on a console.** Written from MA Lighting's grandMA3 2.5 help and tested only on the HighAsCG side.
> Every step marked *not confirmed* must be checked on the desk before a show.

HighAsCG sends the fronts' **final** pan, tilt and dimmer to the desk on a universe the show does not use. Final
means after everything HighAsCG does: tracking, the head calibration, the 3-head spot handover and Auto follow.
grandMA3 merges that universe into the fronts' universe, and one executor fader becomes "HighAsCG has the fronts".
The desk stays the only thing talking to the rig.

For MagicQ (tested), see [the MagicQ page](desk-feed-magicq.md). To send markers instead, see
[PSN output](psn-output.md).

## How it works on grandMA3

grandMA3 has no per-channel merge like MagicQ's. It merges a whole input universe into a local universe, with a
**Merge Mode** (Off, Prio, HTP, LowTP) and an **Input Priority** (Super, Prog, Highest, High, LTP, Low, Lowest).
A playback at a higher priority beats the input. So the fader cannot switch the merge. Instead:

- the feed is merged at a **low** priority, so HighAsCG has the fronts' pan / tilt / dimmer whenever no running
  cue holds them;
- the take-over fader is a **grant channel**: one desk channel sent back to HighAsCG. HighAsCG scales the fronts'
  dimmers in the feed by it. Fader down = HighAsCG sends them dark.

## What the LD needs from you

- The **feed universe** (default **200**) and the **channel table**: Follow → Output → **Copy channel table (CSV)**.
  The Mirror layout keeps every channel number: Focus Profile 1 at 1.001 has pan on 200.1 / 200.2, tilt 200.3 /
  200.4, dimmer 200.15 / 200.16. The other channels of the feed are 0.
- The **grant**: a universe and address the desk sends to this box (Art-Net), e.g. universe 50, address 512.

## In HighAsCG

1. **Follow → Output**: tick **Send the fronts to the lighting desk**. Art-Net, universe 200, **Desk address** = the
   desk's IP. Layout **Mirror**.
2. **Follow → Spot handover → Grant**: tick **LD grant channel**, set the grant universe and address. The
   take-over fade there (**Take-over fade s**) also smooths the grant.
3. The feed status line must say **Live: …**, the handover line **grant: live** once the desk sends.

## On grandMA3

1. **Menu → DMX Protocols → Art-Net**, **Enable Input**. Add a row:
   - **Mode** = Input;
   - **Universe** = the feed universe (200);
   - **Local Universe** = the fronts' universe;
   - **Merge Mode** = Prio, **Input Priority** = Lowest.
   For sACN use Mode **Input Unicast** or **Input Multicast**. grandMA3 ignores the packet priority and uses
   Input Priority instead.
2. Check **Menu → Patch → DMX Universes**: the fronts' universe shows **P** and the orange **Art-Net In**.
3. Patch a 1-channel **Dimmer** fixture called *HighAsCG grant* at the grant address on its own universe. Output
   that universe as Art-Net to this box (**Mode** Unicast, **Destination IP** = this box). *Not confirmed:*
   whether MA's Art-Net universe numbers match HighAsCG's port-address numbers one to one — watch the grant
   status line while you move the fader.
4. Store a cue with the grant dimmer at **100 %** on an executor. Its fader is the take-over.
5. Keep the fronts' pan / tilt / dimmer out of cues that run while HighAsCG has them. Their other attributes
   (shutter, colour, zoom) belong in a cue that runs: see the warning below.

## Fader behaviour (expected, not confirmed)

| Take-over fader | Front dimmers | Pan / tilt |
|---|---|---|
| 0 % | 0 (HighAsCG sends them dark) | HighAsCG's, moving in the dark |
| 50 % | half of HighAsCG's | HighAsCG's |
| 100 % | HighAsCG's | HighAsCG's |

- A crossfade, not a snap: HighAsCG follows the grant within the take-over fade time.
- Dimmer first: the heads are already on their person when the fader comes up.
- A cue at normal (LTP) priority that holds the fronts' position or intensity wins over the feed (MA: a higher
  priority overrides the input). That is how the desk takes them back.

## Fail-safe

- If the desk stops sending the grant, HighAsCG keeps its last value for about 7.5 s, then fades the fed dimmers
  to 0 over the take-over fade time (tested in HighAsCG).
- If HighAsCG stops sending, grandMA3's behaviour is **not documented** (hold or drop, not confirmed). Pull the
  fronts' intensity in a cue at a higher priority, or check what your version does with the feed stopped.

## Warning: the whole universe is merged

The input covers all 512 channels of the local universe. Channels the feed does not carry arrive as 0. *Not
confirmed:* whether a Lowest-priority input of 0 overrides fixture default values (for example shutter open) on
channels no cue holds. If it does, a front with shutter at 0 stays dark. Safe setups:
- the fronts' other attributes in a cue that runs while HighAsCG has them;
- other fixtures not on the fronts' universe, or held by cues.

## Troubleshooting

- **No "Art-Net In" on the universe**: Enable Input is off, the row is not Mode Input, or the feed goes to the
  wrong IP. The HighAsCG status line shows where it sends.
- **Fronts ignore the feed**: a running cue holds them (higher priority), or Merge Mode is Off.
- **Fronts dark with the fader up**: grant not arriving (handover line says *grant: lost*), or HighAsCG has them
  dark (nobody there).
- **Other fixtures misbehave**: see the warning above.

## Limits

- Only pan, tilt and dimmer.
- Executor control of Merge Mode is not documented. A macro using `Set` on the universe might work; not
  confirmed.
- DMX Remotes drive executor faders and keys only, not fixture attributes, so they cannot carry the aim.
- grandMA3 accepts at most 128 input universes (sACN + Art-Net), 20 of them sACN multicast.

## Sources

- grandMA3 2.5, *Art-Net*: https://help.malighting.com/grandMA3/2.5/HTML/dmx_ethernet_artnet.html
- *sACN*: https://help.malighting.com/grandMA3/2.5/HTML/dmx_ethernet_sacn.html
- *DMX Port Configuration* (Merge, Prio): https://help.malighting.com/grandMA3/2.5/HTML/dmx_port_config.html
- *DMX Priorities*: https://help.malighting.com/grandMA3/2.5/HTML/dmx_priorities.html
- *DMX Universes*: https://help.malighting.com/grandMA3/2.5/HTML/patch_dmx_universe.html
- *DMX Remotes*: https://help.malighting.com/grandMA3/2.5/HTML/remote_inputs_dmx.html
