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

