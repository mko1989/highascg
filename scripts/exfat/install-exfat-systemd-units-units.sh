# WO-52: bridge disk (HIGHASCGDAT) → sole media library
cat > /etc/systemd/system/home-casparcg-bridge.mount <<BRIDGEEOF
[Unit]
Description=HighAsCG bridge data (LABEL=HIGHASCGDAT)
Documentation=${DOC_URI}
DefaultDependencies=no
Conflicts=umount.target
ConditionPathExists=/dev/disk/by-label/HIGHASCGDAT
Before=${bridge_prep_svc} ${bridge_media_mount} highascg-exfat-sync.service
After=blk-availability.target systemd-remount-fs.service

[Mount]
What=/dev/disk/by-label/HIGHASCGDAT
Where=/home/casparcg/bridge
Type=exfat
Options=defaults,uid=${UIDN},gid=${GIDN},umask=002,nofail,x-systemd.device-timeout=5,x-systemd.mount-timeout=5

[Install]
# Do not WantedBy=local-fs — highascg-bridge-boot.service starts this when LABEL exists.
WantedBy=multi-user.target
BRIDGEEOF

cat > "/etc/systemd/system/${bridge_prep_svc}" <<BRIDGEPREPEOF
[Unit]
Description=Ensure bridge volume exposes media/ (WO-52)
Documentation=${DOC_URI}
DefaultDependencies=no
BindsTo=home-casparcg-bridge.mount
After=home-casparcg-bridge.mount
Before=${bridge_media_mount} highascg-exfat-sync.service highascg.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/install -d -m 0755 -o ${UIDN} -g ${GIDN} /home/casparcg/bridge/media /home/casparcg/bridge/configs /home/casparcg/bridge/drop-config

[Install]
RequiredBy=${bridge_media_mount}
BRIDGEPREPEOF

cat > "/etc/systemd/system/${bridge_media_mount}" <<BRIDGEMEDIAEOF
[Unit]
Description=Bind bridge media/ → ~/highascg/media/bridge (WO-52 — does not hide local media/)
Documentation=${DOC_URI}
DefaultDependencies=no
Requires=${bridge_prep_svc} home-casparcg-bridge.mount
After=${bridge_prep_svc} home-casparcg-bridge.mount
BindsTo=home-casparcg-bridge.mount
RequiresMountsFor=/home/casparcg/bridge
Before=highascg-exfat-sync.service highascg.service

[Mount]
What=/home/casparcg/bridge/media
Where=/home/casparcg/highascg/media/bridge
Type=none
Options=bind

[Install]
WantedBy=multi-user.target
BRIDGEMEDIAEOF

cat > /etc/systemd/system/highascg-bridge-boot.service <<BRIDGEBOOTEOF
[Unit]
Description=HighAsCG WO-52 — mount HIGHASCGDAT bridge + bind media library
Documentation=${DOC_URI}
DefaultDependencies=no
After=local-fs-pre.target blk-availability.target
Before=highascg-exfat-boot.service highascg.service highascg-exfat-sync.service
Conflicts=shutdown.target

[Service]
Type=oneshot
RemainAfterExit=yes
TimeoutStartSec=60
ExecStart=${BRIDGE_BOOT_SH_DST}

[Install]
WantedBy=multi-user.target
BRIDGEBOOTEOF

# shellcheck disable=SC2094
cat > /etc/systemd/system/home-casparcg-exfat.mount <<EOF
[Unit]
Description=HighAsCG USB operator data (LABEL=HIGHASCGEXF)
Documentation=${DOC_URI}
DefaultDependencies=no
Conflicts=umount.target
ConditionPathExists=/dev/disk/by-label/HIGHASCGEXF
Before=${prep_svc} ${bind_mount_esc} ${update_svc} highascg-exfat-sync.service
After=blk-availability.target systemd-remount-fs.service

[Mount]
What=/dev/disk/by-label/HIGHASCGEXF
Where=/home/casparcg/exfat
Type=exfat
Options=defaults,uid=${UIDN},gid=${GIDN},umask=002,nofail,x-systemd.device-timeout=5,x-systemd.mount-timeout=5

[Install]
# Not enabled at install — highascg-exfat-boot.service mounts USB when present (avoids local-fs emergency).
WantedBy=multi-user.target
EOF

cat > "/etc/systemd/system/${prep_svc}" <<EOF
[Unit]
Description=Ensure exFAT exposes media/ before bind into HighAsCG (WO-47)
Documentation=${DOC_URI}
DefaultDependencies=no
BindsTo=home-casparcg-exfat.mount
After=home-casparcg-exfat.mount
Before=${bind_mount_esc} ${update_svc} highascg-exfat-sync.service highascg.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/install -d -m 0755 -o ${UIDN} -g ${GIDN} /home/casparcg/exfat/media

[Install]
RequiredBy=${bind_mount_esc}
EOF

cat > "/etc/systemd/system/${bind_mount_esc}" <<EOF
[Unit]
Description=Bind ~/exfat/media → ~/highascg/media/exfat (WO-47)
Documentation=${DOC_URI}
DefaultDependencies=no
Requires=${prep_svc} home-casparcg-exfat.mount
After=${prep_svc} home-casparcg-exfat.mount
BindsTo=home-casparcg-exfat.mount
RequiresMountsFor=/home/casparcg/exfat
Before=${update_svc} highascg-exfat-sync.service highascg.service

[Mount]
What=/home/casparcg/exfat/media
Where=/home/casparcg/highascg/media/exfat
Type=none
Options=bind

[Install]
WantedBy=multi-user.target
EOF

cat > "/etc/systemd/system/${update_svc}" <<UPDEOF
[Unit]
Description=Apply server drop from exFAT drop-update/ (WO-47)
Documentation=${DOC_URI}
DefaultDependencies=no
After=home-casparcg-exfat.mount ${bind_mount_esc}
Before=highascg-exfat-sync.service highascg.service
ConditionPathIsMountPoint=/home/casparcg/exfat

[Service]
Type=oneshot
RemainAfterExit=yes
TimeoutStartSec=300
User=root
Group=root
Environment=HIGHASCG_SERVICE_USER=${USER_CASPAR}
ExecStart=${UPDATE_SH_DST}

[Install]
WantedBy=multi-user.target
UPDEOF

cat > /etc/systemd/system/highascg-fix-config-permissions.service <<FIXEOF
[Unit]
Description=Fix ownership of ~/highascg/config for exfat-sync (WO-47)
Documentation=${DOC_URI}
DefaultDependencies=no
After=home-casparcg-bridge.mount home-casparcg-exfat.mount ${bind_mount_esc} ${update_svc}
Before=highascg-exfat-sync.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${FIX_CFG_DST}

[Install]
WantedBy=multi-user.target
FIXEOF

cat > /etc/systemd/system/highascg-exfat-sync.service <<SVCEOF
[Unit]
Description=HighAsCG bridge/USB mtime sync (WO-47 + WO-52)
Documentation=${DOC_URI}
DefaultDependencies=no
After=home-casparcg-bridge.mount ${bridge_media_mount} home-casparcg-exfat.mount ${bind_mount_esc} ${update_svc} ${network_apply_svc} ${decklink_install_svc} highascg-fix-config-permissions.service highascg-bridge-boot.service highascg-exfat-boot.service
Before=highascg.service
ConditionPathExists=/home/casparcg/highascg/tools/runtime/exfat-sync-cli.js

[Service]
Type=oneshot
RemainAfterExit=yes
TimeoutStartSec=120
User=${USER_CASPAR}
Group=${GNAME}
WorkingDirectory=/home/casparcg/highascg
ExecStart=/usr/bin/node /home/casparcg/highascg/tools/runtime/exfat-sync-cli.js --boot

[Install]
WantedBy=multi-user.target
SVCEOF

cat > /etc/systemd/system/highascg-exfat-boot.service <<BOOTEOF
[Unit]
Description=HighAsCG WO-47 — wait for HIGHASCGEXF USB, mount ~/exfat, queue sync (optional at boot)
Documentation=${DOC_URI}
DefaultDependencies=no
After=local-fs-pre.target highascg-live-stick-init.service highascg-bridge-boot.service
Before=highascg.service highascg-exfat-sync.service
Conflicts=shutdown.target

[Service]
Type=oneshot
RemainAfterExit=yes
TimeoutStartSec=300
Environment=HIGHASCG_EXFAT_BOOT_WAIT_SEC=30
ExecStart=${BOOT_SH_DST}

[Install]
WantedBy=multi-user.target
BOOTEOF

cat > "/etc/systemd/system/${bridge_arrive_svc}" <<BRIDGEARRIVEEOF
[Unit]
Description=Mount HIGHASCGDAT bridge + bind media (late NVMe / hotplug)
Documentation=${DOC_URI}
DefaultDependencies=no
ConditionPathExists=/dev/disk/by-label/HIGHASCGDAT
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=oneshot
RemainAfterExit=no
ExecStart=${BRIDGE_ARRIVE_SH_DST}

[Install]
WantedBy=multi-user.target
BRIDGEARRIVEEOF

cat > "/etc/systemd/system/${arrive_svc}" <<ARRIVEEOF
[Unit]
Description=Mount HIGHASCGEXF and run WO-47 pipeline (late USB / hotplug)
Documentation=${DOC_URI}
DefaultDependencies=no
ConditionPathExists=/dev/disk/by-label/HIGHASCGEXF
ConditionPathExists=!/etc/highascg/disable-exfat-arrive
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=oneshot
RemainAfterExit=no
ExecStart=${ARRIVE_SH_DST}

[Install]
WantedBy=multi-user.target
ARRIVEEOF

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
