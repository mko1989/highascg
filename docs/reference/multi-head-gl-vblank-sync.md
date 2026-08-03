# Multi-head vblank sync — why PGM micro-stuttered while the operator GUI was smooth (WO-407)

Fixed 2026-08-03, owner-verified on the glass. This is the missing chapter of
[screen-consumer-vsync-nvidia.md](./screen-consumer-vsync-nvidia.md): that doc's recipe
(SyncToVBlank off, ForceCompositionPipeline on, caspar vsync on) was fully in force on this
box and it **still** stuttered. The knob it never covered is *which display* OpenGL syncs to.

## The physics

A display redraws itself top-to-bottom at its refresh rate. The moment it finishes and
returns to the top is the **vblank** (vertical blanking interval) — the only safe moment to
swap in a new frame without tearing. "Vsync on" means: when the app presents a frame, the
driver holds it until the next vblank.

Crucially, **every display generates its own vblank from its own hardware clock**. Two
panels both "running 50 Hz" are really running 50.000…±tolerance Hz on two independent
crystals. They are never exactly in step, and their relative phase drifts continuously.

## The trap on this box

Both outputs live on **one X screen** (one big 3648×1080 desktop):

| Output | What | Mode |
|---|---|---|
| DP-0 | PGM display (LED processor) | 1728×960 @ 50 Hz |
| DP-4 | Operator monitor (**X primary**) | 1920×1080 @ 50 Hz |

When a GL app on a multi-head X screen enables vsync, the NVIDIA driver must pick **one**
head's vblank to gate swaps on. By default it picks one for you (in practice the primary —
DP-4 here). So caspar's PGM window, physically shown on **DP-0**, was having its frames
released on **DP-4's** clock.

Two free-running 50 Hz clocks drift past each other. Most of the time a frame released on
DP-4's beat still arrives in time for DP-0's scanout — but as the phases slide through
alignment, frames periodically land just after DP-0's deadline and get shown late or
doubled. The drift rate is not constant, so it looks **irregular** — exactly what the owner
reported — and it can never be fixed by content, load, or config tuning, because the
pipeline is genuinely perfect: we measured the channel ticking **exactly 50.00 fps with
zero stalls** while the stutter was visible.

### Why the operator GUI looked smooth

The operator monitor (DP-4) **was** the sync display. Everything presented there — Firefox,
and the ch-3 screen consumer behind its holes — swapped on its own vblank. Smooth by
construction. That asymmetry ("same content, smooth on one screen, stutters on the other")
is the fingerprint of this whole failure class.

## The fix

Tell the driver which head to gate caspar's swaps on:

```
__GL_SYNC_DISPLAY_DEVICE=DP-0        # the PGM display
```

Priority rule: **the on-air output wins**. The operator monitor showing an occasional soft
frame is invisible in practice (Firefox composites at its own rhythm anyway); the PGM
display must get every frame on its own beat.

### How it's wired — AUTOMATIC (owner rule: no hand-edited env files)

- On **every config Apply**, `src/utils/caspar-gl-sync-env.js` rewrites the machine-owned
  file `~/.config/highascg/caspar-env` (box-local — not in the repo, so Syncthing peers
  with different connector layouts are unaffected). Do not hand-edit it; the next Apply
  overwrites it.
- **Auto resolution**: screen 1's connector from `calculateLayoutPositions()` — the SAME
  layout plan that generates the `xrandr --output DP-0 --pos 0x0 …` line, so the sync
  display tracks the PGM output through replugs and layout changes with zero manual steps.
  Fallback: `casparServer.screen_1_system_id`; if nothing resolves, the var is simply not
  written (never a stale connector).
- `run.sh` sources the file and exports `__GL_SYNC_DISPLAY_DEVICE` before launching caspar.
- **Override** (config key, no GUI yet): `casparServer.caspar_gl_sync_display` =
  `auto` (default) | `off` (never set) | a connector name verbatim (e.g. `DP-4`).

Verify on the running caspar:

```bash
tr '\0' '\n' < /proc/$(pgrep -x casparcg | head -1)/environ | grep SYNC_DISPLAY
```

If the PGM display moves to a different connector, just run Apply — the plan re-resolves.
Symptom of a wrong sync display: this exact bug (smooth operator monitor, irregular
micro-stutter on air).

## Diagnosis recipe for next time

1. Same channel smooth on one display, stuttering on another → presentation path, not
   pipeline. Confirm by measuring the channel tick (sample an ffmpeg consumer's
   `file/frame` OSC counter — WO-407 has the script): steady 50.00 fps = pipeline innocent.
2. `xrandr`: check both displays' real refresh (50-on-60 gives *cadenced* judder; two
   independent 50s give *irregular* drift stutter).
3. `nvidia-settings -q CurrentMetaMode` + caspar env: is `__GL_SYNC_DISPLAY_DEVICE` set,
   and to the display that stutters?
4. Ruled out on the way (WO-407 test log): ch-3 vsync off (no change), refresh mismatch
   (both measured 50.00), load (perfect tick under 220–431 % caspar CPU).
