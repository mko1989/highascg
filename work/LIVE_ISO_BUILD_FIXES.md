# Live ISO build — field fixes before next `eggs produce`

**Context:** Issues seen on a live ISO test machine (RTX 3060, analog minijack, operator USB). Use this as a **pre-flight checklist** before the next stick build and as **on-site recovery** steps on a booted system.

**Related:** [`tools/eggs/live-usb/FLASH_AND_PERSIST.md`](../tools/eggs/live-usb/FLASH_AND_PERSIST.md), [`tools/eggs/live-usb/EXFAT_DATA_ZERO_TOUCH.md`](../tools/eggs/live-usb/EXFAT_DATA_ZERO_TOUCH.md), WO‑47 [`docs/WO47_ISO_VS_EXFAT.md`](../docs/WO47_ISO_VS_EXFAT.md), WO‑35 [`work/work-orders/35_WO_GPU_PHYSICAL_CONNECTOR_STABILITY.md`](work-orders/35_WO_GPU_PHYSICAL_CONNECTOR_STABILITY.md), audio [`docs/guides/audio/audio-setup-guide.md`](../docs/guides/audio/audio-setup-guide.md).

---

## Summary

| # | Symptom | Likely root cause | Fix priority |
|---|---------|-------------------|--------------|
| 1 | Everything gone after reboot | Booted **plain Live** (RAM overlay) and/or stick never got **union persistence** + **exFAT** partitions; data written under squashfs/overlay paths | **Blocker** for next stick |
| 2 | No sound on rear 3.5 mm | Wrong ALSA **card/profile** (GPU HDMI vs onboard HDA); ISO **minimal Caspar config** (no audio consumer); PipeWire default sink not analog | High |
| 3 | Broken GPU connector IDs (`None 0/1`, one screen) | **xrandr** only lists connected heads; NVIDIA **DP pair drift**; default topology ≠ RTX 3060 layout | High (Device View + OS layout) |

---

## 1. exFAT / persistence — “completely fresh” after reboot

### How it is supposed to work

The operator stick has **two different** persistence mechanisms:

| Layer | Partition | Label | What survives reboot |
|-------|-----------|-------|----------------------|
| **A. Union overlay** | ext4 tail slice | `persistence` | Changes under **`/`** when booting **Live with persistence**: `/etc`, `/var`, apt/NVIDIA, most of `~/highascg` **on the overlay** |
| **B. WO‑47 exFAT** | exFAT tail (largest slice) | `HIGHASCGEXF` | Files on **`/home/casparcg/exfat/`** (`drop-update/`, `drop-config/`, `media/`, etc.) |

exFAT files live on a **real partition** on the USB stick. They do **not** require the union overlay — but only if you actually **wrote to the mounted exFAT tree**, not to an empty squashfs stub.

### Most common failure modes (field)

1. **ISO flashed with `dd` only** — no `finish-operator-stick.sh` → no `persistence` partition, no `HIGHASCGEXF` partition.
2. **GRUB: “Try Ubuntu” / plain Live** instead of **“Live with persistence”** → all overlay writes lost on reboot.
3. **`HIGHASCGEXF` missing or wrong label** → `home-casparcg-exfat.mount` never mounts; `~/exfat` stays an empty directory inside the ISO.
4. **Setup saved only in RAM paths** — e.g. edited `~/highascg/config/*.json` before exFAT mounted, or used paths that never sync to exFAT (`drop-config/` / exfat-sync map).
5. **Persistence partition exists but label ≠ `persistence`** or missing `persistence.conf` containing exactly `/ union`.
6. **Re-partition order wrong** — exFAT added first, then persistence, overlapping layout (see EXFAT doc §3).

### Verify on a running system

```bash
# Partition table + labels
lsblk -f /dev/sdX
blkid | grep -E 'HIGHASCGEXF|persistence'

# exFAT actually mounted (must not be "none" / empty stub)
findmnt /home/casparcg/exfat
systemctl status home-casparcg-exfat.mount \
  highascg-exfat-media-prep.service \
  highascg-exfat-sync.service

# Union persistence active (cmdline + mount)
cat /proc/cmdline | tr ' ' '\n' | grep -i persist
findmnt /cow /overlay 2>/dev/null || findmnt | grep -E 'overlay|persistence'
```

**Pass criteria:**

- `HIGHASCGEXF` mounted at `/home/casparcg/exfat`
- Boot entry includes **`persistence`** (or overlay backed by labeled `persistence` partition)
- Operator data visible under `~/exfat/` (e.g. `drop-update/`, `media/`)

### Fix before next eggs / stick build

**On the build/flash host (after `dd`):**

```bash
cd ~/highascg
ISO=/home/eggs/highascg_*.iso   # your built image

# Production layout: persistence (2 GiB) THEN exFAT fills disk tail
sudo bash tools/eggs/live-usb/finish-operator-stick.sh /dev/sdX --iso "$ISO"

# Re-flash leftover partitions from an old stick:
# sudo bash tools/eggs/live-usb/finish-operator-stick.sh --prune-stale /dev/sdX --iso "$ISO"
```

**On the imaging host (before `eggs produce`):**

```bash
sudo bash tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh
# Installs WO-47 units, empty stubs, exclude merge
sudo bash tools/eggs/live-usb/build-highascg-egg.sh
```

**Operator habit:** Always boot **Live with persistence**. Treat `~/exfat/` as the durable store for configs/media you must keep across machines.

### Eggs / repo improvements (backlog)

- [ ] Post-flash **smoke script** on stick: assert `blkid` shows both labels, mount units enabled.
- [ ] First-boot **one-line banner** if `/home/casparcg/exfat` is not a mountpoint (“WO‑47 volume missing — stick not finished”).
- [ ] Document in ISO installer UI which paths are **exFAT-durable** vs **overlay-only**.

---

## 2. No analog audio on rear 3.5 mm (minijack)

### How playout audio is wired in HighAsCG

| Stage | Detail |
|-------|--------|
| **ISO first boot** | [`config/casparcg.config.iso`](../config/casparcg.config.iso) — video screen only, **no** `<system-audio>`, `<portaudio>`, or FFmpeg ALSA consumer |
| **Production** | Settings → Audio + Device View → regenerated `config/casparcg.config` with `<system-audio>` (OpenAL → session default) and/or `<portaudio>` (`custom_live` Caspar build) |
| **OS** | Ubuntu **PipeWire** (or Pulse) + **ALSA**; analog jack is usually **HDA PCH** (`hw:0,0` or `hw:1,0`), **not** NVIDIA HDMI |

**alsamixer “correct” but still silent** often means you adjusted the **wrong card** (e.g. `NVidia` HDMI) while the jack is on **`HDA Intel PCH`** / **`ALC…`**.

### Diagnose on the playout host

```bash
# List cards — find PCH / Realtek / ALC (analog), not only NVidia
aplay -l
aplay -L | head -40

# PipeWire / Pulse sinks
pactl list sinks short 2>/dev/null || pw-cli ls Node 2>/dev/null | grep -i audio

# Unmute analog path (card index may differ)
alsamixer -c 0
# Enable: Master, Headphone, Front, Speaker — not “MM” on the PCH card

# Direct hardware test (replace N,M with PCH analog device from aplay -l)
speaker-test -D hw:N,M -c 2 -t wav
aplay -D hw:N,M /usr/share/sounds/alsa/Front_Center.wav
```

**With HighAsCG running:**

```bash
curl -s http://127.0.0.1:4200/api/audio/devices | jq .
curl -s http://127.0.0.1:4200/api/audio/portaudio-devices | jq .
```

Pick the device that matches **analog**, not `HDMI` / `DisplayPort`.

### Fix in HighAsCG / Caspar

1. **Regenerate Caspar config** after server is up (Settings → apply/save) so consumers exist — ISO template alone will not route PGM audio.
2. **Settings → Audio:** set program output to a consumer that hits analog:
   - **`<system-audio>`** — set OS default sink to analog (PipeWire `pavucontrol` or `pactl set-default-sink …`).
   - **PortAudio** — enable per-screen or global PortAudio in Device View; select the **analog** PortAudio device name from `/api/audio/portaudio-devices`.
   - **FFmpeg ALSA** — `-f alsa hw:N,M` for PCH device (see [caspar-outputs-nvidia-stereo-usb.md](../docs/reference/audio/caspar-outputs-nvidia-stereo-usb.md)).
3. **Build profile:** production expects **`custom_live`** Caspar with PortAudio consumer support ([`docs/internal/CASPAR_CUSTOM_BUILD.md`](../docs/internal/CASPAR_CUSTOM_BUILD.md)). Stock Caspar without PR #1720 will not honor `<portaudio>`.
4. **User group:** `casparcg` must be in **`audio`** ([`scripts/install-phase3.sh`](../scripts/install-phase3.sh)); ISO docs assume this on the live user.

### ISO / eggs improvements (backlog)

- [ ] Bake **`pipewire-pulse`** + **`alsa-utils`** + a **default PipeWire profile** that prefers analog when a PCH card exists.
- [ ] Optional **`/etc/asound.conf`** snippet on imaging host for `defaults.pcm.card` → PCH (document in [`docs/reference/sudo_and_audio_setup.md`](../docs/reference/sudo_and_audio_setup.md)).
- [ ] Post-install **audio smoke**: `speaker-test` + Caspar AMCP audio channel test in [`tools/smoke/`](../tools/smoke/).
- [ ] First-boot wizard: “Select analog / HDMI / DeckLink” tied to `POST /api/audio/default-device`.

---

## 3. xrandr / GPU connectors — `None 0/1`, one active screen, bad mapping

### What you saw

- **RTX 3060** — 3× DP + 2× HDMI physically; only **one** connected screen active in xrandr.
- Connector labels like **`None 0/1`** (or similar) in Device View / GPU inspector.

### What `None 0/1` means in HighAsCG

It is **not** an xrandr output name. The API pads missing physical ports to four entries:

```25:33:src/api/system-hardware-gpu-ports.js
	while (pairs.length < 4) {
		const idx = pairs.length * 2
		pairs.push({
			id: `gpu_p${pairs.length}`,
			label: `None ${idx}/${idx + 1}`,
			pairs: [],
			type: 'dp',
		})
	}
```

So xrandr pairing found **fewer than four** DP/HDMI pairs (often only one connected head). The UI shows placeholders for empty jacks.

### Why xrandr alone is a poor source of truth on NVIDIA

| Issue | Effect |
|-------|--------|
| **Connected-only parsing** | `xrandr --query` omits disconnected DP/HDMI names → inventory looks empty for unused jacks |
| **DP A/B pairs** | One physical port alternates **`DP-0` / `DP-1`** (or `DP-6`/`DP-7`) across reboots — WO‑35 |
| **Naming variants** | `DP-1` vs `card0-DP-1` — normalized in code, but operator must use stable **`gpu_p*`** IDs |
| **Default topology** | [`src/config/defaults.js`](../src/config/defaults.js) generic 4-port map may not match RTX 3060 back-panel order |

### Better enumeration stack (use all layers)

| Source | Command / API | Use for |
|--------|---------------|---------|
| **DRM sysfs** | `for d in /sys/class/drm/card*-*/status; do echo $d $(cat $d); done` | **All** connectors, connected or not |
| **xrandr** | `xrandr --query` and `xrandr --verbose` | Active mode, resolution, which `DP-*` is lit |
| **NVIDIA** | `nvidia-smi`, `nvidia-settings -q` (GUI) | GPU model, connector table (manual) |
| **HighAsCG** | `GET /api/device-view/gpu-map-debug` | Merged `live.gpu`: displays, connectors, `physicalMap` |
| **Reset pairs** | `POST /api/system/gpu-ports-reset` | Refresh DP/HDMI pair hints from live xrandr |
| **Topology override** | Settings `gpuPhysicalTopology` | Lock physical order for this board (WO‑35 profile) |

### RTX 3060–class workflow (recommended)

1. **Capture evidence** (3 reboots): save `xrandr --query`, DRM `status`+`edid` per port, and `gpu-map-debug` JSON — WO‑35 T35.1–T35.2.
2. **Cable all outputs you care about** (or accept placeholders for empty jacks).
3. **Set physical topology** for this machine (example field profile from WO‑35 — adjust after your capture):

   | Physical port | DP pair (example) |
   |---------------|-------------------|
   | `gpu_p0` | DP-6 / DP-7 |
   | `gpu_p1` | DP-4 / DP-5 |
   | `gpu_p2` | DP-0 / DP-1 |
   | `gpu_p3` | DP-2 / DP-3 |

   Persist via Settings API / `config` generator — not raw `DP-*` in the device graph.

4. **`POST /api/system/gpu-ports-reset`** after cable changes.
5. **`POST /api/settings/apply-os`** to push `screen_N_system_id` → xrandr (`applyX11Layout` in [`src/utils/os-config.js`](../src/utils/os-config.js)).
6. **Device View cabling:** use **`gpu_p0`…`gpu_p3`**, not volatile `DP-7`.

### When only one screen is “active”

- Expected if only one display is plugged in — xrandr will not enable other heads until **`xrandr --output DP-x --auto`** (or apply-os plan).
- Check **NVIDIA driver** loaded: `nvidia-smi`; wrong driver → fallback modeset and odd connector names.
- **Openbox / playout** may not call apply-os on boot — layout may need explicit apply from UI or persisted [`/etc/highascg/apply-layout.sh`](../src/utils/os-config.js) via autostart (see WO‑40 / `fixing1.md` notes).

### Eggs / software improvements (backlog)

- [ ] Ship **`tools/gpu-map-reboot-capture.sh`** (referenced in WO‑35, not in tree) for field logs.
- [ ] Default **`known-gpus.json`** entry for **RTX 3060** back-panel order.
- [ ] Device View: show **DRM disconnected** connectors alongside xrandr connected set.
- [ ] Optional boot hook: **`highascg-apply-os-layout.service`** after `graphical.target` (WO‑40).
- [ ] Document **`nvidia-settings` vs xrandr**: layout apply is **xrandr-only** in code today.

---

## Pre-build checklist (next eggs + operator stick)

Run on the **imaging host** before `eggs produce`, and on the **flash host** after `dd`:

### Imaging host

- [ ] `sudo bash tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh`
- [ ] `sudo bash scripts/install.sh` (or at least `install-exfat-systemd-units.sh` + `write-highascg-systemd-unit.sh casparcg`)
- [ ] Confirm `/etc/systemd/system/home-casparcg-exfat.mount` uses `What=/dev/disk/by-label/HIGHASCGEXF`
- [ ] `sudo bash tools/eggs/live-usb/build-highascg-egg.sh`

### USB stick (after ISO written)

- [ ] `sudo bash tools/eggs/live-usb/finish-operator-stick.sh /dev/sdX --iso /path/to.iso`
- [ ] `lsblk -f` → `persistence` + `HIGHASCGEXF`
- [ ] Boot once → verify `findmnt /home/casparcg/exfat` and **Live with persistence** in GRUB
- [ ] Audio: `aplay -l` + analog `speaker-test` on PCH card
- [ ] GPU: `curl …/api/device-view/gpu-map-debug` with expected `gpu_p*` map

### Operator documentation (one-pager for testers)

1. Boot **Live with persistence** every time.
2. Durable files → **`/home/casparcg/exfat/`** (or synced paths in exfat-sync map).
3. Analog audio → PCH ALSA device, then HighAsCG audio settings / PortAudio.
4. GPU cabling → **`gpu_p*`** ports; run **GPU ports reset** after hardware changes.

---

## Investigation — stick on dev PC (2026-05-25)

`lsblk` on the machine with the stick attached (booted from **internal NVMe**, not the USB):

| Part | Size | Label | Notes |
|------|------|-------|-------|
| `sda1` | ~5 GiB | `highascg` | Hybrid ISO (iso9660) |
| `sda2` | 16 MiB | — | ESP |
| `sda3` | 2 GiB | **`persistence`** | ext4 — union overlay slice **present** |
| `sda4` | ~20 GiB | **`HIGHASCGEXF`** | exFAT — operator data slice **present** |

**Labels are correct.** This session did not mount `sda4` at `/home/casparcg/exfat` because the host booted from `nvme1n1p2`, not the stick — only an automount hint at `/run/media/.../persistence`.

**Why setup “vanished” on the playout test:** if the tester booted **plain Live** (no persistence cmdline) or saved under `~/highascg` on the **RAM overlay** before exFAT mounted, reboot wipes that regardless of stick labels. Confirm on the **playout boot**:

```bash
cat /proc/cmdline | tr ' ' '\n' | grep -i persist
findmnt /home/casparcg/exfat
lsblk -f | grep -E 'HIGHASCGEXF|persistence'
```

Data that must survive → paths under **`/home/casparcg/exfat/`** (when mounted) or boot **Live with persistence**.

---

## Audio — `aplay` is live on **this** machine, not the eggs host

HighAsCG **`GET /api/audio/devices`** runs **`aplay -l` / `aplay -L`** on the machine where **`node index.js`** runs ([`src/audio/audio-devices.js`](../src/audio/audio-devices.js)), with a **30 s cache** — not a snapshot from the imaging PC.

On the investigation host right now:

- **Card 0:** `PCH` / `ALC1220 Analog` → rear **3.5 mm** (`hw:0,0`)
- **Card 1:** `NVidia` → **HDMI** only (`HDMI 0`, `HDMI 1`, …)

If Caspar consumers point at **NVIDIA HDMI** or **default** (session sink = HDMI), the **minijack stays silent** even when `alsamixer` on PCH looks fine.

**On the playout box (as `casparcg`, with X/session running):**

```bash
aplay -l
aplay -L | grep -E '^hw:|^default'
speaker-test -D hw:0,0 -c 2 -t wav    # adjust card index for PCH Analog
pactl get-default-sink 2>/dev/null || pw-cli ls Node 2>/dev/null | head
grep -E 'system-audio|portaudio|alsa|hw:' ~/highascg/config/casparcg.config | head -30
```

**Pass:** `speaker-test` audible on analog **before** blaming HighAsCG; Caspar config references **`hw:0,0`** or PCH PortAudio name, not `NVidia` / `hdmi`.

---

## GPU — `xrandr` output `none` vs what HighAsCG should run

### What went wrong (your RTX 3060 case)

NVIDIA + broken/mismatched driver stack often exposes the active head as **`none connected`** (or `None-1`) instead of **`DP-1`**. That is a **driver/RANDR naming failure**, not a missing physical port.

HighAsCG today builds **physical topology** from xrandr lines that match **`^DP` or `^HDMI` only** ([`parseXrandrDpHdmiOutputNames`](../src/utils/gpu-topology-xrandr.js)). An output named **`none` is ignored** for topology, so pairing returns empty → UI falls back to wrong defaults / placeholders.

Meanwhile **DRM sysfs** still lists real connectors, e.g.:

```text
card1-DP-1  connected
card1-DP-2  disconnected
card1-HDMI-A-1  connected
```

So the server **should not** rely on xrandr names alone when they are not `DP-*` / `HDMI-*`.

### Commands to run on the playout host (operator / SSH)

Run as the user that owns X (usually **`casparcg`**), with **`DISPLAY=:0`** and **`XAUTHORITY=/home/casparcg/.Xauthority`**:

```bash
export DISPLAY=:0
export XAUTHORITY=/home/casparcg/.Xauthority

# 1) DRM — all GPU connectors (connected or not); works without valid xrandr names
for d in /sys/class/drm/card*-*; do
  [ -f "$d/status" ] || continue
  n=$(basename "$d")
  st=$(cat "$d/status")
  mc=$(wc -l < "$d/modes" 2>/dev/null || echo 0)
  echo "$n  status=$st  modes=$mc"
done

# 2) xrandr — see the bogus name
xrandr --query
xrandr --listproviders

# 3) xrandr verbose — map RandR output → connector (when driver cooperates)
xrandr --verbose 2>/dev/null | head -120

# 4) NVIDIA
nvidia-smi --query-gpu=name,driver_version --format=csv,noheader
cat /proc/cmdline | tr ' ' '\n' | grep nvidia

# 5) Kernel mode setting (expect modeset=1 on RTX playout)
cat /sys/module/nvidia_drm/parameters/modeset 2>/dev/null
```

**Driver recovery** when stuck on `none` + wrong resolution: reinstall/rebuild **nvidia modules for the running kernel** (`linux-headers` + DKMS), ensure **`nvidia-drm.modeset=1`**, reboot — see field reports (Arch forum: `None-1` → fixed after DKMS rebuild).

### What HighAsCG should use internally (code direction)

| Priority | Probe | Purpose |
|----------|--------|---------|
| **1** | `/sys/class/drm/card*-*/status` + `modes` | Enumerate **1–N connectors** regardless of cable; stable names `card1-DP-1`, `HDMI-A-1` |
| **2** | `xrandr --query` + `--verbose` | Active resolution, position, refresh; map **`none`** outputs to DRM via verbose connector id |
| **3** | `xrandr --listproviders` + offload wiring | Fix **NVIDIA-0 / modesetting** split when external heads are invisible |
| **4** | `nvidia-smi` + optional `data/known-gpus.json` | Board-level default pair layout when discovery is ambiguous |
| **5** | Config `gpuPhysicalTopology` | Operator override — no fixed “4 ports” padding |

**Stop:** padding to four **`None 0/1`** slots in [`system-hardware-gpu-ports.js`](../src/api/system-hardware-gpu-ports.js) — report **only discovered** connectors (variable count).

**Implement:** `discoverGpuPhysicalTopologyFromDrm()` and use it **before** or **instead of** xrandr-only discovery in [`resolvePhysicalTopology`](../src/utils/gpu-physical-map.js); correlate xrandr connected heads to DRM by EDID hash or `xrandr --verbose` connector number.

---

## Work log

| Date | Note |
|------|------|
| 2026-05-25 | Initial guide from field ISO test (persistence, analog audio, RTX 3060 xrandr). |
| 2026-05-25 | Stick `lsblk`: labels OK; audio live `aplay`; GPU `none` = xrandr/driver; DRM sysfs command pack. |

**Instructions for next agent:** Implement DRM-first topology in `gpu-topology-xrandr.js` / `gpu-physical-map.js`; remove 4-port `None` padding; add `stick-post-flash-verify.sh`.
