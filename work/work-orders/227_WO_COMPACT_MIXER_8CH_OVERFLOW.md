# WO-227 — Compact audio mixer: 8-channel screens overflow their space

**Status:** Implemented (verified by audit 2026-07-17; owner acceptance pending) | **Date:** 2026-07-15
**Source:** owner: "in the compact audio mixer when a screen has 8ch it doesnt fit in it space"

## Tasks
- [x] T227.1 Reproduce by reading: client/components/audio-mixer-panel*.js render + its CSS (07b sheet family) — find the fixed-width assumption that breaks at 8 channel strips per screen.
- [x] T227.2 Fix: responsive strip sizing (narrower faders at high counts and/or horizontal scroll within the screen group with `overflow-x:auto`; keep 2-4ch layouts pixel-identical).
- [x] T227.3 eslint/gate; orchestrator builds. A227.1 owner check at 8ch.

## Work log

- **Audit 2026-07-17:** Implementation verified in-tree. Dense-mixer fix applied; smoke test tools/smoke/smoke-wo227-mixer-dense.test.js present and green.
