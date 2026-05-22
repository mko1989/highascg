# HighAsCG live USB — build and flash

**What is inside the ISO?** Stack from Ubuntu → nodm/Openbox → NVIDIA → DeckLink → CasparCG → HighAsCG (and WO‑47 exFAT split): **[`docs/ISO_CONTENTS.md`](../../docs/ISO_CONTENTS.md)**.

**All-in-one (build + choose USB + `dd` + `/ union` persistence):**

```bash
cd /path/to/highascg
sudo bash tools/live-usb/build-flash-and-persist.sh
# sudo bash tools/live-usb/build-flash-and-persist.sh --help
```

Use `--flash-only` if the ISO is already built; `--usb /dev/sdX` and `--iso /path` for less interactive use.

### Operator stick — one command (`build-operator-stick`)

```bash
cd /path/to/highascg
sudo bash tools/live-usb/build-operator-stick.sh
```

Runs **`build-highascg-egg.sh`** (WO‑47 **`/etc`** prep, Eggs **`--clone --max --excludes static`**, NVIDIA offline cache), confirms the **USB whole-disk** interactively (`dd`), adds **exFAT `HIGHASCGEXF`** with start **≥ hybrid ISO tail** and **≥ ceil(ISO MiB)+`EXFAT_AFTER_ISO_MARGIN_MIB`** (**1152** MiB default — adjust if your ISO grows), then **union persistence**. Warns if Blackmagic **`desktopvideo*`** packages are missing from the clone source; **`--decklink-required`** exits non‑zero unless they’re installed (*`sudo bash scripts/install.sh`* with Desktop Video tarball). The string **`highascg-data`** cannot be the literal exFAT volume label (**11 characters max**); operators still call it “data”; **`HIGHASCGEXF`** is what systemd mounts.

### Desktop helper — Stick Studio (`tools/stick-tools`)

On a workstation with a display (and **`python3-tk`**): flash ISO + optional exFAT + seed operator dirs + optional copy to `sim/highascg`, plus **Start simulation** — `npm run stick-studio` from the repo root. Destructive steps use **pkexec**. Details: **`tools/stick-tools/README.md`**. See **[`docs/CASPAR_IMAGE_VS_HIGHASCG_OVERLAY.md`](../../docs/CASPAR_IMAGE_VS_HIGHASCG_OVERLAY.md)** for how a **Caspar-only** squashfs coexists with **HighAsCG synced from exFAT**.

### Automated dev prerelease on GitHub (ISO + ZIP)

To publish **`highascg_*.iso`** (Eggs WO‑47 excludes) and **`highascg_<UTC>.tar.gz`** (full tree, **`node_modules` included by default**) as GitHub prerelease assets from a machine already set up as a build/run host:

[`docs/DEV_RELEASE_GITHUB.md`](../../docs/DEV_RELEASE_GITHUB.md) · `npm run release:dev-github` (`release:dev-github:dry` preview).

## Build host (Ubuntu Noble recommended)

1. **Install eggs** (if apt repo fails, use the latest `.deb` from  
   https://github.com/pieroproietti/penguins-eggs/releases )

2. **One-shot build** (WO-47 / operator exFAT baked into **`/etc`**, network stack, NVIDIA offline cache, eggs excludes + ISO):

   ```bash
   cd /path/to/highascg
   sudo bash tools/live-usb/build-highascg-egg.sh
   ```

   The build script runs **`prepare-eggs-clone-with-exfat.sh`** first (mount + bind + boot sync units, **`highascg.service`** ordering, empty **`~/exfat`** / **`~/highascg/media/*`** stubs, merge of **`penguins-eggs-exclude-highascg-fragment.list`**). If **`/etc/penguins-eggs.d/exclude.list`** does not exist yet, run Eggs config or a preliminary **`eggs produce`** once; then rerun the build script or **`sudo bash tools/live-usb/prepare-eggs-clone-with-exfat.sh`**. Stick + exFAT workflow: [**`EXFAT_DATA_ZERO_TOUCH.md`**](EXFAT_DATA_ZERO_TOUCH.md).

   Optional:

   ```bash
   sudo NVIDIA_BRANCHES="535 580 595" BASENAME=highascg bash tools/live-usb/build-highascg-egg.sh
   ```

3. **Output**: ISO under `/home/eggs/` — name starts with `BASENAME` (default `highascg`), e.g.  
   `highascg_amd64_YYYY-MM-DD_HHMM.iso`

4. **Netplan**: If `netplan` warns about permissions, fix once:

   ```bash
   sudo chmod 600 /etc/netplan/01-live-networkd.yaml
   ```

5. **Excludes** (large dirs omitted from squashfs): fragment merged via **`prepare-eggs-clone-with-exfat.sh`** (or **`merge-penguins-eggs-exclude-highascg.sh`**) — includes **`home/casparcg/highascg/media`** and **`home/casparcg/exfat/*`** so the ISO carries an empty WO-47 stub, not developer scratch files. **`swap.img`** is excluded and **`strip-host-swap-for-live-iso.sh`** drops file-swap from **`/etc/fstab`** during produce (restored on the build host after **`build-highascg-egg.sh`**).

6. **Tailscale / tailnet identity**: A cloned ISO is **not** automatically “logged out.” If `tailscaled` state existed on the build host when `eggs produce` ran, that **machine key** is copied into the squashfs unless every storage path is excluded. The laptop then joins the tailnet **as the same node** as the builder (same key → same identity; it effectively replaces that machine until you fix it).  
   - `.deb` installs often use **`/var/lib/tailscale/`**, but **snap** layouts use **`/var/snap/tailscale/…`** — so “no `/var/lib/tailscale`” does **not** prove there is no shipped identity.  
   - Custom locations: check **`systemctl cat tailscaled`** and **`/etc/default/tailscaled`** for `--statedir=` / `--state=`. Add matching paths to **`tools/live-usb/penguins-eggs-exclude-highascg-fragment.list`**, run **`merge-penguins-eggs-exclude-highascg.sh`**, rebuild.  
   - **Persistence** (`FLASH_AND_PERSIST.md`, `/ union`) saves overlays too — once state exists on the stick, it keeps coming back until you delete or reflash.  
   - Sanity-check the ISO/squashfs: mount or `unsquashfs -ll` and search for **`tailscaled.state`** (and anything under **`var/snap/tailscale/`**).

---

## Flash to USB

1. **Identify the stick** (whole disk, e.g. `/dev/sdb` — **not** a partition):

   ```bash
   lsblk -dpno NAME,SIZE,MODEL,TRAN
   ```

2. **Unmount** anything on that disk:

   ```bash
   sudo umount /dev/sdX?* 2>/dev/null || true
   ```

3. **Write ISO** (replace `ISO` and `USB`):

   ```bash
   ISO=/home/eggs/mnt/highascg_amd64_2026-05-09_1311.iso
   USB=/dev/sdc

   sudo dd if=$(ls -t /home/eggs/mnt/highascg_amd64_2026-05-09_1311.iso | head -1) of=$USB bs=4M status=progress oflag=sync conv=fsync
   sudo sync
   sudo partprobe "$USB"
   ```

   Do **not** quote the glob in `dd if=…` — use `ls -t … | head -1` or the full filename.

4. **Required for production sticks — exFAT + persistence** (not optional)

   After `dd` + `sync` + `partprobe`, add **both** partitions (exFAT **first**, persistence **second**). Do **not** use partition **2** for operator data if it is a tiny leftover slice — remove stale partitions 2+ from a previous attempt, then run the finish script.

   ```bash
   USB=/dev/sdX
   ISO=/home/eggs/mnt/highascg_amd64_YYYY-MM-DD_HHMM.iso

   sudo bash tools/eggs/live-usb/finish-operator-stick.sh "$USB" --iso "$ISO" --prune-stale
   ```

   Or manually: **`add-union-persistence-partition.sh`** ( **`PERSIST_SIZE_MIB=2048`** ) → **`EXFAT_FILL_DISK=1 add-exfat-data-partition.sh`** → **`seed-exfat-operator-layout.sh`**. On a **32 GiB** stick: ~5 GiB ISO · ~2 GiB persistence · ~24 GiB exFAT.

   **Always** boot GRUB’s **Live with persistence** entry. Full reference: **[FLASH_AND_PERSIST.md](./FLASH_AND_PERSIST.md)** · Etcher / macOS / Windows: **[MANUAL_STICK_WINDOWS_MACOS.md](./MANUAL_STICK_WINDOWS_MACOS.md)**.

   **Narrow alternative (not production playout):** persist only **`~/highascg`** on a separate ext4 — **[HIGHASCG_FOLDER_USB_PARTITION.md](./HIGHASCG_FOLDER_USB_PARTITION.md)**. Skips NVIDIA/Tailscale/system-wide persistence.

5. **Long flash in tmux** (optional):

   ```bash
   tmux new -s flash
   # run dd here; detach: Ctrl+b then d
   tmux attach -t flash
   ```

---

## GRUB says live/install but there is no disk installer

The menu text does **not** guarantee Calamares (GUI installer) is inside the ISO. With **`eggs produce --clone`** you get a live system clone; the graphical installer is only present if you add it **on the build host**, then rebuild.

### Option A — Calamares (GUI install baked into the ISO)

On the **build machine**, before rebuilding:

```bash
sudo eggs calamares --help
sudo eggs calamares
```

Follow prompts so Calamares is installed **and** configured for eggs, then run `build-highascg-egg.sh` again.

After flashing the new ISO, boot live and start the graphical installer from the desktop/menu (exact label depends on your calamares theme).

### Option B — Krill (TUI install from the live USB, no rebuild)

Eggs ships **`krill`**. From the live session terminal:

```bash
sudo eggs krill --help
sudo eggs krill
```

That installs to disk without Calamares in the ISO.

### Option C — No install — **full USB persistence (default / recommended)**

Use **`/ union`** persistence so the stick **remembers** NVIDIA drivers, DeckLink-related OS state, Tailscale, **`/etc`**, **`/var`**, **`/home`**, and HighAsCG. After `dd`, run **`add-union-persistence-partition.sh`** and always boot **Live with persistence**: **[FLASH_AND_PERSIST.md](./FLASH_AND_PERSIST.md)**, [flash step 4](#flash-to-usb).

### Option D — No install — **only `~/highascg` on a data partition (advanced / narrow)**

When you **deliberately** do **not** want full-root persistence: **[HIGHASCG_FOLDER_USB_PARTITION.md](./HIGHASCG_FOLDER_USB_PARTITION.md)** and [flash step 4 optional](#flash-to-usb). **Does not** preserve NVIDIA/Tailscale/system-wide changes.

---

## Windows / macOS — write ISO + exFAT + persistence

**Etcher + extra partitions (macOS / Windows):** [MANUAL_STICK_WINDOWS_MACOS.md](./MANUAL_STICK_WINDOWS_MACOS.md).

**Manual Etcher + system partitioning (legacy detail):** [`MANUAL_STICK_WINDOWS_MACOS.md`](MANUAL_STICK_WINDOWS_MACOS.md).

If you already have a **`*.iso`** built elsewhere:

| OS | Script |
|----|--------|
| **Windows** (Admin PowerShell) | [`windows/make-highascg-stick.ps1`](windows/make-highascg-stick.ps1) |
| **macOS** (sudo in Terminal) | [`macos/make-highascg-stick.sh`](macos/make-highascg-stick.sh) |

Both: **visible menu** of removable targets, **explicit confirmations**, raw **ISO** write, then **exFAT** labelled **`HIGHASCGEXF`** (WO‑47) and seeded folders: **`drop-update`**, **`drop-config`**, **`media`**, **`templates`**, **`configs`**, **`snapshots/rear-panels`**. Hybrid ISO + free-space detection varies by OS; macOS may require **Disk Utility** or **Linux `add-exfat-data-partition.sh`** fallback if `diskutil addPartition` fails.

---

## Live session notes

- Default live user/password are whatever **eggs** printed at the end of the build (often `live` / `evolution`-style — check build log).
- Wired DHCP: image should ship **systemd-networkd** + **netplan** `renderer: networkd` + **NetworkManager** as fallback from the build script.
