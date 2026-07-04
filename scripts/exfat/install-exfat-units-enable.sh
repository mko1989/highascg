cat > "/etc/systemd/system/${network_apply_svc}" <<NETAPPLYEOF
[Unit]
Description=Apply operator network config from exFAT network/network.conf (WO-95)
Documentation=${DOC_URI}
DefaultDependencies=no
After=home-casparcg-exfat.mount highascg-exfat-boot.service
Before=${update_svc} ${decklink_install_svc} highascg.service highascg-exfat-sync.service
ConditionPathIsMountPoint=/home/casparcg/exfat
ConditionPathExists=${NETWORK_APPLY_SH_DST}

[Service]
Type=oneshot
RemainAfterExit=yes
TimeoutStartSec=60
User=root
Group=root
ExecStart=${NETWORK_APPLY_SH_DST} --boot

[Install]
WantedBy=multi-user.target
NETAPPLYEOF

cat > "/etc/systemd/system/${decklink_install_svc}" <<DECKLINKEOF
[Unit]
Description=Install DeckLink Desktop Video from exFAT/bridge decklink/ (WO-92)
Documentation=${DOC_URI}
DefaultDependencies=no
After=home-casparcg-bridge.mount home-casparcg-exfat.mount ${network_apply_svc} ${update_svc} highascg-bridge-boot.service highascg-exfat-boot.service
Before=casparcg-scanner.service casparcg-server.service highascg.service highascg-exfat-sync.service
ConditionPathExists=${DECKLINK_INSTALL_SH_DST}

[Service]
Type=oneshot
RemainAfterExit=yes
TimeoutStartSec=300
User=root
Group=root
ExecStart=${DECKLINK_INSTALL_SH_DST} --boot

[Install]
WantedBy=multi-user.target
DECKLINKEOF

# Wrong name refused bind at media/bridge (Where= mismatch).
rm -f /etc/systemd/system/home-casparcg-highascg-media.mount

chmod 0644 "/etc/systemd/system/home-casparcg-exfat.mount" \
	"/etc/systemd/system/highascg-exfat-sync.service" \
	"/etc/systemd/system/highascg-fix-config-permissions.service" \
	"/etc/systemd/system/highascg-exfat-boot.service" \
	"/etc/systemd/system/${update_svc}" \
	"/etc/systemd/system/${prep_svc}" \
	"/etc/systemd/system/${bind_mount_esc}"

systemctl daemon-reload
systemctl disable highascg-exfat-bootstrap.service 2>/dev/null || true
systemctl reset-failed highascg-exfat-arrive.service 2>/dev/null || true
systemctl reset-failed highascg-bridge-arrive.service 2>/dev/null || true
ENABLE_UNITS=(
	highascg-bridge-boot.service
	highascg-exfat-boot.service
	"${network_apply_svc}"
	"${update_svc}"
	"${decklink_install_svc}"
	highascg-fix-config-permissions.service
	highascg-exfat-sync.service
	"${prep_svc}"
	"${arrive_svc}"
	"${bridge_arrive_svc}"
)
# Mount/bind units are started on demand (bridge-boot / exfat-boot / udev). Enabling them
# pulls dev-disk-by-label.* into local-fs.target and can block boot ~90s when absent.
DISABLE_AT_BOOT=(
	home-casparcg-exfat.mount
	home-casparcg-bridge.mount
	"${bridge_media_mount}"
)
if [[ "$LEGACY_USB_MEDIA_BIND" == "1" ]]; then
	ENABLE_UNITS+=("${bind_mount_esc}")
else
	DISABLE_AT_BOOT+=("${bind_mount_esc}")
fi
systemctl enable "${ENABLE_UNITS[@]}" 2>/dev/null || true
for u in "${DISABLE_AT_BOOT[@]}"; do
	[[ -n "$u" ]] || continue
	systemctl disable "$u" 2>/dev/null || true
done
udevadm control --reload-rules 2>/dev/null || true
udevadm trigger --subsystem-match=block --action=add 2>/dev/null || true

echo "Installed:"
echo "  ${ARRIVE_SH_DST}"
echo "  ${UDEV_RULE_DST} (hotplug + late USB → ${arrive_svc})"
echo "  ${UDEV_BRIDGE_RULE_DST} (late NVMe → ${bridge_arrive_svc})"
echo "  ${BRIDGE_ARRIVE_SH_DST}"
echo "  ${UPDATE_SH_DST}"
echo "  ${APPLY_SH_DST}"
echo "  ${WEBUI_UPDATE_SH_DST}"
echo "  /etc/highascg/disable-exfat-bootstrap (legacy sim/highascg seed off)"
echo "  ${BOOT_EXCLUDE_DST} (legacy bootstrap excludes — unused when disabled)"
echo "  ${UPDATE_EXCLUDE_DST} (server drop — skips client/, dist-web/, runtime)"
echo "  ${DOC_PKG}/ (offline Documentation= targets)"
echo "  /etc/systemd/system/home-casparcg-bridge.mount (LABEL=HIGHASCGDAT)"
echo "  /etc/systemd/system/${bridge_prep_svc}"
	echo "  /etc/systemd/system/${bridge_media_mount} (bridge library → ~/highascg/media/bridge)"
echo "  /etc/systemd/system/highascg-bridge-boot.service"
echo "  ${BRIDGE_BOOT_SH_DST}"
echo "  legacy USB media bind: $([[ "$LEGACY_USB_MEDIA_BIND" == "1" ]] && echo enabled || echo disabled — WO-52)"
echo "  /etc/systemd/system/home-casparcg-exfat.mount"
echo "  /etc/systemd/system/${prep_svc}"
echo "  /etc/systemd/system/${bind_mount_esc}"
echo "  /etc/systemd/system/${update_svc} (drop-update/ or legacy update/server/)"
echo "  /etc/systemd/system/highascg-fix-config-permissions.service"
echo "  ${FIX_CFG_DST}"
echo "  /etc/systemd/system/highascg-exfat-sync.service"
echo "  /etc/systemd/system/highascg-exfat-boot.service"
echo "  ${BOOT_SH_DST}"
echo "  /etc/systemd/system/${network_apply_svc}"
echo "  ${NETWORK_APPLY_SH_DST}"
echo "  /etc/systemd/system/${decklink_install_svc}"
echo "  ${DECKLINK_INSTALL_SH_DST}"
echo "  ${DECKLINK_INSTALL_LIB_DST}"
echo "  /etc/systemd/system/${arrive_svc}"
echo "Re-run: sudo bash ${REPO_ROOT}/scripts/write-highascg-systemd-unit.sh ${USER_CASPAR}"
