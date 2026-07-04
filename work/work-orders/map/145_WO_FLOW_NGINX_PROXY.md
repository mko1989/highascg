# WO-145 — Flow: Nginx Proxy

**Parent:** [WO-83 index](../83_WO_INTERACTIVE_PROJECT_MAP.md)  
**Status:** Completed  
**Nodes:** `svc:nginx`, `app:nginx`

---

## Endpoint Flow Documentation

This document explicitly maps out the interaction chain that safely exposes the Node.js backend to external operator networks.

### 1. Initialization (This does that)
The `nginx.service` daemon boots on startup and binds directly to the privileged OS ports 80 (HTTP) and 443 (HTTPS). It reads the server block configurations from `/etc/nginx/sites-available/` pointing to the internal HighAsCG Node application port (e.g., 4200).

### 2. Execution Mechanism (In that way)
When an external tablet or laptop navigates to the server's IP address, the network traffic hits Nginx first. Nginx terminates the TLS encryption (if configured) and handles serving large static media files (like video thumbnails) directly from the filesystem, bypassing the Node process for performance. For dynamic API requests or WebSocket upgrade handshakes, Nginx acts as a reverse proxy, rewriting the headers and forwarding the TCP stream to the internal Node backend.

### 3. Final Result (Which results in that reacting this way)
As a result, the Node.js application never has to manage SSL certificates or deal with low-level network attacks. The backend reacts safely to clean, proxied request streams, while operators experience fast UI loads and secure WebSocket connections over complex production network topologies.
