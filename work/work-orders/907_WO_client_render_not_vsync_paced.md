# WO-907 — Visuals stutter (and alt-tab hitches): the Godot client's render loop was paced by the operator monitor's vsync

**Area:** godot-client, video-io
**Status: DONE (31.10.26 — box: Caspar OSC ch2 shm layer 40–50 → 48–50 new frames/s, ring stalls on alt-tab 90–100 ms → none over 4 round trips; screen consumer 50 presented/s, no new drops; GPU 58–69 % with Caspar; Godot --test / --check; smoke 2/2)**

## Owner report (31.10.26)
"the alt tabbing still stutters the output, but i think its linked to the visuals. not sure if i see it on the normal
media content."

## 1. Investigation
- Alt-tab switches between the Godot operator window (DP-4, 0,0) and Caspar's `Screen consumer [2|3840x1792]` (DP-0).
- Read-only ring logger on `/dev/shm/highascg-visuals` (seq @96, 10 ms poll) through 4 alt-tab round trips: a
  **91–101 ms stall at every alt-tab and every alt-tab back** (15:00:33 / 34 / 37 / 38 / 41 / 43 / 45 / 47).
- Caspar's own OSC (`/channel/2/output/port/600/screen/presented_frames`, `…/dropped_frames`,
  `/channel/2/stage/layer/1/foreground/shm/frames`, sniffed read-only on :6250): the screen consumer presents
  **50/s with no drops** through the alt-tabs → normal media is not affected. The shm layer gets only **40–49 new
  frames/s (≈ 44)** even without alt-tab → Caspar repeats a visuals frame several times a second (constant judder).
- `features/shm_out/viewport_publisher.gd` publishes every Godot frame, so the visuals rate = the client's frame rate.
  `project.godot` `window/vsync/vsync_mode=1` with DP-4 at 50.00 Hz: a frame over 20 ms waits for the next vblank (40 ms),
  and a focus / stacking change blocks the vsync'd swap ~100 ms.
- A/B on the owner's GUI (relaunched each time, measured with the same alt-tab script):
  - vsync FIFO (as shipped): ≈ 44 frames/s, 90–100 ms stall per alt-tab.
  - `--disable-vsync --max-fps 100`: 50/s every second, **no** stall.
  - mailbox (`vsync_mode=3`) + 100 cap: mostly 50/s, still 71–101 ms stalls per alt-tab → not enough.
  - project `vsync_mode=0` + `run/max_fps=100`: 48–50/s, **no** stall in 4 round trips.

## 2. What was done
- **`godot/client/project.godot`** — `window/vsync/vsync_mode=0`, `application/run/max_fps=100`. The client renders
  the show's visuals, so its loop must not wait on the operator monitor; 100 = twice the 50 fps channel, so the newest
  frame Caspar takes per tick is at most 10 ms old and a slow frame no longer costs a whole vblank.
- Tearing: the box's X config forces NVIDIA ForceCompositionPipeline on every output
  (`/etc/X11/xorg.conf.d/99-highascg-force-composition.conf`, installed by `scripts/setup/09-openbox-autostart.sh`),
  which composites tear-free regardless of the app's swap mode.
- Not done: pacing the publisher to Caspar's tick (needs a tick signal from Caspar); a separate visuals render process.

## 3. What was VERIFIED
- Box, final build: OSC per second `pres 50` ×29, shm `50` ×25 / `49` ×3 / `48` ×1; ring logger: nothing over the 30 ms
  poll floor through 4 alt-tab round trips; screen consumer `dropped_frames` unchanged (29) during the run.
- GPU 58–69 % (Caspar 3840x1792 + client), Godot ≈ 1 core.
- `tools/smoke/smoke-wo907-client-free-running-render.test.js` 2/2; Godot `--test` / `--check` (below).
- Owner-QA: operator GUI looks tear-free; the Dioda visuals are smooth while alt-tabbing / using the GUI.
