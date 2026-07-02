# Work Order 94: Ethernet link-local fallback when DHCP is absent

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Draft — root cause confirmed; fix not implemented  
**Priority:** **High** — head-headless rigs on a direct cable (no DHCP) get no usable IPv4 today  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Builds on:**
- [59_WO_DEVICE_VIEW_SERVER_INSPECTOR_FPS_NETWORK.md](./59_WO_DEVICE_VIEW_SERVER_INSPECTOR_FPS_NETWORK.md) — NM apply/reset helpers (`highascg-network-apply.sh`, `highascg-network-reset.sh`)
- [77_WO_STICK_BOOT_QA_TEST_SUITE.md](./77_WO_STICK_BOOT_QA_TEST_SUITE.md) — add stick QA module for no-DHCP link-local
- Egg build networking in `tools/eggs/live-usb/build-highascg-egg.sh`

**Related (border [95_WO_EXFAT_NETWORK_CONFIG_FILE.md](./95_WO_EXFAT_NETWORK_CONFIG_FILE.md) — operator static/DHCP via exFAT (persistent override)

---

## 1. Problem statement

Operators expect a playout box on a **direct Ethernet cable** (no router, no DHCP server) to still get a usable address — typically **IPv4 link-local** (`169.254.0.0/16`) so they can open `http://169.254.x.x:4200/`.

**Observed:** Ethernet stays down / no address when no DHCP server is present.

**Root cause (repo audit 2026-07-01):**

| Layer | Link-local configured? | Notes |
|-------|------------------------|-------|
| **Egg build** (`10-live-wired.network`) | **Yes** — `LinkLocalAddressing=ipv4` | Written by `build-highascg-egg.sh` for **systemd-networkd** |
| **Runtime stack** | **No** | WO-59 documents **NetworkManager owns connections** on the live image; `nmcli` helpers have no link-local settings |
| **NM default ethernet profile** | **No fallback** | `highascg-network-apply.sh` sets `ipv4.method auto` (DHCP only) |
| **Fast boot** | May worsen UX | `install-fast-boot-network.sh` caps `wait-online-timeout=15` — boot continues but NIC may never reach link-local |

The egg’s systemd-networkd drop-in is **not applied** when NM manages the interface (typical deployed stick).

---

## 2. Goal (normative)

When a wired NIC has **carrier** and **DHCP fails or times out**, the box MUST assign **IPv4 link-local** (`169.254.0.0/16`) so:

- Console splash / operator UI show a reachable address
- Short power-button press (`highascg-network-reset.sh`) can recover link-local after cable swap
- Stick-boot QA can assert link-local within a bounded timeout on an isolated link

**Out of scope v1:** mDNS hostname resolution, IPv6 SLAAC-only rigs, Wi‑Fi link-local.

---

## 3. Recommended approach

### 3.1 NetworkManager (primary — matches WO-59)

Configure default / HighAsCG-created connections with **link-local fallback**:

```bash
# NM property (verify exact key on target Ubuntu):
nmcli con mod "$CONN" ipv4.method auto ipv4.link-local 2
# 2 = fallback (link-local when DHCP fails) — confirm enum on image
```

**Deliverables:**

1. **`scripts/runtime/install-highascg-network-defaults.sh`** (or extend `install-network-apply.sh`):
   - Global NM conf fragment **or** patch existing `Wired connection 1` / create `highascg-wired-default` connection profile with link-local fallback
   - Idempotent; safe on laptops (only wired `eth*` / `enp*` / `eno*`)
2. Update **`highascg-network-apply.sh`** — DHCP mode must set link-local fallback, not bare `auto`
3. Update **`highascg-network-reset.sh`** — after renew, log global + link-local (already partial)
4. Hook into **`prepare-eggs-clone-with-exfat.sh`** (same tier as `install-fast-boot-network.sh`)

### 3.2 systemd-networkd (secondary — if NM disabled on some images)

Ensure `10-live-wired.network` survives clone and is not overridden by empty netplan. Document when networkd path applies.

### 3.3 Boot timing

Review interaction with **`wait-online-timeout=15`**: link-local should not require `network-online.target`. Document expected time-to-link-local (~30–90s worst case on some NICs).

---

## 4. Tasks

- [ ] **T94.0** Confirm `ipv4.link-local` enum values on eggs Ubuntu base (`nmcli -f ipv4.link-local con show`)
- [ ] **T94.1** Install script + clone hook for NM link-local fallback on wired profiles
- [ ] **T94.2** Patch `highascg-network-apply.sh` (dhcp branch) and `install-network-apply.sh`
- [ ] **T94.3** Stick QA: module “no DHCP → link-local within N s” (WO-77 extension or standalone script)
- [ ] **T94.4** Docs: `docs/LIVE_USB_IMAGE.md` troubleshooting § direct cable; `docs/HIGHASCG_PASSWORDLESS_SUDO.md` if new helper
- [ ] **T94.5** Manual QA: direct laptop↔NUC cable, no DHCP — splash shows `169.254.x.x`, UI reachable

---

## 5. Acceptance criteria

1. Fresh stick boot on isolated Ethernet obtains **169.254.x.x** without manual `nmcli`
2. Device View **Apply network → DHCP** preserves link-local fallback behaviour
3. Power-button short press renews DHCP; if still no server, link-local returns
4. No regression on normal DHCP LAN (address from server, not link-local)

---

## Work Log

### 2026-07-01 — Initial WO (audit only)

- Documented split: link-local in **egg networkd** config only; **runtime NM** has no fallback — explains user report.
- **Instructions for Next Agent:** Run T94.0 on a live stick; implement T94.1–T94.2; add QA in T94.3.
