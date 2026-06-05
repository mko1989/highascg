# Work Order 34: Switcher-style bus transition rebuild (3-channel model)

> **AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Replace the current per-layer outgoing/incoming take choreography with **switcher-like behavior**:

- Operator builds full look on **PRV bus**
- **TAKE** transitions full composition PRV -> PGM
- predictable CUT/MIX semantics at **bus level**
- support clip start policies needed by production:
  - restart on take
  - continue from PRV playhead
  - match/sync to PGM same-layer playhead (loop continuity)

---

## Target architecture (per main screen)

Use **3 Caspar channels per screen**:

1. `PGM_BUS_n` — full program composition runtime
2. `PRV_BUS_n` — full preview composition runtime
3. `OUT_n` — output composition channel that routes + transitions between buses

For one classic screen pair this means:

- old: 2 channels (`PGM`, `PRV`)
- new: 3 channels (`PGM_BUS`, `PRV_BUS`, `OUT`)

Multiview remains separate (outside per-screen bus pair).

---

## Scope

### In scope

- Routing/config generation support for 3-channel bus model
- Engine transition rewrite for bus-level TAKE
- Per-layer clip start policy model + UI exposure
- Preview behavior aligned to destination/bus model
- Migration path from current 2-channel scene take mode

### Out of scope (initial WO-34)

- Advanced switcher effects (DVE/WIPE/STING parity) beyond stable CUT/MIX
- PixelHue-specific scene semantics changes (covered in WO-33 stream)
- Full backward-compat removal in first phase (keep compatibility flag until stabilized)

---

## Implementation plan

### Phase 1 — Bus model + config/routing foundation
- [ ] **T34.1** Add route/channel map schema for `pgmBus/prvBus/out` per main destination
- [ ] **T34.2** Update config generator (`src/config/*generator*`) to emit 3-channel layout for switcher mode
- [ ] **T34.3** Add compatibility flag in settings/config (e.g. `transitionModel: "legacy_layer" | "switcher_bus"`)
- [ ] **T34.4** Ensure Device View generated channel order and destination intent expose bus/output roles clearly

### Phase 2 — Engine rebuild (take path)
- [ ] **T34.5** New TAKE path: transition on `OUT_n` route(s), not per-layer phase-1 fade
- [ ] **T34.6** Implement CUT and MIX at bus level with deterministic AMCP ordering + single commit moments
- [ ] **T34.7** Keep PRV authoring independent from on-air output until TAKE
- [ ] **T34.8** Remove/disable legacy phase-1 outgoing fade in switcher mode

### Phase 3 — Clip start policy
- [ ] **T34.9** Add per-layer `startPolicy` enum (`restart_on_take`, `continue_from_prv`, `sync_with_pgm_same_layer`)
- [ ] **T34.10** Extend playback tracker/OSC reconciliation to resolve required seeks for each policy
- [ ] **T34.11** Wire scene/inspector UI + defaults + persistence for `startPolicy`
- [ ] **T34.12** Define policy fallbacks (missing clip/state mismatch) and document behavior

### Phase 4 — UI/Preview/operator workflow
- [ ] **T34.13** Align Looks/Timeline preview wording + indicators to bus semantics (PRV bus vs on-air output)
- [ ] **T34.14** Ensure destination visual layout previews follow per-destination bus mapping
- [ ] **T34.15** Add operator-facing status cues for TAKE model + clip start policy in use

### Phase 5 — Migration, testing, rollout
- [ ] **T34.16** Add migration notes/tools from legacy 2-channel projects
- [ ] **T34.17** Add smoke/integration tests for CUT/MIX bus take and startPolicy matrix
- [ ] **T34.18** Add docs: AMCP sequence diagrams, troubleshooting, rollback path

---

## Acceptance criteria

- A prepared PRV look never changes on-air output before TAKE
- CUT and MIX operate on full composition, not layer-by-layer visible churn
- `startPolicy` behavior is deterministic and reproducible for media clips
- For one screen pair, resulting system uses and reports 3 channels in switcher mode
- Legacy mode remains available until switcher mode is validated in field tests

---

## Risks / notes

- Extra channel per screen increases Caspar resource usage
- Route-based transition timing must be validated on target Caspar build(s)
- Playhead synchronization depends on stable playback telemetry (OSC + tracker)
- Existing timeline/scene assumptions around `programChannels/previewChannels` need careful adaptation

---

## Work Log

### 2026-04-25 — Agent (WO creation + status integration)

**Work Done:**
- Created WO-34 for switcher-like transition rebuild using 3-channel bus architecture.
- Captured phased task plan (routing/config, engine, start policy, UI, migration/testing).
- Added acceptance criteria and rollout constraints.

**Status:** Work order created. Implementation not started.

**Instructions for Next Agent:** Start with **Phase 1 (T34.1–T34.4)** and add channel-map prototypes + config generator changes behind a compatibility flag.

---
*Work Order created: 2026-04-25 | Series: transition engine / switcher model*
