#!/usr/bin/env bash
# WO-1096 — the ISO carries nothing we have no right to distribute, and nothing private to the build host
# (WO-1095 audit; excludes in penguins-eggs-exclude-redistribution.list).
#
# Sourced by verify-iso-squashfs-excludes.sh (uses its UNSQ / SQ / bad / ok), or run on its own:
#   bash tools/eggs/live-usb/verify-iso-redistribution.sh <highascg*.iso | filesystem.squashfs>
# Lists the squashfs ONCE and greps that listing (one unsquashfs pass instead of one per needle).
#
# Deliberately NOT asserted: home/casparcg/.highascg/gdtf-share.json — the shared GDTF Share login ships by owner
# decision (22.10, confirmed 16.11.26). home/casparcg/highascg/lib/libndi.so.6 ships on purpose (Caspar's NDI).

# needle table: <ERE on the liveroot-relative path>|<what it is>
REDIST_NEEDLES=(
	'^(home/[^/]+/Documents/.|home/[^/]+/highascg-backups(/|$))|client show data / project backups'
	'^root/.|root home contents (known_hosts, histories, npm logs)'
	'^(opt/shutter-encoder(/|$)|usr/share/applications/shutter-encoder-|var/lib/dpkg/info/shutter-encoder\.)|Shutter Encoder'
	'^(usr/share/icons/hicolor/[^/]+/apps/(BlackmagicDesktopVideoSetup|DesktopVideoUpdater)\.png|etc/blackmagic(/|$)|etc/dracut\.conf\.d/dracut-blackmagic\.conf|usr/share/lintian/overrides/desktopvideo|etc/rc.\.d/[SK][0-9]+DesktopVideoHelper|etc/systemd/system/[^/]+\.wants/DesktopVideoHelper\.service|home/[^/]+/\.config/Blackmagic Design(/|$)|usr/share/man/man1/(Blackmagic|DesktopVideo))|Blackmagic Desktop Video leftovers (EULA)'
	'^(usr/share/applications/magic(q|hd|vis|multiwin)\.desktop|usr/share/pixmaps/magic(q|hd|vis)\.png|etc/udev/rules\.d/99-chamsys-usb\.rules|usr/share/mime/(packages/magicq\.xml|application/x-magicq-)|var/lib/dpkg/info/magicq\.)|ChamSys MagicQ leftovers (EULA)'
	'^(usr/share/NX(/|$)|var/NX(/|$)|usr/share/doc/nomachine(/|$)|etc/pam\.d/nx|var/lib/dpkg/info/nomachine\.|usr/share/icons/hicolor/[^/]+/apps/NoMachine-|usr/share/mime/packages/NoMachine-mime\.xml|usr/share/polkit-1/(actions|rules\.d)/[^/]*nomachine)|NoMachine leftovers'
	'^(etc/apparmor\.d/zoom$|usr/share/mime/application/x-zoom\.xml|var/lib/dpkg/info/zoom\.)|Zoom leftovers'
	'^var/lib/NetworkManager/(seen-bssids|timestamps|[^/]*\.lease)$|NetworkManager history (AP MACs, leases)'
	'^home/[^/]+/\.config/pulse/cookie$|PulseAudio auth cookie'
	'^etc/highascg/exfat-sync\.json\.bak\.|exfat-sync.json backups (stale host config)'
	'^usr/lib/x86_64-linux-gnu/libndi\.so|system-path NDI copy (NDI: never install the DLLs into the system path)'
	'^usr/lib/cef(/|$)|unused CEF duplicate /usr/lib/cef'
	'^home/[^/]+/highascg/lib/(NOBLE-COMPAT-MANIFEST\.txt|libavcodec\.so\.60|libavformat\.so\.60|libavutil\.so\.58|libicu[a-z0-9]*\.so\.74|libsfml-[a-z]+\.so\.2\.6|libxml2\.so\.2|libx26[45]\.so\.1[69][49]$|libboost_chrono\.so\.1\.83)|noble compat libs (only the excluded rollback binaries use them)'
	'^(opt/magicq|home/casparcg/show|home/casparcg/highascg/godot/export/(windows|web-demo)|home/casparcg/\.highascg/(backup|retro/games))(/|$)|dev-box tools and data (WO-870 30.10: MagicQ, shows, Godot exports for other OSes, switch backups, game ROMs)'
	'^home/[^/]+/highascg/template/mario(/|$)|Nintendo-derived template (WO-1096 A)'
	'^home/[^/]+/highascg/node_modules/wetransfert(/|$)|unlicensed npm package wetransfert (WO-1096 C)'
)

redistribution_check() {
	local listing rc=0 entry re what hit
	listing="$(mktemp)"
	set +o pipefail
	"${UNSQ[@]}" -l "$SQ" 2>/dev/null | sed -e 's#^squashfs-root/\{0,1\}##' >"$listing" || rc=$?
	set -o pipefail
	if [[ ! -s "$listing" ]]; then
		bad "WO-1096: cannot list ${SQ} (unsquashfs rc ${rc})"
		rm -f "$listing"
		return
	fi
	for entry in "${REDIST_NEEDLES[@]}"; do
		re="${entry%|*}"
		what="${entry##*|}"
		hit="$(grep -E -m 3 "$re" "$listing" | tr '\n' ' ' || true)"
		if [[ -n "$hit" ]]; then
			bad "not ours to ship / host-private (WO-1096): ${what}: ${hit}— remove it from the tree or exclude it (penguins-eggs-exclude-redistribution.list, install-eggs-config.sh)"
		else
			ok "absent (WO-1096): ${what}"
		fi
	done
	rm -f "$listing"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	set -euo pipefail
	HERE_R="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
	SQ="${1:?usage: verify-iso-redistribution.sh <highascg*.iso | filesystem.squashfs>}"
	UNSQ=(unsquashfs)
	if [[ "$SQ" == *.iso ]]; then
		# shellcheck source=iso-read-lib.sh
		source "${HERE_R}/iso-read-lib.sh"
		iso_read_open "$SQ" || exit 1
		off="$(iso_file_offset "$SQ" live/filesystem.squashfs)" || exit 1
		iso_read_close
		UNSQ=(unsquashfs -o "$off")
	fi
	FAIL=0
	bad() {
		echo "FAIL: $*" >&2
		FAIL=$((FAIL + 1))
	}
	ok() { echo "OK: $*"; }
	redistribution_check
	[[ "$FAIL" -eq 0 ]] || {
		echo "WO-1096 redistribution check FAILED (${FAIL})." >&2
		exit 1
	}
	echo "WO-1096 redistribution check passed."
fi
