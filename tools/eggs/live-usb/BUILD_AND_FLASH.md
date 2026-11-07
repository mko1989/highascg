# HighAsCG live USB — build the ISO and put it on a stick

**What is inside the ISO?** Stack from Ubuntu → nodm/Openbox → NVIDIA → DeckLink → CasparCG → HighAsCG (and WO‑47 exFAT split): **[`docs/ISO_CONTENTS.md`](../../../docs/ISO_CONTENTS.md)**.

> ## Sticks are Ventoy-only
>
> Procedure: **[`docs/STICK_QUICK_START.md`](../../../docs/STICK_QUICK_START.md)** — install Ventoy
> reserving space at the end of the disk, create `HIGHASCGEXF` in that space, then copy each new ISO
> onto the Ventoy partition. No reflash per build, and the previous ISO stays as a fallback.
>
> Flashing the ISO with `dd` / Etcher is deprecated and its scripts were removed: it destroys the
> Ventoy layout and the `HIGHASCGEXF` partition.

**Build the ISO:**

```bash
cd ~/highascg
sudo bash tools/eggs/live-usb/build-highascg-egg.sh   # driver branch auto-detected (615 on 26.04)
# npm run eggs:build
```

Wait for **`Done. ISO:`** — the file appears minutes earlier and is still being re-packed; the
`<iso>.sha256` sidecar is written last and is the ready signal. Then copy to the stick's Ventoy
partition, `sync`, and verify with `verify-stick-iso.sh`.

The `HIGHASCGEXF` partition is the **third** partition of the stick (see `docs/STICK_QUICK_START.md`); systemd mounts it by label. The build warns if Blackmagic **`desktopvideo*`** packages are missing from the clone source; **`--decklink-required`** exits non‑zero unless they’re installed (*`sudo bash scripts/install.sh`* with Desktop Video tarball). The string **`highascg-data`** cannot be the literal exFAT volume label (**11 characters max**); operators still call it “data”; **`HIGHASCGEXF`** is what systemd mounts.

See **[`docs/CASPAR_IMAGE_VS_HIGHASCG_OVERLAY.md`](../../../docs/CASPAR_IMAGE_VS_HIGHASCG_OVERLAY.md)** for how a **Caspar-only** squashfs coexists with **HighAsCG synced from exFAT**. (The desktop Stick Studio, `client/tools/stick-tools`, was removed in WO-995.)

### Automated dev prerelease on GitHub (ISO + ZIP)

To publish **`highascg_*.iso`** (Eggs WO‑47 excludes) and **`highascg_<UTC>.tar.gz`** (full tree, **`node_modules` included by default**) as GitHub prerelease assets from a machine already set up as a build/run host:

[`docs/DEV_RELEASE_GITHUB.md`](../../../docs/DEV_RELEASE_GITHUB.md) · `npm run release:github-server` (`release:github-server:dry` preview); full-ISO publishing is a manual/deprecated flow (see that doc).

## Build host (Ubuntu Noble recommended)

1. **Install eggs** (if apt repo fails, use the latest `.deb` from  
   https://github.com/pieroproietti/penguins-eggs/releases )

2. **One-shot build** (WO-47 / operator exFAT baked into **`/etc`**, network stack, NVIDIA offline cache, eggs excludes + ISO):

   ```bash
   cd /path/to/highascg
   sudo bash tools/eggs/live-usb/build-highascg-egg.sh   # or: npm run eggs:build
   ```

   The build script runs **`prepare-eggs-clone-with-exfat.sh`** first (mount + bind + boot sync units, **`highascg.service`** ordering, empty **`~/exfat`** / **`~/highascg/media/*`** stubs, merge of **`tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list`**). Legacy eggs only: if **`/etc/penguins-eggs.d/exclude.list`** does not exist yet, run Eggs config or a preliminary **`eggs produce`** once (eggs 26.10 uses **`custom.exclude.list`** from **`install-eggs-config.sh --apply`**, which the build applies itself); then rerun the build script or **`sudo bash tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh`** (also: `npm run eggs:prepare`). Stick + exFAT workflow: [**`EXFAT_DATA_ZERO_TOUCH.md`**](EXFAT_DATA_ZERO_TOUCH.md).

   Optional:

   ```bash
   sudo BASENAME=highascg bash tools/eggs/live-usb/build-highascg-egg.sh
   ```

3. **Kernel (one version)** — `build-highascg-egg.sh` runs `sync-eggs-kernel-and-purge-stale.sh` with **`HIGHASCG_ENSURE_LATEST_KERNEL=1`**: installs **`linux-image-generic`**, points **`eggs.yaml`** at the **newest** `linux-image-*-generic`, purges older images. The ISO matches that kernel, not necessarily the kernel you booted before the build. If the script warns that running ≠ latest, **reboot** after the build (or before a long `eggs remaster`) so DKMS (NVIDIA, DeckLink) matches.

4. **Output**: ISO under `/home/eggs/` — name starts with `BASENAME` (default `highascg`), e.g.  
   `highascg_amd64_YYYY-MM-DD_HHMM.iso`

5. **Netplan**: If `netplan` warns about permissions, fix once:

   ```bash
   sudo chmod 600 /etc/netplan/01-live-networkd.yaml
   ```

6. **Excludes** (large dirs omitted from squashfs): fragment merged via **`prepare-eggs-clone-with-exfat.sh`** (or **`merge-penguins-eggs-exclude-highascg.sh`**) — includes **`home/casparcg/highascg/media`** and **`home/casparcg/exfat/*`** so the ISO carries an empty WO-47 stub, not developer scratch files. **`swap.img`** is excluded and **`strip-host-swap-for-live-iso.sh`** drops file-swap from **`/etc/fstab`** during produce (restored on the build host after **`build-highascg-egg.sh`**).

7. **Tailscale / tailnet identity**: A cloned ISO is **not** automatically “logged out.” If `tailscaled` state existed on the build host when `eggs remaster` ran, that **machine key** is copied into the squashfs unless every storage path is excluded. The laptop then joins the tailnet **as the same node** as the builder (same key → same identity; it effectively replaces that machine until you fix it).  
   - `.deb` installs often use **`/var/lib/tailscale/`**, but **snap** layouts use **`/var/snap/tailscale/…`** — so “no `/var/lib/tailscale`” does **not** prove there is no shipped identity.  
   - Custom locations: check **`systemctl cat tailscaled`** and **`/etc/default/tailscaled`** for `--statedir=` / `--state=`. Add matching paths to **`tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list`**, run **`merge-penguins-eggs-exclude-highascg.sh`**, rebuild.  
   - Sanity-check the ISO/squashfs: mount or `unsquashfs -ll` and search for **`tailscaled.state`** (and anything under **`var/snap/tailscale/`**).

---

## Copy to the stick

Copy the ISO to the **Ventoy** partition, `sync`, and verify (details: [`HOW_TO_BUILD_AND_FLASH_EGGS.md`](./HOW_TO_BUILD_AND_FLASH_EGGS.md)):

```bash
cp /home/eggs/highascg*.iso /media/$USER/Ventoy/ && sync
bash tools/eggs/live-usb/verify-stick-iso.sh /media/$USER/Ventoy/<iso>
```

Stick contents and server drops: [`MANUAL_STICK_WINDOWS_MACOS.md`](./MANUAL_STICK_WINDOWS_MACOS.md).

---

## GRUB says live/install but there is no disk installer

The menu text does **not** guarantee Calamares (GUI installer) is inside the ISO. With **`eggs remaster --clone`** (legacy: `eggs produce --clone`) you get a live system clone; the graphical installer is only present if you add it **on the build host**, then rebuild.

### Option A — Calamares (GUI install baked into the ISO)

On the **build machine**, before rebuilding:

```bash
sudo eggs calamares --help
sudo eggs calamares
```

Follow prompts so Calamares is installed **and** configured for eggs, then run `build-highascg-egg.sh` again.

After copying the new ISO to the stick, boot live and start the graphical installer from the desktop/menu (exact label depends on your calamares theme).

### Option B — Krill (TUI install from the live USB, no rebuild)

Eggs ships **`krill`**. From the live session terminal:

```bash
sudo eggs krill --help
sudo eggs krill
```

That installs to disk without Calamares in the ISO.

### Option C — No install — only `~/highascg` on a data partition (advanced / narrow)

Union (whole-stick) persistence is retired; durable data lives on `HIGHASCGEXF`. For the narrow case of an ext4 partition holding only `~/highascg`, see [HIGHASCG_FOLDER_USB_PARTITION.md](./HIGHASCG_FOLDER_USB_PARTITION.md). It does **not** preserve NVIDIA/Tailscale/system-wide changes.

---

## Live session notes

- Default live user/password are whatever **eggs** printed at the end of the build (often `live` / `evolution`-style — check build log).
- Wired DHCP: image should ship **systemd-networkd** + **netplan** `renderer: networkd` + **NetworkManager** as fallback from the build script.
