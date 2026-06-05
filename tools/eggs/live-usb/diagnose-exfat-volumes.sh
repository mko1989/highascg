#!/usr/bin/env bash
# Quick check: HIGHASCGDAT (bridge) vs HIGHASCGEXF (USB stick) on live or install host.
set -euo pipefail

echo "=== Disk labels (by-label) ==="
ls -la /dev/disk/by-label/ 2>/dev/null || echo "(no /dev/disk/by-label)"

echo ""
echo "=== lsblk (look for HIGHASCGDAT / HIGHASCGEXF) ==="
lsblk -f -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINTS 2>/dev/null || lsblk -f

echo ""
echo "=== Expected mount points ==="
for mp in /home/casparcg/bridge /home/casparcg/exfat /home/casparcg/highascg/media; do
	if findmnt -n "$mp" &>/dev/null; then
		echo "OK  $mp ← $(findmnt -n -o SOURCE,FSTYPE "$mp")"
	else
		echo "—   $mp (not a mount point)"
	fi
done

echo ""
echo "=== Sync map ==="
for f in /etc/highascg/exfat-sync.json "${HOME}/highascg/config/exfat-sync.json"; do
	[[ -f "$f" ]] && echo "found: $f" && break
done
[[ -f /etc/highascg/exfat-sync.json ]] || echo "WARN: no /etc/highascg/exfat-sync.json"

echo ""
echo "=== systemd (exFAT / bridge) ==="
for u in \
	home-casparcg-bridge.mount \
	home-casparcg-exfat.mount \
	highascg-bridge-boot.service \
	highascg-bridge-arrive.service \
	highascg-exfat-boot.service \
	highascg-exfat-arrive.service \
	highascg-exfat-sync.service; do
	if systemctl cat "$u" &>/dev/null; then
		st="$(systemctl is-active "$u" 2>/dev/null || echo '?')"
		echo "  $u: $st"
	else
		echo "  $u: (unit missing)"
	fi
done

echo ""
echo "=== Boot log (if present) ==="
for log in /var/log/highascg-exfat-boot.log /var/log/highascg-bridge-boot.log; do
	[[ -f "$log" ]] && {
		echo "--- tail $log ---"
		tail -n 15 "$log"
	}
done

echo ""
echo "Notes:"
echo "  HIGHASCGDAT = internal bridge disk → ~/bridge (not on USB-only live boot)"
echo "  HIGHASCGEXF = USB stick data partition → ~/exfat (slot 3 after create-operator-stick-from-dd.sh)"
echo "  RAM-only boot is OK when neither label exists; config stays in ISO/squashfs until USB mounts."
