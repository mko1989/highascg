# Work Order 38: Mount internal disk partition to media folder (live USB)

> **AGENT COLLABORATION PROTOCOL**  
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done  
> 2. Update task checkboxes to reflect current status  
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry  
> 4. Do NOT delete previous agents' log entries  

---

## Goal

On **live-USB** (or similar) deployments where the OS runs from removable media, let operators **bind the machine’s internal drive** to HighAsCG’s **fixed media directory** so CasparCG and the web UI use that disk for playout and ingest — without SSH.

The operator picks a **block device / partition** in **Settings**, confirms a **destructive warning**, and the server **unmounts any previous use of the mount point, clears the mount-point directory, mounts the chosen partition**, and **persists the choice** so the same partition is mounted again on the next HighAsCG start (config lives on the USB / writable config store).

**Static paths (product contract for this WO):**

| Constant | Path |
|----------|------|
| Media mount point | `/home/casparcg/highascg/media` |

CasparCG / HighAsCG must already be configured to use this path as the media root (`local_media_path` / `casparcg.config` `<paths><media-path>` — align with existing settings; this WO does not introduce a second configurable media root for mount).

---

## Success Criteria

1. Settings tab currently labeled **“Media (USB)”** is renamed to **`media/usb`** (display + `data-tab` id updated consistently in templates, JS tab switching, and any deep links/docs in-repo).
2. The **`media/usb`** pane layout: **top** = new **“Media disk mount (live / internal)”** block; **below** = existing USB import controls (Caspar media path field, enable import, subfolder template, overwrite policy, SHA1 verify) unchanged in behaviour unless noted.
3. **Partition picker:** dropdown populated from the server with **candidate partitions** (e.g. `lsblk` output: `NAME`, `SIZE`, `FSTYPE`, `LABEL`, `UUID`, `MOUNTPOINT`, `RM`, `HOTPLUG`). UX copy should distinguish **internal** vs **removable** where possible; implementation may filter or group (exact filter is an implementation detail — document chosen rules in code comments).
4. **Mount** button (enabled when a row is selected): opens a **modal confirmation** stating clearly that proceeding will **delete all existing files under** `/home/casparcg/highascg/media` **before mounting**, making them **unrecoverable** from that folder (explain that this is required so the mount point is empty and operators are not confused by “hidden” pre-mount files).
5. On confirm: server runs a **single guarded pipeline** (see Architecture): umount-if-needed on the fixed mount point → recursive delete of contents of that directory only (`rm -rf` scoped to the mount point; never wildcard parent paths) → `mount` selected partition → persist selection in config → refresh media list / optional WS event.
6. **Persistence:** On **HighAsCG process startup** (after config load from the USB-backed config store), if saved settings contain a **media mount target** (`UUID` strongly preferred; `PARTUUID` / kernel `by-id` path as optional fallback), invoke the **same mount helper** so the partition is mounted before or early enough that media indexing and CasparCG see the disk (ordering vs CasparCG start may require a systemd **After=** dependency or explicit “ensure mount” step in `index.js` — see Tasks).
7. **Privileges:** mounting arbitrary partitions requires **elevated privileges**. Prefer a **narrow sudoers rule** allowing **only** the HighAsCG service user to execute **one root-owned wrapper script** with **no arbitrary arguments**, or **`sudo NOPASSWD` for that script only**. Alternative: **`pkexec`/polkit** is possible but heavier for non-interactive server; justify if chosen.
8. **Safety:** Wrapper validates that the resolved device is a **partition block device**, refuses **disk** nodes without partition table edge cases documented, refuses obvious system partitions (optional heuristic: mounted at `/`, `/boot`, `/boot/efi` — configurable deny list). Rate-limit mount attempts from API.

---

## Relationship to existing work

- **WO-29 (USB ingest)** targets **mounted removable USB** volumes and copying into media. This WO targets **explicit bind of a partition** to the **fixed media path** for **live USB / large internal library**. The two features share the **`media/usb`** settings tab UI but serve different workflows; avoid breaking WO-29 endpoints (`/api/usb/*`).
- **`work/docs/LIVE_USB_IMAGE.md`**: persistence assumption — config writable on USB; reference in install/boot docs once behaviour exists.

---

## Current State

- Settings modal: **`web/components/settings-modal-templates.js`** — tab button `Media (USB)` (`data-tab="media-usb"`), pane id `settings-pane-media-usb` with USB ingest fields including **CasparCG Media Path** text input (`#set-local-media-path`).
- This WO introduces **additional** persistence keys (e.g. `media_mount_enabled`, `media_mount_uuid`) in `config/default.js` + `routes-settings.js` / modal collect+hydrate — exact names chosen at implementation time and documented here when merged.
- No server API today enumerates **unmounted** partitions for operator mount from Web UI.

---

## Architecture

### 1. Enumeration API

New read-only endpoint, e.g. `GET /api/system/block-devices` (name bikeshed OK), returning JSON list of partition candidates derived from **`lsblk --json`** (or `blkid`). Must not leak unrelated security-sensitive paths beyond normal `lsblk` output.

### 2. Privileged mount — **sudo**

- **Yes, root-equivalent privileges are required** for `mount` on arbitrary internal partitions (NTFS/ext4/etc.) unless using user-space FUSE stacks (not in scope).

**Recommended pattern:**

1. Ship **`/usr/local/lib/highascg/media-mount.sh`** (path bikeshed OK) **`root:root`**, mode **`0755`**, parses **no** user-supplied shell — only invokes `mount` with options from an allow-list.
2. HighAsCG Node process calls **`/usr/bin/sudo -n`**… or **`sudo`** with **`NOPASSWD:`** strictly for **`/usr/local/lib/highascg/media-mount.sh`** (full path).

**`/etc/sudoers.d/highascg-media-mount`** (example — final text in install script + MANUAL_INSTALL):

```text
# Allow highascg to run ONLY the audited mount helper, no args
casparcg ALL=(root) NOPASSWD:SETENV /usr/local/lib/highascg/media-mount.sh
```

SETENV only if needed for `LC_ALL`; prefer without.

Alternatively pass **exactly two fixed arguments** via sudoers:</br>
`NOPASSWD: /usr/local/lib/highascg/media-mount.sh *` → **reject** — too broad.<br/>
Use **one** wrapper that reads a **single line from a root-only config file written atomically by Node** (still complex), or **`sudo`** wrapper with **`NOEXEC` disallow** … simplest v1 is **sudoers NOPASSWD** for **exact path, no wildcard args**, and helper reads **`/run/highascg/media-mount.req.json`** written by Node with restrictive perms (`root:casparcg`, `0640`), consumed once — **optional** optimisation; v0 can validate device by opening `/dev/disk/by-uuid/$UUID` symlink target.

**Minimal v1:** Node passes **UUID string** via env **`HIGHASCG_MEDIA_MOUNT_UUID=…`** sudo-preserved only if unavoidable; sudoers **`SETENV`** is undesirable — better: temp file **`0400`** casparcg-owned in **`/run/highascg/`**, helper validates path prefix.

Exact mechanism is implementation detail; WO requires **narrow privilege surface** documented in **`docs/MANUAL_INSTALL.md`** and **`scripts/install-phase4.sh`** (or successor).

### 3. Clear-then-mount pipeline (server)

Order (must match Linux expectations):

1. If `/home/casparcg/highascg/media` is **already a mount point**, **`umount -l`** (lazy) or standard `umount` — behaviour if CasparCG has files open: surface **explicit error** (“stop playback / restart Caspar”); document in UX.
2. **Confirm** UX already obtained — server trusts only authenticated Settings user (same as existing settings auth model).
3. Delete **contents** inside mount point (**not** the directory inode itself): e.g. after umount, `find mountpoint -mindepth 1 -maxdepth 1 -exec rm -rf {} +` or equivalent **with path normalisation** and **realpath** check that resolved path **equals** allowed base.
4. **`mount -t auto`** or explicit fstype from `lsblk` row — read-only option **out of scope** (read-write default for ingest + playout).
5. Update saved config: **`media_mount_uuid`** (and optional last-known `KERNEL` name for display only).

### 4. Startup

- In **`index.js`** or dedicated **`src/boot/media-mount.js`**: after config load, if `media_mount_uuid` present and feature flag on, invoke helper **idempotently** (if already mounted and matches, noop).
- **Caspar ordering:** CasparCG should start **after** successful mount OR HighAsCG should document “restart Caspar” toast when mount completes from UI — **prefer** systemd **`PartOf`** / **`After=highascg.service`** adjustment on image build (WO-11 family).

### 5. Web UI

- Rename tab label to **`media/usb`**; prefer internal id **`media-slash-usb`** or keep **`media-usb`** slug but update visible label — **keep one canonical `data-tab` value** and grep-replace usages.
- New section **at top**: partition `<select>` + refresh + **Mount** + status line (last mount error, mounted `SOURCE` from `findmnt`).
- Modal: destructive warning + checkbox “I understand files will be deleted”.
- Existing USB ingest controls **moved down** (same pane).

---

## Code map (expected touch points)

| Concern | File / area |
|---------|-------------|
| Settings tab label + pane structure | `web/components/settings-modal-templates.js` |
| Tab switching / collect / hydrate | `web/components/settings-modal.js`, `settings-modal-logic.js` (or equivalents) |
| New API routes | `src/api/routes-system-storage.js` [NEW] or extend existing system routes |
| Block device listing | `src/system/block-devices.js` [NEW] |
| Mount orchestration | `src/system/media-partition-mount.js` [NEW] |
| Wrapper script (install) | `scripts/highascg-media-mount.sh` → installed to `/usr/local/lib/highascg/` |
| Sudoers / install | `scripts/install-phase4.sh`, `sudoers.d` fragment under `scripts/sudoers.d/` |
| Startup hook | `index.js`, `src/boot/*` |
| Config defaults | `config/default.js`, `src/api/routes-settings.js` |
| Docs | **`work/docs/MANUAL_INSTALL.md`** §7, **`work/docs/LIVE_USB_IMAGE.md`** §7.2 (**CasparCG note**), **`docs/HIGHASCG_PASSWORDLESS_SUDO.md`** |

---

## Tasks

### Phase 1 — Design & safety
- [x] **T38.1** Document threat model: who can POST mount (same auth as settings); symlink attacks on `/dev/disk/by-uuid/*`; denial of mounting system disks.
- [x] **T38.2** Freeze canonical mount point path **`/home/casparcg/highascg/media`** and add compile-time / runtime assert in helper that target path matches.

### Phase 2 — Privileged helper + install
- [x] **T38.3** Implement **`media-mount.sh`** (or similar): `mount-by-uuid`, `umount-media`, `status` subcommands; **no** `eval`; log to journal or `/var/log/highascg/mount.log`.
- [x] **T38.4** Add **`sudoers.d`** fragment + install in **`install-phase4.sh`**; verify **`sudo -n`** works for service user.
- [x] **T38.5** Add **dry-run** / **self-test** in CI or `npm run smoke:media-mount` that mocks `lsblk` JSON only (no real mount in CI).

### Phase 3 — Server API
- [x] **T38.6** `GET /api/system/block-devices` — returns partition list for dropdown.
- [x] **T38.7** `POST /api/system/media-mount` — body `{ uuid }` or `{ device }` (prefer uuid); enforces confirmation token or `?confirm=DELETE_MEDIA` query to prevent accidental CSRF — follow existing API CSRF patterns if any.
- [x] **T38.8** `GET /api/system/media-mount/status` — `findmnt` JSON for fixed path.
- [x] **T38.9** Persist **`media_mount_uuid`** (and optional `media_mount_enabled`) in settings; wire save from UI.

### Phase 4 — Web UI
- [x] **T38.10** Rename tab to **`media/usb`**; move existing USB ingest block **below** new mount block.
- [x] **T38.11** Implement dropdown + refresh + mount + destructive modal (checkbox ack).
- [x] **T38.12** Show current mount status and last error in pane.

### Phase 5 — Startup & operations
- [x] **T38.13** On HighAsCG start, apply saved UUID mount; handle failure with **logged error** + **WS banner** optional.
- [x] **T38.14** Document **CasparCG restart** requirement when mount changes while server running.
- [x] **T38.15** Update **`work/docs/MANUAL_INSTALL.md`** and **`work/docs/LIVE_USB_IMAGE.md`** with persistence + sudoers (see also **`docs/HIGHASCG_PASSWORDLESS_SUDO.md`**).

### Phase 6 — Verification
- [ ] **T38.16** Manual: ext4 internal partition, NTFS internal partition, mount while media folder has files, umount + remount, reboot persistence.
- [ ] **T38.17** Manual: attempt mount when Caspar holds file open — expect controlled failure message.

---

## Technical considerations

- **Clearing the folder:** The Linux kernel allows mounting on a non-empty directory (contents become hidden), but that is **operationally dangerous**. This WO mandates **explicit delete-with-warning** so operators are not surprised by “missing” or “reappearing” files after umount.
- **`rm -rf` scope:** Only under realpath-normalised `/home/casparcg/highascg/media`. Refuse if path is not a directory or is a symlink to outside tree.
- **LUKS / BitLocker:** out of scope unless unlocked by user at OS level first.
- **Dual boot:** mounting Windows “C:” NTFS while hibernated — **read-only** or refuse; document **Windows fast startup** risk (optional `ntfs-3g` ro mount).
- **ZFS / btrfs subvolumes:** v1 may exclude unknown FSTYPES; return clear “unsupported fstype” in API.

---

## Out of scope (v1)

- Editing `/etc/fstab` on the internal disk (live USB may not persist there).
- Multiple alternate media roots.
- Mounting network block storage (NBD/iSCSI).

---

## Work Log

### 2026-05-15 — Agent (WO-38 core implementation)

**Work Done:**
- **`scripts/highascg-media-mount.sh`** → installs to **`/usr/local/lib/highascg/media-mount.sh`**: validates UUID req file `/run/highascg/media-mount.req`, refuses root UUID + busy umount paths, clears mountpoint contents + `mount` (no CLI args beyond sudo invocation).
- **`scripts/sudoers.d/highascg-media-mount`** + **`install-phase4.sh`**: NOPASSWD for that script only; tmpfiles **`/etc/tmpfiles.d/highascg-media-mount.conf`** for **`/run/highascg`** 0770.
- **`src/system/block-devices.js`**, **`src/system/media-partition-mount.js`**, **`src/api/routes-system-storage.js`**: `GET /api/system/block-devices`, `GET /api/system/media-mount/status`, `POST /api/system/media-mount` (`confirm: DELETE_MEDIA`); startup **`ensurePersistedMediaPartitionMounted`** in **`index.js`**.
- **Config:** **`mediaMount`** in **`defaults.js`**, **`MODULAR_KEYS`**, settings GET/POST persistence.
- **UI:** Settings tab **`media/usb`**, top section partition picker + destructive confirm modal; docs hint updates in **`USB_AUTO_MOUNT_UBUNTU.md`**, **`usb-import-modal.js`**.

**Status:** Ready for on-hardware QA (real partition, Caspar files open, NTFS, sudoers install).

**Instructions for Next Agent:** T38.14–38.17 + T38.5 (optional CI smoke): document Caspar restart on mount change; finalize MANUAL_INSTALL / LIVE_USB_IMAGE cross-links; hardware QA checklist.

### 2026-05-15 — Agent (WO-38 status)

Marked implementation tasks **T38.1–T38.13** as done per landed code/API/UI/helper; QA (**T38.16–T38.17**) remained open (**T38.14–15** documented in subsequent entry; **T38.5** landed in latest entry).

### 2026-05-15 — Agent (WO-38 T38.14/T38.15 + startup ordering)

**Work done:** Expanded **`settings-modal-templates.js`** (**media/usb** pane) Caspar/remount/copy; **`work/docs/MANUAL_INSTALL.md`** §7 WO-38 install + sudoers + operator notes; **`work/docs/LIVE_USB_IMAGE.md`** §7.2 Caspar/remount/`sudo`; **`index.js`** — await startup media-mount **before first `CasparConn.start()`** (no race with WO-38 persisted UUID).

**Instructions for next agent:** Hardware QA **T38.16–T38.17** (and **`npm run smoke:media-mount`** in CI optional); confirm Openbox/autostart scanner ordering on rigs that change mounts frequently.

### 2026-05-15 — Agent (WO-38 T38.5 + lsblk key casing)

**Work done:** **`npm run smoke:media-mount`** — `tools/smoke-media-mount-lsblk.js` + fixture **`tools/fixtures/lsblk-w38-partitions.json`** covers **`parseLsblkJsonForPartitionPicker`** (**`src/system/block-devices.js`**). **`listBlockPartitionsForPicker`** accepts real **`lsblk -J`** lowercase keys (and uppercase for compatibility).

**Repair:** **`usb-drives.js`** re-export **`parseLsblkJson`** now passes **`encodeDriveId`** → **`npm run smoke:usb-lsblk`** passes.

**Instructions for next agent:** **T38.16–T38.17** on hardware; CI: add `npm run smoke:media-mount` if desired.

### 2026-05-15 — Agent (Work order drafted)

**Work Done:** Created WO-38 from product request: `media/usb` tab rename, partition dropdown + destructive clear + mount to fixed path, sudo/NOPASSWD narrow wrapper, startup persistence from config on USB.

**Status:** Specification draft; subsequent entry documents implementation landing.

---

*Work Order created: 2026-05-15 | Series: HighAsCG operations | Related: 29_WO_USB_MEDIA_INGEST.md, docs/LIVE_USB_IMAGE.md*
