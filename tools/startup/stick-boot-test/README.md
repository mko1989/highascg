# Stick boot QA (operator USB stick / live ISO)

Read-only test suite to run **on the booted playout machine**:

```bash
bash ~/highascg/tools/startup/stick-boot-test/run-stick-boot-tests.sh          # full
bash ~/highascg/tools/startup/stick-boot-test/run-stick-boot-tests.sh --quick
bash ~/highascg/tools/startup/stick-boot-test/run-stick-boot-tests.sh --list
```

Exit **0** = no FAIL (WARN alone is OK). Tests live in `tests/` (live identity,
stick layout, exFAT operator data, drop-update, WO-47 systemd, Caspar supervisor,
AMCP playout, UI, Openbox, boot journal, replication trust, exFAT network conf).

## Boot-branding checklist (WO-148 — before flashing, on the build host)

Automated gate: `verify-iso-boot-branding.sh` runs inside every produce wrapper and
fails the build if GRUB splash / Plymouth theme / Calamares slideshow are missing.
The visual QEMU pass below is the human confirmation of the same ISO
(no USB flash needed):

```bash
sudo bash tools/eggs/live-usb/preview-live-iso-qemu.sh [/home/eggs/highascg-*.iso]
```

| # | Check | Expected |
|---|-------|----------|
| B1 | **GRUB theme visible** | HighAsCG wallpaper (no penguins), dark menu panel, selected row = bright blue bar (`94,179,255`) with dark text, readable labels (font.pf2 loaded — no blank black panel), 5 s timeout bar |
| B2 | **Plymouth splash visible** | Pick menu entry "… Live (Plymouth splash)": dark HighAsCG splash + top-right corner throbber + systemd status lines on the left — **no** purple Ubuntu dots, no "Ubuntu" wordmark. (Default "… Live" entry intentionally shows full dmesg + framebuffer corner throbber instead.) |
| B3 | **Calamares slideshow branded** | On the live desktop launch the installer (Install to disk); the slideshow shows the dark HighAsCG slides (wordmark + mascot on `#0c1220`), **not** the penguins-eggs slides. You can cancel before partitioning. |

If any of B1–B3 fails: fix the build host
(`sudo bash tools/eggs/live-usb/finalize-boot-branding-for-eggs-produce.sh`,
`sudo bash tools/eggs/live-usb/install-eggs-calamares.sh`), rebuild via
`work/run-eggs-produce-from-host.sh`, and re-check. Do **not** flash an ISO that
fails this checklist — the automated verify should already have failed the build.

See `tools/eggs/live-usb/branding/README.md` for the full branding pipeline and
troubleshooting (blank GRUB panel, purple dots, letterboxing).
