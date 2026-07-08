# HighAsCG boot branding (GRUB + Plymouth)

Two separate layers on the live ISO:

| Layer | When | What you see today | Customize |
|-------|------|-------------------|-----------|
| **GRUB / isolinux** | Boot menu (**5 s** timeout) | Background image + menu (eggs penguins model) | `splash.boot.jpg` + `grub.theme.cfg` + `font.pf2` (GNU Unifont) |
| **Plymouth** | Kernel loading until desktop (optional) | **Alternate** ISO menu: splash + corner throbber. **Default Live** = full dmesg (`nosplash`) | `throbber-boot/` + `install-highascg-plymouth-theme.sh` |

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

### GRUB menu: cannot see which entry is highlighted

**Symptom:** Labels visible but the selected row looks identical to the others.

**Cause:** `item_color` and `selected_item_color` were both `white`; only a subtle background shift marked selection.

**Fix (in repo):** selected row = bright blue bar (`94, 179, 255`) + dark text (`#0c1220`); unselected = light gray (`#b8c4d8`). Text fallback: `menu_color_highlight=black/light-cyan`. Rebuild and re-flash.

### GRUB menu: blank black panel (no entry labels)

**Symptom:** Wallpaper visible but a dark rectangle covers the menu; no white text / no selectable lines.

**Cause:**

1. **`font.pf2` missing or wrong** — `grub.theme.cfg` uses `GNU Unifont Regular 16`; if `loadfont` fails, gfxmenu draws the menu box with no glyphs.
2. **`gfxmode=1920x1080` only** on a laptop panel — theme layout can clip or letterbox the menu region.
3. **Opaque `boot_menu` background** without `menu_bg_color` / font — looks like a solid black bar.

**Fix (in repo):** `grub.theme.cfg` sets `menu_bg_color` + `selected_item_bg_color`; `grub.main.cfg` / inject use a **gfxmode fallback chain**; `inject-iso-boot-branding.sh` copies `/boot/grub/font.pf2` onto the ISO. Rebuild and re-flash.

**On stick now (no rebuild):** mount the EFI/ISO partition, edit `boot/grub/grub.cfg`: `set timeout=5`; confirm `boot/grub/font.pf2` exists; replace `boot/grub/theme.cfg` from the repo.

### Post-GRUB black box (~50% screen, ~2 seconds)

**Symptom:** After choosing **Live** in GRUB, a dark centred rectangle (letterbox) for ~2 s, then kernel dmesg scrolls.

**Cause:**

1. **`gfxmode=auto`** with a **1920×1080** `splash.png` — GRUB centres the wallpaper on `desktop-color` `#0c1220` (near-black) → looks like a half-size black panel.
2. **`gfxpayload=auto`** on the default menu entry — kernel inherits a frozen graphics framebuffer briefly before text console.

**Fix (in repo):** `grub.main.cfg` uses **`gfxmode=1920x1080`** and default Live uses **`set gfxpayload=text`** before `linux` (clean handoff to `nosplash` dmesg). Rebuild ISO after pulling.

**On laptop now (no rebuild):** pick **Text Mode** once to confirm, or edit ISO `boot/grub/grub.cfg` default entry: `set gfxpayload=text`, `gfxmode=1920x1080`.

## Artwork files

| File | Used for | Recommended |
|------|----------|-------------|
| **`splash.png`** | GRUB background, isolinux (`desktop-image`) | **1024×768** or **1920×1080**, PNG/JPEG, &lt; 2 MiB |
| **`logo.png`** | Optional future / watermark experiments | **256–512 px** wide, transparent PNG |

If **`splash.png`** is missing, the installer keeps the stock **eggs** GRUB background until you add one.

### GRUB menu only (no full wallpaper)

You can use a mostly dark **`splash.png`** and rely on **`highascg-eggs-theme/theme/livecd/grub.theme.cfg`** for menu colours (already dark blue + white text).

## Custom Plymouth animation (multiple PNGs)

**Default:** Plymouth **`script`** module — **systemd status lines scroll on the left**, **4 throbber frames** animate in the **top-right corner** (`throbber-boot/`). Requires kernel `splash systemd.show_status=true` (no `quiet`).

| Source | Installed as | Role |
|--------|--------------|------|
| `throbber-boot/1–4.png` | `throbber-0001.png` … `throbber-0004.png` | Small corner spinner (from `animation/1.png`, `2.png`, `29.png`, `30.png`) |

`prepare-branding-assets.sh` builds `throbber-boot/` automatically. Replace those 4 PNGs (or change `PLYMOUTH_THROBBER_FRAMES`) before install.

### Optional modes

| Env var | Result |
|---------|--------|
| *(default)* | Throbber top-right + status log left |
| `HIGHASCG_PLYMOUTH_FULL_ANIM=1` | Large 30-frame mascot right 1/3 + log left |
| `HIGHASCG_PLYMOUTH_TWO_STEP=1` | Legacy Ubuntu two-step (may hide framebuffer logs behind full-screen bg) |

**Tips:**

- Default spinner frames are **32×32** PNG with transparency. Keep frames the **same size** across the sequence.
- You can ship **only** `animation/` and leave the stock throbber dots, or replace both.
- **Frame count:** `two-step` is happiest with **36** animation + **30** throbber frames (same as spinner). Other counts often work if you replace the **whole** set; test with `sudo plymouthd && sudo plymouth --show-splash`.
- After changes: `sudo bash tools/eggs/live-usb/install-highascg-plymouth-theme.sh` then rebuild the ISO.

**Making frames from video/GIF:** use ffmpeg, e.g.  
`ffmpeg -i clip.mp4 -vf fps=12,scale=32:32 branding/plymouth/animation/frame-%04d.png`  
then rename or let the install script sort them.

## Boot console (default) vs Plymouth splash (alternate)

**Default Live** (`grub.main.cfg`): `nosplash loglevel=7 ignore_loglevel console=tty0` — **full early kernel dmesg** on screen. Plymouth cannot run at the same time (it replaces the text console). The playout host and ISO rootfs can still show the **small corner throbber** via `highascg-fb-corner-throbber.service` (framebuffer overlay, no Plymouth).

**Alternate menu** “Live (Plymouth splash)”: `splash` + corner throbber — use when you want branding instead of dmesg.

**Playout host** (`install-host-boot-branding.sh`): same as default Live — GRUB wallpaper + full dmesg + **framebuffer corner throbber** (`install-fb-corner-throbber.sh`); Plymouth masked on the host.

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

**Branded since WO-148.** `highascg-eggs-theme/theme/calamares/` is now a **real repo directory** (it used to be a symlink to `/usr/lib/penguins-eggs/addons/eggs/theme/calamares` — that is how the penguin slideshow reached the ISO). It contains:

| File | Role |
|------|------|
| `branding/show.qml` | HighAsCG slideshow — dark `#0c1220` background, wordmark, GRUB-palette colours (`#5eb3ff` accent, `#b8c4d8` text) |
| `branding/highascg-mascot.png` | Slide artwork (copy of `branding/splash.png`) — **owner can replace** with richer art later, keep the name |
| `branding/highascg-eggs-theme-logo.png`, `eggs-logo.png`, `welcome.png` | Product logo/icon names eggs 26.6.2 / Calamares look for |
| `branding/branding.desc` | Stub — eggs generates the real one at `eggs calamares` time |
| `modules/*.yaml` | Installer module configs (refreshed from eggs defaults by `install-eggs-live-grub-theme.sh`) |

Wiring: `install-eggs-live-grub-theme.sh` removes any legacy symlink and refuses a non-HighAsCG `show.qml`; `install-eggs-calamares.sh` syncs `branding/` (minus `branding.desc`) into `/etc/calamares/branding/highascg-eggs-theme/` on every run and deletes stale penguin slide PNGs; `verify-calamares-installed.sh` (pre-produce) and `verify-iso-boot-branding.sh` (post-produce, reads `show.qml` out of the ISO squashfs) both FAIL on a penguins slideshow.
