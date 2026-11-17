# shellcheck shell=bash
# WO-1096 — licence texts + source offer for the non-dpkg stack on the ISO (WO-1095 §Obligations). Sourced by
# collect-third-party-licenses.sh (uses LIC, TP, REPO_ROOT, GENERATED_AT, log); writes one manifest row per component
# to the TSV named by $1 (id, name, version, licenseId, category, licenseFile, notes, url).
#
# Vendored texts the host cannot provide live in tools/release/licenses/ (provenance: its README.md). Copies next to the
# binaries (bin/LICENSE*, lib/LICENSE-CEF.txt, ~/companion/LICENSE.md, cores/*.copyright) are written unless
# HIGHASCG_LICENSES_NEXT_TO_BINARIES=0 (tests).

# WO-1106 B65: the ISO build runs this under sudo (HOME=/root), so $HOME found no Companion, cores or WayVR and their
# licences never reached the tree. As root, read the playout user's home: SUDO_USER's, else /home/casparcg.
# HIGHASCG_LICENSES_HOME still overrides (tests). $1 = uid (default: the caller's).
collect_licenses_home() {
	local uid="${1:-$(id -u)}" h=""
	if [[ -n "${HIGHASCG_LICENSES_HOME:-}" ]]; then
		echo "$HIGHASCG_LICENSES_HOME"
	elif [[ "$uid" -eq 0 ]]; then
		[[ -n "${SUDO_USER:-}" && "$SUDO_USER" != root ]] && h="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
		echo "${h:-/home/casparcg}"
	else
		echo "$HOME"
	fi
}

# WO-1106 B72: PortAudio's licence (Debian copyright of libportaudio2 19.7.0, the build Caspar's lib/ carries; WO-773).
_portaudio_license() {
	cat <<'EOF'
PortAudio Portable Real-Time Audio Library — http://www.portaudio.com
Shipped as ~/highascg/lib/libportaudio.so.2 (Ubuntu package libportaudio2; see lib/PORTAUDIO-FIX-MANIFEST.txt).

Copyright (c) 1999-2009 Ross Bencina
Copyright (c) 1999-2008 Phil Burk
Copyright (c) 1999-2000 Robert Marsanyi
Copyright (c) 1999-2007 Andrew Baldwin
Copyright (c) 2002 Joshua Haberman <joshua@haberman.com>
Copyright (c) 2003 Fred Gleason
Copyright (c) 2004 Stefan Westerfeld <stefan@space.twc.de>
Copyright (c) 2004-2009 Arve Knudsen <arve.knudsen@gmail.com>
Copyright (c) 2005-2006 Ludwig Schwardt
Copyright (c) 2006-2007 David Viens
Copyright (c) 2008 Kevin Kofler <kevin.kofler@chello.at>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files
(the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software,
and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR
ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The text above constitutes the entire PortAudio license; however,
the PortAudio community also makes the following non-binding requests:

Any person wishing to distribute modifications to the Software is
requested to send the modifications to the original developer so that
they can be incorporated into the canonical version. It is also
requested that these non-binding requests be included along with the
license above.
EOF
}

# WO-1106 B65: a copy written as root into the playout user's tree keeps that tree's owner ($2 = reference path).
_lic_own() { [[ "$(id -u)" -ne 0 ]] || chown --reference="$2" "$1" 2>/dev/null || true; }

# WO-1106 B66: SOURCES.md's AGPL source link is HEAD; an ISO built from an unpushed commit or a dirty tree points at
# source GitHub does not have. Warn loudly (the owner builds from the dev box, so never fail) and record the state.
# Sets LIC_COMMIT, LIC_DESCRIBE (`git describe --always --dirty`), LIC_REMOTE (remote branches holding HEAD) and
# LIC_DIRTY (changed tracked files). safe.directory: the build runs as root on the playout user's repo.
collect_source_state() {
	local g=(git -c "safe.directory=$1" -C "$1") tree
	LIC_COMMIT="$("${g[@]}" rev-parse HEAD 2>/dev/null || echo unknown)"
	LIC_DESCRIBE="$("${g[@]}" describe --always --dirty 2>/dev/null || echo unknown)"
	LIC_REMOTE="$("${g[@]}" branch -r --contains HEAD 2>/dev/null | sed 's/^[* ]*//' | grep -v -- ' -> ' | tr '\n' ' ' || true)"
	LIC_REMOTE="${LIC_REMOTE% }"
	LIC_DIRTY="$("${g[@]}" status --porcelain --untracked-files=no 2>/dev/null | wc -l || true)"
	tree=clean
	[[ "${LIC_DIRTY:-0}" -gt 0 ]] && tree="DIRTY (${LIC_DIRTY} tracked files changed)"
	echo "[collect-licenses] HighAsCG source for SOURCES.md: commit ${LIC_COMMIT} (${LIC_DESCRIBE}); on a remote branch: ${LIC_REMOTE:-NO}; tree: ${tree}" >&2
	if [[ -z "$LIC_REMOTE" || "$tree" != clean ]]; then
		{
			echo "[collect-licenses] !!! WARN (WO-1106 B66): the AGPL source offer in SOURCES.md points at ${LIC_COMMIT}, but"
			[[ -z "$LIC_REMOTE" ]] && echo "[collect-licenses] !!!   that commit is on NO remote branch — push it before you distribute this ISO"
			[[ "$tree" != clean ]] && echo "[collect-licenses] !!!   the tree is ${tree} — the image carries changes that commit does not have"
		} >&2
	fi
}

collect_stack_licenses() {
	local extra="$1" vend="${REPO_ROOT}/tools/release/licenses" home
	home="$(collect_licenses_home)"
	local next="${HIGHASCG_LICENSES_NEXT_TO_BINARIES:-1}" v="" wv="" f f2 pkg so ver
	_lic_row() { printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$@" >>"$extra"; }
	cp -f "${vend}/COMPLIANCE-ISO.md" "${LIC}/COMPLIANCE-ISO.md"

	# --- CasparCG Server (GPL-3.0-or-later): version from the binary itself, tag per caspar/README.md (WO-1022) ---
	local cbin="${REPO_ROOT}/bin/casparcg" cver="" csha9="" cnote=""
	if [[ -f "$cbin" ]]; then
		cver="$(strings -n 8 "$cbin" | grep -m1 -E '^[0-9]+\.[0-9]+\.[0-9]+ [0-9a-f]{9} ' || true)"
		csha9="$(awk '{print $2}' <<<"$cver")"
	fi
	if [[ -f "${REPO_ROOT}/caspar/PINNED.json" ]]; then
		local pinned
		pinned="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["shortSha"])' "${REPO_ROOT}/caspar/PINNED.json" 2>/dev/null || true)"
		if [[ -n "$csha9" && "$pinned" == "$csha9" ]]; then
			cnote="source tarball casparcg-source-${csha9}.tar.gz in release caspar-${csha9} of mko1989/highascg"
		elif [[ -n "$csha9" ]]; then
			cnote="bin/casparcg is ${csha9} but caspar/PINNED.json pins ${pinned:-nothing}: publish its tag (caspar/README.md)"
			log "WARN: ${cnote}"
		fi
	fi
	cp -f "${vend}/third-party/casparcg-server-LICENSE.txt" "${TP}/casparcg-server-GPL-3.0.txt"
	if [[ "$next" == 1 && -d "${REPO_ROOT}/bin" ]]; then
		cp -f "${vend}/third-party/casparcg-server-LICENSE.txt" "${REPO_ROOT}/bin/LICENSE"
		printf 'CasparCG Server %s — GPL-3.0-or-later (LICENSE).\nCorresponding source: https://github.com/mko1989/casparcg-server/tree/highascg-%s\nSee /usr/share/doc/highascg/licenses/SOURCES.md\n' \
			"${cver:-unknown}" "${csha9:-unknown}" >"${REPO_ROOT}/bin/SOURCE.txt"
	fi
	_lic_row casparcg-build "CasparCG Server (HighAsCG build)" "${cver:-}" GPL-3.0-or-later playout third-party/casparcg-server-GPL-3.0.txt \
		"Source: tag highascg-${csha9:-?} (SOURCES.md)." "https://github.com/mko1989/casparcg-server"

	# --- CEF + Chromium (inside lib/libcef.so) ---
	local cefv="142.0.17+g60aac24+chromium-142.0.7444.176"
	[[ -f "${REPO_ROOT}/caspar/PINNED.json" ]] && cefv="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("cefVersion",""))' "${REPO_ROOT}/caspar/PINNED.json" 2>/dev/null || echo "$cefv")"
	[[ "$cefv" == 142.0.17+* ]] || log "WARN: CEF ${cefv} differs from the vendored 142.0.17 licence texts (tools/release/licenses/README.md)"
	cp -f "${vend}/third-party/cef-142.0.17-LICENSE.txt" "${TP}/cef-LICENSE.txt"
	xz -dc "${vend}/third-party/chromium-142.0.7444-LICENSES.html.xz" >"${TP}/chromium-142.0.7444-LICENSES.html"
	[[ "$next" == 1 && -f "${REPO_ROOT}/lib/libcef.so" ]] && cp -f "${vend}/third-party/cef-142.0.17-LICENSE.txt" "${REPO_ROOT}/lib/LICENSE-CEF.txt"
	_lic_row cef "Chromium Embedded Framework + Chromium" "$cefv" "BSD-3-Clause AND see Chromium credits" browser third-party/cef-LICENSE.txt \
		"Chromium third-party licences: third-party/chromium-142.0.7444-LICENSES.html." "https://github.com/chromiumembedded/cef"

	# --- PortAudio (MIT): Caspar's lib/libportaudio.so.2 — WO-1106 B72 ---
	local pav=""
	pav="$(sed -n 's/^# Source deb: libportaudio2_\([^_]*\)_.*/\1/p' "${REPO_ROOT}/lib/PORTAUDIO-FIX-MANIFEST.txt" 2>/dev/null | head -1 || true)"
	_portaudio_license >"${TP}/portaudio-LICENSE.txt"
	[[ "$next" == 1 && -f "${REPO_ROOT}/lib/libportaudio.so.2" ]] && cp -f "${TP}/portaudio-LICENSE.txt" "${REPO_ROOT}/lib/LICENSE-portaudio.txt"
	_lic_row portaudio "PortAudio (lib/libportaudio.so.2)" "$pav" MIT audio third-party/portaudio-LICENSE.txt \
		"Ubuntu package libportaudio2 copied into Caspar's lib/ (WO-773)." "http://www.portaudio.com/"

	# --- ShaderToyLite.js (template/shaders, BSD-3-Clause; vendor/ itself is not on the ISO) — WO-1096 B ---
	if [[ -f "${REPO_ROOT}/vendor/shadertoy/LICENSE" ]]; then
		cp -f "${REPO_ROOT}/vendor/shadertoy/LICENSE" "${TP}/shadertoylite-LICENSE.txt"
		_lic_row shadertoylite ShaderToyLite.js 11bbc09a BSD-3-Clause ui-runtime third-party/shadertoylite-LICENSE.txt \
			"Patched copy: template/shaders/ShaderToyLite.js. Shaders: template/shaders/LICENSES/manifest.json (NOT AGPL)." "https://github.com/chipweinberger/ShaderToyLite.js"
	fi

	# --- Godot (operator client export + editor) ---
	local gv="4.7.2"
	f="$(unzip -Z1 "${home}/.local/opt/godot/dl/godot.zip" 2>/dev/null | head -1 || true)"
	[[ "$f" =~ Godot_v([0-9.]+)-stable ]] && gv="${BASH_REMATCH[1]}"
	[[ "$gv" == 4.7.2 ]] || log "WARN: Godot ${gv} differs from the vendored 4.7.2 LICENSE/COPYRIGHT (tools/release/licenses/README.md)"
	cp -f "${vend}/third-party/godot-4.7.2-LICENSE.txt" "${TP}/godot-LICENSE.txt"
	cp -f "${vend}/third-party/godot-4.7.2-COPYRIGHT.txt" "${TP}/godot-COPYRIGHT.txt"
	_lic_row godot "Godot Engine" "$gv" MIT ui-runtime third-party/godot-LICENSE.txt "Third-party components: third-party/godot-COPYRIGHT.txt." "https://godotengine.org/license/"

	# --- Bitfocus Companion ---
	if [[ -d "${home}/companion" ]]; then
		v="$(head -1 "${home}/companion/resources/BUILD" 2>/dev/null || true)"
		cp -f "${vend}/third-party/companion-5.0.2-LICENSE.md" "${TP}/companion-LICENSE.md"
		if [[ "$next" == 1 && -w "${home}/companion" ]]; then
			cp -f "${vend}/third-party/companion-5.0.2-LICENSE.md" "${home}/companion/LICENSE.md"
			_lic_own "${home}/companion/LICENSE.md" "${home}/companion"
		fi
		[[ "$v" == 5.0.2* ]] || log "WARN: Companion ${v:-?} differs from the vendored 5.0.2 LICENSE.md"
		_lic_row companion "Bitfocus Companion" "$v" MIT control third-party/companion-LICENSE.md \
			"Electron/Chromium notices ship in ~/companion (LICENSE.electron.txt, LICENSES.chromium.html)." "https://github.com/bitfocus/companion"
	fi

	# --- penguins-eggs (patched, see scripts/eggs/patches) ---
	if dpkg-query -W penguins-eggs &>/dev/null; then
		cp -f "${vend}/third-party/penguins-eggs-LICENSE.txt" "${TP}/penguins-eggs-LICENSE.txt"
		_lic_row penguins-eggs penguins-eggs "$(dpkg-query -W -f='${Version}' penguins-eggs)" "MIT OR GPL-2.0" installer third-party/penguins-eggs-LICENSE.txt \
			"Patched: scripts/eggs/patches in the HighAsCG repo." "https://github.com/pieroproietti/penguins-eggs"
	fi

	# --- WayVR AppImage (GPL-3.0) ---
	f="$(ls -1 "${home}"/.local/opt/wayvr/WayVR-v*-x86_64.AppImage 2>/dev/null | tail -1 || true)"
	if [[ -n "$f" ]]; then
		[[ "$f" =~ WayVR-(v[0-9.]+)-x86_64 ]] && wv="${BASH_REMATCH[1]}"
		cp -f /usr/share/common-licenses/GPL-3 "${TP}/GPL-3.0.txt"
		_lic_row wayvr WayVR "$wv" GPL-3.0 vr third-party/GPL-3.0.txt "Source: SOURCES.md." "https://github.com/wlx-team/wayvr"
	fi

	# --- libretro cores: Ubuntu packages unpacked by godot/retro/get-cores.sh (copyright kept next to the core) ---
	local cores="${home}/.highascg/retro/cores" ctable="" tmpd=""
	for so in "${cores}"/*_libretro.so; do
		[[ -f "$so" ]] || continue
		case "$(basename "$so")" in
			nestopia_libretro.so) pkg=libretro-nestopia ;;
			bsnes_mercury_balanced_libretro.so) pkg=libretro-bsnes-mercury-balanced ;;
			mgba_libretro.so) pkg=libretro-mgba ;;
			genesis_plus_gx_libretro.so) pkg=libretro-genesisplusgx ;;
			snes9x_libretro.so) pkg=libretro-snes9x ;;
			*) log "WARN: unknown core $(basename "$so") — add it to collect-licenses-stack.sh"; continue ;;
		esac
		if [[ ! -f "${cores}/${pkg}.copyright" ]]; then
			[[ -n "$tmpd" ]] || tmpd="$(mktemp -d)"
			(cd "$tmpd" && apt-get download "$pkg" >/dev/null 2>&1 && dpkg-deb -x ./"${pkg}"_*.deb "root-${pkg}") || true
			if [[ -f "${tmpd}/root-${pkg}/usr/share/doc/${pkg}/copyright" && "$next" == 1 ]]; then
				cp "${tmpd}/root-${pkg}/usr/share/doc/${pkg}/copyright" "${cores}/${pkg}.copyright"
				dpkg-deb -f "${tmpd}"/"${pkg}"_*.deb Version >"${cores}/${pkg}.version"
				_lic_own "${cores}/${pkg}.copyright" "$cores"
				_lic_own "${cores}/${pkg}.version" "$cores"
			fi
		fi
		f="${cores}/${pkg}.copyright"
		[[ -f "$f" ]] || f="${tmpd:-/nonexistent}/root-${pkg}/usr/share/doc/${pkg}/copyright"
		ver="$(cat "${cores}/${pkg}.version" 2>/dev/null || true)"
		if [[ -z "$ver" ]]; then
			f2="$(ls -1 "${tmpd:-/nonexistent}"/"${pkg}"_*.deb 2>/dev/null | head -1 || true)"
			[[ -n "$f2" ]] && ver="$(dpkg-deb -f "$f2" Version 2>/dev/null || true)"
		fi
		if [[ -f "$f" ]]; then
			cp -f "$f" "${TP}/${pkg}.copyright"
			_lic_row "$pkg" "libretro core $(basename "$so")" "$ver" "See copyright" emulation "third-party/${pkg}.copyright" \
				"Ubuntu package ${pkg}; source: apt-get source ${pkg}=${ver}." "https://launchpad.net/ubuntu/+source/${pkg}"
		else
			log "WARN: no copyright for ${pkg} (apt-get download failed) — the core ships without its licence"
		fi
		ctable+="| \`$(basename "$so")\` | \`${pkg}\` | \`${ver:-?}\` | \`apt-get source ${pkg}=${ver:-?}\` · https://launchpad.net/ubuntu/+source/${pkg} |"$'\n'
	done
	[[ -n "$tmpd" ]] && rm -rf "$tmpd"
	[[ -n "$ctable" ]] && ctable="| Core | Ubuntu package | Version | Source |"$'\n'"|------|----------------|---------|--------|"$'\n'"${ctable}"
	[[ -n "$ctable" ]] || ctable="No libretro cores on this image."

	# --- Ubuntu package list + the source offer ---
	dpkg-query -W -f='${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n' >"${TP}/ubuntu-packages.tsv" 2>/dev/null || true
	local commit scanner eggs
	collect_source_state "${REPO_ROOT}"
	commit="$LIC_COMMIT"
	scanner="$(dpkg-query -W -f='${Version}' casparcg-scanner 2>/dev/null || true)"
	eggs="$(dpkg-query -W -f='${Version}' penguins-eggs 2>/dev/null || true)"
	CORES_TABLE="$ctable" python3 - "${vend}/SOURCES.md.in" "${LIC}/SOURCES.md" <<PY
import os, sys
t = open(sys.argv[1], encoding="utf-8").read()
for k, v in {
    "GENERATED_AT": "${GENERATED_AT}", "HIGHASCG_COMMIT": "${commit}", "CASPAR_VERSION": "${cver:-unknown}",
    "CASPAR_SHA9": "${csha9:-unknown}", "CASPAR_SOURCE_NOTE": "${cnote:-no bin/casparcg on the build host}",
    "CEF_VERSION": "${cefv}", "SCANNER_VERSION": "${scanner:-not installed}", "SCANNER_UPSTREAM": "${scanner%%-*}",
    "EGGS_VERSION": "${eggs:-not installed}", "WAYVR_VERSION": "${wv:-not installed}", "GODOT_VERSION": "${gv}",
    "COMPANION_VERSION": "$(head -1 "${home}/companion/resources/BUILD" 2>/dev/null || echo 'not installed')",
    "CORES_TABLE": os.environ["CORES_TABLE"].rstrip("\n"),
}.items():
    t = t.replace("@" + k + "@", v)
# WO-1106 B66: the exact build tree, so a dirty or unpushed build is visible to whoever reads the offer
t = t.rstrip("\n") + "\n\n### HighAsCG build tree\n\n\`git describe --always --dirty\` when this image was built: \`${LIC_DESCRIBE}\`" \
    + " (remote branches holding it: ${LIC_REMOTE:-none})." + "\n"
open(sys.argv[2], "w", encoding="utf-8").write(t)
PY
	log "wrote SOURCES.md, COMPLIANCE-ISO.md and the stack licence texts"
}
