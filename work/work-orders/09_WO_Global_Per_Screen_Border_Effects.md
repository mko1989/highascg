# WO-09 — Global per-screen border effects and Art-Net control

**Status:** Draft work order  
**Scope:** HighAsCG application (Web GUI / Server logic)  
**Related context:** We have standard border overlays implemented for PIPs (Picture-in-Picture) in the inspector (see `client/components/inspector-pip-overlay.js` and `pip-overlay-registry.js`). The goal is to reuse these effects as global, per-screen overlays on a high CG layer (e.g., 998) and expose their parameters via Art-Net for external control.

---

## 1. Objective

Implement global per-screen border effects that can be enabled via a "Look" setting and controlled in real-time via Art-Net (DMX). The effect should run on a high CG layer (default 998) to ensure it stays on top of other content.

**Success:** Operators can enable a border effect for a specific screen via a Look, and a lighting operator can manipulate its parameters (color, width, etc.) via Art-Net from a lighting desk.

---

## 2. Constraints and assumptions

- The system already has Art-Net *output* capabilities in `src/sampling/dmx-output.js` using `dmxnet`, but Art-Net *input* (receiving) needs to be implemented.
- The border effects should reuse the logic/assets from the existing PIP overlays to maintain consistency.
- The effect runs on a specific high layer (e.g., 998) on the CasparCG channel corresponding to the screen.

---

## 3. Phases

### Phase A — UI & Configuration (Looks)

| Task | Description |
|------|-------------|
| **T-A.1** | Add a "Global Border" section to the Look configuration UI. |
| **T-A.2** | Allow selection of border effect type (reusing types from `pip-overlay-registry.js`). |
| **T-A.3** | Add a setting to define the default CG layer (default: 998) for the global border. |
| **T-A.4** | Save these settings in the Look state. |

### Phase B — Art-Net Input Implementation

| Task | Description |
|------|-------------|
| **T-B.1** | Implement an Art-Net receiver using `dmxnet.newReceiver` (library is already a dependency). |
| **T-B.2** | Add configuration for Art-Net input universe and start address in system settings or Look settings. |
| **T-B.3** | Define a DMX channel map for border parameters (e.g., Channel 1: Intensity/Opacity, Channel 2-4: RGB Color, Channel 5: Width, Channel 6: Effect Mode/Preset). |
| **T-B.4** | Create a listener that captures incoming DMX data and triggers updates to the active border effect. |

### Phase C — Playout & CasparCG Integration

| Task | Description |
|------|-------------|
| **T-C.1** | Implement logic to play the border template/effect on layer 998 when the Look is loaded. |
| **T-C.2** | Map incoming Art-Net/DMX data to CG UPDATE commands or Mixer commands to alter the border in real-time. |
| **T-C.3** | Optimize updates to avoid flooding CasparCG with AMCP commands (e.g., debounce or send only on change). |

### Phase D — Verification

| Task | Description |
|------|-------------|
| **T-D.1** | Verify that loading a Look with the border enabled plays it on layer 998. |
| **T-D.2** | Verify that sending Art-Net data from a test source (or lighting desk) updates the border parameters in real-time. |
| **T-D.3** | Verify that turning off the setting or switching to a Look without it removes the border. |

---

## 4. Risks

| Risk | Mitigation |
|------|------------|
| High-frequency Art-Net updates flooding the AMCP connection | Implement throttling or send updates only when values change beyond a threshold. |
| Port conflicts for Art-Net input | Ensure the Art-Net port (6454) is available and configurable if needed. |
| Performance impact of always-on CG layer | Test performance on target hardware with typical show load. |

---

## 5. Acceptance criteria

1. Border effects can be enabled per screen as part of a "Look".
2. The effect plays on a configurable high layer (default 998).
3. Art-Net receiver listens for incoming DMX data and updates border parameters (Color, Width, Opacity) in real-time.
4. Logic reuses existing PIP overlay definitions where possible.

---

## 6. References

- `client/components/inspector-pip-overlay.js`
- `src/lib/pip-overlay-registry.js`
- `src/sampling/dmx-output.js` (for existing `dmxnet` usage)

---

## 7. Ownership

Assign: **UI Developer** (Looks integration), **Backend Developer** (Art-Net input & CasparCG control), **QA** (Real-time testing).
