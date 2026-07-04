# WO-140 — Flow: systemd Boot Sequence

**Parent:** [WO-83 index](../83_WO_INTERACTIVE_PROJECT_MAP.md)  
**Status:** Completed  
**Nodes:** `systemd`, `svc:casparcg-server`, `svc:highascg`, `svc:nodm`

---

## Endpoint Flow Documentation

This document explicitly maps out the interaction chain that boots the underlying operating system services in correct dependency order.

### 1. Initialization (This does that)
When the OS kernel finishes loading and hands control to `/sbin/init` (systemd), systemd parses the unit files inside `/etc/systemd/system/`. Based on target dependencies, systemd initializes the display manager `nodm.service` for X11, the `highascg.service` backend daemon, and the `casparcg-server.service`.

### 2. Execution Mechanism (In that way)
Systemd enforces strict execution order using `Wants=` and `After=` directives. The `highascg` Node backend starts immediately after the network stack is up. The `nodm` service starts up a bare-bones Openbox X11 session. Crucially, the `casparcg-server` service waits for `nodm` to establish the display server and for `mnt-bridge.mount` to ensure the NVMe high-speed storage is available before it executes its `run.sh` entry point.

### 3. Final Result (Which results in that reacting this way)
As a result, the OS arrives at a fully headless state where the Node server is listening for API calls, the X11 server is holding the physical GPU screens open, and CasparCG safely starts up knowing its required hardware storage and OpenGL display dependencies are met, reacting with a clean, crash-free launch.
