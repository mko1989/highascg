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
ExecStart=/usr/bin/node /opt/highascg/index.js
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

