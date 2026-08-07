#!/usr/bin/env bash
# Build HIGHASCGDAT-starter-layout.zip — bridge-partition folder tree (WO-456).
# Same idea as pack-exfat-starter-zip.sh but for the internal bridge disk
# (LABEL=HIGHASCGDAT): media library + configs + drops, no boot-time apply role.
#
# Usage:
#   bash tools/eggs/live-usb/pack-bridge-starter-zip.sh
#   bash tools/eggs/live-usb/pack-bridge-starter-zip.sh /path/to/output.zip
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
OUT_ZIP="${1:-${REPO_ROOT}/dist/HIGHASCGDAT-starter-layout.zip}"
STAGE="$(mktemp -d /tmp/highascg-bridge-starter.XXXXXX)"

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

bash "${HERE}/seed-bridge-operator-layout.sh" "$STAGE"
# zip skips empty directories — keep placeholders so operators see the full tree
for d in media configs projects projects/_autosave drop-config drop-update drop-update/applied .private; do
	touch "${STAGE}/${d}/.gitkeep"
done

mkdir -p "$(dirname "$OUT_ZIP")"
rm -f "$OUT_ZIP"
if command -v zip >/dev/null 2>&1; then
	(
		cd "$STAGE"
		zip -r -q "$OUT_ZIP" .
	)
else
	python3 - "$STAGE" "$OUT_ZIP" <<'PY'
import sys, zipfile
from pathlib import Path
stage, out = Path(sys.argv[1]), Path(sys.argv[2])
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
    for p in sorted(stage.rglob("*")):
        if p.is_file():
            zf.write(p, p.relative_to(stage).as_posix())
PY
fi

echo "Created ${OUT_ZIP}"
echo "  Label the partition: mkfs.exfat -L HIGHASCGDAT /dev/sdXN"
echo "  Unzip contents to the volume root"
