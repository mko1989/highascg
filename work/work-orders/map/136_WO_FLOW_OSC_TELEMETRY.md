# WO-136 — Flow: OSC Telemetry

**Parent:** [WO-83 index](./83_WO_INTERACTIVE_PROJECT_MAP.md)  
**Status:** Completed  
**Nodes:** `caspar:osc:audio`, `caspar:osc:playback`, `net:osc`

---

## Endpoint Flow Documentation

This document explicitly maps out the interaction chain that results in high-frequency live telemetry arriving at the operator UI.

### 1. Initialization (This does that)
CasparCG is configured via `casparcg.config` to emit OSC (Open Sound Control) UDP packets to `127.0.0.1:6250`. The HighAsCG Node.js backend spins up an OSC UDP listener on port `6250`, which binds to the socket to receive these packets as buffer streams.

### 2. Execution Mechanism (In that way)
During active playback, CasparCG emits hundreds of OSC UDP datagrams per second. These packets contain encoded XML payloads detailing per-channel/per-layer audio meters (in dBFS), playhead frames, and profiler timings. The Node backend captures these packets, strips the OSC byte headers, and parses the payload into a structured JSON dictionary representing live telemetry state. Because this data is high-frequency, the backend heavily throttles/debounces it before dispatching it to connected clients.

### 3. Final Result (Which results in that reacting this way)
As a result, the backend flushes optimized JSON diffs over the WebSocket pipeline exactly 15-30 times per second. The frontend Vue/Canvas UI reacts to this data by rendering fluid, real-time audio VU meters and advancing the timeline playhead graphics, accurately reflecting CasparCG's live execution without overloading the browser's render thread.
