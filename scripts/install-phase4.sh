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

# 4.3b USB media ingest — udisks2 + polkit (WO-29; headless safe eject)
echo -e "${CYAN}→ USB ingest dependencies (udisks2, polkit)…${NC}"
apt install -y udisks2 policykit-1
POLKIT_SRC="$SCRIPT_DIR/scripts/polkit/50-highascg-udisks.rules"
if [ -f "$POLKIT_SRC" ]; then
	cp "$POLKIT_SRC" /etc/polkit-1/rules.d/50-highascg-udisks.rules
	chmod 644 /etc/polkit-1/rules.d/50-highascg-udisks.rules
	echo -e "  ${GREEN}✓${NC} polkit rule installed (plugdev may mount/unmount USB)"
else
	echo -e "  ${YELLOW}○${NC} polkit rule missing at $POLKIT_SRC — copy manually if USB eject fails"
fi
POLKIT_HEADLESS="$SCRIPT_DIR/scripts/polkit/51-highascg-udisks-casparcg-headless.rules"
if [ -f "$POLKIT_HEADLESS" ]; then
	cp "$POLKIT_HEADLESS" /etc/polkit-1/rules.d/51-highascg-udisks-casparcg-headless.rules
	chmod 644 /etc/polkit-1/rules.d/51-highascg-udisks-casparcg-headless.rules
	sed -i "s/casparcg/${USER_CASPAR}/g" /etc/polkit-1/rules.d/51-highascg-udisks-casparcg-headless.rules
	echo -e "  ${GREEN}✓${NC} polkit headless rule for $USER_CASPAR (udisks without active session)"
else
	echo -e "  ${YELLOW}○${NC} optional headless polkit rule missing at $POLKIT_HEADLESS"
fi
if [ -f /etc/polkit-1/rules.d/50-highascg-udisks.rules ] || [ -f /etc/polkit-1/rules.d/51-highascg-udisks-casparcg-headless.rules ]; then
	systemctl try-restart polkit.service 2>/dev/null || true
fi
usermod -aG plugdev "$USER_CASPAR" 2>/dev/null || true

# 4.3c Runtime state dir for privileged helpers (NVIDIA apply, etc.)
GRP_CASPAR=$(id -gn "$USER_CASPAR" 2>/dev/null || echo "$USER_CASPAR")
echo -e "${CYAN}→ tmpfiles.d /run/highascg (privileged helper requests)…${NC}"
echo "d /run/highascg 0770 root $GRP_CASPAR -" > /etc/tmpfiles.d/highascg-run.conf
systemd-tmpfiles --create --prefix=/run/highascg 2>/dev/null || true
echo -e "  ${GREEN}✓${NC} tmpfiles.d /run/highascg (0770 root:$GRP_CASPAR)"

# 4.3d NVIDIA: single-driver ISO stamp (no multi-branch pool / pick-nvidia)
mkdir -p /etc/highascg
if [ -n "${HIGHASCG_NVIDIA_DRIVER:-}" ]; then
	case "${HIGHASCG_NVIDIA_DRIVER}" in
	535 | 580 | 595)
		echo "${HIGHASCG_NVIDIA_DRIVER}" > /etc/highascg/nvidia-iso-driver
		chmod 0644 /etc/highascg/nvidia-iso-driver
		echo -e "  ${GREEN}✓${NC} /etc/highascg/nvidia-iso-driver → ${HIGHASCG_NVIDIA_DRIVER}"
		;;
	*)
		echo -e "  ${YELLOW}○${NC} HIGHASCG_NVIDIA_DRIVER ignored (use 535, 580, or 595)"
		;;
	esac
fi
DISABLE_NV="$SCRIPT_DIR/scripts/disable-nvidia-multi-driver-boot.sh"
if [ -f "$DISABLE_NV" ]; then
	bash "$DISABLE_NV" && echo -e "  ${GREEN}✓${NC} disabled nvidia pick-nvidia / pool boot hooks"
fi

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
  echo "│  Setup page: http://${IP:-127.0.0.1}:4200/setup.html"
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
After=network.target NetworkManager.service
Wants=network.target

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
      echo "━━ HighAsCG ━━  http://$(hostname -I 2>/dev/null | awk '{print $1}'):4200/setup.html  ━━"
      ;;
  esac
fi
PROFILE
chmod 644 /etc/profile.d/highascg-console.sh

# 4.4 HighAsCG Server — Deploy & Service (audited in Phase 1)
SHOULD_DEPLOY_HIGHASCG=false
if [ "$HIGHASCG_STATUS" = "missing" ]; then
    SHOULD_DEPLOY_HIGHASCG=true
    echo -e "${CYAN}→ HighAsCG not installed under /home/casparcg/highascg — deploying...${NC}"
elif [ -n "$HIGHASCG_RECOMMENDED" ] && [ -n "$HIGHASCG_CURRENT" ] && [ "$HIGHASCG_CURRENT" != "?" ] && ! version_gte "$HIGHASCG_CURRENT" "$HIGHASCG_RECOMMENDED"; then
    SHOULD_DEPLOY_HIGHASCG=true
    echo -e "${RED}→ HighAsCG v$HIGHASCG_CURRENT is below recommended v$HIGHASCG_RECOMMENDED — upgrading...${NC}"
else
    if ask_action "HighAsCG" "installed" "$HIGHASCG_CURRENT" "" "Re-sync / upgrade from local repo or $HIGHASCG_GIT_URL?"; then
        SHOULD_DEPLOY_HIGHASCG=true
    fi
fi

if [ "$SHOULD_DEPLOY_HIGHASCG" = true ]; then
    echo -e "${CYAN}→ Deploying HighAsCG to /home/casparcg/highascg...${NC}"
    mkdir -p /home/casparcg/highascg
    if ! command -v rsync >/dev/null 2>&1; then
        apt install -y rsync
    fi

    if [ -f "$SCRIPT_DIR/package.json" ]; then
        echo "  Copying from local repo: $SCRIPT_DIR"
        rsync -a \
            --exclude='node_modules' --exclude='.git' --exclude='work' \
            --exclude='media' --exclude='_media' --exclude='data' --exclude='bin' --exclude='lib' \
            --exclude='dist' --exclude='cef-cache' --exclude='log' --exclude='core' \
            "$SCRIPT_DIR/" /home/casparcg/highascg/
    else
        echo "  Cloning from GitHub: $HIGHASCG_GIT_URL"
        rm -rf /home/casparcg/highascg/.git 2>/dev/null || true
        if [ -d /home/casparcg/highascg ] && [ -n "$(ls -A /home/casparcg/highascg 2>/dev/null)" ]; then
            echo "  Replacing existing /home/casparcg/highascg contents with fresh clone..."
            find /home/casparcg/highascg -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
        fi
        git clone --depth 1 "$HIGHASCG_GIT_URL" /home/casparcg/highascg
    fi

    chown -R "$USER_CASPAR:$USER_CASPAR" /home/casparcg/highascg
    chmod -R 775 /home/casparcg/highascg

    cd /home/casparcg/highascg
    sudo -u "$USER_CASPAR" npm install --omit=dev
    # Production UI: unbundled client/ (ES modules). Optional Vite bundle:
    #   sudo -u "$USER_CASPAR" npm install --include=dev && npm run build:client
    # Runtime prefers dist-web/ when index.html exists (see src/repo-paths.js).

    if [ ! -f /home/casparcg/highascg/highascg.config.json ] && [ -f /home/casparcg/highascg/highascg.config.example.json ]; then
        cp /home/casparcg/highascg/highascg.config.example.json /home/casparcg/highascg/highascg.config.json
        chown "$USER_CASPAR:$USER_CASPAR" /home/casparcg/highascg/highascg.config.json
    fi
else
    echo -e "  ${YELLOW}○${NC} HighAsCG deploy skipped — leaving /home/casparcg/highascg unchanged."
fi

# Unified playout root: Caspar dirs + NDI copy (Phase 3 may run before deploy; fresh clone clears children)
if [ -f /home/casparcg/highascg/package.json ]; then
    echo -e "${CYAN}→ Ensuring Caspar companion directories under playout root...${NC}"
    mkdir -p /home/casparcg/highascg/{media,media/exfat,media/bridge,log,template,data,cef-cache,lib}
    mkdir -p /home/casparcg/exfat
    cp /usr/lib/x86_64-linux-gnu/libndi.so.6* /home/casparcg/highascg/lib/ 2>/dev/null || true
    chown "$USER_CASPAR:$USER_CASPAR" /home/casparcg/highascg/lib/libndi.so.6* 2>/dev/null || true
    chown "$USER_CASPAR:$USER_CASPAR" /home/casparcg/exfat 2>/dev/null || true
    EXFAT_MAP_INSTALL="$SCRIPT_DIR/tools/eggs/live-usb/install-exfat-sync-map.sh"
    if [ -f "$EXFAT_MAP_INSTALL" ]; then
        bash "$EXFAT_MAP_INSTALL" && echo -e "  ${GREEN}✓${NC} /etc/highascg/exfat-sync.json (drop-config only; no sim/)"
    fi
    chown -R "$USER_CASPAR:$USER_CASPAR" /home/casparcg/highascg/media /home/casparcg/highascg/log \
        /home/casparcg/highascg/template /home/casparcg/highascg/data /home/casparcg/highascg/cef-cache \
        /home/casparcg/highascg/lib 2>/dev/null || true
    EXFAT_UNIT_SH="$SCRIPT_DIR/scripts/install-exfat-systemd-units.sh"
    if [ -f "$EXFAT_UNIT_SH" ]; then
        echo -e "${CYAN}→ WO-47 exFAT systemd units (by-label mount + boot sync)…${NC}"
        if bash "$EXFAT_UNIT_SH" "$USER_CASPAR"; then
            echo -e "  ${GREEN}✓${NC} exFAT units installed (LABEL=HIGHASCGEXF)"
        else
            echo -e "  ${YELLOW}○${NC} install-exfat-systemd-units.sh failed (non-fatal)"
        fi
    else
        echo -e "  ${YELLOW}○${NC} install-exfat-systemd-units.sh missing at $EXFAT_UNIT_SH"
    fi
fi

# systemd service (ensure unit exists whenever the app tree is present)
if [ -f /home/casparcg/highascg/package.json ]; then
 HG_UNIT_SH="$SCRIPT_DIR/scripts/write-highascg-systemd-unit.sh"
 if [ -f "$HG_UNIT_SH" ]; then
  bash "$HG_UNIT_SH" "$USER_CASPAR"
 else
  echo -e "  ${YELLOW}○${NC} write-highascg-systemd-unit.sh missing at $HG_UNIT_SH"
 fi
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
echo "  Web UI:    http://${PI}:4200/"
echo "  Setup:     http://${PI}:4200/setup.html  (IPs, Tailscale, Syncthing)"
echo "  Syncthing: http://${PI}:8384/"
echo "  Tailscale: ${TS}"
echo "  HighAsCG:  ${HG}"
echo ""
MOTDEOF
chmod +x /etc/update-motd.d/99-highascg

