# Work Order 18: Pixel & Output Mapping — Unified Node-Based System

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Add a unified **Pixel Mapping** system integrated into the **Device View** that lets users:

1.  **Device View Node**: Add a `pixel_mapping` node to the device graph.
2.  **Input Mapping**: Connect a **Screen Destination Channel** (PGM/PRV feed) to the node's input.
3.  **Output Mapping**: Configure $N$ virtual outputs within the node's inspector.
    *   Outputs can be **Video Slices** (e.g., SDI 1080p50) or **Lighting Data** (DMX/Art-Net/sACN).
    *   The node in the graph dynamically updates to show $N$ output pins for cabling to physical/virtual sinks.
4.  **Visual Slicing/Mapping**: In a dedicated **Pixel Mapping** tab (triggered by the node), manipulate "layers" (slices) of the input canvas to position them on the target outputs.
    *   Example: Map a 3072×1024 Destination onto two 1080p SDI outputs.
5.  **Unified DMX Sampling**: Use the same canvas to define DMX sampling zones alongside video slices.

---

## Real-World Example: Video Slicing

```
Destination Canvas = 3072 × 1024

Physical outputs:
  • SDI Output 1: 1920 × 1080 (1080p50)
  • GPU Output 2: 1280 × 720 (Custom resolution)

Mapping layout (3072×1024):
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   ┌────────────────────┐      ┌────────────────────┐    │
│   │   Slice A (Left)   │      │   Slice B (Right)  │    │
│   │   1536 × 1024      │      │   1536 × 1024      │    │
│   └────────────────────┘      └────────────────────┘    │
│                                                         │
└─────────────────────────────────────────────────────────┘

Device View Wiring:
[Destination Feed] ──► [Pixel Mapping Node]
                          ├─► Out 1 ──► [DeckLink Port 1]
                          └─► Out 2 ──► [GPU Display 2]
```

The system supports both **standard broadcast modes** (SDI) and **custom GPU resolutions**.

---

## Mapping Sources Browser (Special Tab)

In the Pixel Mapping view, a special **"Mapping Sources"** tab appears in the browser panel. This tab contains:

1.  **Output Targets**:
    *   **Video Output Template**: Set resolution (Custom or Preset), Frame Rate, and Name.
    *   **DMX Fixture Template**: Set Universe, Channel, Protocol, and Name.
2.  **Management**: Add new templates, copy/paste existing ones.
3.  **Interaction**: Adjust settings in the browser sidebar, then **drag and drop** the target onto the canvas to create a mapping slice or DMX grid.

---

## Architecture (Reworked)

```
┌─────────────────────────────────────────────────────────┐
│  HighAsCG Device View (Node Graph)                      │
│                                                         │
│  ┌─────────────┐       ┌───────────────┐      ┌───────┐ │
│  │ PGM Feed    │ ─────►│ PIXEL MAP     │ ───► │ SDI 1 │ │
│  └─────────────┘       │ (Node)        │ ───► │ GPU 2 │ │
│                        └───────────────┘      └───────┘ │
└─────────────────────────────────────────────────────────┘
         │
         ▼  (Selecting the node opens...)
┌─────────────────────────────────────────────────────────┐
│  Pixel Mapping Tab (Unified Editor)                     │
│                                                         │
│  ┌─────────────────────────────┐  ┌───────────────────┐ │
│  │  Canvas (Input Resolution)  │  │  Mapping Browser  │ │
│  │                             │  │ (Video / DMX)     │ │
│  │  ┌──────────┐  ┌──────────┐ │  │                   │ │
│  │  │ Slice 1   │  │ Slice 2   │ │  │ [ ] 1080p Slice │ │
│  │  └──────────┘  └──────────┘ │  │ [ ] 4K Slice     │ │
│  │                             │  │ [ ] DMX Fixture  │ │
│  │  ┌──────────────┐           │  │                   │ │
│  │  │ DMX Grid 1   │           │  │ + New Target      │ │
│  │  └──────────────┘           │  │                   │ │
│  └─────────────────────────────┘  └───────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## Data Model (Node Extension)

### Pixel Map Node Settings

```json
{
  "id": "node_pm_1",
  "type": "pixel_mapping",
  "settings": {
    "numOutputs": 2,
    "outputs": [
      { "id": "out_1", "mode": "1080p50", "label": "SDI Out" },
      { "id": "out_2", "mode": "1280x720", "label": "GPU Screen" }
    ],
    "mappings": [
      {
        "targetId": "out_1",
        "type": "video_slice",
        "name": "Slice Left",
        "rect": { "x": 0, "y": 0, "w": 1536, "h": 1024 },
        "targetPos": { "x": 0, "y": 0 },
        "rotation": 0
      },
      {
        "targetId": "out_2",
        "type": "video_slice",
        "name": "Slice Right",
        "rect": { "x": 1536, "y": 0, "w": 1536, "h": 1024 },
        "targetPos": { "x": 0, "y": 0 },
        "rotation": 0
      }
    ]
  }
}
```

---

## Tasks (Updated)

### Phase 1: Device View Node Integration

- [ ] **T1.1** Define `pixel_mapping` node type in `device-graph-core.js`
- [ ] **T1.2** Implement dynamic connector generation for the mapping node based on `settings.outputs` length
- [ ] **T1.3** Create `client/components/device-view-pixel-mapping-inspector.js`
  - "General" tab: Configure output list (add/remove/edit targets)
  - "Pixel Mapping" button: Switches to the full canvas editor

### Phase 2: Mapping Sources Browser

- [ ] **T2.1** Create `client/components/pixel-mapping-browser.js`
  - Specialized browser tab that only appears when the Mapping Node is selected
  - Displays list of "Output Templates" and "DMX Templates"
  - Ability to edit template properties (Res, Mode, Universe) in-situ
- [ ] **T2.2** Drag-and-Drop Implementation:
  - Drag from Mapping Browser → Canvas to create a new mapping
  - Visual ghosting during drag showing the slice dimensions

### Phase 3: Unified Canvas Editor (Rework)

- [ ] **T3.1** Adapt `pixel-map-editor.js` into the unified **Pixel Mapping Tab**
- [ ] **T3.2** Input Canvas Awareness: The editor must set its "background canvas size" based on the connected input source
- [ ] **T3.3** Slice/Layer Manipulation:
  - Add "Video Slice" layers alongside DMX fixtures
  - Each slice is assigned to a `targetId` from the node's output list
- [ ] **T3.4** Scaling & Positioning:
  - If a slice is smaller than the target output, allow positioning the content on the output frame

### Phase 4: Playout & Backend Wiring

- [ ] **T3.1** Update `SamplingManager` to support "Video Slicing" mode
  - Instead of just sampling pixels for DMX, it must handle the cropping/rotating of regions for secondary CasparCG consumers
- [ ] **T3.2** Backend Route Generation:
  - When a `pixel_mapping` node is cabled to a DeckLink output, generate the appropriate CasparCG `ADD` / `PLAY` commands with `MIXER CROP` / `MIXER FILL` to achieve the mapping

---

## Work Log

*(Agents: add your entries below in reverse chronological order)*

- **2026-04-29 (Part 2)**: Implemented Phase 1 and Phase 2.
    *   Added `pixel_mapping` node role to Device View with dynamic multi-output support.
    *   Wired cabling logic for intermediate mapping nodes.
    *   Created **Mapping Sources Browser** (Special Tab) for managing Video/DMX output templates with drag-and-drop support.
    *   Updated backend to persist `mappingTemplates` and node `settings`.
- **2026-04-29 (Part 1)**: Reworked WO-18 to integrate with the Node-Based Device View. Replaced "Output Slicer" tab concept with a unified "Pixel Mapping" node that supports both DMX and Video Slicing outputs. Added dynamic pin generation and Destination-to-Node cabling model.

---
*Work Order created: 2026-04-12 | Parent: 00_PROJECT_GOAL.md*
