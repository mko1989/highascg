# scripts/ci — sweep 29.10.2026 (batch 050)

Files: 1 · lines: 32 · findings: 0 BUG-HIGH, 0 BUG, 0 DEAD, 0 RISK, 2 QUALITY

## scripts/ci/run-local-ci.sh
- `QUALITY` scripts/ci/run-local-ci.sh:2 — the header says "the same checks as GitHub Actions", but `.github/workflows/ci.yml` also runs a `godot` job (shm seqlock C++ test, bridge to probe round-trip, Godot client unit tests, client boot check, lines 64-96) and a `build-client` job that this script skips. Failing case: a change to `caspar/modules/shm/` or `godot/client/` passes `npm run ci:local` and goes red in CI. The Node steps and their order match (repo-integrity, max-lines, unwired exports, boot, eslint, prettier, test:ci, audit). Fix: say "the Node job" in the header, or add the C++/Godot steps when `c++` / `$GODOT` exist.
- `QUALITY` scripts/ci/run-local-ci.sh:26-27 — CI runs `xvfb-run -a npm run test:ci`; the local script runs `npm run test:ci` bare. On a box with the operator display this tests against the real GPU/display (see the operator-display note: one connected monitor changes the auto-single operator port and fails 3 suite tests). Live: `package.json:29` (`ci:local`).
