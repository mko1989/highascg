# Boot emergency mode (Ctrl+D to continue)

If the machine drops into **emergency mode** during boot and you must press **Ctrl+D** to continue, check the journal on the playout PC:

```bash
journalctl -b -p err --no-pager | tail -40
journalctl -b -g 'emergency|local-fs|HIGHASCG|boot-efi' --no-pager | tail -30
```

## Common causes (WO-47 / WO-52 playout installs)

| Symptom in journal | Cause | Fix |
|--------------------|-------|-----|
| `Timed out waiting for device dev-disk-by-uuid-1E9C-3CEB` | `/etc/fstab` **/boot/efi** points at an old ESP UUID (disk reinstall / imaging) | Run fix script (updates fstab to current vfat UUID) |
| `Timed out waiting for device dev-disk-by-label-HIGHASCGEXF` | **USB stick not plugged in** but `home-casparcg-exfat.mount` was **enabled** at boot | Fix script **disables** USB mount at `local-fs`; `highascg-exfat-boot.service` mounts when stick appears |
| `Dependency failed for local-fs.target` | Combination of the above | Same fix script |

USB and bridge volumes are **optional at boot**. Missing stick or bridge disk must not block `local-fs.target`.

## One-command fix (run on each affected PC)

```bash
cd ~/highascg && sudo bash scripts/fix-boot-emergency-recovery.sh
sudo reboot
```

After reboot, confirm:

```bash
systemctl is-enabled home-casparcg-exfat.mount   # disabled
systemctl is-enabled highascg-exfat-boot.service # enabled
findmnt /boot/efi || echo "EFI not mounted (check fstab)"
```

## Manual EFI fstab check

```bash
grep /boot/efi /etc/fstab
lsblk -f | grep vfat
blkid | grep vfat
```

The UUID in fstab must match the vfat ESP on the boot drive (often `nvme0n1p1`).
