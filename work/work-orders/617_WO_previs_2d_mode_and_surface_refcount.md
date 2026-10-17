**Status: IN PROGRESS (2026-10-17) — T1–T4 done and measured on the shop dev box (2D default, surfaces refcounted). Open: server-side REMOVE on leaving previs not observable on this 1-channel box (needs a box with PGM channels), remaining 7 % idle client CPU (profile). Parent: [WO-607](./607_WO_godot_previs_native_3d.md). Related: [WO-614](./614_WO_previs_stage_builder.md) (the stage it draws), [WO-597](./597_WO_server_video_surfaces_shm_and_atlas.md) (leases), [WO-594](./594_WO_caspar_shm_frame_consumer.md) (per-surface Caspar cost).**

# WO-617 — Previs 2D mode (default) + video surfaces only while something shows them

Owner (`next.md`, 17.10): "i need a simple 2d option for preserving resources especially when its not needed."

## Investigation (shop dev box, RTX PRO 4000, Caspar 2.5.1, 1 channel 1080p50, 4-object stage)

Measured with a new dev probe `--probe-perf` (`godot/client/app/perf_probe.gd`: `RenderingServer`
measured render time per viewport) and `nvidia-smi` board power over 12 s windows:

| Condition | 3D viewport GPU | window GPU | client CPU | board power |
|---|---|---|---|---|
| no client (baseline) | – | – | – | 11.4–14.7 W |
| client, Live tab | 0 (not rendered) | 0.07 ms | 13.2 % core | 25.2 W |
| client, Previs 3D | **0.22 ms/frame** | 0.04 ms | 13.0 % core | 26.5 W |

- The 3D render of a small stage is ~1 % of the 20 ms frame budget here, and a hidden previs tab already
  stops its SubViewport (`UPDATE_WHEN_VISIBLE`). It will not stay small: GLB venue models, WO-615 fixtures
  with volumetric beams, and weaker clients (laptops/Mac, WO-610) are where 3D costs real GPU.
- **The real leak is video surfaces.** `video/video_surfaces.gd` creates a surface on first
  `texture(role)` and **never releases it** (no caller of `release()`; `rg "VideoSurfaces\.(texture|release)"`):
  the role stays in every lease renewal (5 s) so the server keeps the Caspar shm consumer on that
  channel, and the client reads + uploads every frame in `_process` — whether or not anything is visible.
  Per surface that is +5.2 % of a Caspar core at 1080p50 (WO-594 measurement) plus a client memcpy/upload;
  a 3072×1728 PGM is ~2.6× that. Touching the previs source picker or binding a stage object to `pgm1`
  pinned it until the client quit.

## Design

1. **Reference-counted surfaces** (`VideoSurfaces`): `acquire(role, owner) -> Texture2D` /
   `release(role, owner)` / `release_all(owner)`. Only roles with ≥ 1 holder are polled, uploaded and
   leased; the `Texture2D` object stays the same across release/re-acquire (bindings never dangle).
   The Live tab holds `opgui` only while visible; the previs holds the roles its visible objects use.
2. **Previs view modes: `2D front` (default) · `2D plan` · `3D`**, remembered per client
   (`user://ui.cfg`, a UI preference — not show data).
   - 2D: the 3D SubViewport is not rendered (`UPDATE_DISABLED`, hidden); a plain `Control` draws the stage:
     *front* = elevation (x/height, flat widths), *plan* = top-down footprints with rotation, curved
     walls, projector + frustum. Click selects (synced with the Stage list), drag moves (front: X/Y,
     plan: X/Z, 0.05 m snap) — the cheap gizmo for WO-614 T5.
   - **"Live pictures" toggle (2D, default off)**: off = layout only, **zero surfaces held**; on = each
     object shows its crop (draw_texture_rect_region), redrawn at 25 Hz only while visible.
   - 3D: as today; surfaces held only while the tab is visible.
3. Leaving the previs tab releases every previs-held surface (server REMOVEs after the lease TTL).

## Tasks
- [x] T1 VideoSurfaces refcount + headless tests; Live tab holds `opgui` only while visible.
- [x] T2 Stage builder + GLB source picker acquire/release through an owner; `set_live(bool)`.
- [x] T3 2D view (front/plan, select, drag-move, live-pictures toggle) + mode switch + persistence.
- [x] T4 Measure again: 2D vs 3D vs hidden; leases/REMOVE on the server when leaving previs.

## Investigation addendum — the offline suite overwrote the live project (found while testing this)
After a suite run the seeded stage was gone and `projects/untitled.json` was a fresh empty Untitled
written with **no server log line** (rev 345 → 347 at 20:10:26). Cause: `tools/smoke/smoke-new-project.test.js`
runs the real New-project persist path and `src/engine/project-store.js` hard-coded `<repo>/projects`;
proven by running that file alone (live rev 347 → 349, bridge copy too). Every offline run on a box
replaced the active project when it was called "Untitled". (The owner's `npcc` show, 6 looks, had
been replaced by a New project at 19:06:16 before any of this — intact in `_trash` + `_autosave`.)
Fix `8b9fc4e`: `src/engine/projects-root.js` (env override → temp dir under `node --test` → live
dir), volume sync off in test processes; guard smoke drives the real `persistProject`.

## What was done (2026-10-17)

| File | What |
|---|---|
| `video/surface_holders.gd` + `video_surfaces.gd` | acquire/release/release_all per owner; only held roles polled, uploaded, leased; a path change swaps the reader, never the `Texture2D` |
| `features/live/live_tab.gd` | holds `opgui` only while visible |
| `features/previs/stage_builder.gd` | `set_live()` + `sync_holds()` — holds exactly the roles its objects use, only in visible 3D |
| `features/previs/stage_2d_view.gd` | front + plan drawing, hit test, drag-move (0.05 m snap), live-pictures holds |
| `features/previs/previs_tab.gd` | mode toolbar (2D front / 2D plan / 3D, Live pictures, Fit), `user://ui.cfg`, 3D viewport `UPDATE_DISABLED` outside 3D, GLB source picker holds by owner |
| `features/previs/stage_objects.gd` | `footprint`, `front_rect`, `projector_world_xz` |
| `app/perf_probe.gd` | `--probe-perf` (per-viewport measured render time) |

Tried and reverted: `OS.low_processor_usage_mode` while nothing is held — no measurable change (7.1 %),
scripts still run every loop iteration; the idle cost needs profiling, not a flag.

## What was VERIFIED (shop dev box, 4-object stage, 12 s windows)

| Mode | surfaces held | client CPU | board power |
|---|---|---|---|
| baseline (no client) | – | – | 12.1–15.0 W |
| Live tab | opgui | 11.9 % | 25.3 W |
| **2D layout (default)** | **none** | **7.0 %** | **22.8 W** |
| 2D + live pictures | opgui | 12.2 % | 25.9 W |
| 3D | opgui | 12.4 % | 27.1 W |

- `held_roles` in the run SUMMARY: front/plan → `[]` (the hidden Live tab released too), 3D → `["opgui"]`.
- Screens: front + plan draw the stage (curved wall arc, rotated TV, projector + throw lines); live
  pictures show per-object crops (left/right halves); real XTEST drag moved Main LED [0,1,0] → [3,2.5,0],
  autosaved (rev 351), inspector followed the 2D selection.
- Headless 155/0 (holders 2 tests, 2D geometry 6 checks).
- Not verified here: server `REMOVE` of a PGM consumer on leaving previs (box has only the operator channel).
