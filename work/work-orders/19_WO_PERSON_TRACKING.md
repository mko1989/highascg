# Work Order 19: Person Tracking — Stage Performer Detection from Camera Inputs & 3D Previs

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Module context

Part of the **Previs & Tracking optional module** — see [WO-30](./30_WO_PREVIS_TRACKING_MODULE.md) for packaging, feature flag, and directory boundary. This WO is inert unless `HIGHASCG_PREVIS=1` or `config.features.previs3d === true`. All source lives under `src/tracking/`, `web/components/tracking-*`, `web/lib/tracking-*`, and is deletable as a unit.

Sibling WOs: [WO-17](./17_WO_3D_PREVIS.md) (3D stage model — projection surface for tracking markers) and [WO-31](./31_WO_STAGE_AUTOFOLLOW_PTZ.md) (consumer of tracking data for PTZ/lighting auto-follow).

---

## Goal

Add **real-time, multi-person tracking** that detects performers on a stage using:

1. **Camera inputs** — live DeckLink (SDI) / NDI / RTSP / SRT camera feeds ingested through CasparCG.
2. **3D Previs context** (WO-17) — project detected positions into the 3D stage model on the stage floor.
3. **Tracking data output** — expose person coordinates (2D stage position, 3D stage position, bounding box, skeleton/pose, persistent IDs) via REST + WebSocket for downstream systems. Primary consumer: **Bitfocus Companion** via [WO-31](./31_WO_STAGE_AUTOFOLLOW_PTZ.md) — HighAsCG publishes `tracking:persons` over WS, the companion module exposes it as Companion variables, and operator-defined Companion buttons/actions fan out to PTZ cameras, moving-heads, lighting desks, etc. Native OSC-out is deferred.

This enables automated follow-spots (WO-31), AR content placement, interactive LED wall zones, and presenter tracking systems.

---

## Architecture

```
  Physical Camera(s)
       │
       ▼ SDI / NDI / RTSP
  CasparCG
  ├── DeckLink Input (Channel N) ─→ go2rtc ─→ WebRTC ─→ Browser
  │                                                       │
  │                                                       ▼
  │                                          ┌─────────────────────┐
  │                                          │ Browser Person      │
  │                                          │ Tracking (MediaPipe)│
  │                                          │                     │
  │                                          │ OR (performance):   │
  │                                          └────────┬────────────┘
  │                                                   │
  └── FFmpeg consumer ─→ Raw RGB frames ──────────────┼───────────┐
                                                      │           │
                                              ┌───────▼────────┐  │
                                              │ Server-Side    │  │
                                              │ Person Tracker │  │
                                              │ (Node.js +     │  │
                                              │  ONNX Runtime) │  │
                                              └───────┬────────┘  │
                                                      │           │
                                                      ▼           │
                                              ┌──────────────┐   │
                                              │ Tracking     │   │
                                              │ State        │◄──┘
                                              │              │
                                              │ - person_id  │
                                              │ - bbox       │
                                              │ - pose       │
                                              │ - stage_pos  │
                                              └──────┬───────┘
                                                     │
                                              WS broadcast
                                                     │
                                    ┌────────────────┼───────────────┐
                                    ▼                ▼               ▼
                              3D Previs        Companion       External
                              (WO-17)          Variables        Systems
                              Show tracked     person_1_x      (OSC, Art-Net
                              positions on     person_1_y      lighting desks)
                              3D model         person_count
```

---

## Technology Decision: Tracking Engine

### Selected: **Server-side ONNX Runtime + YOLOv8-Pose + ByteTrack**

Per operator direction, the earlier "browser-side MediaPipe Phase 1" plan is dropped. The production path is the only path: server-side YOLOv8n-Pose via `onnxruntime-node`, with ByteTrack for persistent multi-person IDs. A Python microservice path stays on the table as a future optimisation only.

| Approach | Where | Model | FPS (1080p) | GPU | Latency | Notes |
|----------|-------|-------|-------------|-----|---------|-------|
| **ONNX Runtime + YOLOv8n-Pose (server)** | Node.js worker | YOLOv8n-Pose | 25-60 fps | CUDA GPU (CPU fallback) | ~30 ms | **✅ Phase 1 — the plan** |
| Python microservice | Python subprocess | YOLOv8 + ByteTrack + Re-ID | 30-60 fps | CUDA GPU | ~25 ms | 🔮 Future — only if accuracy/throughput ceiling is hit |
| Browser MediaPipe | Browser | BlazePose | 15-30 fps | WebGL | ~50 ms | ❌ **Rejected** — requires a browser tab open, single-person practical limit, not a server-grade solution |

### Camera → tracker frame path

Chosen: **CasparCG FFmpeg consumer → raw RGB frames over shared memory / UDP FIFO → Node worker thread → ONNX Runtime**. This reuses the pattern already in place for DMX sampling (`src/sampling/`). Dedicated FFmpeg consumer on the camera input channel so tracker framerate is independent of other subsystems.

GPU frame-sharing (zero-copy CUDA / DMA-BUF / NVENC handles from Caspar to the tracker) is **not pursued in v1** — no public CasparCG fork implements such a surface today, and building one would mean patching the Caspar consumer layer. The tracker's frame-input stage is kept abstract so a zero-copy producer can be swapped in later without rewriting detection, ByteTrack, or broadcast.

### Execution provider priority

`CUDAExecutionProvider` → `DmlExecutionProvider` (Windows dev) → `CPUExecutionProvider` (fallback; reduced fps cap).

---

## Tasks

### Phase 1: Server-Side Detection (YOLOv8-Pose + ByteTrack)

- [ ] **T1.1** Add `onnxruntime-node` as an **`optionalDependency`** per WO-30. Download pre-exported `yolov8n-pose.onnx` (~6 MB) into `<data>/models/` as part of the `--with-previs` installer path.

- [ ] **T1.2** Create `src/tracking/session.js` (≤250 lines)
  - Initialise ONNX Runtime session with execution-provider priority `CUDA → DML → CPU`.
  - Warm-up inference on a dummy 640×640 tensor at startup; record baseline latency.
  - Expose `infer(rgbBuffer, width, height) → detections[]` with NMS applied.

- [ ] **T1.3** Create `src/tracking/frame-source.js` (≤250 lines)
  - Spawn a dedicated FFmpeg consumer on the configured camera input channel (DeckLink / NDI / RTSP / SRT source already exposed via Caspar).
  - Deliver raw RGB frames to a Node `worker_threads` worker via shared memory / UDP FIFO (same pattern as `src/sampling/`).
  - Back-pressure: drop frames, never buffer more than one in flight per inference.

- [ ] **T1.4** Create `src/tracking/byte-track.js` (≤250 lines)
  - Lightweight ByteTrack implementation for multi-object tracking.
  - Assigns persistent IDs across frames based on IoU.
  - Handles entry, exit (retire after configurable timeout, default 30 frames), brief-occlusion re-ID.
  - Parameters: high-threshold 0.5, low-threshold 0.1, track-buffer 30 frames.

- [ ] **T1.5** Create `src/tracking/engine.js` (≤300 lines)
  - Orchestrates frame-source → session → byte-track → state.
  - Applies EMA + one-euro filter per keypoint and per `stagePosition` to damp jitter.
  - Marks person `lost` after configurable N frames without detection.
  - Broadcasts `tracking:persons` events via the WS layer.

### Phase 2: Integration with 3D Previs (WO-17)

- [ ] **T2.1** Stage coordinate mapping (`web/lib/tracking-stage-map.js`, ≤200 lines)
  - Define stage coordinate system:
    - Camera calibration: user marks the stage floor corners in the camera view
    - 4-point perspective transform (homography matrix)
    - Maps 2D image coordinates → 3D stage coordinates (assuming flat floor plane)
  - UI: calibration wizard
    - Step 1: Show camera frame, user clicks 4 corners of the stage floor
    - Step 2: Enter real-world dimensions (e.g., 12m × 8m)
    - Step 3: System computes homography
  - Save calibration per camera in `previs-state.js`

- [ ] **T2.2** 3D previs person markers (`web/components/previs-tracking-overlay.js`, ≤150 lines)
  - In the 3D previs scene, render tracked persons as:
    - Capsule meshes (height based on detected skeleton)
    - Or point-cloud skeleton visualization
    - Or simple cylinder + label
  - Position on the 3D stage floor using the homography-mapped coordinates
  - Color matches the tracking overlay colors
  - Animate smoothly (lerp between detection frames)
  - Show tracking cone (camera frustum) as a wireframe in 3D

- [ ] **T2.3** Multi-camera support
  - If multiple camera inputs are available, detect on each independently
  - Fuse detections from multiple cameras using triangulation
  - Show all camera frustums in 3D previs
  - Handle occlusion: if person lost in one camera, use the other

### Phase 3: WebSocket broadcast & REST surface

- [ ] **T3.1** Broadcast `tracking:persons` over WS (namespace per WO-30) at tracking framerate (throttled to configurable 10/15/25 Hz).
  - Payload:
    ```json
    {
      "timestamp": 1712345678.123,
      "frameId": 42,
      "sourceCamera": "decklink_1",
      "persons": [
        {
          "id": 1,
          "confidence": 0.92,
          "bbox": { "x": 0.3, "y": 0.2, "w": 0.15, "h": 0.6 },
          "pose": [
            { "x": 0.35, "y": 0.22, "confidence": 0.95 }
          ],
          "stagePosition": { "x": 3.2, "y": 5.1, "z": 0 }
        }
      ]
    }
    ```
  - `stagePosition` is in the stage coordinate system defined by WO-30 (meters, right-handed, Z = up, origin = stage-floor centre unless calibration overrides). `z` is reserved for future head-height estimation; v1 sets `z = 0`.

- [ ] **T3.2** `GET /api/tracking/persons` — current snapshot for polling clients and UI bootstrap.
- [ ] **T3.3** `GET /api/tracking/stats` — FPS, latency histogram, last-inference timing.

### Phase 4: Companion integration (primary consumer)

WO-31 is the principal consumer of tracking data. Companion integration is therefore narrow here: expose tracking state as variables/feedbacks in the existing companion module.

- [ ] **T4.1** In `companion-module-highpass-highascg`, subscribe to `tracking:persons` and auto-generate variables:
  - `tracking_person_count` — number of detected persons.
  - `tracking_person_<N>_x`, `tracking_person_<N>_y`, `tracking_person_<N>_z` — stage coordinates (meters).
  - `tracking_person_<N>_confidence` — detection confidence.
  - N from 1 up to a configurable max (default 4).
- [ ] **T4.2** Feedback: `Person In Zone <id>` — true while any tracked person's stage position is inside the named zone polygon. Zones come from the shared zone store (WO-31 writes them; we read).
- [ ] **T4.3** No native OSC-out in v1. Left as a deferred optional feature for installs without Companion.

### Phase 5: UI — Tracking Settings & Visualisation

- [ ] **T5.1** Settings → "Tracking" section (only when module enabled)
  - Enable / disable tracking.
  - Camera source (dropdown over configured DeckLink / NDI / RTSP inputs).
  - Detection confidence threshold slider.
  - Tracking visualisation toggles: overlay, skeleton, bbox, IDs.
  - Stage calibration button (opens the 4-point homography wizard — T2.1).
  - Performance stats: FPS, latency, person count, GPU/CPU EP in use.
  - Throttle control: 10 / 15 / 25 Hz broadcast.

- [ ] **T5.2** Create `web/components/tracking-panel.js` (≤300 lines)
  - Lives inside the Previs module's side-pane (not a separate workspace tab).
  - Shows the selected camera feed with the overlay (bboxes, skeletons, IDs).
  - Top-down stage map showing person positions (shares the same canvas the autofollow zone editor from WO-31 uses).
  - Real-time stats: persons detected, tracking FPS, latency.

---

## Key Implementation Notes

### Homography (2D Camera → 3D Stage)

The stage calibration uses a perspective transform (homography) to map 2D camera pixel coordinates to 3D stage floor coordinates. This assumes a flat stage floor.

```javascript
// 4-point calibration:
// cameraPoints = [[px1,py1], [px2,py2], [px3,py3], [px4,py4]] (image coords 0-1)
// stagePoints  = [[sx1,sy1], [sx2,sy2], [sx3,sy3], [sx4,sy4]] (meters on stage)
//
// Solve for 3×3 homography matrix H such that:
//   [sx, sy, 1]^T = H * [px, py, 1]^T
//
// Use DLT (Direct Linear Transform) algorithm — 8 equations, 8 unknowns

function computeHomography(srcPts, dstPts) {
  // ... DLT implementation (standard computer vision algorithm)
  // Returns 3x3 matrix
}

function projectToStage(imageX, imageY, H) {
  // Apply homography
  const w = H[6] * imageX + H[7] * imageY + H[8]
  const sx = (H[0] * imageX + H[1] * imageY + H[2]) / w
  const sy = (H[3] * imageX + H[4] * imageY + H[5]) / w
  return { x: sx, y: sy }
}
```

### Server-Side Frame Source Options

| Source | How | Pros | Cons |
|--------|-----|------|------|
| **Dedicated FFmpeg consumer (v1)** | New `ADD STREAM` on camera input channel, raw RGB over UDP FIFO to worker | Independent framerate; decouples tracking from other subsystems | Extra Caspar consumer + UDP port |
| Reuse DMX sampling FFmpeg | Share existing UDP/FIFO → raw RGB pipeline | No extra Caspar consumer | Couples DMX and tracking framerate |
| GPU zero-copy (future) | Custom Caspar patch → CUDA/DMA-BUF handle → ORT CUDA EP | Lowest latency, zero copies | No public Caspar fork exists; heavy custom work |

**Decision:** dedicated FFmpeg consumer processed in a `worker_threads` worker (same pattern as `src/sampling/sampling-worker.js`). The frame-source stage is abstracted so a GPU zero-copy producer can be dropped in later without touching detection, ByteTrack, or broadcast.

### Performance Budget

| Metric | Target | Acceptable |
|--------|--------|------------|
| Detection FPS (server, 4 people, CUDA) | 25 fps | 15 fps |
| Detection FPS (server, 4 people, CPU EP) | 8 fps | 5 fps |
| Detection latency (server, CUDA) | < 50 ms | < 100 ms |
| End-to-end WS latency (camera pixel → `tracking:persons`) | < 120 ms | < 200 ms |
| GPU utilisation (server ONNX, CUDA) | < 40 % | < 60 % |
| Memory (YOLOv8n ONNX model) | ~30 MB | ~60 MB |

---

## Dependencies

- `onnxruntime-node` — **`optionalDependency`** per WO-30. Installed only with `--with-previs`.
- YOLOv8n-Pose ONNX model — pre-exported, downloaded into `<data>/models/yolov8n-pose.onnx` during `--with-previs` install.
- Existing: go2rtc WebRTC streams (used by the camera-source UI, not by detection).
- Existing: DMX sampling pipeline architecture from `src/sampling/` (pattern reused by `src/tracking/frame-source.js`).
- WO-17 (3D Previs) for 3D position visualisation.
- WO-31 (Stage Auto-Follow) for the primary consumer of tracking data.

---

## Work Log

### 2026-04-21 — Agent (Revision: YOLOv8-only, module gating, Companion sink)

**Work Done:**
- Dropped the browser-MediaPipe Phase 1 per operator direction; server-side YOLOv8n-Pose + ByteTrack is now the single primary path.
- Refactored Phase 1 task list to reflect the server pipeline (`src/tracking/session.js`, `frame-source.js`, `byte-track.js`, `engine.js`).
- Consolidated the old Phase 3 into Phase 1 so ONNX isn't mentioned twice.
- Retargeted Phase 4 (external integration) to Companion-primary; OSC-out explicitly deferred.
- Added `z` to `stagePosition` in the broadcast payload for forward-compat with head-height estimation.
- Pinned frame-source v1 to the FFmpeg-consumer pattern; noted that no public CasparCG fork supports GPU zero-copy, so that path stays on the "future" shelf.
- Attached to the Previs module umbrella (WO-30) for packaging, feature flag, and deletion story.

**Status:** Revised. Implementation pending; blocked on WO-30 registry (T30.1–T30.4).

**Instructions for Next Agent:** Implement WO-30 Phase 1 first. Then T1.1–T1.5 here land the server-side pipeline. Calibration (T2.x) is the operator-visible quality gate — do it thoroughly before wiring WO-31.

---
*Work Order created: 2026-04-12 | Revised: 2026-04-21 | Parent: [WO-30](./30_WO_PREVIS_TRACKING_MODULE.md)*
