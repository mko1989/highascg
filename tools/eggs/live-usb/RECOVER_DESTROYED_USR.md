# Recover host after liveroot `rm` destroyed `/usr`

## Symptoms

- `sudo: command not found`, `ls: command not found` (with PATH set)
- SSH may still work (sshd loaded in RAM)
- `/home/casparcg/highascg` often **still intact**
- Eggs artifact often still on disk: `/home/eggs/mnt/iso/live/filesystem.squashfs` or `*.iso`

## Cause

`rm -rf /home/eggs/liveroot` while eggs **bind-mounts** live `/usr` into liveroot deletes the real system.

**After any Ctrl-C during `eggs produce` → `reboot` before any liveroot cleanup.**

## Recovery A — SSH + artifact on disk (fastest if ISO/squashfs is complete)

### 1. Bootstrap tools (from your laptop)

```bash
curl -fsSL -o /tmp/busybox https://busybox.net/downloads/binaries/1.36.1-x86_64-linux-musl/busybox
chmod +x /tmp/busybox
scp /tmp/busybox root@YOUR_HOST:/root/busybox
```

Use `su -` on SSH if root login is disabled:

```bash
ssh casparcg@YOUR_HOST
su -
# then receive busybox via scp to /root/busybox from another terminal
```

### 2. Find artifact (on broken host, bash only)

```bash
echo /home/eggs/mnt/iso/live/filesystem.squashfs
echo /home/eggs/mnt/highascg-nvidia-595_*.iso
echo /home/eggs/*.iso
```

Need **≥ ~3 GB** squashfs (complete build). Partial 0% mksquashfs is useless.

### 3. Run recovery (as root)

```bash
export BB=/root/busybox
export PATH="/root:$PATH"
bash /home/casparcg/highascg/tools/eggs/live-usb/recover-host-usr-from-eggs-artifact.sh
```

Or point at a specific file:

```bash
export HIGHASCG_RECOVER_ARTIFACT=/home/eggs/mnt/highascg-nvidia-595_amd64_2026-06-06_1613.iso
bash .../recover-host-usr-from-eggs-artifact.sh
```

### 4. Reboot

```bash
echo b > /proc/sysrq-trigger
```

## Recovery B — Boot ISO USB

If SSH recovery fails or artifact is truncated:

1. Flash/copy ISO to USB on another machine
2. Boot USB → live session
3. Mount root partition: `mount /dev/nvme0n1p2 /mnt`
4. Loop-mount ISO, squashfs, `cp -a` `usr` `bin` `lib` `sbin` into `/mnt/`
5. Reboot internal disk

## Recovery C — Reinstall Ubuntu, keep `/home`

If artifact is bad:

1. Reinstall 24.04, **preserve /home**
2. `~/highascg` repo remains
3. Run `scripts/setup/` from scratch

## After any recovery

```bash
cd ~/highascg
sudo bash scripts/setup/02-verify-kernel-117.sh
sudo bash scripts/highascg-exfat-remount-sync.sh
```

## Prevention (scripts updated)

- `never rm /home/eggs
- Safety uses `/usr/bin/findmnt` absolute paths — fails closed if tools missing
- **Never** `rm -rf liveroot` after interrupted produce — **reboot first**
