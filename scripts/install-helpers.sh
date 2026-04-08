# ═══════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════

get_latest_github_tag() {
    curl --silent "https://api.github.com/repos/$1/releases/latest" 2>/dev/null | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/'
}

# Pick the correct .deb from GitHub release/latest (never the first .deb — Caspar lists CEF before server).
# $1 = owner/repo, $2 = substring that must appear in the filename (e.g. casparcg-server-2.5, casparcg-scanner_)
get_latest_github_deb() {
	local repo="$1"
	local pkg_filter="${2:?get_latest_github_deb: package filter required}"
	local json arch suffix lines url codename
	json=$(curl -sL "https://api.github.com/repos/$repo/releases/latest" 2>/dev/null)
	arch=$(dpkg --print-architecture 2>/dev/null || echo amd64)
	case "$arch" in
		amd64) suffix="_amd64.deb" ;;
		arm64) suffix="_arm64.deb" ;;
		*)     suffix=".deb" ;;
	esac
	lines=$(echo "$json" | grep '"browser_download_url"' | grep -F "$suffix" | grep -F "$pkg_filter")
	if [ -z "$lines" ]; then
		echo ""
		return 1
	fi

	# T3.3 / Phase 3: Prioritize explicit OS build suffixes (noble1, jammy, etc)
	codename=$(lsb_release -sc 2>/dev/null || echo noble)
	if [ "$codename" = "noble" ]; then
		url=$(echo "$lines" | grep -iF "noble1" | head -1)
		[ -n "$url" ] && echo "  Matched noble1 build for $repo" >&2
	fi
	if [ -z "$url" ]; then
		url=$(echo "$lines" | grep -iF "$codename" | head -1)
		[ -n "$url" ] && echo "  Matched $codename build for $repo" >&2
	fi
	if [ -z "$url" ]; then
		url=$(echo "$lines" | head -1)
		[ -n "$url" ] && echo "  No $codename build found for $repo; falling back to first asset: $(basename "$url")" >&2
	fi
	echo "$url" | sed -E 's/.*"(https[^"]+)".*/\1/'
}

# Read "version" from a package.json without jq (Phase 1 runs before apt may install jq).
read_package_json_version() {
    local f="$1"
    [ -f "$f" ] || return 1
    grep '"version"' "$f" 2>/dev/null | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/'
}

# GitHub release tags like v2.5.0-stable → 2.5.0 for version_gte
normalize_github_release_tag() {
    local t="${1#v}"
    t="${t%%-*}"
    if [[ "$t" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
        echo "${BASH_REMATCH[0]}"
    else
        echo "$t"
    fi
}

# Prefer 2.x.y from Caspar server --version (avoids confusing CEF/build numbers with the server semver).
detect_caspar_server_version() {
    local out ver
    for bin in casparcg-server-2.5 casparcg-server; do
        if command -v "$bin" &>/dev/null; then
            out=$("$bin" --version 2>/dev/null || true)
            ver=$(echo "$out" | grep -oE '2\.[0-9]+\.[0-9]+' | head -1)
            [ -n "$ver" ] && echo "$ver" && return 0
            ver=$(echo "$out" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
            [ -n "$ver" ] && echo "$ver" && return 0
        fi
    done
    if dpkg-query -W -f='${Version}' casparcg-server &>/dev/null; then
        ver=$(dpkg-query -W -f='${Version}' casparcg-server 2>/dev/null | head -1)
        ver=$(echo "$ver" | grep -oE '2\.[0-9]+\.[0-9]+' | head -1)
        [ -n "$ver" ] && echo "$ver" && return 0
    fi
    echo ""
}

detect_caspar_scanner_version() {
    local out ver full
    # Prefer dpkg full Version (upstream is before first '-', e.g. 1.4.0-ubuntu1)
    if dpkg-query -W -f='${Version}' casparcg-scanner &>/dev/null; then
        full=$(dpkg-query -W -f='${Version}' casparcg-scanner 2>/dev/null | head -1)
        full="${full#*:}"
        ver="${full%%-*}"
        if [[ "$ver" =~ ^[0-9]+\.[0-9]+$ ]]; then
            ver="${ver}.0"
        fi
        if [[ "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            [ "$ver" != "0.0.0" ] && echo "$ver" && return 0
        fi
    fi
    if command -v casparcg-scanner &>/dev/null; then
        out=$(casparcg-scanner --version 2>/dev/null || true)
        # Drop bogus 0.0.0; if multiple semvers, take highest (sort -V)
        ver=$(echo "$out" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | grep -v '^0\.0\.0$' | sort -V | tail -1)
        [ -n "$ver" ] && echo "$ver" && return 0
    fi
    echo ""
}

# Desktop Video .deb version → 15.3.1 (strip Debian epoch/revision)
decklink_pkg_version() {
    local v
    v=$(dpkg-query -W -f='${Version}' desktopvideo 2>/dev/null | head -1)
    [ -z "$v" ] && echo "" && return
    v="${v#*:}"
    echo "$v" | sed -E 's/^([0-9]+\.[0-9]+\.[0-9]+).*/\1/'
}

# e.g. https://.../DesktopVideo/v15.3.1/Blackmagic_...tar.gz → 15.3.1
decklink_version_from_url() {
    local u="${1:-$URL_DECKLINK_TAR}"
    echo "$u" | sed -nE 's|.*/v([0-9]+\.[0-9]+\.[0-9]+)/.*|\1|p' | head -1
}

# Recommended HighAsCG semver: local repo package.json, else GitHub latest release tag.
get_highascg_recommended_version() {
    local v=""
    v=$(read_package_json_version "$SCRIPT_DIR/package.json")
    if [ -z "$v" ]; then
        v=$(curl --silent "https://api.github.com/repos/mko1989/highascg/releases/latest" 2>/dev/null | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/' | sed 's/^v//')
    fi
    if [ -z "$v" ]; then
        v="0.1.0"
    fi
    echo "$v"
}

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
    echo ""
    read -r -p "  $name v$current — upgrade available. $desc [y/N]: " answer
    case "$answer" in
        [yY]*) return 0 ;;
        *) echo "  Skipping $name upgrade."; return 1 ;;
    esac
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

# DeckLink tarball: try URL first (wget/curl), then HIGHASCG_DECKLINK_TAR, then /tmp/decklink.tar.gz
# Writes to $1 (e.g. /tmp/decklink.tar.gz). Returns 0 if valid .tar.gz content.
fetch_decklink_tarball() {
    local out="${1:-/tmp/decklink.tar.gz}"
    rm -f "$out"
    echo "  Trying download: $URL_DECKLINK_TAR"
    if command -v wget >/dev/null 2>&1; then
        wget --tries=3 --timeout=45 -U "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" -O "$out" "$URL_DECKLINK_TAR" 2>/dev/null || true
    fi
    if [ ! -s "$out" ] && command -v curl >/dev/null 2>&1; then
        curl -fL --retry 2 --connect-timeout 45 -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" -o "$out" "$URL_DECKLINK_TAR" 2>/dev/null || true
    fi
    if [ ! -s "$out" ] && [ -n "${HIGHASCG_DECKLINK_TAR:-}" ] && [ -f "$HIGHASCG_DECKLINK_TAR" ]; then
        echo "  Using HIGHASCG_DECKLINK_TAR=$HIGHASCG_DECKLINK_TAR"
        cp -f "$HIGHASCG_DECKLINK_TAR" "$out"
    fi
    if [ ! -s "$out" ] && [ -s /tmp/decklink.tar.gz ] && [ "${HIGHASCG_USE_TMP_DECKLINK:-1}" = "1" ]; then
        echo "  Using existing /tmp/decklink.tar.gz"
        if [ "$out" != "/tmp/decklink.tar.gz" ]; then
            cp -f /tmp/decklink.tar.gz "$out"
        fi
    fi
    if [ ! -s "$out" ]; then
        echo -e "  ${RED}Could not obtain DeckLink tarball.${NC}"
        return 1
    fi
    if ! tar -tzf "$out" >/dev/null 2>&1; then
        echo -e "  ${RED}File is not a valid gzip tarball (CDN may have returned an HTML error page).${NC}"
        rm -f "$out"
        return 1
    fi
    return 0
}

# NDI SDK tarball: URL first, then HIGHASCG_NDI_SDK_TAR, then /tmp/ndi-sdk.tar.gz
fetch_ndi_sdk_tarball() {
    local out="${1:-/tmp/ndi-sdk.tar.gz}"
    rm -f "$out"
    echo "  Trying download: $URL_NDI_SDK_TAR"
    if command -v wget >/dev/null 2>&1; then
        wget --tries=3 --timeout=45 -U "Mozilla/5.0 (X11; Linux x86_64) HighAsCG-Installer" -O "$out" "$URL_NDI_SDK_TAR" 2>/dev/null || true
    fi
    if [ ! -s "$out" ] && command -v curl >/dev/null 2>&1; then
        curl -fL --retry 2 --connect-timeout 45 -A "Mozilla/5.0 (X11; Linux x86_64) HighAsCG-Installer" -o "$out" "$URL_NDI_SDK_TAR" 2>/dev/null || true
    fi
    if [ ! -s "$out" ] && [ -n "${HIGHASCG_NDI_SDK_TAR:-}" ] && [ -f "$HIGHASCG_NDI_SDK_TAR" ]; then
        echo "  Using HIGHASCG_NDI_SDK_TAR=$HIGHASCG_NDI_SDK_TAR"
        cp -f "$HIGHASCG_NDI_SDK_TAR" "$out"
    fi
    if [ ! -s "$out" ] && [ -s /tmp/ndi-sdk.tar.gz ] && [ "${HIGHASCG_USE_TMP_NDI:-1}" = "1" ]; then
        echo "  Using existing /tmp/ndi-sdk.tar.gz"
        [ "$out" != "/tmp/ndi-sdk.tar.gz" ] && cp -f /tmp/ndi-sdk.tar.gz "$out"
    fi
    if [ ! -s "$out" ]; then
        echo -e "  ${RED}Could not obtain NDI SDK tarball.${NC}"
        return 1
    fi
    if ! tar -tzf "$out" >/dev/null 2>&1; then
        echo -e "  ${RED}NDI archive invalid (wrong file or HTML error page).${NC}"
        rm -f "$out"
        return 1
    fi
    return 0
}
