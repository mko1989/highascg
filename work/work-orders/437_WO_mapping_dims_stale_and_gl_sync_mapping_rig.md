# WO-437 — Mapping outputs: stale stored dims report 1080p on GPU ports; GL-sync auto blind to mapping-only rigs

**Status: DONE (2026-08-06 — suite 1849/0/2, built + kiosk F5 + highascg restart; live graph healed via API. Caspar picks up the GL-sync var on the owner's next Apply + caspar restart)**

> **CORRECTION (same day, owner escalation → WO-439):** this WO's GL-sync diagnosis was
> incomplete. The owner's "NVIDIA sync to display" tick WAS set (`screen_1_nvidia_sync_to_display: true`)
> and WAS being read — it was dropped one step later, at the port→name lookup, which only knew
> `screen_N_system_id` / plan.screens (both empty on this rig). This session's offline repro
> missed it by loading the config without the caspar_server.json slice. The mapping-outputs
> fallback added here is still correct as the LAST resort, but the tick fix is
> [WO-439](./439_WO_nvidia_sync_tick_dropped_on_mapping_rig.md); precedence is now
> tick → screen assignment → mapping wall origin.

Owner (todos06.08.26 items 2+3): "even though the mapping node outputs are set to 2160p the
gpu ports display 1080p as the incoming/connected signal" and "is the caspar gl sync set
right now?"

## Investigation

**Item 2 — the 1080p display.** Smoking gun in the live graph (config/device_graph.json):

```
{"id":"out_1","mode":"2160p5000", "width":1920,"height":1080, ...}   ← both outputs
```

The dropdown said 2160p5000; the stored dims said 1080p. Cause: the pre-437 inspector's
`saveCustom` (device-view-inspector-mapping.js) sent the HIDDEN custom W/H/FPS inputs' stale
values alongside every standard-mode pick, and `updateMappingOutputFields` stored them
verbatim. Every resolver then preferred the stored numbers over the mode:

- client `resolveMappingOutputResolution` (mapping-node-service.js) — branch 2 returned
  stored dims for standard modes;
- client `resolveMappingOutputFeedSource` (device-view-gpu-source-inherit.js) — inlined
  `output.width ?? mode dims`; this feeds the GPU-port inspector's cable-feed note
  (`device-view-inspector-gpu-video-modeline.js:92`) — the "incoming signal: 1920×1080 @ 50 Hz"
  the owner saw;
- server `resolveOutputPixelSize` (mapping-gpu-os-layout.js) — stored dims first. The OS
  layout itself was SAVED by the mapping rects (slices carry w:3840 h:2160, and rects
  outrank output dims in the layout/consumer paths), so xrandr/consumers were correct —
  only the reported size and any rect-less fallback were wrong.

Likely how the corruption got in: WO-436's revert bug — the owner's 2160p attempts took
"a couple of tries", and each standard-mode retry re-saved the stale hidden inputs.

**Item 3 — GL sync.** Answered live: NOT set. Running caspar (pre-restart PID 2354358) had no
`__GL_SYNC_DISPLAY_DEVICE`; the 06.08 09:52 auto-regenerated `~/.config/highascg/caspar-env`
had no `CASPAR_GL_SYNC_DISPLAY` line. Reproduced offline with the REAL merged config
(highascg.config.json + deviceGraph): `plan.screens` is `{}` because this rig assigns NO
screen destinations to screens — everything routes `pixel_map_out → gpu_out` (out_1→gpu_p0
=DP-0, out_2→gpu_p2=DP-4). The WO-407 auto only consulted `plan.screens[1]` +
`screen_1_system_id`, so a mapping-only rig always resolved null. Mitigating accident: DP-0
is currently the PRIMARY head, so the driver default coincides with the wall origin — but
it silently breaks if primary ever moves.

## What was done

- `device-view-inspector-mapping.js` `saveCustom`: a standard-mode pick now derives
  width/height/fps from `videoModeToResolution(mode)` — the hidden custom inputs are only
  used when Custom is selected.
- `mapping-node-service.js` `resolveMappingOutputResolution`: a STANDARD mode id
  (`(720|1080|2160)[pi]NNNN`, PAL, NTSC) is authoritative over stored width/height.
  Custom modes keep honouring stored dims (they ARE the mode).
- `device-view-gpu-source-inherit.js` `resolveMappingOutputFeedSource`: routes through
  `resolveMappingOutputResolution` — precedence lives in ONE place.
- `src/utils/mapping-gpu-os-layout.js` `resolveOutputPixelSize`: same invariant server-side
  (standard-mode spec first).
- `src/utils/caspar-gl-sync-env.js` `resolveGlSyncDisplay`: new step 3 — when
  `plan.screens[1]` and `screen_1_system_id` both fail, fall back to the LEFTMOST
  `plan.mappingGpuOutputs` row's sysId (the mapping wall's origin head = the PGM display).
  Verified offline against the real merged config: resolves **DP-0**.
- **Live graph healed via API** (`POST /api/device-view`, server owns the file): both
  outputs now `2160p5000 / 3840×2160`, confirmed persisted to config/device_graph.json.
- New smoke `tools/smoke/smoke-wo437-mapping-dims-gl-sync.test.js` (curated list): unit
  tests both resolvers with the exact corrupt shape + custom-mode counterexamples; source
  asserts pin the saveCustom derivation, the single-resolver routing, and the GL-sync
  mapping fallback.

## Verified

- WO-437 smoke 5/5; full offline suite **1851 tests, 1849 pass, 0 fail, 2 skipped**.
- Build clean, kiosk F5'd; highascg restarted (`kill -TERM` MainPID, API back 200).
- `resolveGlSyncDisplay(realMergedConfig)` → `DP-0` (was `null`).
- Owner QA: GPU port inspectors should now show the mapping feed as 3840×2160 @ 50 Hz.

## Remaining owner step

The GL-sync var reaches CasparCG via the caspar-env file, which is rewritten **on config
Apply** and read **at caspar launch**. On the next "Apply Caspar config (restart)" the file
gains `CASPAR_GL_SYNC_DISPLAY=DP-0` and the restarted caspar gets
`__GL_SYNC_DISPLAY_DEVICE=DP-0`. No action needed beyond the next normal Apply; not forced
now because an Apply restarts Caspar (on-air impact is the owner's call). Note WO-407's
standing reminder: re-check smoothness once after that Apply.
