#!/usr/bin/env bash
# WO-1022 — put the pinned Caspar build into the tree before the server tarball is packed (CI release job).
#
#   bash tools/release/fetch-pinned-caspar.sh [--pin caspar/PINNED.json] [--dest caspar/bin] [--from FILE]
#
# Reads caspar/PINNED.json, downloads its asset from the `caspar-<sha>` release (gh, or curl on the public URL),
# checks the asset sha256, unpacks it into caspar/bin/ (casparcg, LICENSE, LICENSE-CEF.txt, SOURCE.txt) and checks the
# binary's sha256 and size. Any mismatch or a missing asset exits 1, so the release step fails (verify, godot and
# build-client are separate jobs and stay green). --from uses a local asset file instead of downloading (tests).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PIN="${REPO_ROOT}/caspar/PINNED.json"
DEST="${REPO_ROOT}/caspar/bin"
FROM=""

while [[ $# -gt 0 ]]; do
	case "$1" in
	--pin) PIN="${2:?}"; shift ;;
	--dest) DEST="${2:?}"; shift ;;
	--from) FROM="${2:?}"; shift ;;
	*) echo "Unknown option: $1" >&2; exit 2 ;;
	esac
	shift
done

die() {
	echo "ERROR (WO-1022 pinned Caspar): $*" >&2
	exit 1
}
[[ -f "$PIN" ]] || die "${PIN} missing"
pin() { node -e 'const p=require(process.argv[1]);const v=process.argv[2].split(".").reduce((o,k)=>o?.[k],p);process.stdout.write(v==null?"":String(v))' "$PIN" "$1"; }

TAG="$(pin releaseTag)"
ASSET="$(pin asset)"
ASSET_SHA="$(pin assetSha256)"
BIN_SHA="$(pin binarySha256)"
BIN_SIZE="$(pin binarySize)"
REPO="$(pin releaseUrl | sed -E 's#^https://github.com/([^/]+/[^/]+)/.*#\1#')"
[[ -n "$TAG" && -n "$ASSET" && -n "$ASSET_SHA" && -n "$BIN_SHA" && -n "$REPO" ]] || die "${PIN} lacks releaseTag/asset/sha256 fields"
[[ "$ASSET" =~ ^casparcg-[0-9a-f]+-linux-x64\.tar\.(zst|gz)$ ]] || die "unexpected asset name ${ASSET}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
if [[ -n "$FROM" ]]; then
	cp "$FROM" "${WORK}/${ASSET}"
elif command -v gh >/dev/null 2>&1 && gh release download "$TAG" --repo "$REPO" --pattern "$ASSET" --dir "$WORK" 2>/dev/null; then
	:
else
	curl -fsSL --retry 3 -o "${WORK}/${ASSET}" "https://github.com/${REPO}/releases/download/${TAG}/${ASSET}" ||
		die "cannot download ${ASSET} from release ${TAG} of ${REPO} — publish it first: tools/release/publish-caspar-build.sh"
fi
GOT="$(sha256sum "${WORK}/${ASSET}" | cut -d' ' -f1)"
[[ "$GOT" == "$ASSET_SHA" ]] || die "${ASSET} sha256 ${GOT} ≠ pinned ${ASSET_SHA}"

mkdir -p "${WORK}/x"
case "$ASSET" in
*.zst) tar -I zstd -xf "${WORK}/${ASSET}" -C "${WORK}/x" ;;
*) tar -xzf "${WORK}/${ASSET}" -C "${WORK}/x" ;;
esac
[[ -f "${WORK}/x/casparcg" && -f "${WORK}/x/LICENSE" ]] || die "${ASSET} lacks casparcg or LICENSE"
GOT="$(sha256sum "${WORK}/x/casparcg" | cut -d' ' -f1)"
[[ "$GOT" == "$BIN_SHA" ]] || die "casparcg sha256 ${GOT} ≠ pinned ${BIN_SHA}"
[[ -z "$BIN_SIZE" || "$(stat -c %s "${WORK}/x/casparcg")" == "$BIN_SIZE" ]] || die "casparcg size ≠ pinned ${BIN_SIZE}"

mkdir -p "$DEST"
cp -f "${WORK}/x/"* "$DEST/"
chmod 0755 "${DEST}/casparcg"
echo "==> pinned Caspar $(pin version) → ${DEST}/casparcg (sha256 ${BIN_SHA:0:16}…)"
