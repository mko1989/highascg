# WO-130 — Flow: NVIDIA Screen Consumers

**Parent:** [WO-83 index](./83_WO_INTERACTIVE_PROJECT_MAP.md)  
**Status:** Completed  
**Nodes:** `nvidia:screen-consumers`, `x11:xrandr`, `nvidia:vblank`

---

## Endpoint Flow Documentation

This document explicitly maps out the interaction chain that results in hardware-accelerated video output on physical screens attached to the GPU.

### 1. Initialization (This does that)
The `casparcg-server.service` executes the `run.sh` supervisor, which spawns the CasparCG binary (`bin/casparcg`). Based on `casparcg.config`, the server initializes a **Screen Consumer** for each configured output channel. 

### 2. Execution Mechanism (In that way)
The Screen Consumer creates a borderless X11 window using OpenGL. This window is mapped to a specific logical display configured by the `xrandr` subsystem. To ensure performance, the `highascg-nvidia-x-apply.sh` script (invoked during Openbox autostart) disables the proprietary NVIDIA driver's "Sync to VBlank" feature for these specific consumer windows, circumventing forced compositor throttling.

### 3. Final Result (Which results in that reacting this way)
As a result, CasparCG renders video frames directly into the un-throttled OpenGL context at its internal broadcast framerate (e.g., 50fps or 59.94fps). The NVIDIA GPU driver pushes these frames directly to the connected physical displays (via HDMI/DisplayPort) without tearing or stuttering, ensuring broadcast-grade smoothness for live playout on stage monitors or LED walls.
