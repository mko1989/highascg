#!/usr/bin/env bash
# test-01-live-identity.sh — live session / driver stamp (sourced by runner)
st_section "01 Live session identity"
st_ok "hostname $(hostname)"
if st_is_live_session; then
	st_ok "live/overlay session detected"
else
	st_warn "not a live overlay session (installed disk or build host is OK for partial runs)"
fi
if [[ -f /etc/highascg/nvidia-iso-driver ]]; then
	st_ok "nvidia-iso-driver $(tr -d '[:space:]' </etc/highascg/nvidia-iso-driver)"
else
	st_warn "no /etc/highascg/nvidia-iso-driver stamp"
fi
if command -v nvidia-smi >/dev/null 2>&1; then
	st_ok "nvidia-smi: $(nvidia-smi --query-gpu=name,driver_version --format=csv,noheader 2>/dev/null | head -1 || echo present)"
else
	st_warn "nvidia-smi not available"
fi
