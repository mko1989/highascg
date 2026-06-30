#!/usr/bin/env bash
# Collect third-party license texts from the build host into licenses/.
#
# Run on a host that matches what eggs produce will clone (after scripts/setup/).
#
#   bash tools/release/collect-third-party-licenses.sh
#   sudo bash tools/release/collect-third-party-licenses.sh   # also refresh deb copyrights
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
LIC="${REPO_ROOT}/licenses"
TP="${LIC}/third-party"
MANIFEST="${LIC}/manifest.json"
NDI_PDF_URL='https://downloads.ndi.tv/SDK/NDI_SDK/NDI%20License%20Agreement.pdf'
GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "${TP}"

log() { echo "[collect-licenses] $*"; }

dpkg_ver() {
	local pkg=$1
	dpkg-query -W -f='${Version}' "$pkg" 2>/dev/null | head -1 || true
}

copy_deb_copyright() {
	local pkg=$1 dest=$2
	local src="/usr/share/doc/${pkg}/copyright"
	if [[ -f "$src" ]]; then
		cp "$src" "${TP}/${dest}"
		log "copied ${pkg} copyright → third-party/${dest}"
		return 0
	fi
	return 1
}

nvidia_pkg() {
	for p in nvidia-driver-595-open nvidia-driver-580-open nvidia-driver-535-open \
		nvidia-driver-595 nvidia-driver-580 nvidia-driver-535 nvidia-open; do
		if dpkg-query -W "$p" &>/dev/null; then
			echo "$p"
			return 0
		fi
	done
	echo ""
}

# --- HighAsCG (AGPL) ---
cp -f "${REPO_ROOT}/LICENSE" "${TP}/highascg-AGPL-3.0.txt" 2>/dev/null || true
cp -f "${REPO_ROOT}/COPYRIGHT" "${TP}/highascg-COPYRIGHT.txt" 2>/dev/null || true

# --- NVIDIA ---
NV_PKG="$(nvidia_pkg)"
NV_VER=""
if [[ -n "$NV_PKG" ]]; then
	NV_VER="$(dpkg_ver "$NV_PKG")"
	copy_deb_copyright "$NV_PKG" "nvidia-driver.NOTICE" || true
fi
NV_ISO_STAMP=""
[[ -f /etc/highascg/nvidia-iso-driver ]] && NV_ISO_STAMP="$(tr -d '\n' </etc/highascg/nvidia-iso-driver)"

# --- Blackmagic ---
BMD_VER=""
build_bmd_eula() {
	local dest="${TP}/blackmagic-desktopvideo-EULA.txt"
	{
		echo "Blackmagic Design Desktop Video — License Agreement"
		echo "Copyright Blackmagic Design Pty. Ltd. All rights reserved."
		echo ""
		echo "This file is shipped with HighAsCG live ISO images. Source: desktopvideo"
		echo "Debian package /usr/share/doc/desktopvideo/copyright"
		echo ""
		if [[ -f "${TP}/blackmagic-desktopvideo.NOTICE" ]]; then
			cat "${TP}/blackmagic-desktopvideo.NOTICE"
		elif [[ -f /usr/share/doc/desktopvideo/copyright ]]; then
			cat /usr/share/doc/desktopvideo/copyright
		fi
	} >"$dest"
	log "wrote third-party/blackmagic-desktopvideo-EULA.txt"
}
if dpkg-query -W desktopvideo &>/dev/null; then
	BMD_VER="$(dpkg_ver desktopvideo)"
	copy_deb_copyright desktopvideo blackmagic-desktopvideo.NOTICE || true
	copy_deb_copyright desktopvideo-gui blackmagic-desktopvideo-gui.NOTICE 2>/dev/null || true
	build_bmd_eula
fi

# --- NDI ---
NDI_VER=""
if [[ -f /usr/lib/x86_64-linux-gnu/libndi.so.6 ]]; then
	NDI_VER="$(readlink -f /usr/lib/x86_64-linux-gnu/libndi.so.6 | sed 's/.*libndi\.so\.//')"
fi
if [[ ! -f "${TP}/ndi-sdk-license-agreement.pdf" ]] || [[ ! -s "${TP}/ndi-sdk-license-agreement.pdf" ]]; then
	log "downloading NDI SDK License Agreement"
	curl -fsSL -o "${TP}/ndi-sdk-license-agreement.pdf" "$NDI_PDF_URL" || {
		log "WARN: could not download NDI license PDF"
	}
fi
# SDK tree license from last install (if present)
for f in \
	"/tmp/NDI SDK for Linux/NDI License Agreement.txt" \
	"/tmp/NDI SDK for Linux/NDI License Agreement.pdf" \
	"/tmp/NDI SDK for Linux/Documentation/NDI License Agreement.pdf"; do
	if [[ -f "$f" ]]; then
		cp -f "$f" "${TP}/ndi-sdk-license-from-install.$(basename "$f")"
		log "archived SDK license from ${f}"
		break
	fi
done

# --- Other common stack packages (best-effort) ---
for pair in \
	"casparcg-server-2.5:casparcg-server.NOTICE" \
	"ffmpeg:ffmpeg.NOTICE" \
	"tailscale:tailscale.NOTICE" \
	"syncthing:syncthing.NOTICE" \
	"nodejs:nodejs.NOTICE" \
	"calamares:calamares.NOTICE"; do
	pkg="${pair%%:*}"
	dest="${pair##*:}"
	if dpkg-query -W "$pkg" &>/dev/null; then
		copy_deb_copyright "$pkg" "$dest" || true
	fi
done

# --- npm production deps (optional; needs node in playout or repo) ---
NPM_JSON="${TP}/highascg-npm-deps.json"
if command -v npx &>/dev/null && [[ -f "${REPO_ROOT}/package-lock.json" ]]; then
	(
		cd "${REPO_ROOT}"
		npx --yes license-checker@25.0.1 --production --json --out "${NPM_JSON}" 2>/dev/null \
			|| log "WARN: license-checker skipped (network or npm)"
	) || true
fi

# --- manifest.json ---
python3 - "${MANIFEST}" "${GENERATED_AT}" "${NV_PKG}" "${NV_VER}" "${NV_ISO_STAMP}" \
	"${BMD_VER}" "${NDI_VER}" <<'PY'
import json, os, sys
from pathlib import Path

manifest_path, generated_at, nv_pkg, nv_ver, nv_iso, bmd_ver, ndi_ver = sys.argv[1:8]
repo = Path(manifest_path).resolve().parents[1]
tp = repo / "licenses" / "third-party"

def has_file(name):
    return (tp / name).is_file()

components = [
    {
        "id": "highascg",
        "name": "HighAsCG",
        "version": None,
        "licenseId": "AGPL-3.0-or-later",
        "category": "application",
        "isoShipStatus": "allowed",
        "licenseFile": "third-party/highascg-AGPL-3.0.txt",
        "complianceNotes": "Copyright HighPass Marcin Wardecki. Source: repository root LICENSE.",
    },
]

if nv_pkg:
    components.append({
        "id": "nvidia-driver",
        "name": f"NVIDIA Linux Display Driver ({nv_pkg})",
        "version": nv_ver or nv_iso or None,
        "licenseId": "NVIDIA-graphics-drivers",
        "category": "gpu-driver",
        "isoShipStatus": "allowed",
        "licenseFile": "third-party/nvidia-driver.NOTICE",
        "complianceNotes": "Ship unmodified binaries; include NVIDIA Driver License Agreement (see COMPLIANCE-ISO.md).",
        "isoDriverStamp": nv_iso or None,
    })

if bmd_ver:
    components.append({
        "id": "blackmagic-desktopvideo",
        "name": "Blackmagic Desktop Video",
        "version": bmd_ver,
        "licenseId": "Proprietary",
        "category": "capture-playback",
        "isoShipStatus": "allowed",
        "licenseFile": "third-party/blackmagic-desktopvideo-EULA.txt",
        "complianceNotes": "Embedded in HighAsCG ISO. Full BMD Desktop Video License Agreement shipped with image.",
        "vendorUrl": "https://www.blackmagicdesign.com/",
    })

if ndi_ver or has_file("ndi-sdk-license-agreement.pdf"):
    components.append({
        "id": "ndi-sdk",
        "name": "NDI SDK (libndi)",
        "version": ndi_ver or None,
        "licenseId": "Proprietary",
        "category": "av-network",
        "isoShipStatus": "allowed",
        "licenseFile": "third-party/ndi-sdk-license-agreement.pdf",
        "complianceNotes": "Include PDF; link https://ndi.video/ near NDI UI; NDI® trademark notice required.",
        "attributionUrl": "https://ndi.video/",
    })

for extra in [
    ("casparcg-server", "casparcg-server.NOTICE", "CasparCG Server", "playout"),
    ("ffmpeg", "ffmpeg.NOTICE", "FFmpeg", "multimedia"),
    ("tailscale", "tailscale.NOTICE", "Tailscale", "network"),
    ("syncthing", "syncthing.NOTICE", "Syncthing", "sync"),
]:
    eid, fname, name, cat = extra
    if has_file(fname):
        components.append({
            "id": eid,
            "name": name,
            "version": None,
            "licenseId": "See NOTICE",
            "category": cat,
            "isoShipStatus": "see-notice",
            "licenseFile": f"third-party/{fname}",
            "complianceNotes": "Debian copyright file from build host package.",
        })

data = {
    "schemaVersion": 1,
    "generatedAt": generated_at,
    "generator": "tools/release/collect-third-party-licenses.sh",
    "highascgLicense": "AGPL-3.0-or-later",
    "complianceDoc": "licenses/COMPLIANCE-ISO.md",
    "components": components,
}

Path(manifest_path).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
print(f"Wrote {manifest_path} ({len(components)} components)")
PY

# --- INDEX.md ---
python3 - "${LIC}/INDEX.md" "${MANIFEST}" <<'PY'
import json, sys
from pathlib import Path

index_path, manifest_path = sys.argv[1], sys.argv[2]
data = json.loads(Path(manifest_path).read_text())
lines = [
    "# Third-party licenses — HighAsCG ISO / playout stack",
    "",
    f"Generated: **{data['generatedAt']}** by `{data['generator']}`.",
    "",
    "HighAsCG application: **AGPL-3.0-or-later** — see [`LICENSE`](../LICENSE).",
    "",
    "**ISO shipping (NVIDIA / BMD / NDI):** read [`COMPLIANCE-ISO.md`](COMPLIANCE-ISO.md) before distributing images.",
    "",
    "| Component | Version | License | ISO ship | Notice file |",
    "|-----------|---------|---------|----------|-------------|",
]
status_emoji = {"allowed": "OK", "caution": "CAUTION", "see-notice": "see notice"}
for c in data["components"]:
    ver = c.get("version") or "—"
    ship = status_emoji.get(c.get("isoShipStatus"), c.get("isoShipStatus", ""))
    lines.append(
        f"| {c['name']} | {ver} | {c['licenseId']} | {ship} | `{c.get('licenseFile', '')}` |"
    )
lines += [
    "",
    "## Regenerate",
    "",
    "```bash",
    "bash tools/release/collect-third-party-licenses.sh",
    "sudo bash scripts/setup/15-licenses-install.sh",
    "```",
    "",
]
Path(index_path).write_text("\n".join(lines), encoding="utf-8")
print(f"Wrote {index_path}")
PY

log "done — see ${LIC}/INDEX.md and ${LIC}/COMPLIANCE-ISO.md"
