# WO-135 — Flow: AMCP Playout Control

**Parent:** [WO-83 index](./83_WO_INTERACTIVE_PROJECT_MAP.md)  
**Status:** Completed  
**Nodes:** `net:amcp`, `caspar:amcp:play`, `caspar:amcp:mixer`

---

## Endpoint Flow Documentation

This document explicitly maps out the interaction chain that results in CasparCG executing actual media playout commands from the backend.

### 1. Initialization (This does that)
Upon startup, the HighAsCG Node.js backend establishes a persistent TCP socket connection to CasparCG on `localhost:5250`, utilizing the Advanced Media Control Protocol (AMCP). The connection is kept alive, and dropped sockets are automatically retried by the reconnect logic.

### 2. Execution Mechanism (In that way)
When a scene requires playback, the Node server's Engine translates complex scene states into a sequenced batch of raw AMCP text strings (e.g., `PLAY 1-10 "media/video.mp4" MIX 25`, `MIXER 1-10 OPACITY 1`). The backend writes these strings over the TCP socket, flushing them into CasparCG's command queue. CasparCG's internal AMCP parser breaks down the ASCII command, locks the requested channel/layer, and schedules the underlying producer graph (e.g., FFmpeg) to load the asset.

### 3. Final Result (Which results in that reacting this way)
As a result, CasparCG executes the action on the next video frame boundary. The internal video layer reacts by decoding the specified media file and compositing it onto the master frame. CasparCG then replies over the TCP socket with a `202 OK` string, which the Node server reads to confirm successful execution, updating its internal state.
