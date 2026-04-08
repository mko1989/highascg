
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

    # Persistent: OpenGL sync-to-vblank off + “Prefer maximum performance” (PowerMizer), applied each X session.
    echo -e "${CYAN}→ NVIDIA: persist VSync off + Prefer Max Performance (nvidia-settings + GL env)…${NC}"
    apt install -y nvidia-settings 2>/dev/null || true

    mkdir -p /etc/X11/Xsession.d
    cat <<'HS_NV_XSE' > /etc/X11/Xsession.d/99-highascg-nvidia-gl
#!/bin/sh
# HighAsCG — OpenGL: do not sync to vertical retrace (lower latency for Caspar/CEF).
export __GL_SYNC_TO_VBLANK=0
HS_NV_XSE
    chmod 644 /etc/X11/Xsession.d/99-highascg-nvidia-gl

    cat <<'HS_NV_PROF' > /etc/profile.d/99-highascg-nvidia-gl.sh
# HighAsCG — same GL hint for non-X login shells (harmless if unused).
export __GL_SYNC_TO_VBLANK=0
HS_NV_PROF
    chmod 644 /etc/profile.d/99-highascg-nvidia-gl.sh

    cat <<'HS_NV_APPLY' > /usr/local/bin/highascg-nvidia-x-apply.sh
#!/bin/bash
# Apply NVIDIA control panel settings once per X session (nodm + openbox).
command -v nvidia-settings &>/dev/null || exit 0
# Prefer maximum performance (vs adaptive power saving)
nvidia-settings -a "[gpu:0]/GPUPowerMizerMode=1" 2>/dev/null || nvidia-settings -a "GPUPowerMizerMode=1" 2>/dev/null || true
# Sync to VBlank off (GPU / screen when exposed by driver)
nvidia-settings -a "[gpu:0]/SyncToVBlank=0" 2>/dev/null || true
nvidia-settings -a "[screen:0]/SyncToVBlank=0" 2>/dev/null || true
nvidia-settings -a "[gpu:0]/XVideoSyncToVBlank=0" 2>/dev/null || true
HS_NV_APPLY
    chmod 755 /usr/local/bin/highascg-nvidia-x-apply.sh
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
