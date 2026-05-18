# Work Order 41: Device View — Visual Polish and Grid Layout

> **AGENT COLLABORATION PROTOCOL**  
> Every agent that works on this document MUST:  
> 1. Add a dated entry to the **Work Log** section at the bottom.  
> 2. Update task checkboxes to reflect current status.  
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.  
> 4. Do **not** delete previous agents’ log entries.

**Parent / context:** [WO-33 Device View index](./33_WO_DEVICE_VIEW_INDEX.md)  
**Status:** Draft  
**Prerequisites:** [WO-35](./35_WO_GPU_PHYSICAL_CONNECTOR_STABILITY.md) (stable connector IDs), GPU Layout Creator (LocalStorage/Export)

---

## 1. Goal

Improve the visual aesthetics and usability of the rear panel Device View to better mimic physical hardware layouts and handle irregular enumeration of ports.

## 2. Normative behaviour (acceptance-oriented)

### 2.1 Metallic Background & Labels
- [ ] **T41.1** Modify the card rendering so that the metallic background texture appears **only** under the connectors (with reasonable wiggle room).
- [ ] **T41.2** Move connector labels **outside** of the metallic background area to ensure high readability.

### 2.2 Grid Layout (4 per Column)
- [ ] **T41.3** Enforce a strict grid of **4 connectors per column** for GPU and fixed-slot cards.
- [ ] **T41.4** Rows must have fixed vertical positions (slots 1, 2, 3, 4) instead of evenly distributing available space.
- [ ] **T41.5** Use the stored visual layout (from Edit Mode) to position connectors in this grid.

### 2.3 Elastic Columns (Stream & Record)
- [ ] **T41.6** Stream and Record output bands should be "elastic".
- [ ] **T41.7** They should fill columns of 4 connectors from top to bottom, and automatically spawn a **new column** to the right if more than 4 connectors are created.

### 2.4 Hardware Map Database
- [ ] **T41.8** Create a mechanism (or JSON database) to store known physical layouts for NVIDIA GPUs and DeckLink cards.
- [ ] **T41.9** Research common cards (e.g., Quadro, RTX 4090, DeckLink Quad) and map their driver-reported connector IDs to physical positions.
- [ ] **T41.10** Allow user-submitted layouts (exported from the UI) to be merged into this database.

---

## 3. Implementation notes (for implementers)
- The current layout in `device-view-caspar-render.js` calculates absolute percentages (`x`, `y`) for markers. This will need to be updated to support columns and fixed rows.
- The "metallic background" is likely drawn as a CSS background or a separate div in the band. We will need to clip it or size it dynamically based on the number of columns.

---

## 4. Do **not** implement (explicit rejections)
- Do not hardcode layouts for specific systems in the main rendering logic; use the database or local storage state.

---

## 5. Acceptance criteria (summary)
1. Metallic BG is sized to the connector area only.
2. Labels are outside the BG.
3. 4 connectors per column enforced.
4. Stream/Record expand horizontally with new columns.

---

## 6. Work log

| Date | Agent / role | Summary |
|------|----------------|--------|
| 2026-05-15 | Antigravity | Work Order created based on user request for visual polish and grid layout. |

### Instructions for next agent
- Review the goal and start implementing the grid layout (T41.3) in `device-view-caspar-render.js`.

---

*End of WO-41*
