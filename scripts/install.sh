#!/bin/bash
set -e

# HighAsCG - Production CasparCG Server Installer
# Comprehensive dependency audit + install
# 2026-04-04

# ═══════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════
LOG_FILE="/var/log/highascg-install.log"
USER_CASPAR="casparcg"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Minimum versions (semver-ish: major only or major.minor)
MIN_NODE=20
MIN_NVIDIA=535
MIN_CASPARCG="2.4"
MIN_NDI="6.1"

# Third-party download URLs — keep aligned with:
#   companion-module-casparcg-server/docs/full_production_setup.md
# Re-verify periodically on vendor sites (Blackmagic / NDI / GitHub).
# DeckLink: CDN may return 403/HTML — installer tries URL first, then HIGHASCG_DECKLINK_TAR, then /tmp/decklink.tar.gz.
# Support: https://www.blackmagicdesign.com/support/family/capture-and-playback — pick Linux → Desktop Video
URL_DECKLINK_TAR="https://swr.cloud.blackmagicdesign.com/DesktopVideo/v15.3.1/Blackmagic_Desktop_Video_Linux_15.3.1.tar.gz"
URL_NDI_SDK_TAR="https://downloads.ndi.tv/SDK/NDI_SDK_Linux/Install_NDI_SDK_v6_Linux.tar.gz"
HIGHASCG_GIT_URL="https://github.com/mko1989/highascg.git"

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

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
    if [ "$repo" = "CasparCG/server" ]; then
        codename=$(lsb_release -sc 2>/dev/null || echo noble)
        url=$(echo "$lines" | grep -iF "$codename" | head -1)
        [ -n "$url" ] || url=$(echo "$lines" | head -1)
    else
        url=$(echo "$lines" | head -1)
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

# ═══════════════════════════════════════════════════════════════
# LOGGING
# ═══════════════════════════════════════════════════════════════
exec > >(tee -a "$LOG_FILE") 2>&1
echo "--- Installation Started: $(date) ---"

# ═══════════════════════════════════════════════════════════════
# PHASE 0: ROOT & OS CHECK
# ═══════════════════════════════════════════════════════════════
echo -e "\n${BOLD}════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  HighAsCG Production Installer${NC}"
echo -e "${BOLD}════════════════════════════════════════════════════${NC}\n"

if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: Please run as root (sudo ./install.sh)${NC}"
    exit 1
fi

# Ensure basic tools for Phase 0/1 are present
apt update -y &>/dev/null
apt install -y lsb-release curl wget jq &>/dev/null

OS_CODENAME=$(lsb_release -sc 2>/dev/null || grep -oP '(?<=VERSION_CODENAME=).*' /etc/os-release || echo "unknown")
OS_VERSION=$(lsb_release -sr 2>/dev/null || grep -oP '(?<=VERSION_ID=).*' /etc/os-release | tr -d '"' || echo "unknown")
echo -e "  OS: Ubuntu $OS_VERSION ($OS_CODENAME)"
if [ "$OS_CODENAME" != "noble" ]; then
    echo -e "  ${YELLOW}Warning: Optimized for Ubuntu 24.04 (noble). You are on $OS_CODENAME.${NC}"
fi

if ! check_internet_connectivity; then
    echo -e "${RED}Error: Could not verify outbound internet (ping, HTTP, and TCP probes failed).${NC}"
    echo -e "  ${YELLOW}Tip:${NC} Your network may block ICMP. If you are online, install curl and retry, or run:"
    echo -e "    ${CYAN}HIGHASCG_SKIP_NETWORK_CHECK=1 sudo -E ./install.sh${NC}  (offline / air-gapped only)"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Outbound connectivity OK\n"

# ═══════════════════════════════════════════════════════════════
# PHASE 1: DEPENDENCY AUDIT
# ═══════════════════════════════════════════════════════════════
echo -e "${BOLD}─── Phase 1: Dependency Audit ───${NC}\n"

# --- Detect current versions ---

# NVIDIA Driver
NVIDIA_STATUS="missing"
NVIDIA_CURRENT=""
NVIDIA_RECOMMENDED=""
if command -v nvidia-smi &>/dev/null; then
    NVIDIA_CURRENT=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1 | tr -d ' ')
    [ -n "$NVIDIA_CURRENT" ] && NVIDIA_STATUS="installed"
fi
if lspci 2>/dev/null | grep -qi nvidia; then
    HAS_NVIDIA_GPU=true
    apt install -y ubuntu-drivers-common &>/dev/null || true
    NVIDIA_RECOMMENDED=$(ubuntu-drivers devices 2>/dev/null | grep recommended | awk '{print $3}' | sed 's/nvidia-driver-//')
    [ -z "$NVIDIA_RECOMMENDED" ] && NVIDIA_RECOMMENDED="550"
else
    HAS_NVIDIA_GPU=false
fi

# DeckLink (Desktop Video)
DECKLINK_STATUS="missing"
DECKLINK_CURRENT=""
DECKLINK_RECOMMENDED=$(decklink_version_from_url)
[ -z "$DECKLINK_RECOMMENDED" ] && DECKLINK_RECOMMENDED="15.3.1"
if dpkg-query -W desktopvideo &>/dev/null; then
    DECKLINK_CURRENT=$(decklink_pkg_version)
    DECKLINK_STATUS="installed"
fi
HAS_DECKLINK=$(lspci 2>/dev/null | grep -qi blackmagic && echo true || echo false)

# NDI SDK
NDI_STATUS="missing"
NDI_CURRENT=""
if [ -f /usr/lib/x86_64-linux-gnu/libndi.so.6 ] || ldconfig -p 2>/dev/null | grep -q libndi; then
    NDI_STATUS="installed"
    NDI_CURRENT=$(ls /usr/lib/x86_64-linux-gnu/libndi.so.6.* 2>/dev/null | head -1 | sed 's/.*libndi.so.//')
    [ -z "$NDI_CURRENT" ] && NDI_CURRENT="6.x"
fi

# Node.js
NODE_STATUS="missing"
NODE_CURRENT=""
NODE_RECOMMENDED=$(curl --silent https://nodejs.org/dist/index.json 2>/dev/null | grep -o '"version":"v[0-9]*\.[0-9]*\.[0-9]*"' | head -1 | sed 's/.*"v\(.*\)"/\1/' || echo "22.0.0")
if command -v node &>/dev/null; then
    NODE_CURRENT=$(node -v 2>/dev/null | sed 's/v//')
    NODE_STATUS="installed"
fi

# CasparCG Server (semver from binary --version; dpkg can embed CEF/build noise)
CASPAR_STATUS="missing"
CASPAR_CURRENT=""
CASPAR_RECOMMENDED=$(normalize_github_release_tag "$(get_latest_github_tag "CasparCG/server")")
[ -z "$CASPAR_RECOMMENDED" ] && CASPAR_RECOMMENDED="2.5.0"
if command -v casparcg-server-2.5 &>/dev/null || dpkg-query -W casparcg-server &>/dev/null; then
    CASPAR_CURRENT=$(detect_caspar_server_version)
    [ -z "$CASPAR_CURRENT" ] && CASPAR_CURRENT="2.5.0"
    CASPAR_STATUS="installed"
fi

# Media Scanner
SCANNER_STATUS="missing"
SCANNER_CURRENT=""
SCANNER_RECOMMENDED=$(normalize_github_release_tag "$(get_latest_github_tag "CasparCG/media-scanner")")
[ -z "$SCANNER_RECOMMENDED" ] && SCANNER_RECOMMENDED="1.3.4"
if command -v casparcg-scanner &>/dev/null || dpkg-query -W casparcg-scanner &>/dev/null; then
    SCANNER_CURRENT=$(detect_caspar_scanner_version)
    [ -z "$SCANNER_CURRENT" ] && SCANNER_CURRENT="1.3.4"
    SCANNER_STATUS="installed"
fi

# nodm
NODM_STATUS="missing"
NODM_CURRENT=""
if dpkg -l 2>/dev/null | grep -q "ii  nodm"; then
    NODM_STATUS="installed"
    NODM_CURRENT=$(dpkg -l | grep "ii  nodm" | awk '{print $3}')
fi

# openbox
OPENBOX_STATUS="missing"
OPENBOX_CURRENT=""
if command -v openbox &>/dev/null; then
    OPENBOX_STATUS="installed"
    OPENBOX_CURRENT=$(openbox --version 2>/dev/null | head -1 | awk '{print $NF}' || echo "3.x")
fi

# Tailscale
TAILSCALE_STATUS="missing"
TAILSCALE_CURRENT=""
if command -v tailscale &>/dev/null; then
    TAILSCALE_STATUS="installed"
    TAILSCALE_CURRENT=$(tailscale version 2>/dev/null | head -1 || echo "?")
fi

# Syncthing
SYNCTHING_STATUS="missing"
SYNCTHING_CURRENT=""
if command -v syncthing &>/dev/null; then
    SYNCTHING_STATUS="installed"
    SYNCTHING_CURRENT=$(syncthing --version 2>/dev/null | awk '{print $2}' | sed 's/v//' || echo "?")
fi

# UFW
UFW_STATUS="missing"
UFW_CURRENT=""
if command -v ufw &>/dev/null; then
    UFW_STATUS="installed"
    UFW_CURRENT=$(ufw version 2>/dev/null | head -1 | awk '{print $2}' || echo "?")
fi

# jq (required for GitHub API parsing)
JQ_STATUS="missing"
if command -v jq &>/dev/null; then
    JQ_STATUS="installed"
fi

# FFmpeg — live preview (kmsgrab preferred, x11grab fallback; libndi for NDI tier)
FFMPEG_STATUS="missing"
FFMPEG_CURRENT=""
FFMPEG_HAS_KMSGRAB=""
FFMPEG_HAS_X11GRAB=""
if command -v ffmpeg &>/dev/null; then
    FFMPEG_STATUS="installed"
    FFMPEG_CURRENT=$(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}' || echo "?")
    _ffdev=$(ffmpeg -devices 2>&1 || true)
    echo "$_ffdev" | grep -q kmsgrab && FFMPEG_HAS_KMSGRAB=yes
    echo "$_ffdev" | grep -q x11grab && FFMPEG_HAS_X11GRAB=yes
fi

# HighAsCG app (deployed to /opt/highascg in Phase 4)
HIGHASCG_STATUS="missing"
HIGHASCG_CURRENT=""
HIGHASCG_RECOMMENDED=$(get_highascg_recommended_version)
if [ -f /opt/highascg/package.json ]; then
    HIGHASCG_STATUS="installed"
    HIGHASCG_CURRENT=$(read_package_json_version /opt/highascg/package.json)
    [ -z "$HIGHASCG_CURRENT" ] && HIGHASCG_CURRENT="?"
fi

# ─── Display Report ───

echo -e "${BOLD}  Component               Current        Minimum    Recommended  Status${NC}"
echo    "  ────────────────────────────────────────────────────────────────────────"

# Hardware drivers (conditional on hardware)
if [ "$HAS_NVIDIA_GPU" = true ]; then
    dep_status "NVIDIA Driver"       "$NVIDIA_STATUS"    "$NVIDIA_CURRENT"    "$NVIDIA_RECOMMENDED"  "$MIN_NVIDIA" "required"
else
    printf "  ${GREEN}○${NC} %-22s %-14s                               ${GREEN}[no GPU detected]${NC}\n" "NVIDIA Driver" "skipped"
fi
if [ "$HAS_DECKLINK" = true ]; then
    dep_status "DeckLink (DesktopVideo)" "$DECKLINK_STATUS" "$DECKLINK_CURRENT" "$DECKLINK_RECOMMENDED" "" "optional"
else
    printf "  ${GREEN}○${NC} %-22s %-14s                               ${GREEN}[no card detected]${NC}\n" "DeckLink Driver" "skipped"
fi
dep_status "NDI SDK"              "$NDI_STATUS"       "$NDI_CURRENT"       ""                    "$MIN_NDI" "optional"

# Core software
dep_status "Node.js"              "$NODE_STATUS"      "$NODE_CURRENT"      "${NODE_RECOMMENDED:-22}" "$MIN_NODE" "required"
dep_status "CasparCG Server"      "$CASPAR_STATUS"    "$CASPAR_CURRENT"    "${CASPAR_RECOMMENDED:-2.5}" "$MIN_CASPARCG" "required"
dep_status "Media Scanner"        "$SCANNER_STATUS"   "$SCANNER_CURRENT"   "${SCANNER_RECOMMENDED:-1.3.4}" "" "required"
dep_status "nodm"                 "$NODM_STATUS"      "$NODM_CURRENT"      ""                    "" "required"
dep_status "openbox"              "$OPENBOX_STATUS"    "$OPENBOX_CURRENT"   ""                    "" "required"

# Services
dep_status "Tailscale"            "$TAILSCALE_STATUS"  "$TAILSCALE_CURRENT" ""                    "" "required"
dep_status "Syncthing"            "$SYNCTHING_STATUS"  "$SYNCTHING_CURRENT" ""                    "" "required"
dep_status "UFW Firewall"         "$UFW_STATUS"        "$UFW_CURRENT"       ""                    "" "required"

# FFmpeg (required for WebRTC preview pipeline)
if [ "$FFMPEG_STATUS" = "installed" ]; then
    printf "  ${GREEN}✓${NC} %-22s ${GREEN}v%-12s${NC} kmsgrab:%-4s x11grab:%-4s ${GREEN}[OK]${NC}\n" \
        "FFmpeg" "$FFMPEG_CURRENT" "${FFMPEG_HAS_KMSGRAB:-no}" "${FFMPEG_HAS_X11GRAB:-no}"
else
    printf "  ${RED}✗${NC} %-22s ${RED}%-14s${NC}                               ${RED}[INSTALL REQUIRED]${NC}\n" "FFmpeg" "not found"
fi

dep_status "HighAsCG"            "$HIGHASCG_STATUS"  "$HIGHASCG_CURRENT"  "$HIGHASCG_RECOMMENDED" "" "required"

echo ""
echo -e "${BOLD}─── Phase 1 Complete ───${NC}"
echo ""
read -r -p "  Review the audit above. Press ENTER to continue installation, or Ctrl+C to abort. "

# ═══════════════════════════════════════════════════════════════
# PHASE 2: HARDWARE DRIVERS
# ═══════════════════════════════════════════════════════════════
echo -e "\n${BOLD}─── Phase 2: Hardware & Drivers ───${NC}\n"

# apt base deps (always needed)
apt update -y
apt install -y curl wget git jq unzip rsync software-properties-common

# FFmpeg + DRM — kmsgrab needs KMS/DRM; casparcg user is in video/render for /dev/dri access
if [ "$FFMPEG_STATUS" = "missing" ]; then
    echo -e "${CYAN}→ Installing FFmpeg (kmsgrab / x11grab / NDI input)…${NC}"
    apt install -y ffmpeg libdrm2
else
    echo -e "  ${GREEN}✓${NC} FFmpeg present — run apt upgrade to refresh if needed."
    apt install -y ffmpeg libdrm2
fi
# Re-check grab devices after install
_ffdev=$(ffmpeg -devices 2>&1 || true)
echo "$_ffdev" | grep -q kmsgrab && echo -e "  ${GREEN}✓${NC} ffmpeg: kmsgrab device available (default local capture)" || echo -e "  ${YELLOW}~${NC} ffmpeg: kmsgrab not listed — will use x11grab fallback on :0"
echo "$_ffdev" | grep -q x11grab && echo -e "  ${GREEN}✓${NC} ffmpeg: x11grab available"

# 2.1 NVIDIA
if [ "$HAS_NVIDIA_GPU" = true ]; then
    SHOULD_INSTALL_NVIDIA=false
    if [ "$NVIDIA_STATUS" = "missing" ]; then
        SHOULD_INSTALL_NVIDIA=true
        echo -e "${CYAN}→ Installing NVIDIA drivers...${NC}"
    elif [ -n "$MIN_NVIDIA" ] && ! version_gte "$NVIDIA_CURRENT" "$MIN_NVIDIA"; then
        SHOULD_INSTALL_NVIDIA=true
        echo -e "${RED}→ NVIDIA v$NVIDIA_CURRENT below minimum v$MIN_NVIDIA. Upgrading...${NC}"
    elif [ -n "$NVIDIA_RECOMMENDED" ] && version_gte "$NVIDIA_CURRENT" "$NVIDIA_RECOMMENDED"; then
        echo -e "  ${GREEN}✓${NC} NVIDIA driver at or above Ubuntu recommended series (v$NVIDIA_CURRENT, rec v$NVIDIA_RECOMMENDED)"
    else
        if ask_action "NVIDIA Driver" "installed" "$NVIDIA_CURRENT" "" "Upgrade to recommended v$NVIDIA_RECOMMENDED?"; then
            SHOULD_INSTALL_NVIDIA=true
        fi
    fi
    
    if [ "$SHOULD_INSTALL_NVIDIA" = true ]; then
        apt install -y ubuntu-drivers-common
        DRIVER_NAME=$(ubuntu-drivers devices 2>/dev/null | grep recommended | awk '{print $3}')
        if [ -n "$DRIVER_NAME" ]; then
            echo "  Installing recommended: $DRIVER_NAME"
            apt install -y "$DRIVER_NAME"
        else
            echo "  Fallback: nvidia-driver-550"
            apt install -y nvidia-driver-550
        fi
        apt install -y nvidia-persistenced
        systemctl unmask nvidia-persistenced
        systemctl enable nvidia-persistenced
        systemctl start nvidia-persistenced
        nvidia-smi -pm 1 || true
    fi
fi

# 2.2 DeckLink
if [ "$HAS_DECKLINK" = true ]; then
    SHOULD_INSTALL_DECKLINK=false
    if [ "$DECKLINK_STATUS" = "missing" ]; then
        SHOULD_INSTALL_DECKLINK=true
        echo -e "${CYAN}→ DeckLink Desktop Video not found. Installing...${NC}"
    elif [ -n "$DECKLINK_RECOMMENDED" ] && version_gte "$DECKLINK_CURRENT" "$DECKLINK_RECOMMENDED"; then
        echo -e "  ${GREEN}✓${NC} DeckLink Desktop Video at or above target (v$DECKLINK_CURRENT, target v$DECKLINK_RECOMMENDED)"
    elif ask_action "DeckLink" "$DECKLINK_STATUS" "$DECKLINK_CURRENT" "" "Update DeckLink drivers to v${DECKLINK_RECOMMENDED}?"; then
        SHOULD_INSTALL_DECKLINK=true
    fi
    if [ "$SHOULD_INSTALL_DECKLINK" = true ]; then
        echo -e "${CYAN}→ Installing DeckLink drivers...${NC}"
        cd /tmp
        if fetch_decklink_tarball /tmp/decklink.tar.gz; then
            tar -xzf decklink.tar.gz
            dpkg -i Blackmagic_Desktop_Video_Linux_*/deb/x86_64/desktopvideo_*.deb || apt install -f -y
            modprobe blackmagic_io || true
            echo -e "  ${GREEN}✓${NC} DeckLink desktopvideo packages installed."
        else
            echo -e "  ${YELLOW}○${NC} DeckLink install skipped (download failed or invalid archive)."
            echo "    • Verify URL in install.sh (URL_DECKLINK_TAR) or download Desktop Video for Linux from:"
            echo "      https://www.blackmagicdesign.com/support/family/capture-and-playback"
            echo "    • Fallback — place the tarball and re-run:"
            echo "        ${CYAN}export HIGHASCG_DECKLINK_TAR=/path/to/Blackmagic_Desktop_Video_Linux_*.tar.gz${NC}"
            echo "        ${CYAN}sudo -E ./scripts/install.sh${NC}"
            echo "    • Or: ${CYAN}cp /path/to/…tar.gz /tmp/decklink.tar.gz${NC} and re-run."
        fi
    fi
fi

# 2.3 NDI SDK
SHOULD_INSTALL_NDI=false
if [ "$NDI_STATUS" = "missing" ]; then
    SHOULD_INSTALL_NDI=true
    echo -e "${CYAN}→ NDI SDK not detected. Installing...${NC}"
elif [[ "$NDI_CURRENT" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && ! version_gte "$NDI_CURRENT" "$MIN_NDI"; then
    SHOULD_INSTALL_NDI=true
    echo -e "${RED}→ NDI SDK v$NDI_CURRENT below minimum v$MIN_NDI. Installing...${NC}"
elif [ "${HIGHASCG_NDI_UPDATE:-}" = "1" ] && ask_action "NDI SDK" "installed" "$NDI_CURRENT" "$MIN_NDI" "Reinstall NDI SDK from network?"; then
    SHOULD_INSTALL_NDI=true
else
    echo -e "  ${GREEN}✓${NC} NDI SDK present (v$NDI_CURRENT); skipping download"
fi

if [ "$SHOULD_INSTALL_NDI" = true ]; then
    echo -e "${CYAN}→ Installing NDI SDK v6 (see full_production_setup.md section 5)...${NC}"
    cd /tmp
    if ! fetch_ndi_sdk_tarball /tmp/ndi-sdk.tar.gz; then
        echo -e "  ${YELLOW}○${NC} NDI SDK install skipped (download failed or invalid archive)."
        echo "    • Check $URL_NDI_SDK_TAR or set ${CYAN}HIGHASCG_NDI_SDK_TAR=/path/to/Install_NDI_SDK_v6_Linux.tar.gz${NC}"
        echo "    • Or place a copy at ${CYAN}/tmp/ndi-sdk.tar.gz${NC} and re-run."
    else
        tar -xzf ndi-sdk.tar.gz
        chmod +x Install_NDI_SDK_v6_Linux.sh
        ./Install_NDI_SDK_v6_Linux.sh --accept-license || true
        # SDK ships a versioned libndi.so.6.x.y (e.g. 6.1.1 or 6.3.1) — copy whatever the tarball provides
        NDI_LIB_SRC=""
        if [ -d "NDI SDK for Linux/lib/x86_64-linux-gnu" ]; then
            NDI_LIB_SRC=$(find "NDI SDK for Linux/lib/x86_64-linux-gnu" -maxdepth 1 -type f -name 'libndi.so.6.*' 2>/dev/null | head -1)
        fi
        if [ -n "$NDI_LIB_SRC" ] && [ -f "$NDI_LIB_SRC" ]; then
            install -m 0644 "$NDI_LIB_SRC" /usr/lib/x86_64-linux-gnu/
            NDI_BASE=$(basename "$NDI_LIB_SRC")
            ln -sf "$NDI_BASE" /usr/lib/x86_64-linux-gnu/libndi.so.6
            ln -sf libndi.so.6 /usr/lib/x86_64-linux-gnu/libndi.so
            ldconfig
            echo "  Installed NDI lib: $NDI_BASE"
        else
            echo -e "  ${YELLOW}Warning: Could not find libndi.so.6.* under NDI SDK for Linux/lib — check SDK layout.${NC}"
        fi
    fi
fi

# ═══════════════════════════════════════════════════════════════
# PHASE 3: CASPARCG & OS CONFIGURATION
# ═══════════════════════════════════════════════════════════════
echo -e "\n${BOLD}─── Phase 3: CasparCG & OS Config ───${NC}\n"

# 3.1 casparcg user
USER_SHELL=$(command -v nologin || command -v false || echo "/usr/sbin/nologin")
if ! id "$USER_CASPAR" &>/dev/null; then
    echo -e "${CYAN}→ Creating $USER_CASPAR system user (no login)...${NC}"
    useradd -r -m -s "$USER_SHELL" "$USER_CASPAR"
else
    echo -e "  ${GREEN}✓${NC} User $USER_CASPAR exists"
fi

# Ensure correct groups (video, audio, render are primary; others are for specialized hardware)
# Filter for groups that actually exist on the system to avoid usermod errors
for GRP in video audio render plugdev dialout input; do
    if getent group "$GRP" &>/dev/null; then
        usermod -aG "$GRP" "$USER_CASPAR" 2>/dev/null || true
    fi
done
echo -e "  ${GREEN}✓${NC} User $USER_CASPAR assigned to hardware groups"

# 3.2 nodm & openbox
if [ "$NODM_STATUS" = "missing" ]; then
    echo -e "${CYAN}→ Installing nodm + openbox + xterm (X11-only / DeckLink GUI)...${NC}"
    apt install -y nodm openbox unclutter xterm
else
    echo -e "  ${GREEN}✓${NC} nodm already installed"
    apt install -y xterm 2>/dev/null || true
fi

cat <<EOF > /etc/default/nodm
NODM_ENABLED=true
NODM_USER=$USER_CASPAR
NODM_X_OPTIONS='-s 0 -dpms -nolisten tcp'
EOF

# Ensure .xsession exists (even for nologin user, nodm uses it)
mkdir -p "/home/$USER_CASPAR"
echo 'exec openbox-session' > "/home/$USER_CASPAR/.xsession"
chmod +x "/home/$USER_CASPAR/.xsession"
chown "$USER_CASPAR:$USER_CASPAR" "/home/$USER_CASPAR/.xsession"

# Display mode: normal (CasparCG) | x11-only (Openbox only — DeckLink Desktop Video GUI)
mkdir -p /etc/highascg
if [ ! -f /etc/highascg/display-mode ]; then
    echo "normal" > /etc/highascg/display-mode
fi
chmod 644 /etc/highascg/display-mode

cat <<'DMODE' > /usr/local/bin/highascg-display-mode
#!/bin/bash
set -e
MODE="${1:-}"
if [[ "$MODE" != "normal" && "$MODE" != "x11-only" ]]; then
    echo "Usage: sudo highascg-display-mode normal|x11-only"
    echo "  normal   — CasparCG + scanner autostart (default)"
    echo "  x11-only — Openbox only; use for DeckLink Desktop Video setup (no CasparCG)"
    exit 1
fi
mkdir -p /etc/highascg
echo "$MODE" > /etc/highascg/display-mode
chmod 644 /etc/highascg/display-mode
systemctl restart nodm
echo "Display mode set to: $MODE (nodm restarted)."
DMODE
chmod 755 /usr/local/bin/highascg-display-mode

# 3.3 CasparCG Server & Scanner
SHOULD_INSTALL_CASPAR=false
if [ "$CASPAR_STATUS" = "missing" ]; then
    SHOULD_INSTALL_CASPAR=true
    echo -e "${CYAN}→ CasparCG Server not found. Installing...${NC}"
elif [ -n "$MIN_CASPARCG" ] && ! version_gte "$CASPAR_CURRENT" "$MIN_CASPARCG"; then
    SHOULD_INSTALL_CASPAR=true
    echo -e "${RED}→ CasparCG v$CASPAR_CURRENT below minimum v$MIN_CASPARCG. Upgrading...${NC}"
elif [ -n "$CASPAR_RECOMMENDED" ] && version_gte "$CASPAR_CURRENT" "$CASPAR_RECOMMENDED"; then
    echo -e "  ${GREEN}✓${NC} CasparCG Server matches latest GitHub release (v$CASPAR_CURRENT ≥ v$CASPAR_RECOMMENDED)"
else
    if ask_action "CasparCG Server" "installed" "$CASPAR_CURRENT" "" "Upgrade to v${CASPAR_RECOMMENDED:-latest}?"; then
        SHOULD_INSTALL_CASPAR=true
    fi
fi

if [ "$SHOULD_INSTALL_CASPAR" = true ]; then
    URL_SERVER=$(get_latest_github_deb "CasparCG/server" "casparcg-server-2.5")
    if [ -n "$URL_SERVER" ]; then
        cd /tmp
        wget -q -O caspar-server.deb "$URL_SERVER"
        dpkg -i caspar-server.deb || apt install -f -y
    else
        echo -e "  ${YELLOW}Warning: Could not find latest CasparCG Server .deb${NC}"
    fi
fi

# Scanner
SHOULD_INSTALL_SCANNER=false
if [ "$SCANNER_STATUS" = "missing" ]; then
    SHOULD_INSTALL_SCANNER=true
    echo -e "${CYAN}→ Media Scanner not found. Installing...${NC}"
elif [ -n "$SCANNER_RECOMMENDED" ] && version_gte "$SCANNER_CURRENT" "$SCANNER_RECOMMENDED"; then
    echo -e "  ${GREEN}✓${NC} Media Scanner matches latest GitHub release (v$SCANNER_CURRENT ≥ v$SCANNER_RECOMMENDED)"
elif ask_action "Media Scanner" "$SCANNER_STATUS" "$SCANNER_CURRENT" "" "Upgrade to v${SCANNER_RECOMMENDED:-latest}?"; then
    SHOULD_INSTALL_SCANNER=true
fi

if [ "$SHOULD_INSTALL_SCANNER" = true ]; then
    URL_SCANNER=$(get_latest_github_deb "CasparCG/media-scanner" "casparcg-scanner_")
    if [ -n "$URL_SCANNER" ]; then
        cd /tmp
        wget -q -O scanner.deb "$URL_SCANNER"
        dpkg -i scanner.deb || apt install -f -y
        if command -v casparcg-scanner &>/dev/null; then
            echo -e "  ${GREEN}✓${NC} Media Scanner installed: $(command -v casparcg-scanner)"
        else
            echo -e "  ${RED}✗${NC} Media Scanner binary missing after .deb install (dpkg may have removed a broken package)."
            echo "    • Install manually: $URL_SCANNER"
        fi
    else
        echo -e "  ${YELLOW}Warning: Could not resolve Scanner .deb for this arch (see CasparCG/media-scanner releases).${NC}"
    fi
fi

# Disable stock CasparCG service (we use Openbox autostart)
systemctl stop casparcg-server 2>/dev/null || true
systemctl disable casparcg-server 2>/dev/null || true
rm -f /etc/systemd/system/casparcg-server.service

# Setup directory structure with correct permissions
echo -e "${CYAN}→ Setting up /opt/casparcg directory structure...${NC}"
mkdir -p /opt/casparcg/{media,log,template,data,cef-cache,config}
chown -R "$USER_CASPAR:$USER_CASPAR" /opt/casparcg
chmod -R 775 /opt/casparcg

# Main CasparCG server config lives under config/ (scanner uses its own config under the casparcg tree).
if [ -f /opt/casparcg/media/casparcg.config.ftd ] && [ ! -f /opt/casparcg/config/casparcg.config ]; then
  cp -a /opt/casparcg/media/casparcg.config.ftd /opt/casparcg/config/casparcg.config
  chown "$USER_CASPAR:$USER_CASPAR" /opt/casparcg/config/casparcg.config
  echo -e "  ${GREEN}✓${NC} Migrated legacy config to /opt/casparcg/config/casparcg.config"
fi

# Copy NDI lib to working dir
cp /usr/lib/x86_64-linux-gnu/libndi.so.6 /opt/casparcg/ 2>/dev/null || true
chown "$USER_CASPAR:$USER_CASPAR" /opt/casparcg/libndi.so.6 2>/dev/null || true

# 3.4 Openbox Autostart (normal = CasparCG; x11-only = DeckLink GUI without Caspar)
mkdir -p "/home/$USER_CASPAR/.config/openbox"
cat <<'AST' > "/home/$USER_CASPAR/.config/openbox/autostart"
#!/bin/bash
export DISPLAY=:0
export XAUTHORITY=/home/__CASPAR_USER__/.Xauthority

xset s off
xset s noblank
xset -dpms
unclutter -idle 1 -root &

if [ -f /etc/highascg/display-mode ] && grep -q '^x11-only$' /etc/highascg/display-mode; then
  if command -v desktopvideo_setup >/dev/null 2>&1; then
    (sleep 2 && desktopvideo_setup) &
  fi
  if command -v xterm >/dev/null 2>&1; then
    (xterm -e 'bash -c "echo X11-only: CasparCG not started.; echo Open Desktop Video Setup from the menu.; echo Resume: sudo highascg-display-mode normal; read"') &
  fi
else
  cd /opt/casparcg
  /usr/bin/casparcg-scanner &
  while true; do
    cd /opt/casparcg
    rm -f /opt/casparcg/cef-cache/Singleton*
    /usr/bin/casparcg-server-2.5 /opt/casparcg/config/casparcg.config >> /tmp/caspar.log 2>&1
    while ss -tlnp | grep -q 5250; do sleep 1; done
    sleep 2
  done &
fi
AST
sed -i "s|__CASPAR_USER__|$USER_CASPAR|g" "/home/$USER_CASPAR/.config/openbox/autostart"
chmod +x "/home/$USER_CASPAR/.config/openbox/autostart"
chown -R "$USER_CASPAR:$USER_CASPAR" "/home/$USER_CASPAR/.config"

# ═══════════════════════════════════════════════════════════════
# PHASE 4: HIGHASCG, NODE, TOOLS
# ═══════════════════════════════════════════════════════════════
echo -e "\n${BOLD}─── Phase 4: HighAsCG & System Tools ───${NC}\n"

# 4.1 Node.js LTS
SHOULD_INSTALL_NODE=false
if [ "$NODE_STATUS" = "missing" ]; then
    SHOULD_INSTALL_NODE=true
    echo -e "${CYAN}→ Node.js not found. Installing LTS...${NC}"
elif ! version_gte "$NODE_CURRENT" "$MIN_NODE"; then
    SHOULD_INSTALL_NODE=true
    echo -e "${RED}→ Node.js v$NODE_CURRENT below minimum v$MIN_NODE. Upgrading...${NC}"
elif [ -n "${NODE_RECOMMENDED:-}" ] && version_gte "$NODE_CURRENT" "$NODE_RECOMMENDED"; then
    echo -e "  ${GREEN}✓${NC} Node.js at or above current LTS from index (v$NODE_CURRENT ≥ v$NODE_RECOMMENDED)"
else
    if ask_action "Node.js" "installed" "$NODE_CURRENT" "" "Upgrade to latest LTS?"; then
        SHOULD_INSTALL_NODE=true
    fi
fi

if [ "$SHOULD_INSTALL_NODE" = true ]; then
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
    apt install -y nodejs
fi

# 4.2 Tailscale
if [ "$TAILSCALE_STATUS" = "missing" ]; then
    echo -e "${CYAN}→ Installing Tailscale...${NC}"
    curl -fsSL https://tailscale.com/install.sh | sh
else
    echo -e "  ${GREEN}✓${NC} Tailscale already installed (v$TAILSCALE_CURRENT)"
fi

# 4.3 Syncthing
if [ "$SYNCTHING_STATUS" = "missing" ]; then
    echo -e "${CYAN}→ Installing Syncthing...${NC}"
    mkdir -p /etc/apt/keyrings
    curl -sL -o /etc/apt/keyrings/syncthing-archive-keyring.gpg https://syncthing.net/release-key.gpg
    echo "deb [signed-by=/etc/apt/keyrings/syncthing-archive-keyring.gpg] https://apt.syncthing.net/ syncthing stable" | tee /etc/apt/sources.list.d/syncthing.list
    apt update && apt install -y syncthing
else
    echo -e "  ${GREEN}✓${NC} Syncthing already installed (v$SYNCTHING_CURRENT)"
fi
systemctl enable "syncthing@$USER_CASPAR" 2>/dev/null || true
# Expose Syncthing GUI on all interfaces (LAN + Tailnet); UFW still restricts WAN
mkdir -p /etc/systemd/system/syncthing@.service.d
cat <<'SYNGUI' > /etc/systemd/system/syncthing@.service.d/highascg-gui.conf
[Service]
Environment=STGUIADDRESS=0.0.0.0:8384
SYNGUI
systemctl daemon-reload
systemctl restart "syncthing@$USER_CASPAR" 2>/dev/null || systemctl start "syncthing@$USER_CASPAR" 2>/dev/null || true

# Tailscale daemon (login is still: sudo tailscale up — opens auth URL)
systemctl enable tailscaled 2>/dev/null || true
systemctl start tailscaled 2>/dev/null || true

# Tailscale display IP: CLI can fail in MOTD/cron (PATH); fall back to tailscale0 address
cat <<'TSEOF' > /usr/local/bin/highascg-tailscale-ip.sh
#!/bin/bash
# Prefer "tailscale ip -4"; if empty, read IPv4 from interface tailscale0 (same as ip addr shows).
ts=""
if command -v tailscale >/dev/null 2>&1; then
    ts=$(tailscale ip -4 2>/dev/null || true)
fi
if [ -z "$ts" ] && [ -d /sys/class/net/tailscale0 ]; then
    ts=$(ip -4 addr show tailscale0 2>/dev/null | sed -n 's/.*inet \([0-9.]*\).*/\1/p' | head -1)
fi
if [ -n "$ts" ]; then
    echo "$ts"
else
    echo "not connected — run: sudo tailscale up"
fi
TSEOF
chmod 755 /usr/local/bin/highascg-tailscale-ip.sh

# Pre-login console banner + interactive shell hint (IPs, setup URL)
cat <<'ISSUE' > /usr/local/bin/highascg-refresh-console-issue.sh
#!/bin/bash
set -e
mkdir -p /etc/issue.d
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
TS=$(/usr/local/bin/highascg-tailscale-ip.sh)
{
  echo ""
  echo "┌─ HighAsCG ─────────────────────────────────────────────────"
  echo "│  Primary IP: ${IP:-unknown}"
  echo "│  Tailscale:  ${TS}"
  echo "│  Setup page: http://${IP:-127.0.0.1}:8080/setup.html"
  echo "│  Syncthing:  http://${IP:-127.0.0.1}:8384/"
  echo "└──────────────────────────────────────────────────────────"
  echo ""
} > /etc/issue.d/99-highascg.issue
ISSUE
chmod 755 /usr/local/bin/highascg-refresh-console-issue.sh
/usr/local/bin/highascg-refresh-console-issue.sh 2>/dev/null || true

cat <<'UNITSVC' > /etc/systemd/system/highascg-console-issue.service
[Unit]
Description=Refresh HighAsCG /etc/issue.d banner after network
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/highascg-refresh-console-issue.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNITSVC
systemctl daemon-reload
systemctl enable highascg-console-issue.service 2>/dev/null || true
systemctl start highascg-console-issue.service 2>/dev/null || true

cat <<'PROFILE' > /etc/profile.d/highascg-console.sh
# HighAsCG — show reachability hints on real consoles (tty1–tty6), not SSH
if [ -z "${HIGHASCG_CONSOLE_HINT:-}" ] && [ -n "${PS1:-}" ]; then
  case "$(tty 2>/dev/null || true)" in
    /dev/tty[0-9]|/dev/tty[0-9][0-9])
      export HIGHASCG_CONSOLE_HINT=1
      echo ""
      echo "━━ HighAsCG ━━  http://$(hostname -I 2>/dev/null | awk '{print $1}'):8080/setup.html  ━━"
      ;;
  esac
fi
PROFILE
chmod 644 /etc/profile.d/highascg-console.sh

# 4.4 HighAsCG Server — Deploy & Service (audited in Phase 1)
SHOULD_DEPLOY_HIGHASCG=false
if [ "$HIGHASCG_STATUS" = "missing" ]; then
    SHOULD_DEPLOY_HIGHASCG=true
    echo -e "${CYAN}→ HighAsCG not installed under /opt/highascg — deploying...${NC}"
elif [ -n "$HIGHASCG_RECOMMENDED" ] && [ -n "$HIGHASCG_CURRENT" ] && [ "$HIGHASCG_CURRENT" != "?" ] && ! version_gte "$HIGHASCG_CURRENT" "$HIGHASCG_RECOMMENDED"; then
    SHOULD_DEPLOY_HIGHASCG=true
    echo -e "${RED}→ HighAsCG v$HIGHASCG_CURRENT is below recommended v$HIGHASCG_RECOMMENDED — upgrading...${NC}"
else
    if ask_action "HighAsCG" "installed" "$HIGHASCG_CURRENT" "" "Re-sync / upgrade from local repo or $HIGHASCG_GIT_URL?"; then
        SHOULD_DEPLOY_HIGHASCG=true
    fi
fi

if [ "$SHOULD_DEPLOY_HIGHASCG" = true ]; then
    echo -e "${CYAN}→ Deploying HighAsCG to /opt/highascg...${NC}"
    mkdir -p /opt/highascg
    if ! command -v rsync >/dev/null 2>&1; then
        apt install -y rsync
    fi

    if [ -f "$SCRIPT_DIR/package.json" ]; then
        echo "  Copying from local repo: $SCRIPT_DIR"
        rsync -a --exclude='node_modules' --exclude='.git' --exclude='work' "$SCRIPT_DIR/" /opt/highascg/
    else
        echo "  Cloning from GitHub: $HIGHASCG_GIT_URL"
        rm -rf /opt/highascg/.git 2>/dev/null || true
        if [ -d /opt/highascg ] && [ -n "$(ls -A /opt/highascg 2>/dev/null)" ]; then
            echo "  Replacing existing /opt/highascg contents with fresh clone..."
            find /opt/highascg -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
        fi
        git clone --depth 1 "$HIGHASCG_GIT_URL" /opt/highascg
    fi

    chown -R "$USER_CASPAR:$USER_CASPAR" /opt/highascg
    chmod -R 775 /opt/highascg

    cd /opt/highascg
    sudo -u "$USER_CASPAR" npm install --omit=dev

    if [ ! -f /opt/highascg/highascg.config.json ] && [ -f /opt/highascg/highascg.config.example.json ]; then
        cp /opt/highascg/highascg.config.example.json /opt/highascg/highascg.config.json
        chown "$USER_CASPAR:$USER_CASPAR" /opt/highascg/highascg.config.json
    fi
else
    echo -e "  ${YELLOW}○${NC} HighAsCG deploy skipped — leaving /opt/highascg unchanged."
fi

# systemd service (ensure unit exists whenever the app tree is present)
if [ -f /opt/highascg/package.json ]; then
# systemd service
cat <<EOF > /etc/systemd/system/highascg.service
[Unit]
Description=HighAsCG Playout Control Server
After=network.target

[Service]
Type=simple
User=$USER_CASPAR
Group=$USER_CASPAR
UMask=002
WorkingDirectory=/opt/highascg
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable highascg.service
if [ "$SHOULD_DEPLOY_HIGHASCG" = true ]; then
    systemctl restart highascg.service
else
    systemctl start highascg.service 2>/dev/null || true
fi
fi

# 4.5 Boot Orchestrator — add to MOTD (visible to any SSH login)
echo -e "${CYAN}→ Setting up boot orchestrator banner...${NC}"
cat <<'MOTDEOF' > /etc/update-motd.d/99-highascg
#!/bin/bash
echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║   HighAsCG Production Playout Server  ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""
for IF in $(ls /sys/class/net/ | grep -v lo); do
    IP=$(ip -4 addr show "$IF" 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}')
    [ -n "$IP" ] && echo "  $IF: $IP"
done
PI=$(hostname -I | awk '{print $1}')
TS=$(/usr/local/bin/highascg-tailscale-ip.sh)
HG=$(systemctl show -p ActiveState --value -- highascg 2>/dev/null | head -n1)
[ -z "$HG" ] && HG="unknown"
echo ""
echo "  Web UI:    http://${PI}:8080/"
echo "  Setup:     http://${PI}:8080/setup.html  (IPs, Tailscale, Syncthing)"
echo "  Syncthing: http://${PI}:8384/"
echo "  Tailscale: ${TS}"
echo "  HighAsCG:  ${HG}"
echo ""
MOTDEOF
chmod +x /etc/update-motd.d/99-highascg

# ═══════════════════════════════════════════════════════════════
# PHASE 5: HARDENING & PERMISSIONS
# ═══════════════════════════════════════════════════════════════
echo -e "\n${BOLD}─── Phase 5: Security & Hardening ───${NC}\n"

# 5.1 File Permissions — ensure HighAsCG and CasparCG share files seamlessly
echo -e "${CYAN}→ Verifying /opt/casparcg permissions...${NC}"
chown -R "$USER_CASPAR:$USER_CASPAR" /opt/casparcg
chmod -R 775 /opt/casparcg
chown -R "$USER_CASPAR:$USER_CASPAR" /opt/highascg
chmod -R 775 /opt/highascg
echo -e "  ${GREEN}✓${NC} Both /opt/casparcg and /opt/highascg owned by $USER_CASPAR with 775"

# 5.2 Firewall — Local & Tailnet only
echo -e "${CYAN}→ Configuring firewall (Local + Tailnet only)...${NC}"
if [ "$UFW_STATUS" = "missing" ]; then
    apt install -y ufw
fi
ufw --force reset
ufw default deny incoming
ufw default allow outgoing

# Allow from RFC1918 private networks
ufw allow from 10.0.0.0/8
ufw allow from 172.16.0.0/12
ufw allow from 192.168.0.0/16

# Tailscale interface
if [ -d "/sys/class/net/tailscale0" ] || ip addr show tailscale0 &>/dev/null 2>&1; then
    ufw allow in on tailscale0
fi

ufw --force enable
echo -e "  ${GREEN}✓${NC} Firewall: Local & Tailnet only. Public internet blocked."

# 5.3 Disable Sleep/Blanking
echo -e "${CYAN}→ Disabling sleep and screen blanking...${NC}"
sed -i 's/GRUB_CMDLINE_LINUX_DEFAULT=.*/GRUB_CMDLINE_LINUX_DEFAULT="quiet splash consoleblank=0"/' /etc/default/grub
update-grub 2>/dev/null || true
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target 2>/dev/null || true

# ═══════════════════════════════════════════════════════════════
# FINAL REPORT
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  ✓ Installation Complete!${NC}"
echo -e "${BOLD}════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Services:"
echo -e "    HighAsCG:  $(svc_active_state highascg)"
echo -e "    Syncthing: $(svc_active_state "syncthing@$USER_CASPAR")"
echo -e "    Tailscale: $(tailscale_summary_state)"
echo ""
echo -e "  ${YELLOW}⚠  Please REBOOT to apply GPU driver and X11 changes.${NC}"
echo -e "  ${CYAN}→  After reboot, access: http://$(hostname -I 2>/dev/null | awk '{print $1}'):8080${NC}"
echo ""
echo "--- $(date) ---"
