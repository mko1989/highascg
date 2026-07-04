# WO-121 — CI: enforce 500-line file size limit

> **⚠️ AGENT COLLABORATION PROTOCOL** — see [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)

**Parent:** [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)  
**Status:** Not started  
**Priority:** **Medium** (after most splits land)

**Touches:** `tools/ci/`, `package.json`, `scripts/ci/run-local-ci.sh`, `.github/workflows/` (if present)

---

## 1. Objective

Add an automated check that fails CI when any scoped source file exceeds **500 lines**, matching [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md) policy.

---

## 2. Implementation

### 2.1 Checker script

Create `tools/ci/check-max-file-lines.js`:

```javascript
// Pseudocode — implement in repo
const MAX = parseInt(process.env.HIGHASCG_MAX_FILE_LINES || '500', 10)
const ROOTS = ['client', 'src', 'scripts', 'tools', 'template']
const EXT = new Set(['.js', '.css', '.html', '.sh'])
const SKIP_DIRS = new Set(['node_modules', 'dist-web', 'dist', 'cef-cache'])
// walk, wc-l equivalent, collect violations, exit 1 if any
```

Options:

| Flag / env | Behaviour |
|------------|-----------|
| `HIGHASCG_MAX_FILE_LINES=500` | default limit |
| `--warn-only` | exit 0 but print violations (for transition) |
| `--json` | machine-readable output for agents |

### 2.2 npm scripts

```json
"check:file-lines": "node tools/ci/check-max-file-lines.js",
"check:file-lines:warn": "node tools/ci/check-max-file-lines.js --warn-only"
```

### 2.3 CI integration

1. **Phase 1:** Add to `scripts/ci/run-local-ci.sh` as **warn-only** while WO-112–120 are open.
2. **Phase 2:** Wire into `npm run test:ci` or `npm run ci:local` as **hard fail** when audit shows 0 violations.
3. Document in WO-111 master checklist.

### 2.4 Pre-commit (optional)

Only if `.pre-commit` or existing hook pattern exists — do not invent new hook infra unless requested.

---

## 3. Tasks

- [ ] **T121.0** Implement `tools/ci/check-max-file-lines.js` with roots/extensions from WO-111.
- [ ] **T121.1** Add npm scripts `check:file-lines` and `check:file-lines:warn`.
- [ ] **T121.2** Run warn-only in local CI; confirm it lists current 46 violations.
- [ ] **T121.3** After WO-112–120 complete, switch to hard fail in `ci:local` / GitHub workflow.
- [ ] **T121.4** Update [LOC_OVER_500_AUDIT.md](./LOC_OVER_500_AUDIT.md) generation note (optional: script prints audit markdown).

---

## 4. Verification

```bash
node tools/ci/check-max-file-lines.js --warn-only   # lists violations during transition
node tools/ci/check-max-file-lines.js               # exit 0 when clean
npm run ci:local
```

---

## Work Log

### 2026-07-03 — Created

- **Instructions for Next Agent:** Implement T121.0 first — warn-only mode unblocks tracking split progress without breaking CI.
