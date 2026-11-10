# WO-1031 — Narvil show on the real setup: LED walls + tracking cameras on this box, camera mix + PPT in and stream + record out on the second, and a custom PTZ that follows the presenter
**Area:** devices-config, tracking-vr, video-io, network
**Status: IN PROGRESS (11.11.26: both boxes configured and applied — inputs, Stream PGM with record + stream on the second box, PTZ entry; no camera or PTZ bridge connected yet, so calibration and follow are untested)**

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

## Owner's answers (11.11)

1. LED walls: only the one already set up (screen destination 1 on this box).
2. Tracking cameras: not present yet, just prepare.
3. Second box's ports and formats: does not matter for now.
4. Stream: temporary, no address yet.
5. Record: H.264 into the project folder.
6. PTZ bridge: not present yet, just prepare for VISCA.
7. Zoom arrives as a VISCA zoom command: yes.
8. The PTZ stands at the very end of the room on a 2 m truss.
9. The looks of the deleted big screen can go ("it was just for tests").

## What was done (11.11)

- **Record into the project folder** (commit aaa6173c). It was not an option: a recording always went to Caspar's
  media root. A record row now has `folder: 'project' | 'media'` (`settings-post.js`); `recordRelativeName`
  (`routes-streaming-channel-record.js`) gives Caspar `projects/<slug>/<name>.mp4` under its media folder and falls
  back to the root, with a warning, when the show folder is not under it. No UI for the field yet.
- **Second box updated** to 2026-11-10T233252Z through its update API (it was on 2026-11-10T193133Z).
- **This box** (`POST /api/device-view`):
  - DeckLink 1, 2, 3 → inputs. Live inputs "Tracking cam 1" (`route://4-1`), "Tracking cam 2" (`route://6-2`),
    "PTZ camera" (`route://7-3`). The tracking cameras `cam_1` / `cam_2` already name roles `in1` / `in2`.
  - Duties `tracking` and `detection` became true as soon as the inputs were saved; the detection sidecar started
    (`yolo26n.onnx`, CPU, 2 cameras).
- **The show** (on the master, shared automatically):
  - `dst_mw989wyz_1` "PGM/PRV 3" (7680×2160) removed.
  - `dst_mwbbui46_1` "Stream PGM" added: program + preview, 1920×1080p50, screen index 1.
  - `previs.tracking.ptz`: one camera `ptz1` "PTZ Z200 (MAC 250 yoke)": `visca-ip`, port 52381, address 1, no host,
    `enabled: false`, `auto: true`, zoom left alone, pose x 2.53 (stage centre line), y −11, z 2.0, yaw 0, pitch 0,
    default pan / tilt ranges and 14.4 units per degree. Show rev 186.
- **Second box** (through the master's relay):
  - "Stream PGM" cabled to `rec_1` and `str_1`, which makes that box its owner.
  - `rec_1` "Rec PGM": source `program_2`, H.264, 12 Mbit/s, AAC 192 kbit/s, `folder: 'project'`, file name `Narvil_<time>.mp4`.
  - `str_1` "Stream PGM": RTMP, address and key empty.
  - DeckLink 3, 4 → inputs, live inputs "Camera mix" (`route://4-3`) and "PPT" (`route://5-4`).
    First try was DeckLink 1, 2: that made roles `in1` / `in2` resolve on that box too, and it switched its own
    tracking and detection on (it would have run detection on the camera mix and the PPT). Slots 3 and 4 name no
    tracking camera.
- **Cluster Apply** twice (`POST /api/cluster/apply`): both boxes, then the second box alone after the slot move.
- Backups from before: `~/backups/narvil-before-setup-20261111-001838/` (this box's config + project, the second
  box's config + project as a tarball).

## What was verified (11.11)

- Apply runs: `ok: true` on both boxes; this box restored its test card and kept the two Zoom layers.
- This box's Caspar: 8 channels (GUI 1, PGM/PRV 2/3, DeckLink 1 on 4, Zoom host 5, DeckLink 2 on 6, DeckLink 3 on 7,
  audio preview 8). The second box: 5 (GUI 1, Stream PGM/PRV 2/3, DeckLink 3 on 4, DeckLink 4 on 5).
- `GET /api/cluster`: "PGM/PRV 1" owned by this box, "Stream PGM" owned by highascg5867; show in sync at rev 186;
  duties: tracking + detection true here, false there.
- Record on the second box: 5 s through the API → `media/projects/narvil/Narvil_2026-11-11T00-36-18-323.mp4`,
  H.264 1920×1080 50 fps + AAC (file removed after the check). The same on this box before the push (3072×1024).
- Offline: `smoke-wo1031-record-project-folder` 3/3; full gate loop green; CI green on aaa6173c.

## Not done / not verified

- **No camera, mixer, laptop or PTZ bridge is connected**, so no input picture, no detection on real people, no
  camera calibration and no VISCA packet to a real device were tested. PTZ follow has still only ever run on loopback.
- **PTZ position is a placeholder.** y −11 is the line the (also uncalibrated) tracking cameras sit on, and z 2.0
  takes "2 m" as the height above the model's zero. The stage deck in the model is at z 2.3, so if the truss stands
  on the room floor the right z is different. Calibrating on a person on a mark replaces both.
- **VISCA flavour.** `visca-ip` (framed, port 52381) is a guess at what the bridge expects; raw VISCA over UDP is
  `visca-udp`, port 1259. Units per degree (14.4) are the generic default, not the MAC 250's.
- **The stream** has no address or key, so it was not started.
- **The looks of the deleted screen** (8 in the last autosave) are not deleted: they have no screen and sit in the
  "No screen" column.
- **The second box's pixel-mapping node** that fed the big screen is still there, with no input.
- **The virtual camera did not come back after the Apply** on this box: its relay restarted twice within two seconds
  and the second one failed with "bind failed: Address already in use". Started again by hand.
- No Devices UI for the record `folder` choice.

