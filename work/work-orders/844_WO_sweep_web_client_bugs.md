# WO-844 — Sweep: web client bugs

**Status: OPEN (30.10)**
**Source:** code sweep 29.10 (REPORT §4o–4q, §5 Web client, §7c count+1 ids (web side)).

Items: 4o Electron launcher curly quotes kill the renderer; 4p `1920x1080@50` matches `1080i5000` before
`1080p5000`; 4q Device View Ctrl+Z/Delete document-wide with no focus guard; countdown pos/font edits wipe each other
(WO-320A pos never persists); RMW-with-cached-GET silent reverts (WO-436 class); document shortcuts without a
text-field guard (Space toggles playback, Ctrl+V pastes a clip); `count + 1` ids (device-view-matrix,
mapping-node-service, device-graph-suggest); web side of the MIX+MERGE preset migration (shared with WO-843).
