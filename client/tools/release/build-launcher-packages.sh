#!/usr/bin/env bash
# Build multi-platform Electron launcher folders under dist/launcher-pack/.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./release-lib.sh
source "${SCRIPT_DIR}/release-lib.sh"

REPO_ROOT="$(release_lib_repo_root)"
LAUNCHER_DIR="${REPO_ROOT}/client/tools/electron-launcher"
PACK_OUT="${1:-${REPO_ROOT}/dist/launcher-pack}"
SKIP_PREPARE="${SKIP_PREPARE:-0}"
INSTALL_SIM_DEPS="${INSTALL_SIM_DEPS:-1}"

release_lib_need_cmd node
release_lib_need_cmd npx

if [[ "$SKIP_PREPARE" -eq 0 ]]; then
	echo "==> launcher:prepare (Vite + dist-web + bundle + sim-server)"
	(cd "$REPO_ROOT" && npm run launcher:prepare)
fi

REQUIRED=(
	"${LAUNCHER_DIR}/dist-web/index.html"
	"${LAUNCHER_DIR}/lib/webui-port.cjs"
	"${LAUNCHER_DIR}/lib/webui-port.json"
	"${LAUNCHER_DIR}/portable-sim/launch-sim-from-exfat.cjs"
	"${LAUNCHER_DIR}/portable-sim/sim-app-root.cjs"
	"${LAUNCHER_DIR}/sim-server/index.js"
	"${LAUNCHER_DIR}/sim-server/package.json"
)
for f in "${REQUIRED[@]}"; do
	if [[ ! -f "$f" ]]; then
		echo "Missing packaged launcher file: $f" >&2
		echo "Run: npm run launcher:prepare (needs not-needed/index.js for sim-server)" >&2
		exit 1
	fi
done

if [[ "$INSTALL_SIM_DEPS" -eq 1 ]]; then
	echo "==> npm install in sim-server (bundled for offline sim; uses Electron as Node at runtime)"
	(cd "$REPO_ROOT" && npm run launcher:sim-install)
fi

if [[ ! -d "${LAUNCHER_DIR}/sim-server/node_modules" ]]; then
	echo "Missing ${LAUNCHER_DIR}/sim-server/node_modules — simulation will not work in the zip." >&2
	exit 1
fi

ELECTRON_VER="$(node -e "console.log(require('${REPO_ROOT}/node_modules/electron/package.json').version)")"
echo "==> @electron/packager (electron ${ELECTRON_VER})"
mkdir -p "$PACK_OUT"
rm -rf "${PACK_OUT:?}/"*

# Native addons in sim-server (e.g. dmxnet) must not live only inside asar.
npx --yes @electron/packager@18.3.5 "$LAUNCHER_DIR" HighAsCG-Launcher \
	--out="$PACK_OUT" \
	--overwrite \
	--electron-version="$ELECTRON_VER" \
	--platform=darwin,linux,win32 \
	--arch=x64,arm64 \
	--darwin-dark-mode-support \
	--prune=true \
	--asar.unpack="{**/*.node,**/*.dll,**/sim-server/**}"

echo "==> Packaged apps (no system Node.js required for the GUI):"
find "$PACK_OUT" -maxdepth 1 -mindepth 1 -type d -print
