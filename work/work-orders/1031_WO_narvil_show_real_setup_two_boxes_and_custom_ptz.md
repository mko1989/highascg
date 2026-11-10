# WO-1031 — Narvil show on the real setup: LED walls + tracking cameras on this box, camera mix + PPT in and stream + record out on the second, and a custom PTZ that follows the presenter
**Area:** devices-config, tracking-vr, video-io, network
**Status: OPEN (11.11.26: investigation and plan written; waiting for the owner's cabling answers before any change)**

Owner, 11.11 (verbatim):
> Then I'd like to prepare the Narvil show for the actual setup.
> This machine runs the led walls and gets 2 cameras for tracking the stage. The second machine gets camera mix input
> and ppt input and outputs for stream and rec. The big screen in the second machine can be deleted.
> I'd also like to test getting a custom made ptz camera to follow the presenter on stage. If it helps it can also be
> an input on the main box.
> The custom ptz is a Sony pxw z200 mounted on a Mac 250+ that had the light and head removed. I have a small bridge
> app that does conversation from visca to artnet to move the head and zoom camera via it's WebSocket API.

## Investigation (11.11, read-only)

- **The show.** Project `narvil`, rev 185, 12 looks, 2 timelines. Shared between the boxes: this box (highascg7580)
  is master (epoch 15), highascg5867 at 192.168.0.10 is linked, online and in sync.
- **Screen destinations in the show** (`hardwareConfig.screenDestinations`):
  - `dst_operator_gui` Operator GUI, 1920×1080p50, this box, DP-6.
  - `dst_mw7t9epz_1` "PGM/PRV 1", 3072×1024@50, this box, cabled to GPU port 1 (DP-2). The only LED wall today.
  - `dst_mw989wyz_1` "PGM/PRV 3", 7680×2160@50, program only, owned by highascg5867. **The big screen to delete.**
- **This box's ports.** 4 DeckLink ports, all `ioDirection: unassigned`. Caspar runs 5 channels: GUI, PGM 1, PRV 1,
  audio preview, and the Zoom host channel made on 10.11 (WO-1012).
- **Tracking** (`previs.tracking`): grid 18 × 10 m; two cameras, `cam_1` (role `in1`) and `cam_2` (role `in2`), both
  1920×1080, uncalibrated (`points: []`, `rms: -1`); detection enabled. This box's duties have `tracking: false` and
  `detection: false` (WO-712 / WO-723: duties follow the config), so nothing detects yet.
- **Outputs.** No record or stream output is configured on either box; `streaming.credentials.str_1` is empty.
- **PTZ follow (WO-711).** Built and tested on UDP loopback only; no real camera was ever driven. A PTZ camera is
  configured in the Previs tab: protocol `visca-udp` (raw VISCA, default port 1259) or `visca-ip` (framed, 52381),
  host, port, address, position and mounting on the stage, pan / tilt speed, aim height, home preset, zoom. The server
  sends absolute pan-tilt, home, preset recall and zoom direct. Duty `ptz` is on for this box.
- **The second box** runs build 2026-11-10T193133Z; this box runs the working tree (ahead of it by the WO-1012 work).

## Plan (nothing done yet)

1. **This box.** Keep PGM/PRV 1; add the other LED walls as destinations on the GPU ports they are cabled to; two
   DeckLink ports become inputs for the tracking cameras (roles `in1`, `in2`); tracking + detection duties on;
   calibrate both cameras on the stage marks (WO-713).
2. **Second box.** Delete `dst_mw989wyz_1`. Add one 1080p program destination there for stream and record, with the
   camera mix and the PPT as DeckLink inputs; a record output and a stream output on it. One Apply on that box.
   Looks that only exist for the deleted screen go with it (looks are keyed by destination since WO-1029).
3. **PTZ.** Add the camera in Previs with the bridge's address and protocol; its SDI out as a third input on this box
   so its picture can be checked and used; calibrate it on a person on a mark (WO-713); test follow with one tracked
   person, then the home position after nobody is seen.
4. Update highascg5867 to this build first (its update API), so both boxes run the same linked-server code.

## Open questions for the owner

- The LED walls on this box: how many, each one's pixel size, and which GPU output each is on.
- The two tracking cameras: which DeckLink ports, and their format.
- The second box: which ports carry the camera mix and the PPT, their formats; where the stream goes (RTMP or SRT,
  address) and what the recording should be (codec, where it is written).
- The PTZ bridge: where it runs, its address and port, raw VISCA over UDP or VISCA-over-IP, and whether zoom arrives
  as a VISCA zoom command. Where the camera stands (position and height) and which port its picture comes in on.

## What was done

Nothing yet.

## What was verified

Nothing yet.
