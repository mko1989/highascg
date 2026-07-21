# WO-314 — Laptop: NVIDIA PRIME selection for casparcg-server.service (post-driver)

**Status: BLOCKED ON OWNER/HARDWARE** (secure boot kept the nvidia module unloaded)

## Context — measured on highascg4790, 2026-07-21
Caspar rendered on integrated AMD ("Initialized OpenGL ... Mesa 25.2.8 AMD"), nvidia-smi returned
nothing (driver not loaded — owner: secure boot was ON, which blocks the unsigned module),
casparcg burned 5/12 cores doing host readback of 2x 1080p50. Full diagnose-first runbook lives
in todos21.07.26 ("NVIDIA GPU NOT IN USE" section). casparcg-server.service sets DISPLAY/
XAUTHORITY but no GPU selection.

## Task (strictly AFTER step A of the runbook shows the driver loaded)
1. Owner: disable secure boot (or enroll MOK) → verify nvidia-smi answers, `lspci -nnk` shows
   "Kernel driver in use: nvidia", `xrandr --listproviders` output captured.
2. Ship a drop-in (scripts/setup/ + eggs include): /etc/systemd/system/casparcg-server.service.d/
   nvidia-prime.conf with __NV_PRIME_RENDER_OFFLOAD=1 + __GLX_VENDOR_LIBRARY_NAME=nvidia,
   applied CONDITIONALLY (ExecStartPre check or generator script: only when nvidia driver is
   loaded AND the iGPU drives the panel) so the same image stays correct on the tower.
3. Verify: caspar log OpenGL line says NVIDIA; processes.caspar cpuPct drops far below 500%;
   host-stats gpu.source becomes nvidia-smi (negative-cache fix ddb72d9 already in).
4. Evaluate prime-select nvidia (dGPU primary) as the better steady-state for pure playout —
   needs reboot; measure both, keep the better, document in docs/reference.

## Acceptance
- On the laptop: OpenGL init line = NVIDIA, casparcg CPU under 2ch 1080p50 measured and recorded
  before/after in this WO. Tower unaffected (unit drop-in inert where driver absent).
