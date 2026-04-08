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
apt update -y
# T3.3: Pre-clean broken dependencies from partial previous installs (common with Caspar/CEF mismatches)
apt install -f -y
apt install -y lsb-release curl wget jq

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

# CEF (dependency for CasparCG Server)
CEF_STATUS="missing"
CEF_CURRENT=""
if dpkg-query -W 'casparcg-cef-*' &>/dev/null; then
    CEF_CURRENT=$(dpkg-query -W -f='${Version}' 'casparcg-cef-*' 2>/dev/null | head -1 | cut -d'~' -f1)
    CEF_STATUS="installed"
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
dep_status "CEF (CasparCG dep)"   "$CEF_STATUS"       "$CEF_CURRENT"       ""                    "" "required"
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
