# Device View — GitHub `origin/main` reference snapshot

Pulled for comparison while debugging WO-82 simple-wiring regressions (single-column port layout).

| Field | Value |
|-------|--------|
| Remote | `https://github.com/mko1989/highascg.git` |
| Branch | `main` |
| Commit | `250f3445929677dd9ace72426945cc8c6258dfcc` |
| Date | 2026-06-28 21:30:06 UTC |
| Message | `feat: hot backup robustness, stick produce pipeline, and operator UI expansions` |

## What this tree contains

A read-only copy of **all Device View client code as it exists on GitHub `main`**, with no WO-82 simple-wiring work:

- `client/components/device-view*.js` (29 files)
- `client/styles/09*.css` (entry + split stylesheets)
- `client/lib/device-view*.js` (15 files)
- Layout shell files that affect tab/workspace sizing:
  - `client/styles/01b-layout-panels-workspace.css`
  - `client/styles/02a-workspace-tabs-scenes-preview-host.css`
  - `client/app.js`

## What is **not** on GitHub (local-only WO-82 additions)

These exist only in the working tree under `/home/casparcg/highascg/client/` and are **not** in this reference:

- `client/components/device-view-caspar-render-simple.js`
- `client/components/device-view-caspar-rear-data.js`
- `client/lib/device-view-simple-wiring-prefs.js`
- `client/lib/device-view-refresh.js`

## How this was created

```bash
cd /home/casparcg/highascg
git fetch origin main
# files extracted with: git show origin/main:<path> > work/device-view-github-reference/<path>
```

Do not edit files here — refresh from GitHub when needed:

```bash
git fetch origin main
git show origin/main:client/components/device-view.js > work/device-view-github-reference/client/components/device-view.js
# … repeat for other paths, or re-run the extraction loop from DEVICE_VIEW_SINGLE_COLUMN_INVESTIGATION.md
```
