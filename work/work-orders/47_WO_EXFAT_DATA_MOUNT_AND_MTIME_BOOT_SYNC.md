# Work Order 47: exFAT data volume, fixed mount, and mtime-priority boot sync

> **AGENT COLLABORATION PROTOCOL**  
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done  
> 2. Update task checkboxes to reflect current status  
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry  
> 4. Do NOT delete previous agents' log entries  

---

## Goal

Improve the **live-USB + cross-platform data** story beyond **WO-38** (partition mounted at **`/home/casparcg/highascg/media/drive`** after **wiping** that subfolder):

1. **Auto-mount a dedicated exFAT partition** at a **stable path** **`/home/casparcg/exfat`** (owned use-case: “drop files from Mac/Windows”; survives reboot when partition + fstab/systemd exist).
2. **Optional second bind** of (a subdirectory of) that volume **inside** the project media tree, e.g. **`/home/casparcg/highascg/media/_exfat`**, **without** deleting existing files under **`media/`** (pre-mount content remains visible alongside the mounted subtree — operators must understand **mount hides only that one directory name’s previous content** if reused; prefer **always use a fresh subdir name** like `_exfat` created empty in the image).
3. **Boot-time (or early-login) sync** between **paths on the exFAT volume** (typically the volume root layout) and **selected paths under** `/home/casparcg/highascg/…` (and optionally other roots), with **last-write-wins by file modification time** (newer `mtime` wins **regardless of whether the newer side is exFAT or internal**). This supports: “copy newest HighAsCG tree onto the stick’s exFAT from any OS; next Linux boot pulls updates into `~/highascg`.”
4. **Normal-operator feasibility:** document whether **Windows / macOS** can create the extra partition **after** flashing the ISO with **Balena Etcher** (or `dd`), and what the **safe / recommended** path is when OS tools mis-report hybrid ISO layouts.

---

## Relationship to existing work

| Work | Relationship |
|------|----------------|
| **WO-38** (`mediaMount`, `highascg-media-mount.sh`) | Mounts one UUID at **`/home/casparcg/highascg/media/drive`** after clearing that subfolder. This WO **does not remove WO-38**; it adds **exFAT at `/home/casparcg/exfat`**, **optional bind**, and **boot sync**. |
| **`tools/live-usb/add-union-persistence-partition.sh`** | Already avoids carving persistence into the ISO region; **same discipline** applies to any **new primary** for exFAT: start **after the last hybrid MBR partition end**, never trust **`parted … print free`** alone for start sector. |
| **`work/docs/LIVE_USB_IMAGE.md`**, **`tools/live-usb/FLASH_AND_PERSIST.md`** | After implementation, add a short **operator subsection** linking here (one paragraph + link). |

---

## Success criteria

### A. Mount layout

- [ ] **A1.** Systemd **`.mount`** unit (or fstab line with `nofail,x-systemd.automount` if appropriate) mounts the exFAT partition by **`UUID=`** (preferred) or **`PARTUUID=`** at **`/home/casparcg/exfat`**, **`nofail`**, reasonable **`umask`/UID/GID** for user **`casparcg`** (or documented `uid=`/`gid=` mount options).
- [ ] **A2.** If the partition is absent (stick without exFAT yet), boot **continues**; HighAsCG may log a single **info** line — no hard failure loop.
- [ ] **A3.** **Optional bind:** separate unit or `ExecStart=/bin/mount --bind …` mounts e.g. **`/home/casparcg/exfat/library` → `/home/casparcg/highascg/media/_exfat`** (exact names bikeshed OK) **without** `rm -rf` of parent **`media/`**. Document that **`_exfat` must be an empty mount point** in the golden image (created at image build), so there is nothing to “lose.”

### B. Mtime-priority sync (“newer wins”)

- [ ] **B1.** Declarative mapping: e.g. **`/etc/highascg/exfat-sync.toml`** or **`.yaml`** listing **pairs** `(exfat_relative, highascg_absolute)` and optional **`direction: both|to_project|to_exfat`** (default **`both`** for listed pairs).
- [ ] **B2.** For **regular files**: if only one side exists, **copy to the missing side** (subject to direction). If both exist, compare **`mtime`** (and optionally **size** as tie-break); **copy newer over older**. Document **exFAT timestamp resolution (~1s)** and **timezone / DST** caveats.
- [ ] **B3.** For **directories**: **recursive** file sync with the same rule; **no implicit directory deletes** in v1 unless explicitly enabled per-pair (`allow_delete: false` default) — avoids accidental wipe when one side is temporarily unmounted empty.
- [ ] **B4.** **Ordering:** sync unit runs **`Before=highascg.service`** (and **before** Caspar if Caspar depends on files under `~/highascg`); document **Caspar restart** if sync runs mid-session (out of scope for v1 — boot only).
- [ ] **B5.** Implementation language: **bash + rsync** is acceptable if semantics match; otherwise **small Node or Python** script in-repo with tests. If **`rsync`**: note that **native bidirectional mtime-wins is not one flag** — either **two-pass rsync with `-u`** per direction with careful ordering, or a **small custom walker** (preferred for clarity). Document chosen algorithm in the script header.
- [ ] **B6.** **Dry-run** flag for operators (`--dry-run`) and log file under **`/var/log/highascg/`** or journal for the sync service.

### C. WO-38 alignment (deferred acceptable)

- [ ] **C1.** Either **(i)** document “use **`local_media_path`** / bind subdir for exFAT; reserve WO-38 for internal NVMe” **or** **(ii)** extend **`highascg-media-mount.sh`** with **`MODE=replace|bind`** and **no clear** for bind mode — **pick one** in first implementation PR and update WO-38 header with “superseded for USB exFAT by WO-47”.

### D. Operator / cross-platform

- [ ] **D1.** **`work/docs/LIVE_USB_IMAGE.md`** (or **`tools/live-usb/`** doc): **“Adding exFAT after Etcher”** — **Linux-first** procedure (`parted`/`gparted`, `mkfs.exfat`, `blkid`); **Windows** and **macOS** paragraphs with **honest limits** (hybrid ISO: **Disk Management** / **Disk Utility** may hide unallocated or show only one volume; **wrong shrink/create can brick the stick**).
- [ ] **D2.** Optional **first-boot wizard** or **desktop notification** (“exFAT data partition not found — see …”) — **nice-to-have**; not blocking if docs are clear.

---

## Architecture

### 1. Partition layout (reference)

Typical **fourth MBR primary** (when ISO + EFI + persistence + DATA) or **logical** if future layout moves to GPT — **image builders** must stay within **MBR four-primary** constraints already used by live tooling.

| Partition role | Typical mount / use |
|----------------|---------------------|
| ISO9660 hybrid slice | read-only image |
| ESP | EFI |
| Persistence (ext4) | overlay / `casper-rw` |
| **exFAT DATA** | **`/home/casparcg/exfat`** (this WO) |

**Critical:** new partitions start **after** the **end sector of the last existing MBR partition** (see **`add-union-persistence-partition.sh`** comments re **`print free`**).

### 2. Systemd

- **`home-casparcg-exfat.mount`** — `What=` and `Where=/home/casparcg/exfat`, `Options=…`, `TimeoutSec=…`.
- **`highascg-exfat-sync.service`** — `Type=oneshot`, `RemainAfterExit=yes`, runs sync script; **`Before=highascg.service`**.
- Optional **`highascg-exfat-media-bind.service`** — bind mount after `.mount` is active.

Ship **`.example`** units under **`tools/live-usb/systemd/`** and install hook in **`install-phase4.sh`** or live-USB doc “copy and enable.”

### 3. Suggested default sync map (bikeshed OK)

Example **exFAT root** layout operators can drop from a zip:

```text
/exfat_root/
  sim/highascg/          ← optional portable Node tree for other OSes
  library/               ← large media (optional bind → media/_exfat)
  drop-config/           ← optional highascg.config.json fragments
```

Default **sync pairs** (if present on exFAT):

| exFAT relative | Project absolute | Notes |
|----------------|-------------------|--------|
| `sim/highascg/` | `/home/casparcg/highascg/` | **Exclude** `node_modules`, `.git`, `media` if bind-mounted; **or** include only `src/`, `web/`, `package.json`, `package-lock.json` — **must** be explicit in map to avoid copying gigabytes / wrong arch binaries. |
| `drop-config/highascg.config.json` | `/home/casparcg/highascg/highascg.config.json` | Optional one-file overlay |

**Recommendation:** v1 map file **only** lists **small, safe** subtrees (`sim/highascg` without `node_modules`); **never** default-sync whole `media/` both ways (bandwidth + Caspar file handles); use **bind** for playout library only.

### 4. Mtime algorithm (normative v1)

For each **file** path pair `A` (exFAT) / `B` (project):

1. If **missing on one side** → **copy** onto missing side (respect `direction`).
2. If **both files** → compare `mtime` (seconds); **newer wins** and overwrites the older.
3. If **`mtime` equal** → optional tie-break: **larger size wins** or **no copy** (document choice).
4. **Directories:** walk in **deterministic sort order**; create missing dirs as needed.
5. **Deletes:** **not synced** in v1 (no delete propagation). Document as limitation; v2 may add `.highascg-deleted` tombstones.

**Clock skew:** warn in docs — if laptop clock wrong, wrong file “wins.”

---

## Can a normal user add exFAT after Balena Etcher on Windows or macOS?

**Sometimes yes, often awkward — Linux is most reliable.**

- **Hybrid ISO USB sticks** expose a **small** visible FAT region to Windows/macOS; **unallocated space after the last partition** may or may not appear as free space in **Disk Management** / **Disk Utility**. Some layouts show **no** usable empty region without third-party tools.
- **Risk:** creating or resizing partitions with the wrong **start sector** can **overlap the ISO9660 image** or **break boot** — always **backup**, use **`lsblk`/`fdisk`/`parted`** on Linux to **verify start/end** if possible.
- **Practical guidance for “normal users”:**
  1. **Preferred:** ship **installer script** run once from **booted live Linux** (“Add exFAT data partition”) that uses the **same geometry rules** as persistence tooling.
  2. **Advanced users on Windows:** only if **Disk Management** shows **unallocated** space **after** the last partition on the **correct physical disk** — create **simple volume**, format **exFAT**, label **`HIGHASCGEXF`** — **document screenshot-level steps and “if you do not see unallocated, use Linux.”**
  3. **macOS:** Disk Utility is similarly inconsistent; same caveat.

---

## Security / safety

- Sync script must **refuse** to run if **`/home/casparcg/exfat`** is not a **mountpoint** containing **`UUID`** or **`.highascg-data-volume`** marker file (optional) — mitigates **bind mistakes** and **`rm` on wrong path**.
- **Path traversal:** map entries must resolve **under** allowed roots only; reject `..`.
- **Sudo:** prefer **no sudo** for sync if both sides are user-readable/writable; if needed, narrow sudoers like WO-38.

---

## Code / repo touch points (expected)

| Area | Action |
|------|--------|
| `tools/live-usb/systemd/` | New `*.mount.example`, `highascg-exfat-sync.service.example` |
| `scripts/` or `tools/live-usb/` | `highascg-exfat-sync.sh` (or Node) + default map |
| `work/docs/LIVE_USB_IMAGE.md` | Link + short operator subsection |
| WO-38 doc | Cross-link + “when to use which” table |
| Optional future | Settings UI to edit map (out of scope v1 — file-based only) |

---

## Tasks (checklist for implementers)

- [ ] Ship **example systemd** units + **sync script** with **mtime-wins** semantics and **dry-run**.
- [ ] Ship **default map** tuned for **“drop updated sim bundle on exFAT → sync into `~/highascg`”** without nuking `node_modules` on Linux unintentionally.
- [ ] Document **bind mount under `media/_exfat`** and **empty directory** requirement in golden image.
- [ ] **Cross-platform partition** doc section (Etcher → optional exFAT) with **warnings**.
- [ ] (Optional follow-up) WO-38 script: **`MODE=bind`** without **`clear_mount_point_contents`**.

---

## Work Log

### 2026-05-17 — Agent (WO-47 v1: map + mtime sync + UI view)

**Work done:**
- **`config/exfat-sync.json`** — default **`pairs`**: `sim/highascg` ↔ `~/highascg` (excludes `node_modules`, `.git`, `media`, …) and optional **`drop-config/highascg.config.json`** ↔ project monolithic config.
- **`src/system/exfat-sync.js`** — load map (**`HIGHASCG_EXFAT_SYNC_MAP`** → **`/etc/highascg/exfat-sync.json`** → repo config), **`getExfatSyncDashboard`**, **`runExfatSync`** (mtime-wins file sync; refuses if **`/home/casparcg/exfat`** is not a mount point).
- **`GET /api/system/exfat-sync`**, **`POST /api/system/exfat-sync/run`** (`dryRun` or **`confirm: EXFAT_SYNC`**) — **`src/api/routes-exfat-sync.js`** + **`router.js`**.
- **Settings → media/usb**: table of pairs + map path + mount status; **Dry-run sync** button.
- **`tools/exfat-sync-cli.js`**, **`npm run exfat-sync`**, **`npm run smoke:exfat-sync`**, **`tools/smoke-exfat-sync.js`**.
- **`tools/live-usb/systemd/*.example`** + README; **`install-phase4.sh`** creates **`/home/casparcg/exfat`**, seeds **`/etc/highascg/exfat-sync.json`** when missing.

**Instructions for next agent:** Prefer **`tools/live-usb/EXFAT_DATA_ZERO_TOUCH.md`** + **`scripts/install-exfat-systemd-units.sh`** over hand-editing **`*.example`** units.

### 2026-05-17 — Agent (zero-touch: label mount + partition sizing)

**Work done:** **`scripts/install-exfat-systemd-units.sh`** ( **`What=/dev/disk/by-label/HIGHASCGEXF`**, uid/gid from **`casparcg`** ); **`tools/live-usb/add-exfat-data-partition.sh`** (default **`EXFAT_SIZE_MIB=4096`**, **`EXFAT_FILL_DISK=1`** for exFAT-only); **`install-phase4.sh`** conditional **`highascg.service`** deps; **`EXFAT_DATA_ZERO_TOUCH.md`**; **`FLASH_AND_PERSIST.md`** order (exFAT then persistence).

**Instructions for next agent:** If **`read -d ''`** heredoc in **`install-phase4`** causes issues on non-bash, inline a two-line **`After=`** string instead.

## Instructions for Next Agent

1. Read **WO-38** and **`tools/live-usb/add-union-persistence-partition.sh`** geometry rules before writing any partition logic.  
2. **Boot sync v1 is landed** — wire **`highascg-exfat-sync.service`** into live image builds; tune **`home-casparcg-exfat.mount`** **`uid=`/`gid=`** for **`casparcg`**.  
3. When adding docs, keep **Windows/macOS** language **non-hand-wavy** about failure modes (hybrid ISO visibility).
