# WO-143 — Flow: CasparCG Producers

**Parent:** [WO-83 index](../83_WO_INTERACTIVE_PROJECT_MAP.md)  
**Status:** Completed  
**Nodes:** `caspar:producers`, `caspar:producer:ffmpeg`, `caspar:producer:html`

---

## Endpoint Flow Documentation

This document explicitly maps out the interaction chain that results in media assets and dynamic graphics being rendered into memory.

### 1. Initialization (This does that)
CasparCG receives an AMCP `PLAY` command specifying an asset on a channel layer. Depending on the asset type (e.g., `.mp4` video or HTML URL), CasparCG spins up the appropriate **Producer** module in a dedicated CPU thread.

### 2. Execution Mechanism (In that way)
For video files, the `FFmpeg Producer` allocates a decoding context. It reads the H.264/ProRes file from NVMe, leverages hardware/software decoders, and extracts raw video and audio frames, compensating for file framerate vs output framerate via frame blending or dropping. 
For HTML graphics, the `HTML Producer` instantiates an off-screen Chromium Embedded Framework (CEF) browser. It navigates to the URL, executes its JavaScript lifecycle, and renders the DOM into an ARGB texture bitmap at 50/60fps.

### 3. Final Result (Which results in that reacting this way)
As a result, both the FFmpeg decoding thread and the CEF rendering thread push perfectly timed, uncompressed ARGB frames into the CasparCG Core mixer queue. The Core reacts by compositing these layers sequentially (respecting alpha transparency), finally handing the mixed result to the output consumers for broadcast.
