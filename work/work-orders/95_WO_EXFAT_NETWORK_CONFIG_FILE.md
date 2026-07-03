# Work Order 95: exFAT operator network config file (DHCP / static IP)

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** In progress — T95.1–T95.3 shipped (2026-07-03)  
**Priority:** **Medium** — field operators need IP without Web UI or Device View on first boot  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Builds on:**
- [47_WO_EXFAT_DATA_MOUNT_AND_MTIME_BOOT_SYNC.md](./47_WO_EXFAT_DATA_MOUNT_AND_MTIME_BOOT_SYNC.md) — exFAT mount + boot sync ordering
- [59_WO_DEVICE_VIEW_SERVER_INSPECTOR_FPS_NETWORK.md](./59_WO_DEVICE_VIEW_SERVER_INSPECTOR_FPS_NETWORK.md) — `highascg-network-apply.sh`, settings schema
- [92_WO_DECKLINK_EXFAT_VENDOR_INSTALL.md](./92_WO_DECKLINK_EXFAT_VENDOR_INSTALL.md) — pattern: fixed exFAT path + boot-time idempotent apply
- [94_WO_ETHERNET_LINK_LOCAL_FALLBACK.md](./94_WO_ETHERNET_LINK_LOCAL_FALLBACK.md) — link-local when mode=dhcp and no server

**Existing layout:** `tools/eggs/live-usb/seed-exfat-operator-layout.sh` — extend with `network/` folder + sample file

---

## 1. Goal

Place a **small plain-text config** on the operator exFAT volume (label **`HIGHASCGEXF`**, mount **`~/exfat`**) so users can set **desired IPv4 networking** from any OS (Windows / macOS / Linux) without SSH:

- **DHCP (auto)** — default; optional link-local fallback (WO-94)
- **Manual (static)** — IP, prefix/mask, gateway, optional DNS
- **Optional future keys** — primary interface name, hostname override (document as reserved; v1 may ignore)

Apply **early at boot** (after exFAT mount, before or with `highascg.service`) and **on hot-plug** (`highascg-exfat-arrive`) when file mtime changes.

---

## 2. Operator workflow

1. Edit on the stick (mounted on any PC):

   ```
   /network/network.conf
   ```

   Mounted on playout host as:

   ```
   /home/casparcg/exfat/network/network.conf
   ```

2. Reboot or re-plug USB → HighAsCG applies settings via audited helper (same allow-list as WO-59).

3. Web UI / Device View should **reflect** applied state (read from NM + optional persisted copy in `highascg.config.json`).

---

## 3. File format (v1 — INI-style, exFAT-friendly)

Plain UTF-8 text; `#` or `;` comments; Windows Notepad OK.

```ini
# HighAsCG network — edit on exFAT stick, save, reboot
# mode: dhcp | static
mode=dhcp

# Optional — auto-detect if omitted (first wired NIC with carrier)
# interface=enp3s0

# --- static only (when mode=static) ---
# address=192.168.1.50
# prefix=24
# gateway=192.168.1.1
# dns=192.168.1.1,8.8.8.8
```

**Rules:**

- Unknown keys → ignore + log once
- Invalid values → skip apply, log error, keep previous working config (fail-safe)
- Missing file → no-op (use NM defaults + WO-94 link-local fallback)
- **Do not** store secrets in this file (no Tailscale auth keys — use `.private/` per WO-61)

---

## 4. Architecture

```text
exfat/network/network.conf
        │
        ▼
highascg-exfat-network-apply.service  (oneshot, After=home-casparcg-exfat.mount)
        │
        ▼
/usr/local/lib/highascg/highascg-exfat-network-apply.sh
        │ parse + validate
        ▼
highascg-network-apply.sh dhcp|static <iface> …   (WO-59)
        │
        ▼
Optional: merge into highascg.config.json network.* for UI parity
```

**Ordering:** `Before=highascg.service`; may run parallel with `highascg-exfat-sync.service` if only reads exFAT path.

**Idempotency:** Hash or mtime stamp under `/var/lib/highascg/last-exfat-network.conf` — skip if unchanged.

---

## 5. Tasks

- [x] **T95.0** Bikeshed path: `network/network.conf` vs `network.conf` at exFAT root — prefer **`network/network.conf`** + README
- [x] **T95.1** Parser script + install via `scripts/exfat/install-exfat-systemd-units.sh`
- [x] **T95.2** systemd unit + hook in `highascg-exfat-arrive.sh` when file mtime changes
- [x] **T95.3** Seed sample + README in `seed-exfat-operator-layout.sh`
- [x] **T95.4** API: `GET /api/system/network` notes `source: exfat|ui|default`; optional POST to write back to exFAT (v2)
- [x] **T95.5** Docs: `tools/eggs/live-usb/EXFAT_DATA_ZERO_TOUCH.md`, `client/tools/live-usb/USB_STICK_AFTER_FLASH.md`
- [ ] **T95.6** QA: edit stick on Windows → static IP; edit → dhcp; missing file → WO-94 fallback

---

## 6. Acceptance criteria

1. Operator can set static IP by editing one file on exFAT without Linux shell
2. Boot applies config before operator opens browser (or documents ≤N s delay)
3. Invalid file never leaves box unreachable (last good config or DHCP+link-local)
4. Device View **Apply network** and exFAT file stay consistent (document precedence: **exFAT wins at boot**; UI wins until next boot unless UI also writes exFAT — v2)

---

## Work Log

### 2026-07-01 — Initial WO (design)

- Proposed INI format, path, boot ordering, integration with WO-59 helpers.
- **Instructions for Next Agent:** Implement T95.1–T95.3 after WO-94 link-local fallback lands (dhcp mode depends on it).

### 2026-07-03 — T95.1–T95.3 implementation

- Added `scripts/exfat/highascg-exfat-network-apply.sh` — INI parser, validation, content-hash idempotency, delegates to `highascg-network-apply.sh`.
- Wired `highascg-exfat-network-apply.service` in `install-exfat-systemd-units.sh` (After exFAT mount, Before server-update/highascg).
- Hot-plug: `highascg-exfat-arrive.sh` + `highascg-exfat-boot.sh` queue network apply.
- Seeded `network/network.conf` sample + README in `seed-exfat-operator-layout.sh`.
- Stick boot QA: `test-03` checks `network/` folder; `test-05` checks new systemd unit.
- WO-94 partial: `highascg-network-apply.sh` dhcp branch now sets `ipv4.link-local 2` (NM fallback).
- **Instructions for Next Agent:** Run `sudo bash scripts/exfat/install-exfat-systemd-units.sh` + `sudo bash scripts/runtime/install-network-apply.sh` on a rig; QA T95.6 on real stick. T95.4 (API source tag) and T95.5 (docs) remain.

### 2026-07-03 — T95.4–T95.5 (API source + docs)

- `GET /api/system/network` now returns **`source`**, **`exfatConfPresent`**, **`exfatConfPath`** via `resolveNetworkConfigSource()` in `network-inventory.js`.
- Apply paths record source: exfat script writes **`exfat`**; **`POST /api/system/network/apply`** writes **`ui`**.
- Device View server inspector shows **`config: exfat|ui|default`** in network status line.
- Docs: **`EXFAT_DATA_ZERO_TOUCH.md`** (boot order + operator network section); **`USB_STICK_AFTER_FLASH.md`** (`network/` folder + Windows/macOS seeding).
- Stick boot QA: **`test-12-exfat-network-conf.sh`**.
- **Instructions for Next Agent:** Field QA T95.6 on a stick (Windows edit → static → reboot → `GET /api/system/network` shows `source: exfat`). Optional v2: POST to write UI config back to exFAT.
