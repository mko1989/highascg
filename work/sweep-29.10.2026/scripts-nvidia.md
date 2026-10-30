# scripts/nvidia — sweep 29.10.2026 (batch 057)

Files: 1 · lines: 39 · findings: 0 BUG-HIGH, 0 BUG, 0 DEAD, 0 RISK, 1 QUALITY

## scripts/nvidia/disable-nvidia-multi-driver-boot.sh
- `QUALITY` scripts/nvidia/disable-nvidia-multi-driver-boot.sh:29-36 — the pool purge defaults to ON (`${HIGHASCG_PURGE_NVIDIA_POOL:-1}`), so the documented "run on a deployed rig once" (L3) also `rm -rf /opt/nvidia-pool` (~1.5 GiB driver pool) without any prompt; the "keeping" message (L34) says "set =1 to remove" although 1 is already the default and only an explicit `=0` reaches that branch. Make the default 0 (callers that want it, `tools/eggs/live-usb/build-highascg-egg.sh:50`, already export `=1`) or fix the message.
- Live: the file is reached through the forwarder `scripts/disable-nvidia-multi-driver-boot.sh` (`exec bash …/nvidia/…`) by `tools/eggs/live-usb/build-highascg-egg.sh:51` and `audit-eggs-clone-host.sh:94`. Root check, `|| true` guards and `rm -f` on fixed paths are fine.
