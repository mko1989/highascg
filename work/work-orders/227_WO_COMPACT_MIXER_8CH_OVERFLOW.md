# WO-227 — Compact audio mixer: 8-channel screens overflow their space

**Status:** Planned | **Date:** 2026-07-15
**Source:** owner: "in the compact audio mixer when a screen has 8ch it doesnt fit in it space"

## Tasks
- [ ] T227.1 Reproduce by reading: client/components/audio-mixer-panel*.js render + its CSS (07b sheet family) — find the fixed-width assumption that breaks at 8 channel strips per screen.
- [ ] T227.2 Fix: responsive strip sizing (narrower faders at high counts and/or horizontal scroll within the screen group with `overflow-x:auto`; keep 2-4ch layouts pixel-identical).
- [ ] T227.3 eslint/gate; orchestrator builds. A227.1 owner check at 8ch.
