# Work Order 92: DeckLink Desktop Video — exFAT vendor drop + boot/API install (no BMD in ISO)

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Draft — design + task breakdown  
**Priority:** **High** — blocks shipping a redistributable live ISO without embedding Blackmagic Desktop Video  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Builds on (required reading):**
- [39_WO_SETTINGS_SYSTEM_HARDWARE.md](./39_WO_SETTINGS_SYSTEM_HARDWARE.md) — DeckLink settings tab, `GET /api/system/decklink`, GUI launch
- [47_WO_EXFAT_DATA_MOUNT_AND_MTIME_BOOT_SYNC.md](./47_WO_EXFAT_DATA_MOUNT_AND_MTIME_BOOT_SYNC.md) — `HIGHASCGEXF` mount, boot ordering
- [66_WO_BOOT_DROP_UPDATE_VERSION_AND_WEBUI_UPDATE.md](./66_WO_BOOT_DROP_UPDATE_VERSION_AND_WEBUI_UPDATE.md) — exFAT `drop-update/` retain-on-stick pattern
- [73_WO_CALAMARES_SYSTEMD_CASPAR_NUCLEAR.md](./73_WO_CALAMARES_SYSTEMD_CASPAR_NUCLEAR.md) — systemd ordering vs Caspar
- [90_WO_ISO_THIRD_PARTY_LICENSES_FOLDER.md](./90_WO_ISO_THIRD_PARTY_LICENSES_FOLDER.md) — BMD EULA compliance; `HIGHASCG_ISO_FORBID_DECKLINK`

**Existing code to reuse (do not rewrite from scratch):**
- `scripts/lib/install-helpers.sh` — `fetch_decklink_tarball`, `decklink_report_status`, `decklink_pkg_version`
- `scripts/legacy/install-phase2.sh` — `dpkg -i` / `apt install -f` / `modprobe blackmagic_io` sequence
- `scripts/setup/06-decklink-manual.md` — operator manual steps
- `scripts/setup/check-decklink.sh` — quick status
- `src/api/system-hardware-gui.js` — DeckLink GUI discovery
- `tools/eggs/live-usb/audit-eggs-clone-host.sh` — `HIGHASCG_ISO_FORBID_DECKLINK`, `HIGHASCG_SKIP_DECKLINK_CHECK`

**Operator docs (update when shipped):**
- `docs/LIVE_USB_IMAGE.md` — § DeckLink (operator-supplied)
- `docs/ISO_CONTENTS.md` — DeckLink **not** embedded when `HIGHASCG_ISO_FORBID_DECKLINK=1`
- `licenses/COMPLIANCE-ISO.md` — operator-supplied BMD section
- `client/tools/live-usb/USB_STICK_AFTER_FLASH.md` — copy tarball to exFAT path
- `scripts/setup/06-decklink-manual.md` — link to exFAT + API path

---

## 1. Problem statement

Blackmagic **Desktop Video** (DeckLink drivers + DKMS `blackmagic_io`) **cannot be redistributed inside the HighAsCG live ISO** without violating BMD license / product policy. Today:

| Today | Issue |
|-------|--------|
| Eggs audit **fails** if `desktopvideo` is missing on clone host | Forces build hosts to embed BMD before `eggs produce` |
| `scripts/setup/06-decklink-manual.md` | SSH-only install from tarball on a machine with a browser |
| Settings → **decklink** tab | Read-only status + GUI launch — **no install path** |
| BMD CDN download from playout box | Often **403** / HTML error pages (`install-config.sh` comment) |

**Goal:** Operators who own DeckLink hardware download Desktop Video from Blackmagic, place it on the **operator exFAT stick** (or internal install), and have HighAsCG **install or upgrade idempotently** at boot and on demand from the Web UI — **without** baking BMD into the squashfs.

---

## 2. Recommended approach (normative product design)

### 2.1 Operator workflow (live USB stick)

1. Download **Desktop Video for Linux** `.tar.gz` from [Blackmagic support](https://www.blackmagicdesign.com/support/family/capture-and-playback) on any machine with a browser.
2. Copy the tarball to the USB exFAT partition (label **`HIGHASCGEXF`**) at a **fixed path**:

   ```
   /vendor/decklink/Blackmagic_Desktop_Video_Linux_<version>.tar.gz
   ```

   Mounted on the playout host as:

   ```
   /home/casparcg/exfat/vendor/decklink/Blackmagic_Desktop_Video_Linux_*.tar.gz
   ```

3. Boot the stick (or hot-plug USB → `highascg-exfat-arrive` — see §3.4).
4. Early boot runs **`highascg-decklink-install.service`** (idempotent):
   - If **no tarball** → exit 0, log one info line.
   - If **`desktopvideo` already installed** at **same or newer version** as tarball and **`blackmagic_io` loads** → exit 0 ( **do not reinstall every boot** ).
   - Else → extract to `/run/highascg/decklink-install/` (tmpfs), `dpkg -i` + `apt install -f`, `dkms` if needed, `modprobe blackmagic_io`.
5. Settings → **decklink** shows status; optional **Install / upgrade from USB** button calls the same audited script.

**Why not reinstall every boot?**

| Reinstall every boot | Idempotent check-first |
|--------------------|-------------------------|
| Adds 30–120 s to every cold boot | Usually &lt;1 s when already OK |
| `dpkg`/DKMS churn risks flaky field units | Stable after first success |
| Unnecessary wear / log noise | Only runs when tarball newer or packages missing |

**When persistence matters:** On live USB, `dpkg` state may live in **overlay/casper-rw** (if present) or be **lost on reboot**. The WO must document which stick layouts persist `desktopvideo` and when boot-time install is **required every boot** anyway (exFAT-only / no overlay). Even then, the script should be **fast no-op** when the running kernel already has matching modules loaded.

### 2.2 exFAT folder contract (parallel to `drop-update/`)

| Path on `HIGHASCGEXF` | Purpose |
|-----------------------|---------|
| `drop-update/` | HighAsCG server tree (WO-66) — **retain on stick** |
| `drop-config/` | Config sync pairs (WO-47 / WO-52) |
| **`vendor/decklink/`** | **Operator-supplied BMD tarball(s)** — this WO |
| `vendor/decklink/README.txt` | Short instructions + link to BMD download (no EULA text copied from BMD site) |

**Tarball discovery rules (v1):**

1. Prefer **newest** file matching `Blackmagic_Desktop_Video_Linux_*.tar.gz` (parse version from filename).
2. Fallback: literal `desktopvideo.tar.gz` (operator rename OK).
3. Optional env override: `HIGHASCG_DECKLINK_TAR=/home/casparcg/exfat/vendor/decklink/….tar.gz`.

**Do not** sync `vendor/decklink/` through `exfat-sync.json` into `~/highascg` — keep vendor payloads **only on exFAT**.

### 2.3 Backend install path (audited, no arbitrary shell)

| Method | Route | Notes |
|--------|-------|-------|
| GET | `/api/system/decklink` | **Extend** existing payload: `installed`, `version`, `moduleLoaded`, `pciPresent`, `tarballOnExfat`, `tarballVersion`, `installState`, `lastInstallLog` |
| POST | `/api/system/decklink/install` | Body `{ password?, source?: 'exfat'|'env' }` — runs fixed helper; optional `checkNuclearPassword` (same as reboot) |
| POST | `/api/system/decklink/install` query `?dryRun=1` | Report what would happen (version compare only) |

**Implementation:** delegate to **`/usr/local/lib/highascg/decklink-install.sh`** (root-owned, allow-listed in sudoers), which:

- Accepts **no user-controlled paths** — only reads from `vendor/decklink/` glob or `HIGHASCG_DECKLINK_TAR` set by the wrapper.
- Logs to **`/var/log/highascg/decklink-install.log`** + journal.
- Returns JSON via stdout for API layer (or exit codes + log tail).

Refactor shared logic from `install-phase2.sh` + `fetch_decklink_tarball` into **`scripts/lib/decklink-install-lib.sh`** sourced by both legacy installer and `decklink-install.sh`.

### 2.4 Boot systemd ordering

```text
home-casparcg-exfat.mount
  → highascg-exfat-server-update.service   # WO-66 — server drop first
  → highascg-decklink-install.service     # this WO — before Caspar needs DeckLink
  → highascg-exfat-sync.service
  → casparcg-scanner.service
  → casparcg-server.service
  → highascg.service
```

**Late USB arrive:** if `vendor/decklink/` appears after boot, `highascg-exfat-arrive` should **`systemctl start highascg-decklink-install.service`** (non-blocking is OK if Caspar not yet started; **block** if Caspar units already active and PCI DeckLink present but drivers missing — bikeshed in implementation).

### 2.5 ISO build / audit changes

Release stick images should be produced with:

```bash
export HIGHASCG_ISO_FORBID_DECKLINK=1
export HIGHASCG_SKIP_DECKLINK_CHECK=1   # audit: warn instead of fail when desktopvideo absent
```

Update **`audit-eggs-clone-host.sh`** default for public ISO builds:

| `desktopvideo` on build host | `HIGHASCG_ISO_FORBID_DECKLINK` | Audit result |
|------------------------------|----------------------------------|--------------|
| absent | `1` (default for release) | **OK** + note “operator vendor/decklink” |
| present | `0` (dev / integrator clone) | **OK** + BMD EULA in `licenses/` (WO-90) |
| present | `1` | **FAIL** (contradiction) |

**`licenses/COMPLIANCE-ISO.md`:** add § “DeckLink — operator supplied” when not embedded.

---

## 3. Alternatives considered

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **A. exFAT `vendor/decklink/` + idempotent boot** (recommended) | Matches `drop-update/` mental model; works from Mac/Windows copy; no network on playout | Needs boot unit + sudoers; large tarball on stick | **Ship v1** |
| **B. Reinstall from exFAT every boot** | Simple “always fresh” mental model | Slow; DKMS noise; failure breaks every boot | **Reject** — use version check |
| **C. Web UI upload tarball → exFAT** | No manual USB mount on laptop | Large HTTP body; auth; storage | **Phase B** nice-to-have |
| **D. Download from BMD CDN at boot/API** | No stick copy | CDN 403; legal grey area automating download | **Reject** (already failed in installer) |
| **E. exFAT folder of loose `.deb` only** | Smaller than full tarball | Version skew between `desktopvideo` and `desktopvideo-gui`; harder docs | **Optional** — support as fallback glob `vendor/decklink/deb/*.deb` in v2 |
| **F. Calamares post-install only** | Drivers on internal disk after install | Live USB stick session still broken until manual step | **Complement** — run same script from Calamares hook |
| **G. Document SSH-only (`06-decklink-manual.md`)** | Zero code | Poor operator UX on headless sticks | **Supersede** for stick workflow, keep as fallback |

---

## 4. Web UI (Settings → decklink)

Extend **`settings-pane-decklink`**:

| Element | Behaviour |
|---------|-----------|
| Status block | Installed version, module loaded, firmware mismatch hint (from kernel log heuristic — reuse `decklink_report_status`) |
| exFAT tarball row | “Found: `Blackmagic_Desktop_Video_Linux_15.3.1.tar.gz`” or “Not found — see README on stick” |
| **Install / upgrade from USB** | `POST /api/system/decklink/install` — show log tail in `#decklink-status-line` |
| Link | Open `docs` anchor or wiki: “Download from Blackmagic → copy to `vendor/decklink/`” |
| Existing buttons | Desktop Video Setup / Updater unchanged (require packages installed) |

**Copy for operators:** “HighAsCG does not ship DeckLink drivers. You must download Desktop Video from Blackmagic and place it on the exFAT stick.”

---

## 5. Security & compliance

- **License:** HighAsCG does **not** distribute BMD binaries. Operator acceptance of BMD EULA happens when they download from Blackmagic. Ship **`vendor/decklink/README.txt`** pointing to BMD terms, not a copy of the EULA unless legally reviewed (WO-90).
- **Sudo:** `NOPASSWD` only for **`/usr/local/lib/highascg/decklink-install.sh`** — no glob args, no client-supplied paths.
- **Nuclear password:** Recommend **`checkNuclearPassword`** on POST install (driver install is disruptive).
- **Supply chain:** Validate tarball is gzip (`file` / magic bytes) before extract; refuse if HTML error page downloaded (existing `fetch_decklink_tarball` checks).

---

## 6. Tasks

### Phase A — Library + script (no ISO change yet)

- [ ] **T92.A1** Extract `scripts/lib/decklink-install-lib.sh` — version parse, compare, install from tarball path, status struct.
- [ ] **T92.A2** Add `scripts/runtime/decklink-install.sh` + install to `/usr/local/lib/highascg/decklink-install.sh` via `install-phase4` / `install-exfat-systemd-units.sh`.
- [ ] **T92.A3** Sudoers fragment + `docs/HIGHASCG_PASSWORDLESS_SUDO.md`.
- [ ] **T92.A4** Unit tests: version compare, “skip when installed”, invalid tarball rejected.

### Phase B — Boot + API

- [ ] **T92.B1** `highascg-decklink-install.service` + install hook; ordering vs WO-66/WO-73.
- [ ] **T92.B2** Extend `GET /api/system/decklink` + `POST /api/system/decklink/install` in `routes-system-hardware` (or `routes-decklink-install.js`).
- [ ] **T92.B3** Wire Settings decklink tab — install button, tarball detection display.
- [ ] **T92.B4** `highascg-exfat-arrive` — trigger decklink install when USB appears late (if DeckLink PCI present).

### Phase C — ISO / stick packaging

- [ ] **T92.C1** `audit-eggs-clone-host.sh` — release mode defaults (`HIGHASCG_ISO_FORBID_DECKLINK=1`).
- [ ] **T92.C2** `prepare-eggs-clone-with-exfat.sh` / `BUILD_AND_FLASH.md` — document no BMD on ISO; seed empty `vendor/decklink/README.txt` on stick template.
- [ ] **T92.C3** `tools/runtime/stick-boot-test/test-XX-decklink-vendor.sh` — optional module: tarball absent → skip; mock tarball → dry-run OK.
- [ ] **T92.C4** Update `docs/ISO_CONTENTS.md`, `licenses/COMPLIANCE-ISO.md`, `06-decklink-manual.md`.

### Phase D — QA (hardware)

- [ ] **T92.D1** Stick boot: no tarball, no PCI → no-op.
- [ ] **T92.D2** Stick boot: tarball on exFAT, DeckLink PCI → install success, `ffmpeg -f decklink` or Caspar decklink consumer sees device.
- [ ] **T92.D3** Upgrade: older tarball replaced with newer on exFAT → upgrade on next boot.
- [ ] **T92.D4** Calamares install to disk → drivers persist on target system (overlay not wiped).

---

## 7. Acceptance criteria

1. Public ISO builds **without** `desktopvideo` packages pass eggs audit when `HIGHASCG_ISO_FORBID_DECKLINK=1`.
2. Operator can copy BMD tarball to **`exfat/vendor/decklink/`** and get working DeckLink after boot **without SSH**.
3. Repeat boot with unchanged tarball completes install step in **&lt;2 s** (no-op path).
4. Settings → decklink shows accurate status and manual install works.
5. Install path documented in operator USB stick guide.

---

## 8. Open questions (resolve in Phase A PR)

1. **Stick persistence:** Does the current hybrid stick still use **union/casper-rw** for `dpkg` state, or exFAT-only? Document per `docs/LIVE_USB_IMAGE.md` and adjust “every boot” messaging.
2. **Kernel updates:** If stick boots a new kernel without DKMS rebuild, should install script always run `dkms install` when module missing? (Likely **yes**.)
3. **Multiple tarballs:** Keep newest only, or fail if more than one? (Recommend **newest wins** + warn in log.)
4. **Internal bridge disk (`HIGHASCGDAT`):** Mirror `vendor/decklink/` there for rack units without USB stick? (WO-52 follow-on — out of v1 unless trivial.)

---

## Work Log

### 2026-06-30 — Draft WO (design)

- Created WO-92 from operator request: cannot redistribute DeckLink in ISO; need backend + stick workflow.
- **Recommendation:** `exfat/vendor/decklink/<tarball>` + **idempotent** boot service (not blind reinstall every boot) + `POST /api/system/decklink/install` + Settings button.
- Reuse `install-helpers.sh` / `install-phase2.sh` dpkg sequence; align boot ordering with WO-66/73.
- ISO audit: default `HIGHASCG_ISO_FORBID_DECKLINK=1` for release images.

**Instructions for Next Agent:** Start Phase A — extract `decklink-install-lib.sh` and standalone `decklink-install.sh` with unit tests; do not change eggs pipeline until script is tested on a dev host with a real BMD tarball.
