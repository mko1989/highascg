# Compare version strings: returns 0 if $1 >= $2
version_gte() {
    [ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" = "$2" ]
}

# Print a dependency status line
# Usage: dep_status "Name" "installed|missing" "current_ver" "recommended_ver" "min_ver" "required|optional"
dep_status() {
    local name="$1" status="$2" current="$3" recommended="$4" minver="$5" req="$6"
    if [ "$status" = "installed" ]; then
        if [ -n "$minver" ] && ! version_gte "$current" "$minver"; then
            printf "  ${RED}✗${NC} %-22s ${RED}v%-12s${NC} (min: v%-8s rec: v%-8s) ${RED}[UPGRADE REQUIRED]${NC}\n" "$name" "$current" "$minver" "$recommended"
        elif [ -n "$recommended" ] && ! version_gte "$current" "$recommended"; then
            printf "  ${YELLOW}~${NC} %-22s ${YELLOW}v%-12s${NC} (rec: v%-8s)              ${YELLOW}[upgrade available]${NC}\n" "$name" "$current" "$recommended"
        else
            printf "  ${GREEN}✓${NC} %-22s ${GREEN}v%-12s${NC}                                ${GREEN}[OK]${NC}\n" "$name" "$current"
        fi
    else
        if [ "$req" = "required" ]; then
            printf "  ${RED}✗${NC} %-22s ${RED}%-14s${NC}                               ${RED}[INSTALL REQUIRED]${NC}\n" "$name" "not found"
        else
            printf "  ${YELLOW}○${NC} %-22s ${YELLOW}%-14s${NC}                               ${YELLOW}[optional]${NC}\n" "$name" "not found"
        fi
    fi
}

# Prompt user for install/upgrade action
# Usage: ask_action "component_name" "installed|missing" "current" "min" "action_desc"
# Returns: 0 = proceed, 1 = skip
ask_action() {
    local name="$1" status="$2" current="$3" minver="$4" desc="$5"
    
    # If missing and required, cannot skip
    if [ "$status" = "missing" ]; then
        echo -e "\n${CYAN}→ $name is not installed. Installing...${NC}"
        return 0
    fi
    
    # If below minimum, cannot skip
    if [ -n "$minver" ] && ! version_gte "$current" "$minver"; then
        echo -e "\n${RED}→ $name v$current is below minimum v$minver. Upgrade mandatory.${NC}"
        return 0
    fi
    
    # Optional upgrade available
    if [ "${HIGHASCG_INSTALL_YES:-0}" = "1" ]; then
        echo -e "  ${CYAN}→ $name: HIGHASCG_INSTALL_YES=1 — applying upgrade${NC}"
        return 0
    fi
    echo ""
    read -r -p "  $name v$current — upgrade available. $desc [y/N]: " answer
    case "$answer" in
        [yY]*) return 0 ;;
        *) echo "  Skipping $name upgrade."; return 1 ;;
    esac
}

# nvidia-persistenced is a virtual package on Ubuntu 24.04; the daemon ships in nvidia-compute-utils-*
install_nvidia_persistenced_packages() {
	local br="${HIGHASCG_NVIDIA_DRIVER:-}"
	local pkg=""

	case "$br" in
	535 | 580 | 595) pkg="nvidia-compute-utils-${br}" ;;
	esac

	if [ -z "$pkg" ]; then
		pkg=$(dpkg-query -W -f='${Package}\n' 'nvidia-compute-utils-[0-9]*' 2>/dev/null | grep -v server | head -1 || true)
	fi

	if [ -n "$pkg" ]; then
		echo "  Installing ${pkg} (provides nvidia-persistenced on Noble)"
		apt install -y "$pkg"
	elif command -v nvidia-persistenced >/dev/null 2>&1; then
		echo "  nvidia-persistenced already on PATH — skip compute-utils install"
	else
		echo -e "  ${YELLOW}○${NC} No nvidia-compute-utils-* package resolved — skip persistenced install"
	fi
}

# Use ActiveState (exit 0) — is-active exits non-zero for inactive/activating and breaks set -e / echo -e nesting
svc_active_state() {
    local u="$1"
    local s
    s=$(systemctl show -p ActiveState --value -- "$u" 2>/dev/null | head -n1 | tr -d '\r')
    [ -n "$s" ] && echo "$s" || echo "unknown"
}

# tailscaled (deb) or snap unit; if CLI works but systemd looks down, still report useful status
tailscale_summary_state() {
    local s
    s=$(systemctl show -p ActiveState --value -- tailscaled 2>/dev/null | head -n1 | tr -d '\r')
    if [ "$s" = "active" ]; then
        echo "active"
        return
    fi
    s=$(systemctl show -p ActiveState --value -- snap.tailscale.tailscaled 2>/dev/null | head -n1 | tr -d '\r')
    if [ "$s" = "active" ]; then
        echo "active (snap)"
        return
    fi
    if command -v tailscale &>/dev/null && tailscale status &>/dev/null; then
        s=$(systemctl show -p ActiveState --value -- tailscaled 2>/dev/null | head -n1 | tr -d '\r')
        [ -z "$s" ] && s="inactive"
        echo "connected (tailscaled $s)"
        return
    fi
    s=$(systemctl show -p ActiveState --value -- tailscaled 2>/dev/null | head -n1 | tr -d '\r')
    [ -n "$s" ] && echo "$s" || echo "unknown"
}

# Outbound connectivity: ping alone is unreliable (ICMP often blocked on WAN edge).
# Returns 0 if any probe succeeds.
check_internet_connectivity() {
    if [ "${HIGHASCG_SKIP_NETWORK_CHECK:-}" = "1" ]; then
        echo -e "  ${YELLOW}!${NC} Skipping connectivity check (HIGHASCG_SKIP_NETWORK_CHECK=1)"
        return 0
    fi
    if ping -c 1 -W 3 8.8.8.8 >/dev/null 2>&1; then return 0; fi
    if ping -c 1 -W 3 1.1.1.1 >/dev/null 2>&1; then return 0; fi
    if command -v curl >/dev/null 2>&1 && curl -sf --connect-timeout 8 -o /dev/null http://connectivitycheck.gstatic.com/generate_204 2>/dev/null; then return 0; fi
    if command -v wget >/dev/null 2>&1 && wget -q --timeout=8 --spider http://connectivitycheck.gstatic.com/generate_204 2>/dev/null; then return 0; fi
    # TCP probes (no extra packages; bash built-in)
    if timeout 8 bash -c 'echo >/dev/tcp/1.1.1.1/443' 2>/dev/null; then return 0; fi
    if timeout 8 bash -c 'echo >/dev/tcp/8.8.8.8/53' 2>/dev/null; then return 0; fi
    return 1
}

