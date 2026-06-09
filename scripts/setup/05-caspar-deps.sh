#!/usr/bin/env bash
# Step 5: CasparCG runtime dependencies (no DeckLink auto-install).
# FFmpeg, OpenGL, X11 input, Avahi, casparcg user, nodm/openbox skeleton.
#
#   sudo bash scripts/setup/05-caspar-deps.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root

PLAYOUT="${CASPAR_PLAYOUT_ROOT:-/home/casparcg/highascg}"

log "Base packages"
DEBIAN_FRONTEND=noninteractive apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y \
	curl wget git jq unzip rsync software-properties-common \
	alsa-utils libportaudio2 portaudio19-dev \
	ffmpeg libdrm2 libdrm-tests \
	libopengl0 libgl1 libegl1 \
	libglew2.2 \
	libsfml-graphics2.6 libsfml-window2.6 libsfml-system2.6 \
	libtbb12 \
	libboost-log1.83.0 libboost-locale1.83.0 libboost-filesystem1.83.0 \
	libboost-thread1.83.0 libboost-context1.83.0 \
	libnss3 \
	libx11-6 libxrandr2 libxinerama1 libxi6 libxcursor1 \
	avahi-daemon \
	xserver-xorg-input-all xserver-xorg-input-libinput \
	nodm openbox unclutter xterm

systemctl enable avahi-daemon 2>/dev/null || true
systemctl start avahi-daemon 2>/dev/null || true

_ffdev=$(ffmpeg -devices 2>&1 || true)
echo "$_ffdev" | grep -q kmsgrab && ok "ffmpeg: kmsgrab" || echo "  note: kmsgrab not listed (x11grab fallback)"
echo "$_ffdev" | grep -q x11grab && ok "ffmpeg: x11grab"

log "casparcg system user + hardware groups"
USER_SHELL=$(command -v nologin || command -v false || echo "/usr/sbin/nologin")
if ! id "$USER_CASPAR" &>/dev/null; then
	useradd -r -m -s "$USER_SHELL" "$USER_CASPAR"
	ok "created user $USER_CASPAR"
else
	ok "user $USER_CASPAR exists"
fi
for GRP in video audio render plugdev dialout input; do
	getent group "$GRP" &>/dev/null && usermod -aG "$GRP" "$USER_CASPAR" 2>/dev/null || true
done

log "Playout directory tree"
mkdir -p "${PLAYOUT}"/{bin,media,log,template,data,cef-cache,config,lib}
chown -R "$USER_CASPAR:$USER_CASPAR" "${PLAYOUT}"
chmod -R 775 "${PLAYOUT}"

log "nodm → openbox for $USER_CASPAR"
cat >/etc/default/nodm <<EOF
NODM_ENABLED=true
NODM_USER=${USER_CASPAR}
NODM_X_OPTIONS='-s 0 -dpms -nolisten tcp'
EOF

mkdir -p "/home/${USER_CASPAR}"
echo 'exec openbox-session' >"/home/${USER_CASPAR}/.xsession"
chmod +x "/home/${USER_CASPAR}/.xsession"
chown "${USER_CASPAR}:${USER_CASPAR}" "/home/${USER_CASPAR}/.xsession"

mkdir -p /etc/highascg
[[ -f /etc/highascg/display-mode ]] || echo "normal" >/etc/highascg/display-mode

if [[ -f /usr/lib/x86_64-linux-gnu/libndi.so.6 ]]; then
	cp -f /usr/lib/x86_64-linux-gnu/libndi.so.6* "${PLAYOUT}/lib/" 2>/dev/null || true
	chown "${USER_CASPAR}:${USER_CASPAR}" "${PLAYOUT}/lib"/libndi.so.6* 2>/dev/null || true
fi

CASPAR_BIN="${PLAYOUT}/bin/casparcg"
if [[ -x "$CASPAR_BIN" ]]; then
	log "Caspar shared-library check (${CASPAR_BIN})"
	_missing="$(LD_LIBRARY_PATH="${PLAYOUT}/lib" ldd "$CASPAR_BIN" 2>/dev/null | grep 'not found' || true)"
	if [[ -n "$_missing" ]]; then
		echo "$_missing" >&2
		fail "casparcg still has missing libraries — install packages above or re-run step 08 (CEF)"
	else
		ok "casparcg runtime libraries resolve"
	fi
fi

echo
echo "Caspar binary/CEF/scanner: ensure ${PLAYOUT}/bin/casparcg and lib/ are populated."
echo "DeckLink: manual — see ${SCRIPT_DIR}/06-decklink-manual.md"
echo "Next: sudo bash ${SCRIPT_DIR}/07-node-highascg.sh"
