# WO-111 — File size limit (500 lines): index, audit, and split plan

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Not started  
**Priority:** **Medium** — maintainability, reviewability, agent/CI ergonomics  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md) (restore from git if missing locally)

---

## 1. Policy (normative)

| Rule | Detail |
|------|--------|
| **Hard limit** | No hand-written source file in `client/`, `src/`, `scripts/`, `tools/`, or `template/` may exceed **500 lines** (`wc -l`). |
| **Scope** | `.js`, `.css`, `.html`, `.sh` under those trees. Excludes `node_modules/`, `dist-web/`, generated JSON, project saves. |
| **Split style** | Extract by **concern** (route group, inspector type, modal family, CSS section), not arbitrary chunk size. Re-export from the original path when needed to avoid wide import churn. |
| **No behaviour change** | Splits are refactors only unless a bug is found — preserve public exports and smoke/CI parity. |
| **Enforcement** | [WO-121](./121_WO_CI_ENFORCE_500_LINE_LIMIT.md) adds CI check after splits land. |

---

## 2. Audit snapshot (2026-07-03)

**46 files** over 500 lines after moving the experimental wiki map to `../highascg-wiki-map/`.

| Area | Count | Work order |
|------|------:|------------|
| Device View (client) | 5 | [WO-112](./112_WO_SPLIT_DEVICE_VIEW_OVER_500.md) |
| Timeline + Inspector (client) | 6 | [WO-113](./113_WO_SPLIT_TIMELINE_AND_INSPECTOR_OVER_500.md) |
| Scenes + Preview + Sources (client) | 5 | [WO-114](./114_WO_SPLIT_SCENES_PREVIEW_SOURCES_OVER_500.md) |
| Audio mixer (client) | 2 | [WO-115](./115_WO_SPLIT_AUDIO_MIXER_OVER_500.md) |
| Client CSS | 4 | [WO-116](./116_WO_SPLIT_CLIENT_CSS_OVER_500.md) |
| Server API routes | 5 | [WO-117](./117_WO_SPLIT_SERVER_API_ROUTES_OVER_500.md) |
| Server engine / system / media | 6 | [WO-118](./118_WO_SPLIT_SERVER_ENGINE_AND_SYSTEM_OVER_500.md) |
| Server config / Caspar / replication / utils | 6 | [WO-119](./119_WO_SPLIT_SERVER_CONFIG_AND_CASPAR_OVER_500.md) |
| Scripts, templates, launcher, misc client | 7 | [WO-120](./120_WO_SPLIT_SCRIPTS_TEMPLATES_LAUNCHER_OVER_500.md) |
| CI enforcement | 1 | [WO-121](./121_WO_CI_ENFORCE_500_LINE_LIMIT.md) |

Full line-count table: [LOC_OVER_500_AUDIT.md](./LOC_OVER_500_AUDIT.md)

---

## 3. Recommended execution order

1. **WO-121 scaffold** — add the checker script (warn-only mode first) so progress is measurable.
2. **WO-117 + WO-119** — server routes/config (clear handler boundaries, low UI coupling).
3. **WO-112** — Device View (largest client cluster; many sibling files already exist as split targets).
4. **WO-113 + WO-114** — timeline/scenes (operator-critical; test playback + scene take after each file).
5. **WO-116** — CSS (mechanical `@import` splits).
6. **WO-115, WO-118, WO-120** — remaining files.
7. **WO-121 strict** — flip CI to fail on violations.

---

## 4. Master checklist

- [ ] **T111.0** All sub-WOs linked and audit table current.
- [ ] **T111.1** Zero files > 500 lines in scoped trees (verify with `node tools/ci/check-max-file-lines.js`).
- [ ] **T111.2** `npm run test:ci` and `npm run lint` pass after all splits.
- [ ] **T111.3** Update [LOC_OVER_500_AUDIT.md](./LOC_OVER_500_AUDIT.md) to show **0 violations** or archive it.

---

## 5. Sub-work orders

| WO | Title |
|----|-------|
| [112](./112_WO_SPLIT_DEVICE_VIEW_OVER_500.md) | Split Device View files |
| [113](./113_WO_SPLIT_TIMELINE_AND_INSPECTOR_OVER_500.md) | Split timeline & inspector files |
| [114](./114_WO_SPLIT_SCENES_PREVIEW_SOURCES_OVER_500.md) | Split scenes, preview, sources |
| [115](./115_WO_SPLIT_AUDIO_MIXER_OVER_500.md) | Split audio mixer files |
| [116](./116_WO_SPLIT_CLIENT_CSS_OVER_500.md) | Split client CSS over 500 |
| [117](./117_WO_SPLIT_SERVER_API_ROUTES_OVER_500.md) | Split server API route files |
| [118](./118_WO_SPLIT_SERVER_ENGINE_AND_SYSTEM_OVER_500.md) | Split server engine & system files |
| [119](./119_WO_SPLIT_SERVER_CONFIG_AND_CASPAR_OVER_500.md) | Split server config, Caspar, replication, utils |
| [120](./120_WO_SPLIT_SCRIPTS_TEMPLATES_LAUNCHER_OVER_500.md) | Split scripts, templates, launcher, logs modal |
| [121](./121_WO_CI_ENFORCE_500_LINE_LIMIT.md) | CI enforce 500-line limit |

---

## Work Log

### 2026-07-03 — Planning

- Created WO-111 index and WO-112–121 split plan from post–wiki-map audit (46 files > 500 lines).
- **Instructions for Next Agent:** Start with WO-121 warn-only checker, then WO-117 (`routes-data.js` is the largest route file).
