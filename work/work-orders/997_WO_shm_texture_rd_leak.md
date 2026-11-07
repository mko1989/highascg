# WO-997 — ShmTexture never frees its RenderingDevice texture (Visuals game scenes leak VRAM; resize frees the attached RID)
**Area:** godot-client
**Status: DONE (07.11.26, headless lifetime test with a counting fake RenderingDevice, 27 assertions, mutation-checked; Godot suite 25999 / 0; operator GUI relaunched on the new code with live PRV video on Vulkan)**

Owner, 07.11, about the WO-995 sweep: *"The shm_texture.free_gpu leak is a real bug, not dead code, and needs its own
work order."*

## Investigation

- **`free_gpu()` has no caller.** `video/shm_texture.gd:128-132` is the only free path for the RD texture that
  `_create` makes (`texture_create`, :98). `git grep free_gpu` finds only the definition. When a `ShmTexture` is
  dropped, its `Texture2DRD` is freed, but the RD texture it wraps is not: an RD RID is owned by whoever created it.
  It stays allocated until the RenderingDevice shuts down.
- **Who drops them:**
  - `video/video_surfaces.gd:92` makes one per role and keeps it for the app's lifetime. That is bounded, not the
    leak.
  - `features/visuals/scenes/game.gd:51` (WO-876) makes one per **game scene instance**, and the scene has no
    `_notification(PREDELETE)` (compare `scenes/shader.gd:52-55`, which releases its `ShadertoyRD`).
    Game scenes churn:
    - `visuals_stage.gd:80-121`: every `set_layers` runs `clear()` (`queue_free` on every layer, :117-119), then
      `SCENES[id].new()` (:86).
    - The deck builds one stage per layer (`visuals_deck.gd:195-201`), and every layer or scene change goes through
      `set_layers`.
    - Thumbnails render each look in a shared stage and `_stage.clear()` it after every batch
      (`visuals_thumbs.gd:84-92`).
  - Each game instance that saw a frame leaks one BGRA8 texture of the ring's size (e.g. 768×720×4 ≈ 2.2 MB),
    plus one more per mid-run resize (see the next point). Instances that never got a frame allocate nothing,
    because `_create` only runs on the first `update*`.
- **The resize path frees the RID that is still attached.** `_create` (:83-85) calls `free_rid(_rid)` on the old
  texture first, then creates the new one and only *defers* `_assign` (:100) onto the main thread. Between the two,
  the `Texture2DRD` points at a freed RID. The cases:
  - With rendering on its own thread, a frame drawn in that window samples a dead texture: a Vulkan validation error
    at best, garbage or a device-lost at worst.
  - With rendering on the main thread, `call_on_render_thread` runs synchronously. The window then lasts until the
    deferred flush, which is still before the draw, so the bug was latent.
- **`free_gpu()` itself was wrong:**
  1. It did not detach `texture_rd_rid` first, so the `Texture2DRD` would point at a freed RID (`shadertoy_rd.gd`
     `release()`, :90-104, detaches first).
  2. It read and cleared `_rid` on the main thread, while `_create` writes `_rid` on the render thread.
     - A `_create` still in the queue when `free_gpu` ran would create a texture after the free: the leak again.
     - A pending deferred `_assign` would re-attach it to the texture.
  3. It queued `_rd.free_rid.bind(rid)`. That holds the RD, not the `ShmTexture`. That part was fine for the free,
     but a still-queued `_create.bind(...)` on a dropped `ShmTexture` would just error out, and nothing would hold
     the object alive until its queued work ran.
- **Logs** (`~/.local/share/godot/app_userdata/HighAsCG Operator/logs/`, 5 rotated) have no "RID allocations
  leaked" lines. That proves nothing: the client is stopped with TERM and never reaches RD teardown, where Godot
  would report leaks. VRAM is the real cost, and only on a box that runs games in Visuals.

## What was done

- **`video/shm_texture.gd`:**
  - **Ownership.** `_rid` and the new `_retired` map (successor RID → the RID it replaced) are only touched on the
    render thread. `free_gpu` no longer reads `_rid` on the main thread.
  - **Resize.** `_create` retires the old texture instead of freeing it, then defers `_swap(new)`. `_swap` points the
    `Texture2DRD` at the new RID, then queues `_reap(new)` on the render thread to free the one it replaced.
    `Texture2DRD` applies its RID through `call_on_render_thread` as well, so the free lands after the re-point. A
    chain of resizes faster than the main thread frees each texture only when its own successor is shown.
  - **`free_gpu`:**
    - It is idempotent and sets `_closed`.
    - It detaches the `Texture2DRD` first (`RID()`), then queues `_free_all`, which frees the current and every
      retired RID, behind anything already queued.
    - The queued lambda captures a strong local reference, so a `ShmTexture` dropped right after `free_gpu` lives
      until the free runs.
    - After close, `_create` makes nothing, `_swap` does not re-attach, and `update*` queue nothing.
  - **Test seams.** `_rd` is now typed `Object`, so a fake can stand in. The render queue, main queue and attach
    step are swappable callables (`_on_render`, `_on_main`, `_attach`); their defaults are the real
    `call_on_render_thread`, `call_deferred` and `texture_rd_rid`. There is no new public API.
- **`features/visuals/scenes/game.gd`:** `_notification(PREDELETE)` → `_tex.free_gpu()`, the same pattern as
  `shader.gd`. Every stage `clear()` and thumbnail batch now frees the ring texture.
- **`video_surfaces.gd`** is unchanged. Its per-role textures live as long as the app, and the RD shuts down with
  it.
- **`tests/test_shm_texture_lifetime.gd`** (new, auto-discovered): `FakeRD` counts live, made and dead-use
  (double free or upload into a freed RID). The rig pumps both queues by hand and checks after every step that
  the shown RID is alive. Cases:
  - free after updates and a format/size change;
  - the old texture alive between create and swap;
  - four resizes before any swap;
  - `free_gpu` before a queued create;
  - `free_gpu` between create and swap;
  - no work after free, and a dropped object still frees;
  - a real `game.gd` node `free()` releasing its texture.

## What was VERIFIED

- **Godot:** `run-client.sh --check` boots with no script errors. `--test`: **25999 passed, 0 failed**, 27 more
  than before, all in the new file. The two "Parse JSON failed" lines are the usual expected noise.
- **Mutation check.** I put the old order back (`free_rid(_rid)` in `_create`) and removed the PREDELETE call: **6
  assertions fail** ("never shows a freed RID", "both alive between create and swap", "PREDELETE frees the ring
  texture"). With the fix restored, the suite is green again.
- **Real RenderingDevice.** I relaunched the operator GUI on :0 (setsid `run-client.sh --autostart --tab=Live`).
  `video_surfaces` uses the same class, so this exercises `_create` → `_swap` → attach on Vulkan.
  - Screenshot (scratchpad `wo997-live.png`): the PRV preview shows the moving neon-lines clip that ch3 is playing.
  - PGM ch2 has no layers and the DeckLink input has no signal; both show black, which matches `/api/state`.
  - Nothing new in `~/.highascg/log/godot-client.log`: the `previs_quality` SSR deprecation warning and the
    Unicode NUL lines were already there 52 and 796 times.
- **Not measured:** VRAM before and after game-scene churn. That needs a game running on the Visuals page, plus
  pointer or show changes on the owner's live client. The fake-RD test is the proof of the free path, and a real
  game scene releases through the same `free_gpu`.

Rollback: revert the commit. The leak comes back; nothing else depends on the new seams.
