# Project Review 2026-07-02 — Weak Points & Remediation Index

**Purpose:** Index for the weak-point work orders created from the 2026-07-02 full project review (security + server architecture + client UI + repo/dependency hygiene). Each row links to a standalone WO with problem statement, approach, tasks, and acceptance criteria.

**Method:** Security + server + client deep-dive reviews plus direct checks (`git`, `npm audit`, grep counts) on `main @ 70db3ae`, working tree with 89 modified + 23 untracked files.

---

## Remediation work orders

| WO | Title | Severity | Theme |
|----|-------|----------|-------|
| [96](./96_WO_API_WS_AUTHENTICATION.md) | API + WS authentication, loopback bind, CORS/origin lockdown | **Critical** | Security |
| [97](./97_WO_INJECTION_HARDENING.md) | Zip-Slip, sudo wildcards, xrandr shell strings | **High** | Security |
| [98](./98_WO_REPO_INTEGRITY_AND_HYGIENE.md) | Untracked runtime deps, sync-conflict purge, git bloat | **High** | Repo integrity |
| [99](./99_WO_CI_LINT_FORMAT_PIPELINE.md) | CI, lint, and format pipeline | **High** | Process |
| [100](./100_WO_BACKEND_ARCHITECTURE_STATE.md) | appCtx coupling & state consolidation | Medium-High | Backend arch |
| [101](./101_WO_BACKEND_ROBUSTNESS.md) | Error swallowing, persistence durability, shutdown cleanup | **High** | Backend robustness |
| [102](./102_WO_HTTP_WS_ROBUSTNESS.md) | HTTP body limits, WS maxPayload, broadcast backpressure | Medium-High | Backend robustness |
| [103](./103_WO_CLIENT_XSS_HARDENING.md) | Shared dom-escape + innerHTML XSS audit | **High** | Client security |
| [104](./104_WO_CLIENT_CORRECTNESS_PERF.md) | stateStore global, WS reconnect/timeout, redraw throttling | High / Medium | Client correctness |
| [105](./105_WO_DEPENDENCY_VULNERABILITIES.md) | `ws` / `xlsx` advisories + audit policy | Medium | Dependencies |

---

## Suggested execution order

1. **WO-98** (repo boots from a clean clone) — unblocks everything and is fast.
2. **WO-96 + WO-97** (security emergency: auth, bind, CORS, injection) — highest severity.
3. **WO-99** (CI/lint) — locks in WO-98's guardrails and prevents regressions.
4. **WO-101 + WO-102** (backend robustness/limits) — quick high-value wins (global handlers, shutdown, body caps).
5. **WO-103 + WO-104** (client XSS + correctness) — done alongside the server work.
6. **WO-105** (dependencies) — folds into WO-99's CI audit.
7. **WO-100** (architecture refactor) — largest churn; phase it last, but do the live-scene-state race fix (Phase C) early.

---

## Cross-cutting notes

- WO-96 (no auth) is the **amplifier** for many other findings — it turns injection paths and destructive endpoints from "local" into "remote". Prioritize accordingly.
- WO-98 and WO-99 are mutually reinforcing: the require-integrity CI check in WO-99 would have caught the clean-clone boot failure in WO-98.
- Several WOs touch the same files (WO-96/97 → `http-server.js`, `os-config.js`; WO-100/101 → state/persistence). Coordinate edits and land in the sequence above to minimize conflicts.

---

## Work Log

### 2026-07-02 — Remediation complete

- WOs 96–105 landed on `main`; `npm run test:ci` green (89 tests).
- **Instructions for Next Agent:** None required for this review cycle. Optional: push 19+ commits to `origin/main`; T103.5 CSP / T104.7 manual smoke remain nice-to-have.
