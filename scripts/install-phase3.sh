
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

# Optional: NOPASSWD for Web UI → **system-wide** ALSA default (`/etc/asound.conf`).
# Not installed by default: PortAudio/device-name routing usually needs no ALSA global default,
# and the API already writes **`~/.asoundrc`** for `scope: user` without sudo (see audio-devices.js).
HIGHASCG_INSTALL_ASOUND_SUDOERS="${HIGHASCG_INSTALL_ASOUND_SUDOERS:-0}"

# HighAsCG POST /api/audio/default-device with scope=system writes /etc/asound.conf via sudo -n tee when this is enabled.
SUDO_TEE_RULES=""
if [ "$HIGHASCG_INSTALL_ASOUND_SUDOERS" = "1" ]; then
	for _t in /usr/bin/tee /bin/tee; do
		if [ -x "$_t" ]; then
			SUDO_TEE_RULES="${SUDO_TEE_RULES}${SUDO_TEE_RULES:+, }$_t /etc/asound.conf"
		fi
	done
	if [ -n "$SUDO_TEE_RULES" ]; then
		echo -e "${CYAN}→ Sudoers: allow $USER_CASPAR NOPASSWD tee /etc/asound.conf (Web UI scope=system only)${NC}"
		echo "$USER_CASPAR ALL=(root) NOPASSWD: $SUDO_TEE_RULES" > /etc/sudoers.d/highascg-asound
		chmod 440 /etc/sudoers.d/highascg-asound
		if command -v visudo >/dev/null 2>&1; then visudo -cf /etc/sudoers.d/highascg-asound 2>/dev/null && echo -e "  ${GREEN}✓${NC} /etc/sudoers.d/highascg-asound (visudo OK)" || echo -e "  ${YELLOW}○${NC} visudo check failed — verify /etc/sudoers.d/highascg-asound"
		else
			echo -e "  ${GREEN}✓${NC} /etc/sudoers.d/highascg-asound"
		fi
	else
		echo -e "  ${YELLOW}○${NC} tee not found under /usr/bin or /bin — skip sudoers for /etc/asound.conf (install coreutils)"
	fi
else
	echo -e "  ${GREEN}✓${NC} Skipping highascg-asound sudoers (set HIGHASCG_INSTALL_ASOUND_SUDOERS=1 to enable **system** ALSA default via tee)"
fi

# 3.2 nodm & openbox
if [ "$NODM_STATUS" = "missing" ]; then
    echo -e "${CYAN}→ Installing nodm + openbox + xterm (X11-only / DeckLink GUI)...${NC}"
    apt install -y nodm openbox unclutter xterm
else
    echo -e "  ${GREEN}✓${NC} nodm already installed"
    apt install -y xterm 2>/dev/null || true
fi
# Minimal/server images often omit X input drivers — USB kb/mouse work in TTY but not on :0 until these are present (Openbox, DeckLink desktopvideo_setup).
echo -e "${CYAN}→ X11 input drivers (keyboard / mouse on Openbox session)...${NC}"
apt install -y xserver-xorg-input-all xserver-xorg-input-libinput

echo -e "${CYAN}→ Avahi (mDNS) for NDI / LAN discovery…${NC}"
apt install -y avahi-daemon
systemctl enable avahi-daemon 2>/dev/null || true
systemctl start avahi-daemon 2>/dev/null || true

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

# 3.3 CasparCG (~/highascg/bin/casparcg + run.sh) & pinned CEF
ensure_highascg_caspar_launcher

SHOULD_INSTALL_CEF=false
if [ "$CEF_STATUS" = "missing" ]; then
    SHOULD_INSTALL_CEF=true
    echo -e "${CYAN}→ CEF not found in playout lib — installing pinned binary…${NC}"
elif ask_action "CEF (Caspar HTML)" "$CEF_STATUS" "$CEF_CURRENT" "" "Reinstall pinned CEF ${CASPAR_CEF_VERSION:-142}?"; then
    SHOULD_INSTALL_CEF=true
fi

if [ "$SHOULD_INSTALL_CEF" = true ]; then
    install_highascg_cef_binary
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
    if install_highascg_scanner_deb; then
        :
    else
        echo -e "  ${YELLOW}Warning: Scanner install failed — see URL_SCANNER_DEB in install-config.sh${NC}"
    fi
fi

# Disable stock CasparCG service (we use Openbox autostart + run.sh)
systemctl stop casparcg-server 2>/dev/null || true
systemctl disable casparcg-server 2>/dev/null || true
rm -f /etc/systemd/system/casparcg-server.service

# Setup directory structure with correct permissions
echo -e "${CYAN}→ Setting up /home/casparcg/highascg directory structure...${NC}"
mkdir -p /home/casparcg/highascg/{bin,media,log,template,data,cef-cache,config,lib}
chown -R "$USER_CASPAR:$USER_CASPAR" /home/casparcg/highascg
chmod -R 775 /home/casparcg/highascg

# Main CasparCG server config lives under config/ (scanner uses its own config under the casparcg tree).
if [ -f /home/casparcg/highascg/media/casparcg.config.ftd ] && [ ! -f /home/casparcg/highascg/config/casparcg.config ]; then
  cp -a /home/casparcg/highascg/media/casparcg.config.ftd /home/casparcg/highascg/config/casparcg.config
  chown "$USER_CASPAR:$USER_CASPAR" /home/casparcg/highascg/config/casparcg.config
  echo -e "  ${GREEN}✓${NC} Migrated legacy config to /home/casparcg/highascg/config/casparcg.config"
fi

# Copy NDI into playout lib/ (same dir as CEF — run.sh sets LD_LIBRARY_PATH to lib/ only)
cp /usr/lib/x86_64-linux-gnu/libndi.so.6* /home/casparcg/highascg/lib/ 2>/dev/null || true
chown -R "$USER_CASPAR:$USER_CASPAR" /home/casparcg/highascg/lib/libndi.so.6* 2>/dev/null || true

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

    cd /home/casparcg/highascg || exit 1
    /usr/bin/casparcg-scanner &
    mkdir -p /home/casparcg/highascg/cef-cache
    find /home/casparcg/highascg/cef-cache -mindepth 1 -delete 2>/dev/null || true
    export CASPAR_RESPAWN=1
    ./run.sh >> /tmp/caspar.log 2>&1
  ) &
fi
AST
sed -i "s|__CASPAR_USER__|$USER_CASPAR|g" "/home/$USER_CASPAR/.config/openbox/autostart"
chmod +x "/home/$USER_CASPAR/.config/openbox/autostart"
chown -R "$USER_CASPAR:$USER_CASPAR" "/home/$USER_CASPAR/.config"

# ═══════════════════════════════════════════════════════════════
