# WO-134 — Flow: HTTP REST & WebSocket UI State

**Parent:** [WO-83 index](./83_WO_INTERACTIVE_PROJECT_MAP.md)  
**Status:** Completed  
**Nodes:** `net:http`, `app:highascg-client`

---

## Endpoint Flow Documentation

This document explicitly maps out the interaction chain that results in real-time UI updates across multiple operator browsers.

### 1. Initialization (This does that)
The HighAsCG Node.js backend starts an HTTP/Express server and attaches a WebSocket (`ws`) server on port 4200. The operator navigates to this address in Chrome, downloading the `dist-web` static assets (the Single Page Application), which immediately opens a persistent WebSocket connection back to the server.

### 2. Execution Mechanism (In that way)
When an operator interacts with the UI (e.g., clicking "Take Scene"), the frontend fires a REST API `POST` request or a WebSocket message to the server. The Node server parses this command, validates it against the active `ProjectStore`, and mutates the internal application state. The server then utilizes the `wsBroadcast` utility to serialize the state difference (JSON) and flush it to all connected WebSocket clients.

### 3. Final Result (Which results in that reacting this way)
As a result, all operator browsers (including those on different computers, tablets, or remote locations) receive the WebSocket JSON payload. The Vue/Vanilla-JS frontend reacts by patching its local reactive state, which immediately re-renders the DOM. This results in the entire team seeing the "Take Scene" button illuminate and the timeline progress synchronously in under 5ms, creating a unified control surface.
