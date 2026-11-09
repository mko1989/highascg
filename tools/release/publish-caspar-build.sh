#!/usr/bin/env bash
# WO-1022 — publish a hand-built Caspar binary (+ its complete source) as GitHub release `caspar-<sha>` and pin it in
# caspar/PINNED.json, so every server release carries it (CI: tools/release/fetch-pinned-caspar.sh).
#
# Usage (repo root, on the box that built it):
#   bash tools/release/publish-caspar-build.sh <binary> [--dry-run] [--src DIR] [--lib DIR] [--remote NAME]
#        [--build-script FILE] [--cef-license FILE] [--out-dir DIR] [--pin FILE]
#
#   <binary>        the build, e.g. ~/caspar-build/build-26/shell/casparcg (or the deployed ~/highascg/bin/casparcg)
#   --src           the Caspar git tree it was built from (default ~/caspar-build/src-v2, branch highascg-main)
#   --lib           the lib/ it runs against (default ~/highascg/lib: CEF + noble compat libs)
#   --remote        the public fork remote in --src (default highascg = github.com/mko1989/casparcg-server)
#   --build-script  added to the source tarball as HIGHASCG-BUILD.sh (default ~/caspar-build/build-26.sh)
#   --cef-license   CEF's LICENSE.txt (the binary links libcef_dll_wrapper statically; default: next to the build)
#   --dry-run       everything (checks, archives, PINNED.json, notes) except the GitHub upload
#
# Checks, each fatal: the binary embeds "<version> <sha9> " for the --src HEAD; --src is clean; ldd against --lib
# resolves everything but libcef.so; the commit is on <remote>/highascg-main and tag highascg-<sha9> points at it
# (git ls-remote; the commands to fix it are printed — this script never pushes).
#
# Assets: casparcg-<sha9>-linux-x64.tar.zst (.tar.gz without zstd): casparcg, LICENSE (GPL-3.0), LICENSE-CEF.txt,
# SOURCE.txt — and casparcg-source-<sha9>.tar.gz: `git archive` of the exact commit + the build script. Both are
# reproducible byte for byte (fixed mtime/owner/order), so a dry run writes the same PINNED.json as the real one.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=release-lib.sh
source "${SCRIPT_DIR}/release-lib.sh"
REPO_ROOT="$(release_lib_repo_root)"

BINARY=""
SRC="${HOME}/caspar-build/src-v2"
LIB="${HOME}/highascg/lib"
REMOTE=highascg
BUILD_SCRIPT="${HOME}/caspar-build/build-26.sh"
CEF_LICENSE=""
OUT_DIR="${REPO_ROOT}/dist/caspar"
PIN="${REPO_ROOT}/caspar/PINNED.json"
DRY_RUN=0
GH_REPO="mko1989/highascg"

die() {
	echo "ERROR: $*" >&2
	exit 1
}
usage() {
	sed -n '2,/^set -euo/p' "$0" | head -n -1 | sed 's/^# \{0,1\}//'
	exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
	-h | --help) usage 0 ;;
	--dry-run) DRY_RUN=1 ;;
	--src) SRC="${2:?}"; shift ;;
	--lib) LIB="${2:?}"; shift ;;
	--remote) REMOTE="${2:?}"; shift ;;
	--build-script) BUILD_SCRIPT="${2:?}"; shift ;;
	--cef-license) CEF_LICENSE="${2:?}"; shift ;;
	--out-dir) OUT_DIR="${2:?}"; shift ;;
	--pin) PIN="${2:?}"; shift ;;
	-*) echo "Unknown option: $1" >&2; usage 1 ;;
	*) BINARY="$1" ;;
	esac
	shift
done

[[ -n "$BINARY" && -f "$BINARY" ]] || die "binary missing: '${BINARY}' (usage: $0 <binary> [--dry-run])"
BINARY="$(readlink -f "$BINARY")"
git -C "$SRC" rev-parse --git-dir >/dev/null 2>&1 || die "--src ${SRC} is not a git tree"
for c in sha256sum strings ldd tar gzip node git; do release_lib_need_cmd "$c"; done

SHA="$(git -C "$SRC" rev-parse HEAD)"
SHORT="${SHA:0:9}"
SRC_TAG="highascg-${SHORT}"
TAG="caspar-${SHORT}"
DESCRIBE="$(git -C "$SRC" describe --tags --match 'v*' "$SHA")"
BASE="${DESCRIBE%-*-g*}"
COMMIT_TIME="$(git -C "$SRC" log -1 --format=%ct "$SHA")"
REMOTE_URL="$(git -C "$SRC" remote get-url "$REMOTE" 2>/dev/null)" || die "--src has no remote '${REMOTE}'"
FORK_URL="${REMOTE_URL%.git}"
echo "==> source ${SRC} @ ${SHORT} (${DESCRIBE}), fork ${FORK_URL}"

# 1. The binary is that commit. Never run it to ask: `casparcg --version` is not a flag, Caspar reads it as the config
#    path and starts a server when such a file exists. Its version line is a plain string in .rodata.
VERSION="$(strings -n 6 "$BINARY" | grep -m1 -E "^[0-9]+\.[0-9]+\.[0-9]+ ${SHORT} " || true)"
[[ -n "$VERSION" ]] || die "${BINARY} does not embed '<x.y.z> ${SHORT} …' — it was not built from ${SRC} HEAD"
echo "==> binary VERSION: ${VERSION}"

# 2. Corresponding source = the tree as committed.
DIRTY="$(git -C "$SRC" status --porcelain --untracked-files=no)"
[[ -z "$DIRTY" ]] || die "${SRC} has uncommitted changes; the source tarball would not match the binary:
${DIRTY}"

# 3. Libraries: everything resolves against the lib/ a box carries (libcef.so is allowed to be missing only when --lib
#    has none; the installer re-checks against each box's own lib/).
MISSING="$(LD_LIBRARY_PATH="$LIB" ldd "$BINARY" | grep 'not found' | grep -v 'libcef\.so' || true)"
[[ -z "$MISSING" ]] || die "unresolved libraries with LD_LIBRARY_PATH=${LIB}:
${MISSING}"
[[ -f "${LIB}/libcef.so" ]] || die "${LIB}/libcef.so missing — the pin records its sha256"
LIBCEF_SHA="$(sha256sum "${LIB}/libcef.so" | cut -d' ' -f1)"
CEF_VERSION="$(grep -oE 'cef_binary_[0-9][^ /]*_linux64' "${SRC}/src/CMakeModules/Bootstrap_Linux.cmake" | head -n1 |
	sed -e 's/^cef_binary_//' -e 's/_linux64$//' -e 's/%2B/+/g')"
echo "==> ldd OK against ${LIB}; libcef.so ${LIBCEF_SHA:0:16}… (CEF ${CEF_VERSION:-?})"

# 4. The public fork has the commit (on highascg-main) and the tag highascg-<sha9>.
FIX=()
REMOTE_MAIN="$(git -C "$SRC" ls-remote --heads "$REMOTE" highascg-main | cut -f1)"
if [[ -z "$REMOTE_MAIN" ]]; then
	FIX+=("git -C ${SRC} push ${REMOTE} highascg-main")
elif [[ "$REMOTE_MAIN" != "$SHA" ]] && ! git -C "$SRC" merge-base --is-ancestor "$SHA" "$REMOTE_MAIN" 2>/dev/null; then
	FIX+=("git -C ${SRC} fetch ${REMOTE}   # then, if ${SHORT} is still not on ${REMOTE}/highascg-main:"
		"git -C ${SRC} push ${REMOTE} ${SHA}:refs/heads/highascg-main")
fi
REMOTE_TAG="$(git -C "$SRC" ls-remote --tags "$REMOTE" "refs/tags/${SRC_TAG}^{}" "refs/tags/${SRC_TAG}" |
	sort -k2 -r | head -n1 | cut -f1)"
if [[ "$REMOTE_TAG" != "$SHA" ]]; then
	[[ -n "$REMOTE_TAG" ]] && echo "remote tag ${SRC_TAG} points at ${REMOTE_TAG}, not ${SHA}" >&2
	git -C "$SRC" rev-parse -q --verify "refs/tags/${SRC_TAG}" >/dev/null ||
		FIX+=("git -C ${SRC} tag -a ${SRC_TAG} -m \"HighAsCG Caspar build ${VERSION}\" ${SHA}")
	FIX+=("git -C ${SRC} push ${REMOTE} refs/tags/${SRC_TAG}")
fi
if ((${#FIX[@]})); then
	echo "ERROR: the source is not public at ${FORK_URL} yet. Run, then retry:" >&2
	printf '  %s\n' "${FIX[@]}" >&2
	exit 1
fi
echo "==> ${FORK_URL}: highascg-main contains ${SHORT}; tag ${SRC_TAG} → ${SHORT}"

# 5. Archives (reproducible).
mkdir -p "$OUT_DIR"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# shellcheck disable=SC2054 # --mode takes a comma list
TAR_FIXED=(--sort=name --mtime="@${COMMIT_TIME}" --owner=0 --group=0 --numeric-owner --mode=u+rwX,go+rX,go-w)
STAGE="${WORK}/bin"
mkdir -p "$STAGE"
install -m 0755 "$BINARY" "${STAGE}/casparcg"
cp "${SRC}/LICENSE" "${STAGE}/LICENSE"
if [[ -z "$CEF_LICENSE" ]]; then
	CEF_LICENSE="$(dirname "$(dirname "$BINARY")")/cef-prefix/src/cef/LICENSE.txt"
	[[ -f "$CEF_LICENSE" ]] || CEF_LICENSE="$(ls -1 "${HOME}"/caspar-build/build*/cef-prefix/src/cef/LICENSE.txt 2>/dev/null | head -n1)"
fi
[[ -f "$CEF_LICENSE" ]] || die "CEF LICENSE.txt not found (pass --cef-license)"
cp "$CEF_LICENSE" "${STAGE}/LICENSE-CEF.txt"
SRC_ASSET="casparcg-source-${SHORT}.tar.gz"
cat >"${STAGE}/SOURCE.txt" <<EOF
CasparCG Server ${VERSION} — the HighAsCG build. License: GNU GPL v3 or later (LICENSE).
It links the Chromium Embedded Framework wrapper statically (BSD, LICENSE-CEF.txt) and loads libcef.so
(CEF ${CEF_VERSION}) and the system FFmpeg (Ubuntu's build, --enable-gpl) at run time.

Complete corresponding source:
  ${FORK_URL}/tree/${SRC_TAG}   (commit ${SHA}, ${DESCRIBE})
  ${SRC_ASSET} next to this file in https://github.com/${GH_REPO}/releases/tag/${TAG}
Upstream: https://github.com/CasparCG/server (${BASE}). Build: HIGHASCG-BUILD.sh in the source tarball.
EOF
if command -v zstd >/dev/null 2>&1; then
	ASSET="casparcg-${SHORT}-linux-x64.tar.zst"
	tar "${TAR_FIXED[@]}" -C "$STAGE" -cf - . | zstd -q -19 -T1 >"${OUT_DIR}/${ASSET}"
else
	ASSET="casparcg-${SHORT}-linux-x64.tar.gz"
	tar "${TAR_FIXED[@]}" -C "$STAGE" -cf - . | gzip -n -9 >"${OUT_DIR}/${ASSET}"
fi
git -C "$SRC" archive --format=tar --prefix="casparcg-source-${SHORT}/" -o "${WORK}/src.tar" "$SHA"
if [[ -f "$BUILD_SCRIPT" ]]; then
	mkdir -p "${WORK}/extra/casparcg-source-${SHORT}"
	cp "$BUILD_SCRIPT" "${WORK}/extra/casparcg-source-${SHORT}/HIGHASCG-BUILD.sh"
	tar "${TAR_FIXED[@]}" -C "${WORK}/extra" -rf "${WORK}/src.tar" "casparcg-source-${SHORT}/HIGHASCG-BUILD.sh"
else
	echo "WARN: build script ${BUILD_SCRIPT} missing — not in the source tarball" >&2
fi
gzip -n -9 <"${WORK}/src.tar" >"${OUT_DIR}/${SRC_ASSET}"
for a in "$ASSET" "$SRC_ASSET"; do release_lib_check_asset_size "$a" "${OUT_DIR}/${a}"; done

hash_of() { sha256sum "$1" | cut -d' ' -f1; }
P_BIN_SHA="$(hash_of "$BINARY")"
P_BIN_SIZE="$(stat -c %s "$BINARY")"
P_ASSET_SHA="$(hash_of "${OUT_DIR}/${ASSET}")"
P_ASSET_SIZE="$(stat -c %s "${OUT_DIR}/${ASSET}")"
P_SRC_SHA="$(hash_of "${OUT_DIR}/${SRC_ASSET}")"
P_OS="$(. /etc/os-release && echo "$PRETTY_NAME")"
export PIN_JSON="$PIN" P_VERSION="$VERSION" P_SHA="$SHA" P_SHORT="$SHORT" P_TAG="$TAG" P_ASSET="$ASSET" \
	P_BIN_SHA P_BIN_SIZE P_ASSET_SHA P_ASSET_SIZE P_SRC_ASSET="$SRC_ASSET" P_SRC_SHA P_BASE="$BASE" \
	P_DESCRIBE="$DESCRIBE" P_FORK="$FORK_URL" P_SRC_TAG="$SRC_TAG" P_CEF="$CEF_VERSION" P_CEF_SHA="$LIBCEF_SHA" \
	P_REPO="$GH_REPO" P_OS
node <<'NODE'
const e = process.env
const pin = {
	wo: 'WO-1022',
	note: 'The Caspar build every server release carries. Written by tools/release/publish-caspar-build.sh; do not edit by hand.',
	version: e.P_VERSION,
	sha: e.P_SHA,
	shortSha: e.P_SHORT,
	binarySha256: e.P_BIN_SHA,
	binarySize: Number(e.P_BIN_SIZE),
	releaseTag: e.P_TAG,
	releaseUrl: `https://github.com/${e.P_REPO}/releases/tag/${e.P_TAG}`,
	asset: e.P_ASSET,
	assetSha256: e.P_ASSET_SHA,
	assetSize: Number(e.P_ASSET_SIZE),
	tarballPath: 'caspar/bin/casparcg',
	builtOn: e.P_OS,
	cefVersion: e.P_CEF,
	libcefSha256: e.P_CEF_SHA,
	license: 'GPL-3.0-or-later (LICENSE in the asset); CEF wrapper BSD-3-Clause (LICENSE-CEF.txt)',
	source: {
		base: e.P_BASE,
		commit: e.P_SHA,
		describe: e.P_DESCRIBE,
		repo: e.P_FORK,
		tag: e.P_SRC_TAG,
		treeUrl: `${e.P_FORK}/tree/${e.P_SRC_TAG}`,
		sourceAsset: e.P_SRC_ASSET,
		sourceAssetSha256: e.P_SRC_SHA,
		patches: 'caspar/patches/ (human-readable series; the tarball and the tag are the authoritative source)',
	},
}
require('fs').writeFileSync(e.PIN_JSON, `${JSON.stringify(pin, null, '\t')}\n`)
NODE
echo "==> ${PIN} → ${SHORT}"

NOTES="${OUT_DIR}/caspar-${SHORT}-notes.md"
cat >"$NOTES" <<EOF
## CasparCG Server ${VERSION} — HighAsCG build

The Caspar binary HighAsCG server releases carry (\`caspar/bin/casparcg\`, pinned by \`caspar/PINNED.json\`, WO-1022).
Built on ${P_OS} from \`${DESCRIBE}\`; RUNPATH \`\$ORIGIN/../lib\` (CEF ${CEF_VERSION} + compat libs from the box's \`lib/\`).

| Asset | What |
|-------|------|
| \`${ASSET}\` | \`casparcg\` (sha256 \`${P_BIN_SHA}\`), LICENSE (GPL-3.0), LICENSE-CEF.txt, SOURCE.txt |
| \`${SRC_ASSET}\` | **Complete corresponding source**: \`git archive\` of ${SHA} + the build script (HIGHASCG-BUILD.sh) |

**Source:** [${FORK_URL}/tree/${SRC_TAG}](${FORK_URL}/tree/${SRC_TAG}) (fork of [CasparCG/server](https://github.com/CasparCG/server), base \`${BASE}\`).
License: GNU GPL v3 or later. HighAsCG's own patch list: \`caspar/README.md\` in [${GH_REPO}](https://github.com/${GH_REPO}).
EOF

if [[ "$DRY_RUN" -eq 1 ]]; then
	echo "[dry-run] would publish release ${TAG} on ${GH_REPO} (prerelease, never Latest) with:"
	ls -l "${OUT_DIR}/${ASSET}" "${OUT_DIR}/${SRC_ASSET}" | sed 's/^/  /'
	echo "[dry-run] notes (${NOTES}):"
	cat "$NOTES"
	exit 0
fi

release_lib_check_gh
cd "$REPO_ROOT"
if gh release view "$TAG" --repo "$GH_REPO" >/dev/null 2>&1; then
	gh release upload "$TAG" --repo "$GH_REPO" --clobber "${OUT_DIR}/${ASSET}" "${OUT_DIR}/${SRC_ASSET}"
	gh release edit "$TAG" --repo "$GH_REPO" --notes-file "$NOTES"
else
	# Prerelease: never "Latest", and prune-auto-releases.sh only touches releases carrying a highascg-server_ tarball.
	gh release create "$TAG" --repo "$GH_REPO" --prerelease --title "CasparCG ${VERSION} (HighAsCG build)" \
		--notes-file "$NOTES" "${OUT_DIR}/${ASSET}" "${OUT_DIR}/${SRC_ASSET}"
fi
echo "Release: https://github.com/${GH_REPO}/releases/tag/${TAG}"
echo "Next: commit caspar/PINNED.json — the next server release carries ${SHORT}."
