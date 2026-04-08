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
