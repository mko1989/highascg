# Work Order 105: Dependency vulnerabilities (ws, xlsx) and audit policy

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Draft — confirmed via `npm audit` in 2026-07-02 review
**Priority:** **Medium** — no known active exploit path in our usage, but high-severity advisories
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Touches:** `package.json`, `package-lock.json`, dependency usage of `ws`, `osc` (transitive `ws`), `xlsx`

---

## 1. Problem statement

`npm audit --omit=dev` reports **4 vulnerabilities (3 high, 1 moderate):**

| Package | Advisory | Severity | Fix status |
|---------|----------|----------|-----------|
| `ws` (8.0.0–8.20.1) | Uninitialized memory disclosure (GHSA-58qx-3vcg-4xpx); memory-exhaustion DoS from tiny fragments (GHSA-96hv-2xvq-fx4p) | High | Fixable — bump `ws` |
| `ws` via `osc` (transitive) | same as above; `npm audit fix --force` wants to downgrade `osc` to 2.4.2 (breaking) | High | Needs manual resolution (override, not downgrade) |
| `form-data` (transitive) | (moderate) | Moderate | Bump |
| `xlsx` (all versions) | Prototype pollution (GHSA-4r6h-8v6p-xvw6); ReDoS (GHSA-5pgg-2g8v-p4x9) | High | **No upstream fix** |

`ws` is core (operator + replication WebSocket). `xlsx` is an **optionalDependency** used for lower-third roster import (spreadsheet parsing) — attacker-influenced input (uploaded spreadsheets), which makes the prototype-pollution/ReDoS advisories relevant.

---

## 2. Goal (normative)

1. Direct `ws` updated to a non-vulnerable version; transitive `ws` (under `osc`) resolved without downgrading `osc`.
2. `form-data` transitive bumped.
3. `xlsx` risk mitigated: pin to a maintained source and/or sandbox parsing and validate/limit input; document the residual risk since no upstream fix exists.
4. `npm audit --audit-level=high` passes (or has documented, justified exceptions) and runs in CI (WO-99).

---

## 3. Recommended approach

### 3.1 `ws`
- Bump the direct dependency to the latest 8.x that carries the fix (verify current fixed version at implementation time).
- For the transitive `ws` under `osc`: use an `overrides` entry in `package.json` to force the fixed `ws` **without** touching the `osc` version:
  ```json
  "overrides": { "ws": "^8.<fixed>" }
  ```
  Then re-run `npm audit` to confirm both `ws` paths are clean and smoke-test OSC + WebSocket.

### 3.2 `form-data`
- Resolve via transitive bump / `overrides`; confirm the consumer (busboy/wetransfert path) still works.

### 3.3 `xlsx` (no upstream fix)
- Options, in order of preference:
  1. **Migrate** to a maintained alternative for the roster import (e.g. `exceljs`, or CSV-only import) — removes the advisory entirely. Best long-term.
  2. **Pin** to the SheetJS official CDN/tarball build (the npm `xlsx` is deprecated in favor of their own distribution) and **sandbox** parsing: run it in a worker/child process with a size cap and a parse timeout (ReDoS mitigation), and `Object.freeze(Object.prototype)` / null-proto merge (prototype-pollution mitigation) where results are consumed.
  3. If kept as-is: since it's optional, ensure the feature is off by default and document the risk; validate/limit uploaded spreadsheet size + structure server-side.
- Given roster import handles **user-uploaded files**, prefer option 1 or 2.

### 3.4 Policy / CI
- Wire `npm audit --omit=dev --audit-level=high` into CI (WO-99). For unavoidable advisories with no fix, record an explicit allowlist/justification (e.g. `audit-ci` config) so CI stays green but the exception is visible and reviewed.
- Add a periodic (monthly) dependency review note.

---

## 4. Tasks

- [ ] **T105.0** Bump direct `ws` to fixed version; smoke-test operator + replication WS (`smoke:*` WS tests).
- [ ] **T105.1** `overrides` to force fixed `ws` under `osc`; re-audit; test OSC receive (`smoke:project-fps-network`, OSC listener).
- [ ] **T105.2** Resolve `form-data` transitive; test upload path.
- [ ] **T105.3** Decide `xlsx` strategy (migrate vs pin+sandbox); implement; test roster import with a benign and a malformed spreadsheet.
- [ ] **T105.4** Sandbox + size/time caps for spreadsheet parsing if `xlsx` retained.
- [ ] **T105.5** CI `npm audit --audit-level=high` with documented exceptions (feeds WO-99).
- [ ] **T105.6** Update `package.json` notes / `docs/SECURITY.md` with dependency policy + residual risks.

---

## 5. Acceptance criteria

1. `npm audit --omit=dev` shows no High advisories, or only documented, justified exceptions.
2. Both `ws` resolution paths (direct + via `osc`) are on the fixed version; OSC and WebSocket still work.
3. Roster/spreadsheet import either no longer uses vulnerable `xlsx`, or parses in a sandbox with size/time caps and prototype-pollution guard.
4. CI fails on a newly introduced High-severity dependency (not on the documented exceptions).

---

## 6. Risk notes

- `npm audit fix --force` would downgrade `osc` to 2.4.2 (breaking) — **do not** use it; use `overrides` instead.
- `xlsx` has no clean npm fix; treat the roster-import feature as processing untrusted input regardless of the chosen mitigation.

---

## Work Log

### 2026-07-02 — Initial WO (from `npm audit` in project review)

- Recorded the 4 advisories, the `osc`-downgrade trap, and the no-fix `xlsx` situation with mitigation options.
- **Instructions for Next Agent:** T105.0–T105.2 (`ws`/`form-data` via `overrides`) are straightforward — do first and re-audit. T105.3 (`xlsx`) is the judgement call: recommend migrating roster import off `xlsx` since it handles uploaded files.
