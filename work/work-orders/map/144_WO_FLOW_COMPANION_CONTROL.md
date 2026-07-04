# WO-144 — Flow: Companion Control

**Parent:** [WO-83 index](../83_WO_INTERACTIVE_PROJECT_MAP.md)  
**Status:** Completed  
**Nodes:** `svc:companion`, `app:companion`

---

## Endpoint Flow Documentation

This document explicitly maps out the interaction chain that bridges physical tactile button pushes to the software execution pipeline.

### 1. Initialization (This does that)
The `companion.service` unit boots Bitfocus Companion in a headless background daemon on the server. The Companion software initializes USB drivers, discovers physically attached Elgato StreamDecks, and illuminates their LCD buttons according to its internal page configurations.

### 2. Execution Mechanism (In that way)
An operator physically presses a tactile button on the StreamDeck. The USB interrupt triggers the Companion daemon, which looks up the assigned action for that button. The action is configured to fire a REST API `POST` or a generic OSC string message targeted at `localhost` (the HighAsCG backend). 

### 3. Final Result (Which results in that reacting this way)
As a result, the HighAsCG server receives the HTTP/OSC payload from Companion. The server parses the payload, validates it against the active state (e.g., "Play Video 1"), and reacts by mutating the UI state for all connected browsers and pushing the actual playout commands to CasparCG via AMCP. This creates a seamless, low-latency bridge between a physical button press and on-screen broadcast execution.
