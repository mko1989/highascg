# System Dependency Audit — 2026-07 (WO-142)

Goal: reconcile everything installed on this playout machine against what `scripts/setup/` installs,
so a fresh server provisioned by the suite matches this box. Owner statement: **only Zoom is removable**
(test-only); everything else is intentional.

Status: **outputs captured 2026-07-07 (host `highascg-nvidia-595`), analysis complete.**
Raw capture is at the bottom; the owner ran all 11 commands in one shot — outputs were parsed from the blob.

---

## Analysis (2026-07-07)

### Verdict table (grouped)

| Group | Packages / units | Installed by | Verdict |
|---|---|---|---|
| Playout core | casparcg-scanner, desktopvideo(+gui), libboost-*, libsfml-*, libglew, libtbb, libportaudio/portaudio19-*, ffmpeg, v4l-utils, libnss3, libdrm* | setup `05-caspar-deps.sh` (+DeckLink lib) | keep |
| GPU | nvidia-driver-595-open, cuda-keyring, nvidia dkms 595.71.05 | setup `03-nvidia-open-595.sh` | keep |
| Kernel (pinned) | linux-{image,headers,modules,modules-extra,tools}-6.8.0-117 | setup `01-kernel-117.sh` | keep — **v4l2loopback ships inside `linux-modules-6.8.0-117`** (verified `dpkg -S`), so fresh installs get the vcam module with the pinned kernel; dkms (blackmagic, blackmagic-io, nvidia) builds against the pinned kernel only, which is fine while the pin holds |
| Display/session | nodm, openbox, unclutter, xterm, x11-utils, x11-xserver-utils, xdotool, xserver-xorg-input-*, xvfb, python3-xlib, plymouth* | setup `04/09/10` + boot-branding | keep |
| Boot/ISO | calamares, penguins-eggs, qml-module-qtquick*, grub-*, shim-signed, efibootmgr, os-prober | eggs suite + setup | keep |
| Network | network-manager, netplan.io, avahi-daemon, wpasupplicant, rfkill, wireless-regdb, isc-dhcp-client, ethtool, openssh-server, tailscale (apt) | setup + `install-tailscale-deb-for-iso.sh` | keep — see snap duplicate below |
| Services | nginx (web proxy), syncthing | `scripts/runtime/install-highascg-web-proxy.sh`, setup `12-syncthing` | keep — **web-proxy installer is not in the numbered setup flow** (gap G3) |
| Storage/USB | exfatprogs, parted, udisks2, usbutils, bolt | setup exfat/usb steps | keep |
| Dev/ops tools | build-essential, gcc, make, dkms, git, curl, wget, unzip, bzip2, rsync, jq, nano, evtest, thunar | setup (05/14/lib) | keep |
| Dev/ops tools **not provisioned** | **gh, tmux, mc, magic-wormhole** | manual | keep on this box; gap G4 — add to setup or document machine-local |
| Operator browser | firefox-esr | setup `lib/install-operator-firefox.sh` | keep |
| **Test-only** | **zoom — 942 MB, the single largest package on the box** | manual | **KEEP on build host** (owner decision 2026-07-08) — used for vcam testing; **excluded from shipped ISOs** via the eggs squashfs fragment + guarded by `verify-iso-squashfs-excludes.sh` |

### Snaps

| Snap | Verdict |
|---|---|
| snapd, bare, core24 | keep (snap plumbing) |
| **tailscale (snap, rev 154)** | duplicate of the apt install — **owner decision 2026-07-08: keep both** on the build host; the snap dirs were already excluded from ISOs via the eggs fragment |
| gnome-46-2404, gtk-common-themes, mesa-2404 | platform snaps with **no app snap left that needs them** (tailscale is CLI-only) — likely orphans from an earlier snap app. Candidates: `sudo snap remove gnome-46-2404 gtk-common-themes mesa-2404` after `snap connections` shows nothing attached (owner call) |

### Services notes

- `highascg-*` (13 units), `casparcg-server/scanner`, `companion`, `DesktopVideoHelper`, `nginx`, `tailscaled` — all intentional, all installed by the suite. ✓
- `apt-daily-upgrade.timer` masked+failed — **intentional and benign** (`scripts/lib/apt-block-service-starts.sh` blocks auto-upgrades on playout); the "failed" state is just systemd reporting a masked trigger.
- `apport` (crash reporting) + `motd-news.timer`, `pollinate`, `lxd-installer.socket` — Ubuntu server defaults; harmless, disable-candidates on a production image if boot/noise matters.
- `cloud-init` (4 units) — adds boot latency on a fixed playout box; candidate for `cloud-init.disabled` in a future setup step (owner call; may be wanted for eggs images).
- NetworkManager **and** systemd-networkd both enabled — netplan renders NM; informational, no action.

### npm / pip / flatpak

- npm -g: corepack + npm only — clean.
- pip3/pipx/flatpak: nothing installed — clean.

### /usr/local + sudoers

- `/usr/local/bin` (11 scripts) and `/usr/local/lib/highascg` (17 scripts) match the repo installers exactly (see WO-143 script map).
- `/etc/sudoers.d`: `99-eggs-calamares`, `highascg`, `highascg-network`, `highascg-webui-server-update` (+README) — matches `12-passwordless-sudo.sh` + installers. ✓

### Zoom removal

Zoom is an **apt** package (not snap):

```bash
sudo apt purge zoom && sudo apt autoremove
```

Frees ~920 MB. Paste confirmation:

```
(paste removal confirmation here)
```

### Gaps to feed back into scripts/setup/ (coordinate with WO-143)

- **G1** Zoom: remove (command above). Nothing to provision.
- **G2** Tailscale snap duplicate: `sudo snap remove tailscale` after confirming the apt daemon serves `tailscale status`. Setup suite already installs the deb — no suite change.
- **G3** `scripts/runtime/install-highascg-web-proxy.sh` (installs nginx) is not part of the numbered `scripts/setup/` flow — wire it in (or document as a manual step in `MANUAL_INSTALL.md`).
- **G4** Not provisioned anywhere: `gh`, `tmux`, `mc`, `magic-wormhole`, `v4l2loopback-utils` — add a small `scripts/setup/17-operator-tools.sh` (or extend `05-caspar-deps.sh` package list), or mark machine-local in the setup README.
- **G5** Possibly-orphaned platform snaps (gnome/gtk/mesa) — owner review, no suite change.
- **G6** Optional hardening step for production images: disable `apport`, `motd-news.timer`, consider `cloud-init` — owner call, note only.

---

## Raw capture (2026-07-07, all 11 commands in one shot)

<details><summary>expand</summary>

```
casparcg@highascg-nvidia-595:~/highascg$ apt-mark showmanual
acl alsa-utils apt-transport-https avahi-daemon base-files bash bolt bsdutils build-essential bzip2
ca-certificates calamares casparcg-scanner cuda-keyring curl dash debianutils desktopvideo
desktopvideo-gui diffutils dkms efibootmgr ethtool evtest exfatprogs ffmpeg file findutils
firefox-esr gcc gh git gnupg grep grub-efi-amd64-bin grub-efi-amd64-signed grub-pc grub-pc-bin gzip
hostname iproute2 isc-dhcp-client jq language-selector-common libboost-context1.83.0
libboost-filesystem1.83.0 libboost-locale1.83.0 libboost-log1.83.0 libboost-thread1.83.0 libc-bin
libdrm-tests libdrm2 libegl1 libgl1 libglew2.2 libnss3 libopengl0 libportaudio2
libsfml-graphics2.6 libsfml-system2.6 libsfml-window2.6 libtbb12 libx11-6 libxcursor1 libxi6
libxinerama1 libxrandr2 linux-firmware linux-headers-6.8.0-117-generic
linux-image-6.8.0-117-generic linux-modules-6.8.0-117-generic
linux-modules-extra-6.8.0-117-generic linux-tools-6.8.0-117-generic linux-tools-common login
lxd-installer magic-wormhole make mawk mc nano ncurses-base ncurses-bin netplan.io network-manager
nginx nodejs nodm nvidia-driver-595-open openbox openssh-server os-prober parted pciutils
penguins-eggs plymouth plymouth-label plymouth-theme-spinner policykit-1 portaudio19-dev
portaudio19-doc python3 python3-xlib qml-module-qtquick-controls qml-module-qtquick2 rfkill rsync
shim-signed software-properties-common syncthing tailscale tar thunar tmux ubuntu-server-minimal
udisks2 unclutter unzip usbutils util-linux v4l-utils v4l2loopback-utils wget wireless-regdb
wpasupplicant x11-utils x11-xserver-utils xdotool xserver-xorg-input-all
xserver-xorg-input-libinput xterm xvfb zoom

Top-40 by installed size (KB): zoom 942221, linux-firmware 626006, libnvidia-compute-595 416478,
libnvidia-gl-595 362660, firefox-esr 272791, desktopvideo 265751, nodejs 232486, libllvm20 140245,
ibus-data 133120, snapd 126928, linux-modules-extra 109725, nvidia-firmware-595 100531,
mesa-vulkan-drivers 96231, ... casparcg-scanner 75680, tailscale 71243, desktopvideo-gui 70329, ...

snap list: bare 5, core24 1643, gnome-46-2404 153, gtk-common-themes 1535, mesa-2404 1165,
snapd 27406, tailscale 154 (1/stable)

Enabled units (102): snap mounts ×8; casparcg-scanner, casparcg-server, companion,
DesktopVideoHelper; highascg-{bridge-arrive,bridge-boot,calamares-branding,cpu-performance,
decklink-install,exfat-arrive,exfat-boot,exfat-media-prep,exfat-network-apply,exfat-server-update,
exfat-sync,fb-corner-throbber,fix-config-permissions,hardware-hostname,power-button,storage-probe},
highascg.service; nginx, tailscaled, NetworkManager(+dispatcher,+wait-online), systemd-networkd,
avahi, wpa_supplicant, apparmor, apport(+timer,+forward.socket), cloud-init ×4, ssh.socket,
snapd ×7, lvm2/multipath/iscsi/mdcheck server defaults, motd-news.timer, pollinate,
lxd-installer.socket, e2scrub, fstrim.timer, dpkg-db-backup.timer, grub ×2, gpu-manager,
switcheroo-control, syncthing-resume, udisks2, systemd-{resolved,timesyncd,pstore,network-generator}

Failed: apt-daily-upgrade.timer (masked) — intentional, see analysis.

npm -g: corepack@0.35.0, npm@11.16.0
pip3/pipx/flatpak: (none)

/usr/local/bin: caspar-systemd-cleanup.sh caspar-systemd-control.sh confine-cursor.py
confine-pointer-barriers.py highascg-capture-boot-xrandr.sh highascg-cpu-performance.sh
highascg-display-mode highascg-fb-corner-throbber highascg-nvidia-x-apply.sh
highascg-replication-ssh launch-calamares.sh

/usr/local/lib/highascg: decklink-install-from-exfat.sh decklink-install-lib.sh
fix-calamares-branding.sh highascg-apply-hardware-hostname.sh highascg-apply-server-drop.sh
highascg-bridge-arrive.sh highascg-bridge-boot.sh highascg-exfat-arrive.sh highascg-exfat-boot.sh
highascg-exfat-network-apply.sh highascg-exfat-server-update.sh highascg-fix-config-permissions.sh
highascg-network-apply.sh highascg-network-reset.sh highascg-power-button-listen.sh
highascg-tailscale-up.sh highascg-vcam-modules-up.sh highascg-webui-server-update.sh
probe-internal-storage.sh

/etc/sudoers.d: 99-eggs-calamares README highascg highascg-network highascg-webui-server-update

dkms status: blackmagic-io/16.0.1a2 (6.8.0-117) installed; blackmagic/16.0.1a2 installed;
nvidia/595.71.05 installed

Follow-up verification (same day): lsmod shows v4l2loopback + snd_aloop loaded;
dpkg -S confirms v4l2loopback.ko.zst belongs to linux-modules-6.8.0-117-generic.
```

</details>
