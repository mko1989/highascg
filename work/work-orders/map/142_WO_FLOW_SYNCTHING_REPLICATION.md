# WO-142 — Flow: Syncthing Replication

**Parent:** [WO-83 index](../83_WO_INTERACTIVE_PROJECT_MAP.md)  
**Status:** Completed  
**Nodes:** `svc:syncthing`, `app:syncthing`

---

## Endpoint Flow Documentation

This document explicitly maps out the interaction chain resulting in multi-node media synchronization.

### 1. Initialization (This does that)
The `syncthing.service` systemd unit boots alongside the application. It launches the Syncthing daemon, which reads its cluster configuration and begins polling the local `/home/casparcg/media` filesystem directories for file block hashes.

### 2. Execution Mechanism (In that way)
When an operator uploads a new video file to the Primary node via the web UI, Syncthing detects the filesystem delta (`inotify`). It chunks the file into cryptographic blocks and announces the new index to Backup nodes over a TLS-encrypted P2P TCP socket (port 22000). The follower nodes request the delta blocks in parallel. Syncthing on the followers pulls the binary blocks across the local network and reconstitutes the file natively on their NVMe storage.

### 3. Final Result (Which results in that reacting this way)
As a result, a multi-gigabyte media asset uploaded to a single server is rapidly, securely, and seamlessly replicated across the entire cluster. The HighAsCG server and CasparCG scanner on the backup nodes react to this newly materialized file by parsing it and making it immediately available for hot-standby playout, ensuring the entire server farm stays in perfect sync.
