# Screen consumer vsync (NVIDIA)

> **SUPERSEDED for the consumer-vsync row (06.08.26, todos06.08 / WO-447):** with
> `CASPAR_GL_SYNC_DISPLAY=<PGM connector>` active (WO-407→444), the owner verified **GL sync +
> consumer vsync OFF is perfect** — consumer vsync on top only adds a competing wait. The
> HighAsCG default for `screen_N_vsync` is now **false** (`defaults-caspar-server.js`,
> `screen-consumer-defaults.js`, generator fallback). The NVIDIA driver rows below (Sync to
> VBlank **off**, Force Composition Pipeline **on**) still stand.

Historical setup for **smooth, tear-free** output on CasparCG **screen** consumers when the playout GPU is **NVIDIA** (pre-GL-sync era).

> **Multi-head box? This recipe is necessary but NOT sufficient.** With more than one
> display on the X screen, GL vsync gates on ONE head (the primary by default) and every
> other display beats against it — irregular micro-stutter on the on-air output while the
> operator monitor stays smooth. See
> [multi-head-gl-vblank-sync.md](./multi-head-gl-vblank-sync.md) (WO-407):
> `__GL_SYNC_DISPLAY_DEVICE=<PGM connector>` via `~/.config/highascg/caspar-env`.

## Required combination

| Layer | Setting | Value |
|-------|---------|--------|
| **NVIDIA** (`nvidia-settings`) | **Sync to VBlank** (`SyncToVBlank` on GPU/screen) | **Off** |
| **NVIDIA** (`nvidia-settings` → X Server Display Configuration → Advanced, per output) | **Force composition pipeline** | **On** (all connected screens) |
| **Caspar screen consumer** (`<screen>` / HighAsCG `screen_N_vsync`) | **V-sync** | **On** (`true`) |

Do **all three**. Using only one side often causes tearing, stutter, or frame pacing that looks like “bad vsync.”

## Why

- **Driver sync-to-vblank** forces OpenGL swaps to the display refresh at the **driver** level for all GL clients on that GPU.
- Caspar’s **screen consumer** has its own **vsync** when presenting the playout window.
- With NVIDIA **Sync to VBlank on**, the driver and the consumer can **double-sync** or fight each other → uneven frame times.
- With NVIDIA **Sync to VBlank off**, **Force Composition Pipeline on** (all outputs), and Caspar **vsync on**, presentation is gated correctly for playout — verified on multi-head DP/HDMI + DeckLink setups.

## How to apply

### NVIDIA (OS / X session)

1. Open **`nvidia-settings`** (HighAsCG: **Settings → System → Open NVIDIA Settings**, or `DISPLAY=:0 nvidia-settings`).
2. **X Server Display Configuration** → **Advanced** (per output): enable **Force composition pipeline** on **every** connected screen (not “Force full composition pipeline”).
3. Under the GPU (and screen section if shown), set **Sync to VBlank** to **disabled / off**.
4. Confirm with:
   ```bash
   nvidia-settings -q "[gpu:0]/SyncToVBlank"
   nvidia-settings -q CurrentMetaMode -t | grep ForceCompositionPipeline
   ```
   (`SyncToVBlank` **0** = off; each MetaMode block should include `ForceCompositionPipeline=On`)

HighAsCG production install also sets:

- Environment: **`__GL_SYNC_TO_VBLANK=0`** in the X session / autostart chain.
- Script: **`highascg-nvidia-x-apply.sh`** (PowerMizer max, `SyncToVBlank=0`, **Force Composition Pipeline on all outputs**), installed by `scripts/setup/09-openbox-autostart.sh` from `tools/runtime/highascg-nvidia-x-apply.sh`. Node bridge resolves the same script via `src/utils/nvidia-display-policy.js` after every layout apply and before opening **nvidia-settings** from Settings.

Re-run after layout apply, **nodm restart**, driver upgrades, or if tearing returns:

**Important:** `xrandr` / layout apply resets NVIDIA **CurrentMetaMode** and clears per-output **Force Composition Pipeline** in MetaMode. HighAsCG runs `highascg-nvidia-x-apply.sh` **after** every `apply-layout.sh` (openbox autostart + apply-layout tail), with retries at 6s and 18s.

**Persistent defaults (no polling watchdog):**

1. **Xorg** — `scripts/setup/09-openbox-autostart.sh` installs `/etc/X11/xorg.conf.d/99-highascg-force-composition.conf` with `Option "ForceCompositionPipeline" "On"` on the NVIDIA device (driver default at session start).
2. **nvidia-settings rc** — after each apply, `highascg-nvidia-x-apply.sh` runs `nvidia-settings --save` so `~/.nvidia-settings-rc` includes the patched `CurrentMetaMode`.
3. **Runtime** — any `xrandr` layout change must still be followed by `highascg-nvidia-x-apply.sh` (wired into `apply-layout.sh` and full config apply).

Permanent on a production box:

1. Install script + openbox chain: `sudo bash scripts/setup/09-openbox-autostart.sh` (from the HighAsCG repo).
2. Ensure `~/.config/highascg/apply-layout.sh` exists (run **Apply** once from the UI, or `POST /api/caspar-config/apply`).
3. After manual `sudo systemctl restart nodm`, composition pipeline is re-applied automatically (layout script + delayed retries).

Manual check / one-shot fix:

```bash
DISPLAY=:0 XAUTHORITY=/home/casparcg/.Xauthority /usr/local/bin/highascg-nvidia-x-apply.sh
```

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

1. NVIDIA: Sync to VBlank **off**; CurrentMetaMode shows **ForceCompositionPipeline=On** on each output.
2. Caspar config: `<vsync>true</vsync>` on the program screen consumer(s).
3. Observe output: no torn frames at stable refresh; frame drops show in Caspar log rather than horizontal tears.

## Related docs

- [GPU_SCREEN_CONSUMER_AND_XRANDR.md](GPU_SCREEN_CONSUMER_AND_XRANDR.md) — destinations, xrandr, consumer geometry
- [xrandr-gpu-screen-mapping.md](xrandr-gpu-screen-mapping.md) — Apply GPU / OS layout
- [caspar_config_explained.md](../caspar_config_explained.md) — `<screen>` consumer XML
- [ISO_CONTENTS.md](../ISO_CONTENTS.md) — baked NVIDIA X session defaults on live ISO

*Last updated: 2026-06-24*
