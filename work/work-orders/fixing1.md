# Investigation and Proposed Fixes (fixing1)

## 1. GPU/Display Resolution Persistence

### Findings
- **Persistence Issue**: Currently, OS-level display settings (applied via `xrandr` or `nvidia-settings`) are executed when the "Save GPU Consumer" button is clicked in the UI, but they are **not re-applied on system startup**.
- **Switcher EDID**: If the switcher's EDID is not treated as default, the system falls back to 1080p60. 
- **Startup Sequence**: The orchestrator (`index.js`) does not currently call `applyX11Layout` during its boot process.

### Final Agreed Plan
1.  **UI Text Change**: Change the button label from "Save GPU consumer" to "**Apply resolution to the screen**" in `web/components/device-view-inspectors.js`.
2.  **Scope**: No OS-level automation or persistence will be added for now.

---

## 2. Chosen Cable Connection "Glow"

### Findings
- **Current Behavior**: When a cable is selected or hovered, its `stroke` color is cleared in JavaScript, causing it to fall back to a fixed amber color (`rgba(245, 158, 11, 0.95)`) defined in `09b-device-view-connectors-inspector.css`.
- **User Requirement**: The cable should keep its generated color but gain a "glowing" effect.

### Proposed Refined Approach
1.  **Universal Shadows**: Update `web/index.css` to add shadows to cables in both active and inactive states. 
2.  **Dynamic Glow**: Use a CSS variable (`--cable-color`) so the shadow color matches the cable color.
3.  **Gravity/Slack Fix**:
    *   Increase **slack** (multiplier from `1.04` to `1.12`) to allow cables to hang.
    *   Increase **gravity constant** (from `0.4` to `0.75`) and **iterations** to ensure a natural "sag" even for short cables.
    *   Fix constraint satisfaction logic to prevent cables from looking "jittery" or too tight.

---

## 3. Config Modularization and "Untrustworthy" State

### Findings
- **Bloat**: `highascg.config.json` has grown to over 1000 lines, primarily due to large `deviceGraph` and `tandemTopology` structures.
- **Reliability (The "Untrustworthy" Issue)**: A major discrepancy exists between the **Device Graph Edges** and the **Connector Properties**.
    - **Example**: In `frash_highascg.config`, `gpu_p0` is connected to Screen 2 (`dst_mohl4nel_1`) via an edge, but its internal `mainIndex` property is set to `3`.
    - **Result**: The UI shows one connection, but the CasparCG config generator (which relies on `mainIndex` and `screen_N_...` properties) outputs the signal to the wrong port.
    - **Sync Issue**: The system is not currently enforcing that a cable connection in the UI updates the underlying routing properties of the GPU ports.

### Proposed Refined Approach
1.  **Unified Memory, Split Disk**: 
    - **Why**: The codebase has over 800 references to `ctx.config`. Splitting the memory object would require a dangerous full-system refactor.
    - **How**: `ConfigManager` will transparently map `config.deviceGraph` to `device_graph.json`, `config.casparServer` to `caspar.json`, etc.
2.  **Atomic Saves**: Each module (file) is saved independently only when it changes, reducing the risk of a 1000-line file being corrupted.
3.  **Healing the "Untrustworthy" Graph**: 
    - Implement a validation step that ensures the `edges` in the device graph match the routing properties in `casparServer` and `tandemTopology`.
    - If a discrepancy is found, the system should "heal" the properties to match the visual edges (or vice-versa).

---

## Next Steps
- [ ] Implement `applyX11Layout` on startup in `index.js`.
- [ ] Update GPU inspector button label.
- [ ] Refactor `device-view-cables.js` and CSS for the glow effect.
- [ ] Design and implement the `ConfigManager` multi-file support.
