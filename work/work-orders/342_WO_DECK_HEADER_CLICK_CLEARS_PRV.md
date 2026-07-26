# WO-342 — clicking the screen deck header's empty space clears that screen's PRV

**Source:** owner 2026-07-26 — "clicking the top bar of the screen's look's empty space should also clear this screen's prv."

**Status: OPEN.**

## Fix direction
The per-screen deck header (the "S1 [FTB] ⏱" bar rendered by the scene deck column) gets a
click handler on its EMPTY area (not the FTB/timer/global-border controls): clear that main's
preview — the existing clear path is `clearPreviewBusForMain` (client) / the server preview clear
`POST /api/scene/live/preview/clear` (src/api/routes-scene-preview.js:73 `handlePreviewLiveClear`,
already awaited+broadcasting). Also clear `previewSceneIdByMain[mIdx]` so the deck highlight drops.
Guard: ignore clicks on child controls (`e.target === header` or closest-check), and do nothing
while a look from this screen is being edited.

## Acceptance
Click empty header space → PRV bus for that screen clears (Caspar layers + highlight) on ALL
clients within one broadcast; FTB/timer buttons unaffected; no clear during edit sessions.
