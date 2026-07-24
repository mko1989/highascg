#!/usr/bin/env bash
# Build and install the HighAsCG Companion connection module, and repoint instances
# pinned to a moduleVersionId that no longer exists on disk (Companion v5 pins the
# exact version; a stale pin after an upgrade = instance fails to load = dead desk).
#
# Safe sequence (the db must not be patched under a RUNNING Companion):
#   sudo systemctl stop companion && ./install-companion-module.sh && sudo systemctl start companion
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
TGZ="$(ls -1t "${MODULE_SRC}"/highpass-highascg-*.tgz | head -1)"
if [[ -z "${TGZ}" || ! -f "${TGZ}" ]]; then
	echo "No packaged highpass-highascg-*.tgz found in ${MODULE_SRC}" >&2
	exit 1
fi

rm -rf "${MODULES_DIR}/highpass-highascg" "${MODULES_DIR}"/highpass-highascg-*
mkdir -p "${MODULES_DIR}"
tar -xzf "${TGZ}" -C "${MODULES_DIR}/"

NEW_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' \
	"${MODULES_DIR}/highpass-highascg/package.json")"
echo "Installed module version: ${NEW_VERSION}"

if [[ -f "${DB}" ]]; then
	if systemctl is-active --quiet companion 2>/dev/null && [[ "${COMPANION_ALLOW_LIVE_DB:-0}" != "1" ]]; then
		echo "WARNING: Companion is RUNNING — skipping the instance version-pin fix." >&2
		echo "Stop it first (sudo systemctl stop companion), rerun, then start it —" >&2
		echo "otherwise an instance pinned to an older version will fail to load." >&2
	else
		python3 - "${DB}" "${NEW_VERSION}" <<'PY'
import json, sqlite3, sys

dbpath, new_ver = sys.argv[1], sys.argv[2]
db = sqlite3.connect(dbpath)
cur = db.cursor()
cur.execute("SELECT id, value FROM instances")
changed = 0
for iid, raw in cur.fetchall():
    val = json.loads(raw)
    if val.get("moduleId") != "highpass-highascg":
        continue
    ver = val.get("moduleVersionId")
    # Repoint anything not matching what is now on disk ("dev", an old release, or unset).
    if ver != new_ver:
        val["moduleVersionId"] = new_ver
        cur.execute("UPDATE instances SET value=? WHERE id=?", (json.dumps(val), iid))
        changed += 1
        print(f"Updated instance {val.get('label', iid)!r}: moduleVersionId {ver!r} -> {new_ver!r}")
db.commit()
if not changed:
    print("No highpass-highascg instances needed a moduleVersionId fix")
PY
	fi
else
	echo "Note: ${DB} not found — module installed; Companion will create config on first start"
fi

echo ""
echo "Installed: ${MODULES_DIR}/highpass-highascg/ (v${NEW_VERSION})"
echo "Restart Companion: sudo systemctl restart companion"
echo "Verify: journalctl -u companion --since '1 min ago' | grep -i highpass"
