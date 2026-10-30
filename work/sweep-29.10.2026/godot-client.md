# godot/client — sweep 29.10.2026 (batch 039)

Files: 2 · lines: 115 · findings: 0 BUG-HIGH, 0 BUG, 0 DEAD, 0 RISK, 1 QUALITY

## godot/client/run-client.sh
- `QUALITY` godot/client/run-client.sh:23,28,33 — `--test` / `--check` are recognised only as the first argument (`${1:-}`). `run-client.sh --server=x --test` falls through to `exec "$GODOT" --path ... -- --server=x --test` and launches the full GUI client instead of the unit run. Also the Godot lookup list (line 11: `/opt/godot/godot`, macOS app, `PATH`) lacks `$HOME/.local/opt/godot/godot`, which `run-xr.sh:59` searches; a box with Godot only there works for XR but not for the dev/test runner (set `GODOT=` as a workaround). No failing on-air path; dev tooling only.
- `OK` otherwise: `set -euo pipefail` interplay checked (`out=$(...) && rc=0 || rc=$?` and `... && exit 0 || exit $?` are safe under `set -e`); the EXIT trap removes the temp `XDG_DATA_HOME` in the `--test` / `--check` branches (neither uses `exec`), while the normal path `exec`s with no temp dir; the `--check` 45 s bound plus the `rc -eq 124` handling is correct. Referenced `res://tests/run_tests.gd` exists.

## godot/client/run-xr.sh
- `OK` — runtime lookup follows the OpenXR loader order; the `for ... rt="$(runtime)" && break` loops are `set -e` safe (failing command is in an `&&` list); `headset()` pipeline cannot hit a pipefail SIGPIPE false negative (busctl writes its single line before `grep -q` can exit); `XR_WAIT_S=0` skips both waits and starts the desktop walk; `XR_RUNTIME_JSON` is exported only when a runtime was found and the headset connected (else `--xr-mode off`), matching the header comment; the WO-780 `XDG_RUNTIME_DIR` / `DBUS_SESSION_BUS_ADDRESS` fallbacks are guarded for already-set values.
