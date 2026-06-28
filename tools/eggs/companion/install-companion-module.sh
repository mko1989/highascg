#!/usr/bin/env bash
# Build and install the HighAsCG Companion connection module, and fix instances
# stuck on moduleVersionId "dev" (requires --extra-module-path at runtime).
set -euo pipefail

MODULE_SRC="${COMPANION_MODULE_SRC:-/home/casparcg/companion-module-dev/companion-module-highpass-highascg}"
MODULES_DIR="${MODULES_DIR:-/home/casparcg/.config/companion/modules}"
DB="${COMPANION_DB:-/home/casparcg/.config/companion/v5.0/db.sqlite}"

if [[ ! -d "${MODULE_SRC}" ]]; then
	echo "Module source not found: ${MODULE_SRC}" >&2
	exit 1
fi

cd "${MODULE_SRC}"
npm run package
TGZ="${MODULE_SRC}/highpass-highascg-1.0.1.tgz"
if [[ ! -f "${TGZ}" ]]; then
	TGZ="$(ls -1t "${MODULE_SRC}"/highpass-highascg-*.tgz | head -1)"
fi

rm -rf "${MODULES_DIR}/highpass-highascg" "${MODULES_DIR}"/highpass-highascg-*
mkdir -p "${MODULES_DIR}"
tar -xzf "${TGZ}" -C "${MODULES_DIR}/"

if [[ -f "${DB}" ]]; then
	python3 - "${DB}" <<'PY'
import json, sqlite3, sys

dbpath = sys.argv[1]
db = sqlite3.connect(dbpath)
cur = db.cursor()
cur.execute("SELECT id, value FROM instances")
changed = 0
for iid, raw in cur.fetchall():
    val = json.loads(raw)
    if val.get("moduleId") != "highpass-highascg":
        continue
    ver = val.get("moduleVersionId")
    if ver in (None, "dev"):
        val["moduleVersionId"] = "1.0.1"
        cur.execute("UPDATE instances SET value=? WHERE id=?", (json.dumps(val), iid))
        changed += 1
        print(f"Updated instance {val.get('label', iid)!r}: moduleVersionId dev -> 1.0.1")
db.commit()
if not changed:
    print("No highpass-highascg instances needed moduleVersionId fix")
PY
else
	echo "Note: ${DB} not found — module installed; Companion will create config on first start"
fi

echo ""
echo "Installed: ${MODULES_DIR}/highpass-highascg/"
echo "Restart Companion: sudo systemctl restart companion"
echo "Verify: journalctl -u companion --since '1 min ago' | grep -i highpass"
