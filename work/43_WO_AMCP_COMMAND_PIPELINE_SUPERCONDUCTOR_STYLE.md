# WO-43: AMCP command pipeline (SuperConductor / TSR-style)

## Goal

Evolve HighAsCG’s Caspar AMCP layer from **ad hoc string assembly** toward a **data-driven pipeline** comparable to SuperConductor’s stack: **desired channel/layer state → deterministic diff → structured commands → validated serialization → ordered send**, with clear semantics for foreground vs background (`nextUp`), transitions (`LOADBG`/`PLAY` MIX/STING/etc.), and future tooling (logging, replay, tests).

## Reference architecture (what we are approximating)

SuperConductor routes Caspar through **timeline-state-resolver** and **`casparcg-state`** plus **`casparcg-connection`**:

- Timeline carries **`content.transitions`** (`inTransition` / `outTransition`; durations in ms).
- **`casparcg-state`** diffs old vs new logical layer maps and emits **`LoadbgCommand`**, **`PlayCommand`**, etc., with **`transition` / `transitionDuration` / …** merged from **`Transition.getOptions(fps)`**.
- **`casparcg-connection`** validates params and builds the wire string (e.g. `LOADBG 1-10 "clip" MIX 25 LINEAR RIGHT`); bare **`PLAY ch-layer`** swaps FG/BG without clip and strips transition fields when no clip is present.

This WO does **not** require adopting Sofie timelines or the full TSR package graph; it captures the **same separation of concerns**.

## Problem today

- Core helpers (e.g. `src/caspar/amcp-basic.js`) build commands as concatenated strings. That works but makes it harder to:
  - Guarantee ordering (LOADBG vs PLAY vs mixer batches).
  - Share transition math with engine code (`scene-take-lbg.js`, `scene-transition.js`).
  - Unit-test “intent → AMCP” without a socket.
  - Attach structured context (why this command was emitted).
- Fixes such as **omit SEEK when `PLAY` has no clip** are easier to regress without a single validation layer.

## Proposed design

### 1) Layers (conceptual)

| Layer | Responsibility |
|--------|----------------|
| **Intent / domain** | Engine decides target looks (scenes, buses, layers); maps to a **Caspar layer state snapshot** per channel (foreground media, `nextUp`, playing flags, seek/in/length, filters). |
| **Diff** | Pure function: `(previousSnapshot, nextSnapshot, meta) → CommandPlan[]` where each item has `{ name, params, orderingHint?, context? }`. |
| **Serialize** | Turns each plan item into **exact AMCP line(s)** using shared validators (transition enums, frame bounds, quoted clip paths). |
| **Transport** | Existing socket `_send`; optionally supports REQ/SALVO batching later. |

Keep **mixer DEFER/COMMIT** and channel atomicity policies as an **outer orchestrator** (as today in `scene-take-lbg.js`), but feed it **serialized lines or structured commands** from the pipeline instead of scattered string snippets.

### 2) Command plan scope (phase 1)

Minimum verbs to model first (match current engine needs):

- `LOADBG`, `LOAD`, `PLAY`, `STOP`, `CLEAR`, `CALL` (seek/loop/channel layout where supported), `SWAP` if used.
- Transition bundle on **`LOADBG`** and **`PLAY` when `clip` present**: `transition`, `transitionDuration` (frames), `transitionEasing`, `transitionDirection`; omit transition on swap **`PLAY`** without clip.

Defer full parity with **`casparcg-connection`** (every AMCP verb, sting edge cases) until phase 2 unless a feature needs it.

### 3) Serialization strategy (pick one in implementation)

- **Option A — Lightweight internal module**: Port only the **param ordering + validation rules** needed for LOADBG/PLAY (mirror `casparcg-connection` 5.x behavior HighAsCG targets).
- **Option B — Dependency**: Add **`casparcg-connection`** as a dependency and wrap **`validateParams` + `CasparCGSocket`-style string assembly** behind a thin adapter (evaluate bundle size, Node compatibility, and duplication vs Option A).

Document the choice in the PR that closes phase 1.

### 4) Transition duration

Align with TSR/casparcg-state: **timeline stores ms** → **`transitionDuration` = floor(ms / (1000/fps))`** using the **same channel FPS** source as mixer/timeline code (`scene-transition.js` / channel config).

### 5) Observability

Each planned command should allow optional **`context`** (short string + ids), analogous to TSR/casparcg-state **`addContext`**, for structured logs without parsing AMCP strings.

## Non-goals (initial phases)

- Replacing the entire engine with Sofie timelines or running **`timeline-state-resolver`** in-process.
- Modeling every **`casparcg-state`** layer type (template HTML route record) unless product requires it.
- Changing Caspar server protocol version assumptions without an explicit compatibility subsection.

## Tasks

### Phase 1 — Foundation

- [ ] **Spec snapshot types**: Define TypeScript or JSDoc types for `CasparLayerSnapshot` (fg media, `nextUp`, play/pause, seek/in/length, filters, transitions on media objects).
- [ ] **`diffCasparLayerPlan(prev, next, opts)`**: Pure module under `src/caspar/` (or `src/engine/caspar-plan/`) producing ordered **`CommandPlan`** entries for one channel/layer at a time; include unit tests for:
  - LOADBG + MIX with quoted path and frame duration.
  - PLAY with clip + MIX vs PLAY swap **without** clip (no SEEK/LENGTH).
  - Clearing stale `nextUp` before new LOADBG when required (mirror casparcg-state “EMPTY” preload behavior only if product needs it).
- [ ] **`serializeCommandPlan(plan)`**: Deterministic AMCP string output; golden-file tests for strings matching current known-good behavior (`LOADBG 1-10 "AMB/x.mp4" MIX 12 LINEAR RIGHT`).
- [ ] **Adapter**: Wrap existing `AmcpClient` so callers can `sendPlan(plan[])` or emit strings compatible with current `_send`.

### Phase 2 — Integration

- [ ] **`scene-take-lbg.js`** (and related `scene-transition.js` helpers): Route LOADBG/PLAY construction through the pipeline for **at least one** transition path (internal MIX take); keep mixer DEFER/COMMIT orchestration unchanged initially.
- [ ] **`amcp-basic.js`**: Either deprecate direct string builders for covered verbs or implement them via `serializeCommandPlan` so there is a single source of truth.
- [ ] **Logging**: Pipe `context` into existing Caspar debug logs (structured JSON line or prefixed text).

### Phase 3 — Hardening & parity

- [ ] STING transition serialization if product uses stings.
- [ ] Multi-layer atomic batches: document ordering guarantees vs Caspar (LOADBG all layers → PLAY sequence or COMMIT boundaries).
- [ ] Optional **replay fixture**: JSON trace of plans → strings for regression.

## Acceptance criteria

- Unit tests demonstrate **same wire strings** as today for representative LOADBG/PLAY/MIX cases at a given FPS.
- **No regression**: `PLAY channel-layer` without clip never appends `SEEK`/`LENGTH`/`transition` unless explicitly overridden with tests documenting Caspar behavior.
- Engine integration path exists for **one real take flow** using the pipeline (Phase 2).
- README or module header points contributors to **command plan** as the supported extension point for new AMCP sequences.

## Related work

- **WO-39** — Internal MIX transition (conceptual overlap; pipeline should implement WO-39-style sequences cleanly).
- **WO-34** — Switcher bus transitions (future consumer of multi-layer plans and ordering rules).

## Risks

- **FPS source mismatch** between UI, generator, and runtime could change MIX frame counts vs SuperConductor; centralize FPS resolution.
- **Duplicating casparcg-connection** drift if Option A; mitigate with golden tests copied from known cc-connection outputs.
- **Performance**: Diff/plan per frame must stay cheap; cache snapshots per channel where needed.

## Open questions

- Do we standardize on **Option A vs B** for serialization long-term?
- Should snapshots include **mixer geometry** (FILL/CROP) or keep mixer lines separate from clip transitions (current split)?

---

*Created: 2026-05-05 · Status: Draft*
