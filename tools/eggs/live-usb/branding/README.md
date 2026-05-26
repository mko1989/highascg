# HighAsCG boot branding (GRUB + Plymouth)

Two separate layers on the live ISO:

| Layer | When | What you see today | Customize |
|-------|------|-------------------|-----------|
| **GRUB / isolinux** | Boot menu (10 s countdown) | Background image + menu | `splash.png` + `grub.theme.cfg` |
| **Plymouth** | Kernel loading until desktop | Purple Ubuntu + dots | Plymouth theme `highascg` (dark blue + spinner dots) |

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

**Important:** `eggs produce` runs **`mkinitramfs`** and writes a **new** `live/initrd*.img` on the ISO (it does not copy `/boot/initrd.img` verbatim). Plymouth must be configured on the build host **immediately before** `eggs produce` — `build-highascg-egg.sh` runs `finalize-boot-branding-for-eggs-produce.sh` for that. After the build, `verify-iso-boot-branding.sh` checks the ISO initrd for `highascg`.

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
| **Main animation** | `animation-0001.png` … `animation-0036.png` | Logo / motion above the spinner (36 frames in the default pack) |
| **Throbber** | `throbber-0001.png` … `throbber-0030.png` | Small loading dots (30 frames) |

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

For a large logo or a different number of frames, you need a **`script`** Plymouth theme (`.plymouth` + `.script` that loads `Image("frame-001.png")` in a loop). That is not bundled yet; the spinner/`two-step` path above is the supported operator workflow.

## Plymouth (purple Ubuntu → HighAsCG)

Default Ubuntu live uses **`plymouth-theme-ubuntu-text`** (purple + “Ubuntu” + dots).

**`install-eggs-live-grub-theme.sh`** installs **`plymouth-theme-spinner`**, copies it to **`/usr/share/plymouth/themes/highascg`**, applies **`branding/plymouth/highascg.plymouth`** (dark background, blue progress, **no Ubuntu wordmark**), sets the default theme, and runs **`update-initramfs -u`**.

To preview on the build host (reboot to see fully):

```bash
sudo plymouthd
sudo plymouth --show-splash
sleep 3
sudo plymouth quit
```

## Changing colours without new images

Edit:

- **GRUB:** `tools/eggs/live-usb/highascg-eggs-theme/theme/livecd/grub.theme.cfg`
- **Plymouth:** `tools/eggs/live-usb/branding/plymouth/highascg.plymouth` (`BackgroundStartColor`, `ProgressBarForegroundColor`, …)

Then re-run **`install-eggs-live-grub-theme.sh`** and **`eggs produce`**.

## Calamares installer slideshow

The graphical **installer** still uses eggs **Calamares** branding under `theme/calamares/branding/` (penguin artwork). Replacing that is a separate task; say if you want a HighAsCG slideshow there too.
