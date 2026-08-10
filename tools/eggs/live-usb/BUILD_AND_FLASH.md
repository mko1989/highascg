# HighAsCG live USB — build and flash

**What is inside the ISO?** Stack from Ubuntu → nodm/Openbox → NVIDIA → DeckLink → CasparCG → HighAsCG (and WO‑47 exFAT split): **[`docs/ISO_CONTENTS.md`](../../../docs/ISO_CONTENTS.md)**.

> ## Sticks are made with Ventoy now
>
> The `dd`/Etcher flow below is **pre-Ventoy**. It writes the ISO over the whole device, which
> destroys a Ventoy stick's layout **and the `HIGHASCGEXF` operator data partition with it**.
>
> Current procedure: **[`docs/STICK_QUICK_START.md`](../../../docs/STICK_QUICK_START.md)** —
> install Ventoy reserving space at the end of the disk, create `HIGHASCGEXF` in that space, then
> copy each new ISO onto the Ventoy partition. No reflash per build, and the previous ISO stays
> as a fallback.
>
> The `dd` sections below are kept for recovery and non-Ventoy media, not for operator sticks.

**Build the ISO only (what you want with Ventoy):**

```bash
cd ~/highascg
sudo HIGHASCG_NVIDIA_DRIVER=595 bash tools/eggs/live-usb/build-highascg-egg.sh
# npm run eggs:build
```

Wait for **`Done. ISO:`** — the file appears minutes earlier and is still being re-packed; the
`<iso>.sha256` sidecar is written last and is the ready signal. Then copy to the stick's Ventoy
partition, `sync`, and verify with `verify-stick-iso.sh`.

**All-in-one build + `dd` (legacy — destroys a Ventoy stick):**

```bash
sudo bash tools/eggs/live-usb/build-produce-flash-stick.sh
# non-interactive dd confirm: add -y
```

Picks the **newest ISO from this build** under `/home/eggs/` and `/home/eggs/mnt/`, then runs **`create-operator-stick-from-dd.sh`** (4 GiB persistence, exFAT remainder, seed layout).

**Alternate** (legacy interactive flash): `sudo bash tools/eggs/live-usb/legacy-persistence/build-flash-and-persist.sh --help`

### Operator stick — one command (`build-operator-stick`) — **deprecated**

> **Deprecated.** The script now lives at **`work/deprecated/tools/build-operator-stick.sh`** and builds the old exFAT **+ union persistence** layout. For current sticks use **`tools/eggs/live-usb/finish-operator-stick.sh`** (exFAT-only) after `dd`, or the all-in-one `build-produce-flash-stick.sh` above.

The finish/partition scripts place **exFAT `HIGHASCGEXF`** with start **≥ hybrid ISO tail** and **≥ ceil(ISO MiB)+`EXFAT_AFTER_ISO_MARGIN_MIB`** (**1536** MiB default — adjust if your ISO grows). The build warns if Blackmagic **`desktopvideo*`** packages are missing from the clone source; **`--decklink-required`** exits non‑zero unless they’re installed (*`sudo bash scripts/install.sh`* with Desktop Video tarball). The string **`highascg-data`** cannot be the literal exFAT volume label (**11 characters max**); operators still call it “data”; **`HIGHASCGEXF`** is what systemd mounts.

### Desktop helper — Stick Studio (`client/tools/stick-tools`)

On a workstation with a display (and **`python3-tk`**): flash ISO + optional exFAT + seed operator dirs + optional copy to `sim/highascg`, plus **Start simulation** — `python3 client/tools/stick-tools/stick_studio.py` from the repo root (no npm wrapper). Destructive steps use **pkexec**. Details: **`client/tools/stick-tools/README.md`**. See **[`docs/CASPAR_IMAGE_VS_HIGHASCG_OVERLAY.md`](../../../docs/CASPAR_IMAGE_VS_HIGHASCG_OVERLAY.md)** for how a **Caspar-only** squashfs coexists with **HighAsCG synced from exFAT**.

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

   The build script runs **`prepare-eggs-clone-with-exfat.sh`** first (mount + bind + boot sync units, **`highascg.service`** ordering, empty **`~/exfat`** / **`~/highascg/media/*`** stubs, merge of **`tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list`**). If **`/etc/penguins-eggs.d/exclude.list`** does not exist yet, run Eggs config or a preliminary **`eggs produce`** once; then rerun the build script or **`sudo bash tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh`** (also: `npm run eggs:prepare`). Stick + exFAT workflow: [**`EXFAT_DATA_ZERO_TOUCH.md`**](EXFAT_DATA_ZERO_TOUCH.md).

   Optional:

   ```bash
   sudo NVIDIA_BRANCHES="535 580 595" BASENAME=highascg bash tools/eggs/live-usb/build-highascg-egg.sh
   ```

3. **Kernel (one version)** — `build-highascg-egg.sh` runs `sync-eggs-kernel-and-purge-stale.sh` with **`HIGHASCG_ENSURE_LATEST_KERNEL=1`**: installs **`linux-image-generic`**, points **`eggs.yaml`** at the **newest** `linux-image-*-generic`, purges older images. The ISO matches that kernel, not necessarily the kernel you booted before the build. If the script warns that running ≠ latest, **reboot** after the build (or before a long `eggs produce`) so DKMS (NVIDIA, DeckLink) matches.

4. **Output**: ISO under `/home/eggs/` — name starts with `BASENAME` (default `highascg`), e.g.  
   `highascg_amd64_YYYY-MM-DD_HHMM.iso`

5. **Netplan**: If `netplan` warns about permissions, fix once:

   ```bash
   sudo chmod 600 /etc/netplan/01-live-networkd.yaml
   ```

6. **Excludes** (large dirs omitted from squashfs): fragment merged via **`prepare-eggs-clone-with-exfat.sh`** (or **`merge-penguins-eggs-exclude-highascg.sh`**) — includes **`home/casparcg/highascg/media`** and **`home/casparcg/exfat/*`** so the ISO carries an empty WO-47 stub, not developer scratch files. **`swap.img`** is excluded and **`strip-host-swap-for-live-iso.sh`** drops file-swap from **`/etc/fstab`** during produce (restored on the build host after **`build-highascg-egg.sh`**).

7. **Tailscale / tailnet identity**: A cloned ISO is **not** automatically “logged out.” If `tailscaled` state existed on the build host when `eggs produce` ran, that **machine key** is copied into the squashfs unless every storage path is excluded. The laptop then joins the tailnet **as the same node** as the builder (same key → same identity; it effectively replaces that machine until you fix it).  
   - `.deb` installs often use **`/var/lib/tailscale/`**, but **snap** layouts use **`/var/snap/tailscale/…`** — so “no `/var/lib/tailscale`” does **not** prove there is no shipped identity.  
   - Custom locations: check **`systemctl cat tailscaled`** and **`/etc/default/tailscaled`** for `--statedir=` / `--state=`. Add matching paths to **`tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list`**, run **`merge-penguins-eggs-exclude-highascg.sh`**, rebuild.  
   - **Legacy persistence** ([`legacy-persistence/FLASH_AND_PERSIST.md`](./legacy-persistence/FLASH_AND_PERSIST.md), `/ union`) saves overlays too — once state exists on the stick, it keeps coming back until you delete or reflash.  
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
   shopt -s globstar
   ISO="$(ls -t /home/eggs/**/*.iso | head -1)"   # or set the full filename explicitly
   USB=/dev/sdc

   sudo dd if="$ISO" of="$USB" bs=4M status=progress oflag=sync conv=fsync
   sudo sync
   sudo partprobe "$USB"
   ```

4. **Required for production sticks — exFAT data partition** (persistence is **legacy opt-in**, not production)

   After `dd` + `sync` + `partprobe`, add the **exFAT `HIGHASCGEXF`** partition. Do **not** use partition **2** for operator data if it is a tiny leftover slice — remove stale partitions 2+ from a previous attempt, then run the finish script.

   ```bash
   USB=/dev/sdX
   ISO=/home/eggs/mnt/highascg_amd64_YYYY-MM-DD_HHMM.iso

   sudo bash tools/eggs/live-usb/finish-operator-stick.sh "$USB" --iso "$ISO" --prune-stale
   ```

   Or manually: **`EXFAT_FILL_DISK=1 add-exfat-data-partition.sh`** → **`seed-exfat-operator-layout.sh`**. Legacy union persistence (opt-in **`HIGHASCG_LEGACY_UNION_PERSIST=1`** only, not for production): **`legacy-persistence/add-union-persistence-partition.sh`** ( **`PERSIST_SIZE_MIB=4096`** ) before the exFAT step. On a **32 GiB** stick: ~5 GiB ISO · ~4 GiB persistence · ~22 GiB exFAT.

   Legacy persistence reference: **[legacy-persistence/FLASH_AND_PERSIST.md](./legacy-persistence/FLASH_AND_PERSIST.md)** · Etcher / macOS / Windows: **[MANUAL_STICK_WINDOWS_MACOS.md](./MANUAL_STICK_WINDOWS_MACOS.md)**.

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

### Option C — No install — **full USB persistence (legacy opt-in, not production)**

Production sticks are **exFAT-only, no union persistence** — durable data lives on `HIGHASCGEXF`. If you deliberately need the legacy layout (`HIGHASCG_LEGACY_UNION_PERSIST=1`), **`/ union`** persistence makes the stick remember NVIDIA drivers, DeckLink-related OS state, Tailscale, **`/etc`**, **`/var`**, **`/home`**, and HighAsCG. After `dd`, run **`legacy-persistence/add-union-persistence-partition.sh`** and boot **Live with persistence**: **[legacy-persistence/FLASH_AND_PERSIST.md](./legacy-persistence/FLASH_AND_PERSIST.md)**, [flash step 4](#flash-to-usb).

### Option D — No install — **only `~/highascg` on a data partition (advanced / narrow)**

When you **deliberately** do **not** want full-root persistence: **[HIGHASCG_FOLDER_USB_PARTITION.md](./HIGHASCG_FOLDER_USB_PARTITION.md)** and [flash step 4 optional](#flash-to-usb). **Does not** preserve NVIDIA/Tailscale/system-wide changes.

---

## Windows / macOS — write ISO + exFAT

**Etcher + system partitioning (macOS / Windows):** [MANUAL_STICK_WINDOWS_MACOS.md](./MANUAL_STICK_WINDOWS_MACOS.md).

If you already have a **`*.iso`** built elsewhere:

| OS | Script |
|----|--------|
| **Windows** (Admin PowerShell) | [`make-highascg-stick.ps1`](../../../client/tools/live-usb/windows/make-highascg-stick.ps1) |
| **macOS** (sudo in Terminal) | [`make-highascg-stick.sh`](../../../client/tools/live-usb/macos/make-highascg-stick.sh) |

Both: **visible menu** of removable targets, **explicit confirmations**, raw **ISO** write, then **exFAT** labelled **`HIGHASCGEXF`** (WO‑47) and seeded folders (**`drop-config`**, **`media`**, **`templates`**, **`configs`**, **`snapshots/rear-panels`**, plus a `sim/highascg` simulation tree). Note on server-drop folders: the **canonical layout is `drop-update/`** (+ `drop-update/applied/`); today the macOS script still seeds legacy **`update/server/`** and the Windows script seeds neither — create `drop-update/` yourself until the scripts are aligned. Hybrid ISO + free-space detection varies by OS; macOS may require **Disk Utility** or **Linux `add-exfat-data-partition.sh`** fallback if `diskutil addPartition` fails.

---

## Live session notes

- Default live user/password are whatever **eggs** printed at the end of the build (often `live` / `evolution`-style — check build log).
- Wired DHCP: image should ship **systemd-networkd** + **netplan** `renderer: networkd` + **NetworkManager** as fallback from the build script.
