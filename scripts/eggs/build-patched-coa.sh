#!/usr/bin/env bash
# WO-870 Phase 0.2(b): build penguins-eggs `coa` (Go) v26.10.30 with the HighAsCG patch
# "space estimate honours the excludes" and repack the official .deb as 26.10.30+highascg1.
#
# Runs as a normal user (casparcg). Never uses sudo, never runs eggs/coa except `coa version`
# on the fresh binary, never runs upstream scripts or Makefiles (`go test` + `go build` only).
# The owner installs the result with the commands printed at the end.
#
# Usage (repo root):
#   bash scripts/eggs/build-patched-coa.sh [OUT_DIR]
#     OUT_DIR  new or empty directory for source + artefacts (default: fresh mktemp -d)
#   EGGS_OFFICIAL_DEB=/path/to/penguins-eggs_26.10.30-1_amd64.deb   (default: ~/Downloads/…)
#
# Needs: git, go >= 1.25 (golang-go), gcc (cgo, like the official build), dpkg-deb, fakeroot.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" # scripts/eggs/ → repo root
UPSTREAM_URL="https://github.com/pieroproietti/penguins-eggs"
UPSTREAM_TAG="v26.10.30"
UPSTREAM_COMMIT="0b5e7fa0c5ce94a57c11711c0b8ccc4c7b5b8447" # tag v26.10.30 (annotated b353478e…)
PATCH="${ROOT}/scripts/eggs/patches/wo870-coa-space-estimate-honours-excludes.patch"
COA_VERSION="v26.10.30+highascg1" # `eggs version` prints "eggs <COA_VERSION>"
DEB_VERSION="26.10.30+highascg1"  # sorts above 26.10.30-1
OFFICIAL_DEB="${EGGS_OFFICIAL_DEB:-${HOME}/Downloads/penguins-eggs_26.10.30-1_amd64.deb}"
OFFICIAL_SHA256="dc29749e3d0c66876ca38b6018678cce0cfbf2929b7f930a21c4e64bea17d90f"

die() {
	echo "build-patched-coa: $*" >&2
	exit 1
}

[[ "$(id -u)" -ne 0 ]] || die "run as a normal user, not root"
for pair in git:git go:golang-go gcc:gcc dpkg-deb:dpkg fakeroot:fakeroot sha256sum:coreutils; do
	command -v "${pair%%:*}" >/dev/null || die "missing ${pair%%:*} — ask the owner to apt install ${pair##*:}"
done
GOVER="$(GOTOOLCHAIN=local go env GOVERSION)" # e.g. go1.26.8
IFS=. read -r gomaj gomin _ <<<"${GOVER#go}"
((gomaj > 1 || (gomaj == 1 && gomin >= 25))) || die "go >= 1.25 needed (have ${GOVER})"
[[ -f "$PATCH" ]] || die "patch not found: $PATCH"
[[ -f "$OFFICIAL_DEB" ]] || die "official deb not found: $OFFICIAL_DEB (download it, see WO-870 §4 A)"
echo "${OFFICIAL_SHA256}  ${OFFICIAL_DEB}" | sha256sum -c --quiet - || die "official deb hash mismatch"

OUT="${1:-$(mktemp -d "${TMPDIR:-/tmp}/highascg-coa-XXXXXX")}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
[[ -z "$(ls -A "$OUT")" ]] || die "OUT_DIR must be new or empty: $OUT"
SRC="${OUT}/src"
export GOTOOLCHAIN=local

echo "==> 1/5 fetch ${UPSTREAM_URL} ${UPSTREAM_TAG} → ${SRC}"
git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$UPSTREAM_TAG" "$UPSTREAM_URL" "$SRC"
HEAD_COMMIT="$(git -C "$SRC" rev-parse HEAD)"
[[ "$HEAD_COMMIT" == "$UPSTREAM_COMMIT" ]] || die "tag ${UPSTREAM_TAG} is ${HEAD_COMMIT}, pinned ${UPSTREAM_COMMIT} — re-review before building"

echo "==> 2/5 apply $(basename "$PATCH")"
git -C "$SRC" apply --check "$PATCH"
git -C "$SRC" apply "$PATCH"

echo "==> 3/5 unit tests (coa/pkg/planner)"
(cd "$SRC/coa" && EGGS_EXCLUDE_LIST_PATH="${OUT}/test-excludes.list" go test -count=1 ./pkg/planner/)

echo "==> 4/5 go build (official flags, version ${COA_VERSION})"
(cd "$SRC/coa" && go build -ldflags "-X 'coa/pkg/cmd.AppVersion=${COA_VERSION}'" -o "${OUT}/coa" main.go)
"${OUT}/coa" version | grep -qF "eggs ${COA_VERSION} " || die "built coa does not report ${COA_VERSION}"

echo "==> 5/5 repack $(basename "$OFFICIAL_DEB") with only usr/bin/coa replaced"
DEB="${OUT}/penguins-eggs_${DEB_VERSION}_amd64.deb"
# One fakeroot session: the extracted tree keeps root:root and the rebuilt archive carries it.
# shellcheck disable=SC2016 # $1..$5 expand inside the fakeroot shell
fakeroot -- bash -euo pipefail -c '
	dpkg-deb -R "$1" "$2"
	install -m 0755 "$3" "$2/usr/bin/coa"
	sed -i "s/^Version: .*/Version: $4/" "$2/DEBIAN/control"
	dpkg-deb -Zxz --build "$2" "$5" >/dev/null
' _ "$OFFICIAL_DEB" "${OUT}/pkgroot" "${OUT}/coa" "$DEB_VERSION" "$DEB"
rm -rf "${OUT}/pkgroot"

# Verify: same file list/modes/owners, control differs only in Version, payload coa is ours.
listing() { dpkg-deb -c "$1" | awk '{ print $1, $2, $6, $7, $8 }'; }
diff <(listing "$OFFICIAL_DEB") <(listing "$DEB") >/dev/null || die "file list differs from the official deb"
CTRL_DIFF="$(diff <(dpkg-deb -f "$OFFICIAL_DEB") <(dpkg-deb -f "$DEB") | grep -c '^[<>]' || true)"
[[ "$CTRL_DIFF" == "2" && "$(dpkg-deb -f "$DEB" Version)" == "$DEB_VERSION" ]] || die "control changed beyond Version"
mkdir "${OUT}/verify"
dpkg-deb -x "$DEB" "${OUT}/verify"
cmp -s "${OUT}/verify/usr/bin/coa" "${OUT}/coa" || die "usr/bin/coa in the deb is not the built binary"
rm -rf "${OUT}/verify"
(cd "$OUT" && sha256sum "$(basename "$DEB")" >"$(basename "$DEB").sha256")

echo
echo "Built: ${DEB}"
echo "       $(cut -d' ' -f1 "${DEB}.sha256")  (sha256, also in $(basename "$DEB").sha256)"
echo
echo "Owner install (run by the owner; this script never does):"
cat <<OWNER
  cd "${OUT}"
  sha256sum -c "$(basename "$DEB").sha256"
  sudo apt-mark unhold penguins-eggs
  sudo apt install "./$(basename "$DEB")"
  sudo apt-mark hold penguins-eggs
  eggs version        # expect: [coa] eggs ${COA_VERSION} - The "master" of remaster
OWNER
