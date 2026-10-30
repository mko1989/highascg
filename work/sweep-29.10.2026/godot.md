# godot (root files) — sweep 29.10.2026 (batch 044)

Files: 1 · lines: 70 · findings: 0 BUG-HIGH, 0 BUG, 0 DEAD, 1 RISK, 1 QUALITY

## godot/export-client.sh
- `RISK` godot/export-client.sh:49,63 — the script has a `Darwin)` branch (line 24) and the header documents macOS builds, but `mapfile` (bash 4+) and `sha256sum` (GNU coreutils) are used unguarded. On stock macOS (bash 3.2, no `sha256sum`) running it without preset names dies at line 49 with `mapfile: command not found` (set -e), and with names dies after the first successful export at line 63. Exports are only built on the Linux box today (WO-686), so no failing case on the supported path. Fix: `shasum -a 256` fallback and a `while read` loop instead of `mapfile`.
- `QUALITY` godot/export-client.sh:2,57 — header says outputs go to `godot/export/<platform>/`, but the progress line prints `godot/client/$out` where `$out` is `../export/linux/...` (→ `godot/client/../export/...`). Cosmetic. Also `$p` is interpolated unescaped into a sed regex (line 54).
