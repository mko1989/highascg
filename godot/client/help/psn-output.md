# PSN output to a lighting desk

HighAsCG sends every tracking marker as a **PosiStageNet (PSN)** tracker, so the lighting desk aims its own
fixtures at the people on stage. The desk keeps control of its rig; this box only says where people are.

Where: **Previs → Camera → Follow**, set the output to **PosiStageNet → console**, then press **Output**.

## What this box sends

| Setting | Value |
|---|---|
| Multicast group / port | `236.10.10.10` : `56565` (the PSN defaults) |
| Rate | data 60 times a second, names once a second |
| System name | `HighAsCG` (editable) |
| Tracker id | the marker id: marker 1 = tracker 1 |
| Units | metres |
| Axes | **Stage**: X stage left, Y upstage, Z up · **Y up**: X, height, depth toward the audience |

A marker that stops updating is sent with status 0, so the desk can hold or drop it.

## Which desks can take it

| Desk | PSN input | Axes to pick here |
|---|---|---|
| grandMA3 (v1.7 or later) | yes | Stage |
| grandMA2 (v2.9 or later) | yes | Stage |
| ChamSys MagicQ | yes (PC / Mac: needs a ChamSys or GeNetix interface) | Y up, then fix depth on the desk (below) |
| ETC Eos | no | — |
| Hog 4 / Hog 5 | no | — |
| Avolites Titan | no | — |
| Obsidian Onyx | no | — |

For a desk without PSN input, use **Art-Net backup (this box aims)**: this box aims the patched heads itself.

## grandMA3

Needs v1.7 or later, when markers and XYZ aiming arrived. PSN is a session-wide setting.

1. **Menu → In & Out → PSN**. Choose the network port this box is on as the PSN interface.
2. Turn on **Enable Input**.
3. Tap **Insert new System** and set **Requested** to Yes.
4. Type `236.10.10.10` into **Multicast IP** by hand; the desk does not fill it in for multicast. Port stays
   `56565`.
5. Patch an **MA Lighting MArker** fixture per person you want to follow:
   - mode **Moving** (Still cannot be moved by PSN);
   - give it a **DMX address**, or its moves do not show;
   - its universe must use merge mode **Prio**. **DMX Priority** on the PSN line decides whether a playback can
     override it.
6. On the PSN line, set **Tracker ID** to the HighAsCG marker id and **Marker ID** to that MArker's CID. In v1.6
   these columns were called IDType / ID.
7. Make the fixture type use XYZ: **Menu → Patch → Fixture Types → Edit**, XYZ = Yes. The fixtures also need their
   real 3D position in the patch.
8. Select the fixtures, open **Position**, go to encoder page **XYZ 3 of 3**, and set the **MArker** attribute to
   the MArker number. They now follow it.

The axes match HighAsCG's **Stage** setting exactly: X stage left, Y upstage, Z up, in metres. If you ever send
**Y up** instead, fix it on the PSN line with MapX / MapY / MapZ and InvX / InvY / InvZ.

## grandMA2

Needs v2.9 or later. Re-mapping axes on the desk needs v3.8, so send **Stage**.

1. In **Setup**, open **PSN Network Configuration**.
2. Tap **Add** and set **Enabled** = Yes on the row. IP and Name fill in, and a green background means it is
   receiving. Change Port or Multicast only if you changed them here.
3. Turn on the large **Enabled** button at the top right.
4. Tap **View Tracker**, and for each tracker set **Fixture ID** to a patched **StageMarker** (up to 1024).
   **Predict** = 0 leaves prediction to the sender.
5. Select the fixtures with XYZ active. Under **Position**, go to **Stage B → Mark** and pick the stage marker, then
   switch to **Stage A** and set XYZ = 0. Their XYZ is now relative to the marker, so they follow it.

The fixtures need their real Pos X / Y / Z in the patch.

> Not confirmed in MA's grandMA2 help: which way positive X and Y point. Walk a marker stage left and upstage, then
> check.

## ChamSys MagicQ

On consoles it works as is. **On PC or Mac it only works when unlocked with a MagicQ or GeNetix interface.** The
tracker simulator works without one.

1. **Setup → View Settings → Network**: set **Tracker Rx** to **PSN/SpotMe**.
2. Same tab: set **PSN Function** to **Normal PSN 1**, so HighAsCG marker 1 = MagicQ tracker 1. The default,
   Normal PSN 0, would shift every number by one.
3. There are no port or multicast fields: MagicQ listens on the PSN defaults.
4. Aim the heads with a **Tracker Palette**:
   - record a Position palette, using Focus Hold / Focus Line in Plot;
   - in **View Palette**, press **SET TRACKER** (SHIFT + UNSET TRACKER removes it).
5. The heads' positions in MagicVis / Plot must be right. MagicQ's own **Position Calibration** (aim at four corner
   palettes, then CALIBRATE HEADS) does that.

Active trackers show as a green cross in MagicVis. The cross turns red, then disappears about 2 s after the data stops.

**Axes.**
- MagicQ uses Y as height. It also says *"PSN has Z positive towards the back of the stage"*. HighAsCG's **Y up**
  sends height as Y, but its depth is positive **toward the audience**, so depth arrives mirrored.
- Fix that in MagicQ: **Macro window → View Autom → View Trackers**, set a **negative Z scale** for each tracker
  (−256 = ×−1).
- Then walk a marker upstage and check the cross goes upstage. If left and right are swapped, a negative X scale
  fixes that the same way.

> MagicQ manages IGMP itself: its querier defaults to "Normal (Detect others)". If PSN never arrives, see Network
> below.

## ETC Eos, Hog 4 / 5, Avolites Titan, Obsidian Onyx

None of these has a PSN input in its manual or release notes. For Eos, ETC's forum answer is "no support for
PosiStageNet", and a feature request is open. Hog has an open feature request too. Avolites' **Capture**
visualiser reads PSN, but that does not drive Titan.

What works:
- **Art-Net backup (this box aims)**: HighAsCG aims the patched heads itself. Calibrate them first
  ([Calibrate heads](calibrate-heads.md)). With read-through, the desk keeps the heads until a marker is tracked.
- Third-party PSN → OSC bridges exist for Eos and Hog. They are not documented by ETC and not tested with
  HighAsCG.

## Network

- This box and the desk must be on the same network. Pick the right **Interface** on the Follow page if this box
  has more than one.
- PSN is multicast. On a managed switch with **IGMP snooping**, an **IGMP querier** must be active on that
  network, or the packets never reach the desk.
- The counter line on the Follow page ("PSN ON → … packets · errors") shows this box is sending. If it counts
  up but the desk sees nothing, it is the network or the desk's input setting.

## Check it works

1. Put one marker on stage (Markers mode, or detection).
2. Walk it **stage left**, then **upstage**, and watch the desk's tracker.
3. If an axis is mirrored or swapped, fix it on the desk (MA: Map / Inv; MagicQ: scale / Swap Y/Z).

See also [Calibrate tracking cameras](calibrate-cameras.md): the markers are only as good as the camera
calibration.
