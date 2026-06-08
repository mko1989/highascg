# Legacy union persistence (not for production sticks)

Production sticks are **exFAT-only** (`HIGHASCG_EXFAT_ONLY=1`, `finish-operator-stick.sh`).

These scripts support the old **`/ union`** persistence layout (WO_remove-persistence-partition-workflow). Use only with `HIGHASCG_LEGACY_UNION_PERSIST=1`.

| Script | Role |
|--------|------|
| `add-union-persistence-partition.sh` | ext4 persistence after hybrid ISO |
| `prune-hybrid-data-partitions.sh` | Clean re-flashed sticks |
| `build-flash-and-persist.sh` | Interactive build + dd + optional legacy persist |
| `flash-iso-from-config.sh` | Config-driven flash helper |
| `FLASH_AND_PERSIST.md` | Old operator doc |

**Current stick workflow:** `create-operator-stick-from-dd.sh` → `finish-operator-stick.sh` (see `BUILD_AND_FLASH.md` in parent folder).
