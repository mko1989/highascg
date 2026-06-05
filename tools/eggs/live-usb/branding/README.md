# HighAsCG boot branding (GRUB + Plymouth)

Two separate layers on the live ISO:

| Layer | When | What you see today | Customize |
|-------|------|-------------------|-----------|
| **GRUB / isolinux** | Boot menu (**3 s** timeout) | Background image + menu (eggs penguins model) | `splash.boot.jpg` + `grub.theme.cfg` + `font.pf2` (GNU Unifont) |
| **Plymouth** | Kernel loading until desktop | **Split screen**: logs left **2/3**, logo right **1/3** (opaque RGB) | `highascg.script` + `splash systemd.show_status=true` |

## Eggs / Wardrobe (official model)

[penguins-eggs themes](https://penguins-eggs.net/blog/themes) and the [wardrobe guide](https://penguins-eggs.net/docs/Tutorial/wardrobe-users-guide) describe a **vendor** directory:

```text
highascg-eggs-theme/          ← vendor root (eggs.yaml theme: or --theme)
  theme/
    livecd/                   ← GRUB + isolinux (splash.png, grub.main.cfg, grub.theme.cfg)
    applications/             ← symlinks to eggs defaults
    artwork/
    branding/                 ← Calamares (optional)
```

Produce must use that vendor **at ISO build time**:

```bash
grep '^theme:' /etc/penguins-eggs.d/eggs.yaml
# theme: /home/casparcg/highascg/tools/eggs/live-usb/highascg-eggs-theme

sudo eggs produce --nointeractive --clone --max --basename highascg \
  --theme /path/to/highascg-eggs-theme
# eggs produce ignores eggs.yaml theme: without --theme (build-highascg-egg.sh passes it)
```

Eggs **copies** `theme/livecd/splash.png` into the ISO at produce; Plymouth is **not** in the theme — it is baked via `mkinitramfs` on the build host during produce (`finalize-boot-branding-for-eggs-produce.sh`).

## Quick setup (build host)

```bash
# Optional: add your artwork (see sizes below)
cp /path/to/your-wallpaper.png tools/eggs/live-usb/branding/splash.png

sudo bash tools/eggs/live-usb/install-eggs-live-grub-theme.sh
# also installs Plymouth + updates initramfs

sudo bash tools/eggs/live-usb/build-highascg-egg.sh
# or: sudo bash tools/eggs/live-usb/verify-iso-boot-branding.sh /home/eggs/mnt/highascg_*.iso
```

Re-flash the USB after a new ISO is produced.

**Important:** `eggs produce` runs **`mkinitramfs`** and writes a **new** `live/initrd*.img` on the ISO (it does not copy `/boot/initrd.img` verbatim). Plymouth must be configured on the build host **immediately before** `eggs produce` — `build-highascg-egg.sh` runs `finalize-boot-branding-for-eggs-produce.sh` for that.

**GRUB wallpaper:** Eggs copies stock **`splash.png` after** the ISO tree is built, so a plain `eggs produce` **drops** your custom GRUB image. **`build-highascg-egg.sh`** always runs **`inject-iso-boot-branding.sh`** after produce (re-copies `splash.png`, rebuilds initrd, re-packs ISO). If you run `eggs produce` manually you **must** pass **`--theme …/highascg-eggs-theme`** and then run **`inject-iso-boot-branding.sh`** + **`verify-iso-boot-branding.sh`**.

After the build, `verify-iso-boot-branding.sh` checks the ISO initrd for `highascg` and that `boot/grub/splash.png` is not stock penguins.

If you still see **penguins** at the GRUB menu or **terminal text** during boot, the ISO was built without that step (or without `branding/splash.png`). Rebuild with `sudo npm run eggs:build` and re-flash.

## Artwork files

| File | Used for | Recommended |
|------|----------|-------------|
| **`splash.png`** | GRUB background, isolinux (`desktop-image`) | **1024×768** or **1920×1080**, PNG/JPEG, &lt; 2 MiB |
| **`logo.png`** | Optional future / watermark experiments | **256–512 px** wide, transparent PNG |

If **`splash.png`** is missing, the installer keeps the stock **eggs** GRUB background until you add one.

### GRUB menu only (no full wallpaper)

You can use a mostly dark **`splash.png`** and rely on **`highascg-eggs-theme/theme/livecd/grub.theme.cfg`** for menu colours (already dark blue + white text).

## Custom Plymouth animation (multiple PNGs)

**Yes.** The installed **`highascg`** theme uses Ubuntu’s **`two-step`** module (same as the **spinner** theme). It plays two frame sequences:

| Sequence | Files on disk | Typical role |
|----------|---------------|--------------|
| **Throbber (only)** | `throbber-0001.png` … `throbber-0004.png` | Small spinner — from `animation/1.png`, `2.png`, `29.png`, `30.png` |

### Drop-in replacement (easiest)

Put your frames in the repo **before** running the install script:

```text
tools/eggs/live-usb/branding/plymouth/animation/   → 0001.png, 0002.png, … (any count; renamed on install)
tools/eggs/live-usb/branding/plymouth/throbber/    → optional; replaces the dots only
```

Files are sorted by name, then installed as `animation-0001.png`, `animation-0002.png`, …

**Tips:**

- Default spinner frames are **32×32** PNG with transparency. Keep frames the **same size** across the sequence.
- You can ship **only** `animation/` and leave the stock throbber dots, or replace both.
- **Frame count:** `two-step` is happiest with **36** animation + **30** throbber frames (same as spinner). Other counts often work if you replace the **whole** set; test with `sudo plymouthd && sudo plymouth --show-splash`.
- After changes: `sudo bash tools/eggs/live-usb/install-highascg-plymouth-theme.sh` then rebuild the ISO.

**Making frames from video/GIF:** use ffmpeg, e.g.  
`ffmpeg -i clip.mp4 -vf fps=12,scale=32:32 branding/plymouth/animation/frame-%04d.png`  
then rename or let the install script sort them.

### Full-screen / arbitrary frame counts

If **`branding/plymouth/animation/*.png`** exists (your **134×178 RGBA** frames are fine), **`install-highascg-plymouth-theme.sh`** switches to the **`script`** module: animation in the **right third** of the screen (vertically centred), no Ubuntu wordmark. Frames are installed in **natural sort order** (`1.png` … `30.png`, not `1, 10, 11, 2`).

## Boot console + right-third animation

Default GRUB/isolinux line (see `grub.main.cfg`):

`console=tty1 fbcon=nodefer splash loglevel=4 …` — **no `quiet`**, so kernel/systemd text stays on the **left ~2/3** while Plymouth draws only the RGBA loop in the **right third** (no full-screen background in the script theme).

| Symptom | Likely cause |
|---------|----------------|
| Black screen after GRUB, then TTY flash | **NVIDIA:** initrd missing `nvidia_drm` + `nvidia-drm.fbdev=1` (theme files alone are not enough) |
| No animation, only scrolling text | ISO still has `quiet splash` (inject did not patch grub) or Plymouth DRM never opened |
| Purple Ubuntu dots | Old initrd (`ubuntu-text`) — reinstall Plymouth + rebuild ISO |
| verify passes theme but stick still blank | Stick not re-flashed after inject, or testing old ISO from before inject |

## Preview before eggs produce / USB flash

**Do not run `plymouthd` / `plymouth --show-splash` on the eggs build host** while Xorg, nodm, or CasparCG outputs are up — it takes over DRM and can blank monitors until reboot or `recover-display-after-plymouth.sh`.

| Step | Command |
|------|---------|
| Frame list + safe MP4 mockup (no root) | `bash tools/eggs/live-usb/preview-plymouth-boot-branding.sh` |
| Play mockup | `bash …/preview-plymouth-boot-branding.sh --open` → `work/plymouth-corner-preview.mp4` |
| Install theme for ISO only | `sudo bash …/preview-plymouth-boot-branding.sh --install` |
| Full boot path (GRUB → console → Plymouth) | `sudo bash tools/eggs/live-usb/preview-live-iso-qemu.sh [/path/to.iso]` |
| Video lost after old preview | `sudo bash tools/eggs/live-usb/recover-display-after-plymouth.sh` |

Use **QEMU** for real Plymouth + kernel console together. After preview looks right, rebuild and flash as usual.

After changing Plymouth or frames: **`sudo bash tools/eggs/live-usb/install-highascg-plymouth-theme.sh`**, then **rebuild the ISO** (`inject-iso-boot-branding.sh` runs this automatically). Re-flash the stick. Old May ISO still has **ubuntu-text** in initrd.

## Plymouth (purple Ubuntu → HighAsCG)

Default Ubuntu live uses **`plymouth-theme-ubuntu-text`** (purple + “Ubuntu” + dots).

**`install-eggs-live-grub-theme.sh`** installs **`plymouth-theme-spinner`**, copies it to **`/usr/share/plymouth/themes/highascg`**, applies **`branding/plymouth/highascg.plymouth`** (dark background, blue progress, **no Ubuntu wordmark**), sets the default theme, and runs **`update-initramfs -u`**.

Quick preview (see table above):

```bash
bash tools/eggs/live-usb/preview-plymouth-boot-branding.sh --open
sudo bash tools/eggs/live-usb/preview-plymouth-boot-branding.sh --install   # ISO theme only
```

## Changing colours without new images

Edit:

- **GRUB:** `tools/eggs/live-usb/highascg-eggs-theme/theme/livecd/grub.theme.cfg`
- **Plymouth:** `tools/eggs/live-usb/branding/plymouth/highascg.plymouth` (`BackgroundStartColor`, `ProgressBarForegroundColor`, …)

Then re-run **`install-eggs-live-grub-theme.sh`** and **`eggs produce`**.

## Calamares installer slideshow

The graphical **installer** still uses eggs **Calamares** branding under `theme/calamares/branding/` (penguin artwork). Replacing that is a separate task; say if you want a HighAsCG slideshow there too.
