# WO-1120 — LED wall feed to the previs at half size: Caspar shm consumer SCALE

**Area:** godot-client, video-io, caspar-build
**Status: IN PROGRESS (17.11.26 — built, deployed on this box, walls correct and no client fps incident; Caspar build not yet published / pinned)**

Owner 17.11: "can we scale the led wall feed before sending it to previs?" → "Scale inside Caspar's shared-memory
output — half should do it". Follows [WO-1119](./1119_WO_previs_big_canvas_feed_read_every_other_frame.md).

## Investigation

- `~/caspar-build/src-v2/src/modules/shm/consumer/shm_consumer.cpp`: the consumer took only `NAME` and opened the
  ring at the channel's format (11520×1536 → 70.8 MB a frame, `/dev/shm/highascg-pgm1` 212 MB).
- `src/system/video-surfaces.js` add(): `ADD <ch>-<idx> SHM NAME <role>`.
- Client: `features/previs/stage_builder.gd` `_raster()` divided a wall's rect (channel pixels) by the TEXTURE size —
  a smaller ring would have doubled every UV.

## What was done

- **Caspar** (branch `highascg-main`, commit 2b608f13a, tag `highascg-2b608f13a` pushed to the public fork):
  `ADD … SHM NAME <n> SCALE <1|2|4>` and `<scale>` in a preconfigured consumer; the worker writes the ring at 1/n
  size, each pixel the mean of the 2×2 block at the top-left of its cell (exact for 2). `shm/scale` in the state.
- **Server**: `video-surfaces.js` `scaleFor()` — 2 when the role's channel is far above UHD (> 1.25 × 3840×2160), the
  ADD carries `SCALE 2`, the surface descriptor carries `scale`.
- **Client**: `video/feed_roles.gd` `raster(tex, channel)` + `video_surfaces.gd` `raster(role)`: the channel's size when
  the ring is that picture divided by a whole factor on both axes (so an older Caspar that ignores SCALE still maps
  right); `stage_builder.gd` uses it. WO-1119's every-2nd-frame rule no longer applies to this ring (4.4 MP).
- Box: binary swapped by hand (`bin/casparcg.pre-wo1120`, `.prev`), `~/.highascg/caspar-hold` set so an update does not
  put the pinned 8a2e29372 back; Caspar restarted over AMCP `RESTART`, node restarted, the LED artwork replayed on 2-10.

## What was verified

- Smokes wo1120 + wo597: 13 pass. Client unit suite 30107 passed, 0 failed; `--check` boot OK; eslint, line limit,
  unwired exports OK.
- Box: `VERSION` 2.5.1 2b608f13a; log `ADD 2-741 SHM NAME pgm1 SCALE 2`; `/dev/shm/highascg-pgm1` 53 MB (was 212);
  previs screenshot: all walls show their own part of the canvas; keeping-up status ok, preview feed pgm1 50 / 50,
  no client fps incident.

## Not verified / open

- The Caspar build is not published as a release and `caspar/PINNED.json` still names 8a2e29372
  (`tools/release/publish-caspar-build.sh`) — until then other boxes and the ISO get full-size rings (works, slower).
- The Live tab's PGM monitor now shows the half-size picture — not looked at.
- CPU cost of the 2×2 mean in the consumer worker — not measured (preview feed holds 50 / 50).
- Pixel-mapped fixtures that sample the pgm ring, if any reader assumes channel pixels — not checked.

## Published + pinned (17.11, owner: "do this")

- `tools/release/publish-caspar-build.sh` → release `caspar-2b608f13a` (binary + complete source), `caspar/PINNED.json`
  → 2b608f13a (binary sha256 equals the deployed `bin/casparcg`). `~/.highascg/caspar-hold` removed.
