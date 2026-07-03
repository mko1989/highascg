#!/usr/bin/env bash
# Step 10: Playout performance policy — CPU governor + no unattended upgrades.
#
#   sudo bash scripts/setup/10-playout-performance.sh
#
# What it does (idempotent):
#   1. Installs highascg-cpu-performance.service: sets the intel_pstate/cpufreq
#      governor and energy_performance_preference to "performance" on every
#      boot. Playout needs consistent frame timing; the default "powersave"
#      governor ramps clocks up lazily and adds latency spikes on TAKE.
#   2. Disables unattended-upgrades and the apt-daily timers. A kernel, NVIDIA
#      or ffmpeg upgrade mid-show can kill playout; updates are applied
#      manually in maintenance windows (see MANUAL_INSTALL.md).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root

# --- 1. CPU governor: performance ------------------------------------------

log "CPU performance governor unit"
cat >/usr/local/bin/highascg-cpu-performance.sh <<'EOF'
#!/bin/sh
# HighAsCG playout: force performance governor + EPP on all CPUs.
for g in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
	[ -w "$g" ] && echo performance >"$g" 2>/dev/null
done
for e in /sys/devices/system/cpu/cpu*/cpufreq/energy_performance_preference; do
	[ -w "$e" ] && echo performance >"$e" 2>/dev/null
done
# Make sure turbo stays enabled (intel_pstate: 0 = turbo allowed).
[ -w /sys/devices/system/cpu/intel_pstate/no_turbo ] && echo 0 >/sys/devices/system/cpu/intel_pstate/no_turbo 2>/dev/null
exit 0
EOF
chmod 755 /usr/local/bin/highascg-cpu-performance.sh

cat >/etc/systemd/system/highascg-cpu-performance.service <<'EOF'
[Unit]
Description=HighAsCG: CPU performance governor for playout
# Re-run after suspend/resume too (governor can reset).
After=multi-user.target suspend.target hibernate.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/highascg-cpu-performance.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target suspend.target hibernate.target
EOF

systemctl daemon-reload
systemctl enable --now highascg-cpu-performance.service
gov="$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo '?')"
[[ "$gov" == "performance" ]] && ok "governor = performance" || fail "governor is '$gov' (expected performance)"

# --- 2. Disable unattended upgrades -----------------------------------------

log "Disable unattended-upgrades + apt-daily timers"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
// HighAsCG playout: no automatic package operations. Update manually in
// maintenance windows (scripts/setup/10-playout-performance.sh).
APT::Periodic::Update-Package-Lists "0";
APT::Periodic::Download-Upgradeable-Packages "0";
APT::Periodic::Unattended-Upgrade "0";
APT::Periodic::AutocleanInterval "0";
EOF

systemctl stop unattended-upgrades.service 2>/dev/null || true
systemctl disable unattended-upgrades.service 2>/dev/null || true
systemctl mask apt-daily.timer apt-daily-upgrade.timer 2>/dev/null || true
systemctl stop apt-daily.timer apt-daily-upgrade.timer 2>/dev/null || true
ok "unattended-upgrades disabled, apt-daily timers masked"

echo
ok "playout performance policy applied"
echo "Verify: cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor"
echo "        systemctl list-timers | grep apt   # should be empty"
