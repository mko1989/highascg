
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

# HighAsCG POST /api/audio/default-device writes /etc/asound.conf via sudo -n tee (non-interactive).
# List both common tee paths — sudo matches the command path exactly.
SUDO_TEE_RULES=""
for _t in /usr/bin/tee /bin/tee; do
	if [ -x "$_t" ]; then
		SUDO_TEE_RULES="${SUDO_TEE_RULES}${SUDO_TEE_RULES:+, }$_t /etc/asound.conf"
	fi
done
if [ -n "$SUDO_TEE_RULES" ]; then
	echo -e "${CYAN}→ Sudoers: allow $USER_CASPAR NOPASSWD tee /etc/asound.conf (Web UI default audio)${NC}"
	echo "$USER_CASPAR ALL=(root) NOPASSWD: $SUDO_TEE_RULES" > /etc/sudoers.d/highascg-asound
	chmod 440 /etc/sudoers.d/highascg-asound
	if command -v visudo >/dev/null 2>&1; then visudo -cf /etc/sudoers.d/highascg-asound 2>/dev/null && echo -e "  ${GREEN}✓${NC} /etc/sudoers.d/highascg-asound (visudo OK)" || echo -e "  ${YELLOW}○${NC} visudo check failed — verify /etc/sudoers.d/highascg-asound"
	else
		echo -e "  ${GREEN}✓${NC} /etc/sudoers.d/highascg-asound"
	fi
else
	echo -e "  ${YELLOW}○${NC} tee not found under /usr/bin or /bin — skip sudoers for /etc/asound.conf (install coreutils)"
fi

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
if [ "$CASPAR_STATUS" = "missing" ] || [ "$CEF_STATUS" = "missing" ]; then
    SHOULD_INSTALL_CASPAR=true
    echo -e "${CYAN}→ CasparCG Server or CEF dependency not found. Installing...${NC}"
elif [ -n "$MIN_CASPARCG" ] && ! version_gte "$CASPAR_CURRENT" "$MIN_CASPARCG"; then
    SHOULD_INSTALL_CASPAR=true
    echo -e "${RED}→ CasparCG v$CASPAR_CURRENT below minimum v$MIN_CASPARCG. Upgrading...${NC}"
elif [ -n "$CASPAR_RECOMMENDED" ] && version_gte "$CASPAR_CURRENT" "$CASPAR_RECOMMENDED"; then
    echo -e "  ${GREEN}✓${NC} CasparCG Server matches latest GitHub release (v$CASPAR_CURRENT ≥ v$CASPAR_RECOMMENDED)"
else
    if ask_action "CasparCG Server" "installed" "$CASPAR_CURRENT" "" "Upgrade to v${CASPAR_RECOMMENDED:-latest} (includes CEF update)?"; then
        SHOULD_INSTALL_CASPAR=true
    fi
fi

if [ "$SHOULD_INSTALL_CASPAR" = true ]; then
    URL_CEF=$(get_latest_github_deb "CasparCG/server" "casparcg-cef-")
    URL_SERVER=$(get_latest_github_deb "CasparCG/server" "casparcg-server-2.5")
    
    if [ -n "$URL_CEF" ] && [ -n "$URL_SERVER" ]; then
        cd /tmp
        echo -e "${CYAN}→ Downloading CEF dependency…${NC}"
        wget -q -O caspar-cef.deb "$URL_CEF"
        echo -e "${CYAN}→ Downloading CasparCG Server…${NC}"
        wget -q -O caspar-server.deb "$URL_SERVER"
        
        echo -e "${CYAN}→ Installing CEF and Server…${NC}"
        dpkg -i caspar-cef.deb caspar-server.deb || apt install -f -y
    else
        echo -e "  ${YELLOW}Warning: Could not resolve latest CasparCG .deb packages (server or CEF).${NC}"
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

# Replace generic system CEF libs with the CasparCG .deb build (same paths Caspar loads at runtime).
sync_caspar_cef_into_system

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
# Keep in sync with openbox_autostart.md at repo root ("Recommended autostart" block) + optional NVIDIA line.
mkdir -p "/home/$USER_CASPAR/.config/openbox"
cat <<'AST' > "/home/$USER_CASPAR/.config/openbox/autostart"
#!/bin/bash
export DISPLAY=:0
export XAUTHORITY=/home/__CASPAR_USER__/.Xauthority

xset s off
xset s noblank
xset -dpms
unclutter -idle 1 -root &
[ -x /usr/local/bin/highascg-nvidia-x-apply.sh ] && /usr/local/bin/highascg-nvidia-x-apply.sh

if [ -f /etc/highascg/display-mode ] && grep -q '^x11-only$' /etc/highascg/display-mode; then
  if command -v desktopvideo_setup >/dev/null 2>&1; then
    (sleep 2 && desktopvideo_setup) &
  fi
  if command -v xterm >/dev/null 2>&1; then
    (xterm -e 'bash -c "echo X11-only: CasparCG not started.; echo Open Desktop Video Setup from the menu.; echo Resume: sudo highascg-display-mode normal; read"') &
  fi
else
  # --- Single instance: second autostart exits immediately (nodm/X restart, duplicate runs) ---
  (
    exec 9>/tmp/caspar-openbox-autostart.lock
    if ! flock -n 9; then
      exit 0
    fi

    cd /opt/casparcg || exit 1
    /usr/bin/casparcg-scanner &

    while true; do
      cd /opt/casparcg || exit 1
      mkdir -p /opt/casparcg/cef-cache
      find /opt/casparcg/cef-cache -mindepth 1 -delete 2>/dev/null || true
      /usr/bin/casparcg-server-2.5 /opt/casparcg/config/casparcg.config >> /tmp/caspar.log 2>&1
      # Wait until nothing listens on AMCP (adjust port if your config differs)
      while ss -tlnp 2>/dev/null | grep -qE ':5250\b'; do sleep 1; done
      sleep 2
    done
  ) &
fi
AST
sed -i "s|__CASPAR_USER__|$USER_CASPAR|g" "/home/$USER_CASPAR/.config/openbox/autostart"
chmod +x "/home/$USER_CASPAR/.config/openbox/autostart"
chown -R "$USER_CASPAR:$USER_CASPAR" "/home/$USER_CASPAR/.config"

# ═══════════════════════════════════════════════════════════════
