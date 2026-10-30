# WO-793 — Calibrate and aim heads in HighAsCG (VR or desktop), record the result on the ChamSys desk

**Area:** lighting, tracking-vr
**Status: OPEN (27.10) — design below; licensing note in the PSN output status done; build waits on the owner's go
and a test with ChamSys hardware (the remote protocol's value scale is undocumented)**

Owner, 27.10:
> how to properly do connection between for instance chamsys magicq and highascg visualizer. so obviously visualizer
> shows whats programmed in magicq, but i want to also be able to for instance set positions from the vr world by
> clicking some where etc and that values be used in magicq.

> right now running on the same machine

> i dont want to block artnet or scan for visualizer use. but i really want to be able to calibrate and point heads
> from highascg and record that on the desk. the licensing problem needs to be made aware of. that to use psn on
> chamsys you need hardware. it wont be a problem for me as i have access to couple of chamsys hardware.

Parents:
- [WO-792](./792_WO_magicq_ui_in_vr_via_wayvr.md) (MagicQ PC as a WayVR panel in the headset);
- [WO-631](./631_WO_psn_output.md) (PSN output, `src/fixtures/psn.js`);
- [WO-741](./741_WO_vr_walk_mvr_scene_program_lights.md) / [WO-774](./774_WO_vr_box_select_type_filter_grip_fan.md) (VR select,
  floor aim, fan);
- [WO-624](./624_WO_godot_owner_notes_next_md_3.md) E3 (head calibration, `src/fixtures/calibrate-session.js`);
- [WO-632](./632_WO_artnet_read_through.md) (the desk's Art-Net into the visualiser).

## Investigation

- **Desk → visualiser stays as it is.** The visualiser reads the desk's Art-Net or sACN (lighting input, read-through).
  Owner: don't block either; nothing in this WO touches the inputs.
- **What HighAsCG already does** (`godot/client/features/previs/xr/xr_walk.gd:2-12`):
  - VR: the trigger selects heads, a release on the floor aims the selection there, and the grip fans pan / tilt.
  - The pan / tilt come from HighAsCG's own IK, using its calibration (WO-624).
  - The values only leave the box as HighAsCG's Art-Net (Fixtures DMX output). The desk never sees them, so it can't
    record them.
- **Ways into MagicQ** (ChamSys manual 1.9.9.x):
  - **PSN** (`trackers.html`): the desk aims its own heads at a tracker point (Tracker palette) with its own IK and
    its own fixture positions. HighAsCG's calibration does not travel. On MagicQ PC / Mac it is "only supported when
    unlocked with an appropriate MagicQ or GeNetix interface".
  - **ChamSys Remote Protocol** (`remote_control_commands.html`, `remote_control_network.html`): UDP 6553, text
    commands ending in a letter. Programmer commands end in `H`:
    - `1,<head>[,<end>]H` select, `3H` deselect all, `4,<group>H` select a group;
    - `6,<attr>,<value>[,<time>]H` set an attribute on the selected heads. Pan = 4, tilt = 5. **The value's range is
      not documented.**
    - `7` / `8` `,<attr>,<value>,<16bit>H` step an attribute up / down, with a 16-bit flag;
    - `20,<palette>H` records a position palette, `23,<cue>H` records a cue, `9H` clears the programmer.
    - Desk setting: Setup → View Settings → Network → Ethernet Remote Protocol = "ChamSys Rem rx" (with the CREP
      header) or "rx no header". Received data is ignored by default.
    - **Restrictions:** on PC / Mac only "when connected to a MagicQ Wing or Interface (not MagicDMX)"; not available
      while a net session is in use.
  - **OSC**: only the first 10 playbacks and execute items. It can't set positions.
  - **Merging HighAsCG's DMX into the desk output** moves the beams, but the desk never has the values: it can't
    record them. Rejected.
- **Same machine:** MagicQ PC binds UDP 6553 on 0.0.0.0, and HighAsCG binds nothing on 6553. So remote commands to
  127.0.0.1:6553 reach a MagicQ on the box. The MQ500 takes them at its own IP.

## Plan

**"Send aim to desk": HighAsCG computes the aim, the desk records it.**
1. **Server, `src/fixtures/chamsys-remote.js`:**
   - builds and sends remote protocol commands: header or no header, the desk IP (default 127.0.0.1), port 6553;
   - per head: select it, set pan and tilt from HighAsCG's programmer values, then the next head.
   - A route sends the selection, or every head the programmer touched. An optional "record position palette N" sends
     `20,NH`.
2. **Head mapping:** HighAsCG fixture → MagicQ head number. The default is the MVR FixtureID, which is what MagicQ's
   MVR import uses (to verify). An override per fixture.
3. **Value scale:** the first hardware test sends known values and reads the desk back. Candidates: 0–255, 0–65535,
   percent. If `6` is 8-bit only, fine positioning uses `7` / `8` with the 16-bit flag. The scale goes in a constant
   with the test as its evidence.
4. **UI:**
   - A **Send to desk** button (plus a palette number) on the Programmer, so the VR wrist panel has it too.
   - Desk IP and protocol on the Follow / output page.
   - The licensing note shows wherever the desk link is set up.
5. **PSN stays** for live following (WO-631). **Licensing note** in the UI: done (below).

## What was done

- `godot/client/features/previs/tracking/follow_output.gd`: the PSN status line now says "ChamSys MagicQ PC / Mac
  takes PSN only when unlocked by ChamSys hardware (interface, Wing or GeNetix node)." The help page
  (`godot/client/help/psn-output.md:27,79`) already said so.

## Verified

- Nothing built yet beyond the status line. Remote protocol and PSN details are from the ChamSys manual 1.9.9.x, not
  tested against a desk.
