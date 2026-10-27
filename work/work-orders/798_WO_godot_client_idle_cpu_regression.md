# WO-798 — Godot client idle CPU: ~50 % of a core on the Live tab (was ~10 %)

**Status: OPEN (27.10) — measured, not the previs; cause not found yet**

Owner, 27.10 (after WO-797): "open wo".

Related: [WO-617](./617_WO_previs_2d_mode_and_surface_refcount.md) (21.10 idle audit: 9.6–10 % of a core on the
Multiview tab), [WO-797](./797_WO_previs_fixtures_decoded_only_while_watched.md) (where this turned up).

## Investigation so far (27.10, box, desktop client on :0, project mhp_harder)

- **Desktop GUI on the Live tab** (`top`, 5–10 s samples):

  | When | CPU |
  |---|---|
  | VR session running | 107–123 % |
  | VR session stopped | ~49 % |

  21.10 (WO-617) it was 9.6–10 % at rest. 144 commits have touched `godot/client` since 21.10.
- **GPU** (`nvidia-smi pmon`, while the VR session ran): the desktop GUI used 39–68 % SM on the Live tab. It was not
  re-measured after VR stopped.
- **Not the previs.** On a hidden X display (Xvfb :99; Godot still renders on the NVIDIA GPU over Vulkan):
  - The client on Live and on Previs: ~103 % vs ~106 % CPU.
  - A client copy with the Previs tab replaced by an empty Control: 103 %, 27 fps.

  Xvfb inflates the absolute numbers (frames are presented by copy), so only the comparisons count.
- **Not the scripts' `_process` or the WebSocket.** In an instrumented copy (scratchpad, Live tab, Xvfb), every
  `_process` / `_physics_process` was wrapped with a timer:

  | Source | Time |
  |---|---|
  | `video_surfaces.gd` | ~30 ms/s |
  | `ws.gd` (all messages: `osc` 25/s ≈ 18 ms/s, `change` 75/s ≈ 2 ms/s) | ~23 ms/s |
  | every other script | < 1 ms/s |

  - Godot's `Performance` process time was 72–77 ms per frame (14 fps there), so most of the frame is spent outside
    script `_process`: UI layout / redraw, the engine, or signal / deferred-call work.
  - Not yet split further.
- **`app/perf_probe.gd` (`--probe-perf`) distorts what it measures.** Its own `_process` took ~220 ms/s, more than
  anything it measures. It calls `get_tree().root.find_children("*", "SubViewport", true, false)` every frame over the
  whole tree. Fix it before using it again: cache the list, refresh every few seconds.

## Next steps

1. Measure on :0, not Xvfb. Use `--probe-perf` (fixed) on a second instance with the owner's OK, since it shows on a
   screen. Or ask the owner to flip `--probe-perf` on the desktop GUI once.
2. Native split: `perf record` needs `sudo sysctl kernel.perf_event_paranoid=1` from the owner. Alternatively Godot's
   `--profiling` / `Performance` monitors (`TIME_PROCESS`, `OBJECT_NODE_COUNT`, `RENDER_TOTAL_DRAW_CALLS_IN_FRAME`,
   layout counts) logged once per second.
3. Bisect over the `godot/client` history since 21.10, using the same Xvfb comparison as above (relative numbers).
   Run it in a git worktree, never in the live tree the owner's GUI relaunches from.
4. Likely suspects to rule out first:
   - Controls that change text or size every frame, forcing a relayout (the timeline / clock labels, look-strip
     timers).
   - Video-surface uploads of roles nothing shows.
   - Godot 4.7's redraw of the whole 1080p UI every vsync (the WO-617 lever: redraw on demand).
