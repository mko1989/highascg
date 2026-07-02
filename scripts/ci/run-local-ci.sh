#!/usr/bin/env bash
# WO-99 — run the same checks as GitHub Actions locally.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "==> verify:repo-integrity"
npm run verify:repo-integrity

echo "==> clean-clone boot (no-http)"
node index.js --no-http

echo "==> eslint"
npm run lint

echo "==> prettier (CI-scoped)"
npm run format:check

echo "==> test:ci"
npm run test:ci

echo "==> npm audit"
node tools/ci/npm-audit-ci.js

echo "[run-local-ci] OK"
