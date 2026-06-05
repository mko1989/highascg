# Screen consumer vsync (NVIDIA)

Normative setup for **smooth, tear-free** output on CasparCG **screen** consumers when the playout GPU is **NVIDIA**.

## Required combination

| Layer | Setting | Value |
|-------|---------|--------|
| **NVIDIA** (`nvidia-settings` or NVIDIA Control Panel) | **Sync to VBlank** (`SyncToVBlank` on GPU/screen) | **Off** |
| **Caspar screen consumer** (`<screen>` / HighAsCG `screen_N_vsync`) | **V-sync** | **On** (`true`) |

Do **both**. Using only one side often causes tearing, stutter, or frame pacing that looks like “bad vsync.”

## Why

- **Driver sync-to-vblank** forces OpenGL swaps to the display refresh at the **driver** level for all GL clients on that GPU.
- Caspar’s **screen consumer** has its own **vsync** when presenting the playout window.
- With NVIDIA **Sync to VBlank on**, the driver and the consumer can **double-sync** or fight each other → uneven frame times.
- With NVIDIA **Sync to VBlank off** and Caspar **vsync on**, presentation is gated **once**, at the consumer, which is the intended playout path.

## How to apply

### NVIDIA (OS / X session)

1. Open **`nvidia-settings`** (HighAsCG: **Settings → System → Open NVIDIA Settings**, or `DISPLAY=:0 nvidia-settings`).
2. Under the GPU (and screen section if shown), set **Sync to VBlank** to **disabled / off**.
3. Confirm with:
   ```bash
   nvidia-settings -q "[gpu:0]/SyncToVBlank"
   ```
   (value **0** = off)

HighAsCG production install also sets:

- Environment: **`__GL_SYNC_TO_VBLANK=0`** in the X session / autostart chain.
- Script: **`highascg-nvidia-x-apply.sh`** (PowerMizer + `SyncToVBlank=0` on each GPU), installed by `scripts/install-phase2.sh`.

Re-run that script or reboot the playout session after driver upgrades if tearing returns.

### Caspar (screen consumer)

In generated **`casparcg.config`**:

```xml
<screen>
    …
    <vsync>true</vsync>
</screen>
```

In HighAsCG settings (`casparServer` / Device View), keep **`screen_N_vsync`: true** (defaults in `src/config/defaults-caspar-server.js`). **Write & restart** Caspar after changing consumer flags.

**Preview** outputs may use a separate policy (`preview_screen_consumer`); program **PGM/PRV screen consumers** on NVIDIA should follow the table above.

## Verification

1. NVIDIA: Sync to VBlank **off** (see query above).
2. Caspar config: `<vsync>true</vsync>` on the program screen consumer(s).
3. Observe output: no torn frames at stable refresh; frame drops show in Caspar log rather than horizontal tears.

## Related docs

- [GPU_SCREEN_CONSUMER_AND_XRANDR.md](GPU_SCREEN_CONSUMER_AND_XRANDR.md) — destinations, xrandr, consumer geometry
- [xrandr-gpu-screen-mapping.md](xrandr-gpu-screen-mapping.md) — Apply GPU / OS layout
- [caspar_config_explained.md](../caspar_config_explained.md) — `<screen>` consumer XML
- [ISO_CONTENTS.md](../ISO_CONTENTS.md) — baked NVIDIA X session defaults on live ISO

*Last updated: 2026-06-03*
