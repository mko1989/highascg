# WO-311 — Autosave must not recreate a project the factory reset trashed

**Status: OPEN** (explicitly scoped out of 5d01bca)

## Context — reconstructed from disk timestamps 2026-07-21
Factory reset at 11:47:28 correctly trashed projects/tra.json (intact copy:
projects/_trash/tra-1784634439668/). At 11:47:31 a background autosave from the still-open
browser RECREATED projects/tra.json as an empty shell. 5d01bca stopped the autosave destroying
the hardwareConfig slice, but the resurrection itself remains: any autosave whose slug has no
stored project file silently creates one.

## Task
- /api/project/autosave: when no project file exists for the slug AND the slug is not the active
  slug (or the active slug was cleared by reset), reject with a distinct code the client
  understands (e.g. 410 project_gone).
- Client (server-project-sync.js / autosave loop): on project_gone, STOP autosaving, surface one
  toast ("Project was deleted on the server — Save As to keep your local copy"), and do not
  retry until the operator acts.
- Factory reset should also broadcast a reset event the client uses to drop its in-memory
  project state instead of autosaving it back.

## Acceptance
- Repro: create+save project, factory reset with browser open → project file STAYS deleted;
  client shows the toast; no new file within autosave interval (watch mtime).
- Normal autosave of a live project unaffected (existing autosave smokes green).
