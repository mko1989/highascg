# Work Order 41: Mapping Node Integration and Channel/Consumer Model

## Goal
Make Pixel Mapping a first-class part of the app model and UX.

The mapping node must behave like a proper Caspar channel producer/consumer workflow:
- input comes from a routed source channel feed,
- outputs are dynamic consumers,
- output configuration is available in Device View (without opening Mapping Editor),
- Mapping Editor uses the same inspector conventions as the rest of the app.

## Problem Statement
Current behavior feels disconnected:
- Mapping node state and UI do not consistently match app routing semantics.
- Mapping inspector UI diverges from the app inspector patterns.
- Output management starts from hardcoded defaults and is not reliably model-driven.
- Slice/output editing flow is unclear and inconsistent across views.

## Product Model (Source of Truth)

### 1. Mapping Node Role
- A mapping node is a **processing node** that:
  - accepts one routed input feed (`pixel_map_in`),
  - defines N logical outputs (`settings.outputs[]`),
  - can have per-slice routing to one output (`mapping.outputId`).

### 2. Channel Semantics
- Caspar channel = layers + consumers.
- Mapping output should map to a generated channel slot (existing `routeMap.mappingChannels`) and then to physical/consumer connectors via cabling.
- No hidden alternate path outside device graph/model.

### 3. Consumer Semantics
- Mapping outputs are dynamic consumers:
  - Add output = add new logical output in node settings + connector in graph.
  - Remove output = remove logical output + remove/cleanup connector edges + rebind slices safely.

## UX/Behavior Requirements

### A) Device View: Mapping Node Control (Primary)
- Mapping node card must expose:
  - rename node,
  - duplicate node,
  - delete node,
  - add output,
  - remove output (per output row, disabled when only one output remains),
  - per-output label and mode edit (minimum: label + mode).
- Default placement behavior for new outputs:
  - `Output 1` left,
  - `Output 2` right of output 1,
  - subsequent outputs continue left-to-right.
- Changes persist via device graph/settings save immediately.

### B) Mapping Editor: Inspector Consistency
- Inspector style and interaction should follow app conventions:
  - same button style, section hierarchy, spacing, status feedback.
- Mapping editor inspector must include:
  - selected slice fields (`label`, `x`, `y`, `w`, `h`, `rotation`, `outputId`),
  - current node summary,
  - output list (read/write),
  - no isolated one-off UI logic that bypasses app model.

### C) Selection and Discoverability
- Mapping node selection must be consistent across views:
  - select in Device View -> open/focus Mapping Editor on same node,
  - open Mapping Editor -> node context clearly shown,
  - no "invisible state jump" between tabs.

## Data Contract Requirements

### Node Settings Shape
- `device.role === "pixel_mapping"` uses:
  - `settings.outputs: Array<{ id: string, label: string, mode: string }>`
  - `settings.numOutputs: number` (derived mirror, optional long-term)
  - `settings.mappings: Array<{ id, type, rect, rotation, outputId, ... }>`

### Connector Contract
- Required connector IDs:
  - input: `${nodeId}_in`
  - outputs: `${nodeId}_${output.id}`
- Output connector `index` must match outputs array order.

### Save/Mutate Rules
- Any output add/remove/rename must update:
  - node settings,
  - mapping slice output references,
  - graph connectors,
  - graph edges cleanup for removed connectors.

## Implementation Plan

### Phase 1: Model Hardening
- Consolidate mapping node CRUD/output CRUD in one state/service path.
- Remove duplicate ad-hoc mutations in UI components.
- Add guardrails for output removal/reindexing.

### Phase 2: Device View Controls
- Add full mapping node controls to `device-view-mappings-render` + inspector actions.
- Expose per-output label/mode editing and add/remove controls.

### Phase 3: Mapping Editor Inspector Unification
- Refactor mapping inspector panels to use shared inspector patterns/components where possible.
- Ensure selected slice edits round-trip through same state/model contract.

### Phase 4: Channel/Consumer Verification
- Ensure generated Caspar mapping channels are emitted for each cabled mapping output.
- Verify output mode and consumer attachment behavior aligns with route map.

### Phase 5: UX Polish
- Add clear status messages on save failures.
- Keep selection stable after add/remove/duplicate operations.

## Acceptance Criteria
- Can add/remove mapping outputs dynamically without reload hacks.
- Can rename/copy/delete mapping node from Device View.
- Can select/edit mapping slices from Mapping Editor inspector reliably.
- Mapping output changes are reflected in device graph and config generation.
- Inspector UI feels consistent with app inspector patterns (no isolated "weird" panel).
- Default output ordering/layout behavior is deterministic (left-to-right from output 1).

## Verification Checklist
- Create mapping node -> add 4 outputs -> labels/modes persist.
- Remove output 2 -> connectors/edges cleaned, slices rebound safely.
- Route node input from destination channel feed and route outputs to decklink/gpu.
- Open Mapping Editor from Device View -> node context preserved.
- Edit slice output assignment -> save + reload -> assignment remains.
- Generate Caspar config -> mapping channels/consumers reflect current graph.

