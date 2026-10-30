# WO-798 — Godot client idle CPU: ~50 % of a core on the Live tab (was ~10 %)

**Area:** godot-client
**Status: IN PROGRESS (29.10) — one cause proven (Live Times: whole-window redraw at the OSC rate + a fallback-font ✕ shaped per draw, ~11–12 % of a core); fix is a patch for the owner to apply (`/home/casparcg/highascg-wo798.patch`); the rest of the 27.10 :0 gap is not measured yet**

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

## Investigation (29.10, Opus)

Method: a detached git worktree (`/home/casparcg/highascg-wo798`, removed afterwards), a private user dir carrying
a copy of the owner's `ui.cfg` (`[live] view="standard" times=true auto=false`), project mhp_harder, CPU from
`/proc/<pid>/stat` utime+stime over 3 × 10 s after a 25 s warm-up. The owner's GUI was only sampled passively; no
pointer / keys on :0, no second window on :0.

- **The owner's GUI right now (pid 3533, :0, on the Audio tab, meters moving):** `top -d 10` → 10.0 / 9.3 / 9.3 / 9.4 %,
  later 10.0 / 8.6 / 6.7 / 13.7 %. It was not on the Live tab, so the 49 % Live number could not be re-taken on :0.
- **`--probe-perf` fixed** (`app/perf_probe.gd`): SubViewports are found every 3 s (`RESCAN_S`), not every frame; the
  line now also prints the mean `TIME_PROCESS`, draw calls and node count. Note: Godot's `TIME_PROCESS` includes the
  render sync + draw (it is ≈ the frame time under vsync), so it does not split script from render time.
- **Xvfb :99 cannot split this.** Uncapped, the client pins one core on Xvfb on every tab (Live 102 %, Audio 103 %,
  34–40 fps, presenting by copy dominates). Capped `--max-fps 20` it is noisy (Live 67–85 %, Audio 54 %).
- **Headless (`--headless --max-fps 50`) does split it** — the whole UI, layout and `_draw` recording run, no render /
  present / surface upload:

  | Tab (headless, 50 fps) | CPU % of a core |
  |---|---|
  | Live, Times on (owner's setting) | 18.6 / 18.8 / 18.4; again 18.7 / 19.2 / 19.5 |
  | Live, Times off | 6.8 / 6.8 / 6.7 |
  | Audio | 3.7 / 3.7 / 3.6 |
  | Multiview | 3.4 / 3.3 / 3.5 |

- **Timed inside `compose_tiles.gd`** (instrumented copy, Live, Times on): `_draw` 109–112 ms/s at 20 draws/s
  (5.4 ms each); the Times overlay `_draw_over` 7 ms/s; `_time_rows` 3.5 ms/s; `_layout_crops` 1.3 ms/s; the label
  TextLines 0.9 ms/s; **the "✕" TextLine 108 ms/s** (81 shapes/s ≈ 1.33 ms each, 4 windows × ~20 redraws/s).
- **Why the ✕ is slow:** U+2715 is not in the UI font (`res://assets/fonts/Rewir-Light.ttf`), so every shape walks the
  system-font fallback. A headless bench with the UI font: "✕" 0.455 ms/shape vs "PGM 1 / S1" 0.003 ms (≈150×), flat
  over 12 000 shapes (no growth with run time).
- **Why it runs 20×/s:** `features/live/live_preview.gd:93-95` (from WO-652, 21.10 21:17, after the WO-617 audit):
  every OscMirror `updated` (~25 Hz) did `tiles.queue_redraw()` — the whole windows control — although only the Times
  overlay (`_over`, `compose_tiles.gd _draw_over`) shows OSC data. Each whole redraw reshaped the 4 ✕ glyphs
  (`compose_tiles.gd:225-226`). So the regression appears whenever Times is on and the Live (or Timeline, WO-789) tab
  shows the 2D preview.
- Other per-draw non-ASCII shaping: none found (scan of every `draw_string` / `add_string` with a literal; Labels and
  Buttons shape once until their text changes).
- **Not settled:** the 27.10 :0 gap (Live 49 % vs ~9–10 % elsewhere) is larger than the ~12 % proven here. Still open:
  the `opgui` surface upload (held only on Live; WO-617 put it at ~5 % of a core), and whatever the VR session left
  running on 27.10. What would settle it: a `top -d 10` of the owner's GUI on the Live tab (Times on, then off), before
  and after the patch — or `--probe-perf` on the desktop GUI once.

## What was done (29.10)

| File | Change | Where |
|---|---|---|
| `godot/client/app/perf_probe.gd` | SubViewport list cached, rescanned every 3 s; mean process time, draw calls, node count | **live tree** (uncommitted) |
| `godot/client/features/live/live_preview.gd` | the OSC hook calls `tiles.redraw_times()` (overlay only) instead of `tiles.queue_redraw()` | patch |
| `godot/client/features/live/compose_tiles.gd` | `redraw_times()`; the ✕ TextLine shaped once per font (`_close_glyph`) instead of per window per draw | patch |
| `tools/smoke/smoke-wo798-times-overlay-redraw.test.js` + `tools/ci/offline-test-files-2.js` | source-text guard for both | patch |

Patch: `/home/casparcg/highascg-wo798.patch` (made against 20f0f7a3; `git apply --check` passes on the live tree as of
b90ffe51 + the WO-802 working copy). Both halves are kept: the overlay-only redraw removes the 25 Hz whole-window
redraw; the cached ✕ keeps any remaining whole redraw (layout, drag, resize) from paying the fallback lookup.
Drawing the ✕ as two lines would also work but changes the look; caching keeps it pixel-identical.

## Verified (29.10)

- **Headless, Live tab, Times on, 50 fps, interleaved runs in the worktree:** before 18.7 / 19.2 / 19.5 % and
  5.8 / 20.1 / 23.1 %; after 6.9 / 6.9 / 7.1 % and 6.9 / 7.1 / 7.3 % (and 7.7 / 7.7 / 7.6 % earlier). Times off before
  was 6.8 %, Audio 3.6 % — so with the patch, Times costs ~0.3 % of a core instead of ~12 %.
- **The overlay still repaints:** counted in an instrumented copy after the fix — `_draw_over` ~20/s, the windows
  `_draw` 2 calls in 10 s.
- **Xvfb :99, `--max-fps 20` (relative only, noisy):** before 67.6 / 67.3 / 71.8 and 85.1 / 79.2 / 67.6 %; after
  58.6 / 53.9 / 76.0 and 59.1 / 65.0 / 70.1 %.
- **Tests:** Godot suite in the worktree with the patch 21930 passed, 0 failed; in the live tree with the perf_probe
  change (and WO-802's working copy) 21911 passed, 0 failed. Smokes wo798 + wo789 + wo710: 8 / 8 pass.
  `check-max-file-lines`: 0 files over 500 (compose_tiles.gd 473).
- **Owner-QA (not done):** the GUI on the Live tab with Times on — `top -d 10` before and after applying the patch,
  and the Times rows still ticking under the windows.


## Measured after the fix (29.10 20:43, Opus)

The Times fix landed as 6a47eb71. Desktop GUI on :0 (`--autostart --tab=0 --screen=0`, Live tab, Times ON, a clip
playing on PGM 1, nothing else driving the window), `/proc/<pid>/stat` utime+stime deltas:
**18.2 % of a core over 30 s, 18.8 % over 60 s** (27.10: ~50 %; 21.10 baseline: ~10 %). Screenshot:
`/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/wo798-idle.png`.
So the regression is down from ~40 points to ~8 points over the 21.10 baseline; the remaining ~8 points are not
attributed yet (candidates from the investigation above: the per-frame PGM/PRV thumbnail uploads while a clip plays,
the progress text). Status left IN PROGRESS for that remainder.
