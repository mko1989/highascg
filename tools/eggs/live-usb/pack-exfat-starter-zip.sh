#!/usr/bin/env bash
# Build HIGHASCGEXF-starter-layout.zip — operator folder tree + factory configs + starter show.
#
# Usage:
#   bash tools/eggs/live-usb/pack-exfat-starter-zip.sh
#   bash tools/eggs/live-usb/pack-exfat-starter-zip.sh /path/to/output.zip
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
OUT_ZIP="${1:-${REPO_ROOT}/dist/HIGHASCGEXF-starter-layout.zip}"
STAGE="$(mktemp -d /tmp/highascg-exfat-starter.XXXXXX)"

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

bash "${HERE}/seed-exfat-operator-layout.sh" "$STAGE"
node "${HERE}/write-exfat-starter-bundle.js" "$STAGE"
# zip skips empty directories — keep placeholders so operators see the full tree
for d in drop-config media templates "snapshots/rear-panels" drop-update/applied; do
	touch "${STAGE}/${d}/.gitkeep"
done

cat >"${STAGE}/README.txt" <<'EOF'
HighAsCG operator exFAT layout (volume label must be HIGHASCGEXF)

Copy the contents of this zip onto the exFAT partition (not inside an extra folder).

Folders:
  drop-update/     Server hotfix drops (extract highascg-server_*.tar.gz here)
  drop-config/     Optional monolithic highascg.config.json overlay
  configs/         Modular settings + .highascg-state.json (starter show included)
  media/           Playout media library
  templates/       Caspar HTML/templates
  snapshots/rear-panels/  Rear-panel snapshots

Boot order on the playout machine:
  mount HIGHASCGEXF → apply drop-update/ → sync configs/ → start highascg.service

See docs/WO47_ISO_VS_EXFAT.md and docs/EXFAT_SERVER_UPDATE.md in the HighAsCG repo.
EOF

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
echo "  Label the partition: mkfs.exfat -L HIGHASCGEXF /dev/sdXN"
echo "  Unzip contents to the volume root (e.g. mount -L HIGHASCGEXF /mnt && unzip -d /mnt ...)"
