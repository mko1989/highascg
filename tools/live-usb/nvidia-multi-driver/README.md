# Multi-NVIDIA driver support for the HighAsCG live USB

The live image has to run on a fleet whose GPUs span more than one driver
branch (e.g. legacy Kepler/Maxwell on `nvidia-driver-470`, modern Ada on 535,
Blackwell on 580). Only one `nvidia.ko` can be loaded at a time, so the
strategy is:

1. **Bake the most common branch into the image.** Whatever is installed on
   the build host (currently `nvidia-driver-535` via DKMS) gets cloned into
   the live image by `eggs produce --clone`. For Maxwell-Ada GPUs the picker
   detects "loaded matches recommendation" and stamps the marker without
   doing any work — boot is instant.

2. **Ship the alternate branches as offline `.deb`s** at **`/opt/nvidia-pool/`**.
   `fetch-debs.sh` populates the cache (default `CACHE_DIR`); path lives inside the squashfs
   so installs work without network.

   If you already populated **`/opt/nvidia-debs`**, rename or merge before building:  
   **`sudo mkdir -p /opt/nvidia-pool && sudo rsync -a /opt/nvidia-debs/ /opt/nvidia-pool/`** (then drop the old path when satisfied).

3. **First-boot service picks the recommended branch.** A oneshot systemd
   unit (`highascg-pick-nvidia.service`) runs `ubuntu-drivers devices`,
   compares against the loaded branch, and if a swap is needed: purges the
   stale branch, installs the recommended one from the offline cache,
   stamps `/var/lib/highascg/nvidia-installed`, reboots.

4. **`highascg.service` waits for the marker** via a drop-in
   (`ConditionPathExists=/var/lib/highascg/nvidia-installed`) so the app
   never starts on top of a half-installed GPU stack.

## Files

| File | Lives at on the live image |
|---|---|
| `highascg-pick-nvidia.sh` | `/usr/local/sbin/highascg-pick-nvidia.sh` |
| `highascg-pick-nvidia.service` | `/etc/systemd/system/highascg-pick-nvidia.service` |
| `fetch-debs.sh` | (build host only — populates **`/opt/nvidia-pool/`**) |
| `install-on-build-host.sh` | (build host only — copies the above into place) |

## Build-host workflow

```bash
# 1. Drop the picker assets into system paths, enable the unit
sudo bash tools/live-usb/nvidia-multi-driver/install-on-build-host.sh

# 2. Populate offline deb cache with the *additional* branches you need
sudo NVIDIA_BRANCHES="470 580" bash tools/live-usb/nvidia-multi-driver/fetch-debs.sh

# 3. Merge the eggs exclude fragment (does not exclude /opt/nvidia-pool)
sudo bash tools/live-usb/merge-penguins-eggs-exclude-highascg.sh

# 4. Optional: pre-build cleanup
sudo PURGE_DEV=1 PURGE_SNAPS=1 BUILD_EGGS=0 bash tools/prepare-eggs-minimal.sh

# 5. Build
sudo eggs produce --nointeractive --clone --max --basename highascg-live
```

## Persistence

`--clone` produces a live ISO whose default boot mode does **not** persist
changes — meaning the picker would re-run every boot and never escape the
"install + reboot" loop on machines that need a swap.

You must either:

- **Install the live USB to internal disk** via Calamares on first run
  (changes persist on the installed disk), or
- **Flash with a persistence partition** (changes persist on the USB itself).

See `../FLASH_AND_PERSIST.md` for the flash procedure.

### Cache the **full** `595` stack (not just two metapackage `.deb` files)

`apt-get download nvidia-driver-595 nvidia-dkms-595` only downloads **those two metapackage** archives. They **depend on** the rest of the stack (`libnvidia-gl-595`, `nvidia-utils-595`, `xserver-xorg-video-nvidia-595`, `nvidia-firmware-595-…`, etc.). For an **offline** picker install, those dependency `.deb` files must also be in **`/opt/nvidia-pool`**.

**Option A — builder already has 595 installed (typical):** download **one `.deb` per package** into the pool.  
Do **not** pass the whole list to a single `apt-get install --download-only --reinstall`: apt builds **one** transaction, so **desktop `…-595` + `…-595-server`** splits, virtual `libnvidia-compute`, and `Conflicts:` edges blow up with *Unable to correct problems*.

**Desktop / X11 reference (HighAsCG default)** — keep packages that match the normal `nvidia-driver-595` stack, **drop** the `*-595-server*` split (different firmware line; your log showed `nvidia-firmware-595-server-…` *not installable* from this apt view):

```bash
sudo mkdir -p /opt/nvidia-pool
sudo apt-get update
cd /opt/nvidia-pool
mapfile -t P < <(
  dpkg-query -W -f='${binary:Package}\n' \
    | grep -E '^(libnvidia|nvidia|xserver-xorg-video-nvidia)-' \
    | grep '595' \
    | grep -Fv '\-595-server' \
    || true
)
for pkg in "${P[@]}"; do
  sudo apt-get download "$pkg" 2>/dev/null || echo "WARN: no archive for $pkg (skip)" >&2
done
```

**Server image** (only if you intentionally use `nvidia-driver-595-server`): invert the filter (e.g. `grep -F '595-server'`) and still use the **per-package** `apt-get download` loop — never the single bulk `install --reinstall`.

If the firmware line really is missing from apt, fix **`sources.list` / PPA** first (`apt-cache policy nvidia-firmware-595-server-595.58.03`) or stay on the **desktop** stack for the eggs reference host.

**Option B — 595 not installed yet:** ask apt for the **full install** set into the pool (no unpack):

```bash
sudo mkdir -p /opt/nvidia-pool
sudo apt-get update
sudo apt-get install --download-only -y \
  -o Dir::Cache::archives=/opt/nvidia-pool \
  nvidia-driver-595 nvidia-dkms-595
```

**Option C — use the repo helper (any branch):**

```bash
sudo NVIDIA_BRANCHES="535 580 595" bash tools/live-usb/nvidia-multi-driver/fetch-debs.sh
```

Verify: **`ls /opt/nvidia-pool | grep 595`** should show **many** packages, not **only** `nvidia-driver-595_*` and `nvidia-dkms-595_*`.

Override directory only if needed: **`CACHE_DIR=/opt/nvidia-pool`** (default).

## Picker behaviour matrix

| Loaded branch on boot | `ubuntu-drivers` recommends | Picker action |
|---|---|---|
| 535 | 535 | stamp marker, no reboot |
| 535 | 580 | purge 535, install 580 from cache, reboot |
| (none, nouveau) | 535 | install 535 from cache or apt, reboot |
| anything | (none — non-NVIDIA host) | stamp marker, no reboot |
