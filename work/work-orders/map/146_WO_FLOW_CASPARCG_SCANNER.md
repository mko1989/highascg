# WO-146 — Flow: CasparCG Scanner

**Parent:** [WO-83 index](../83_WO_INTERACTIVE_PROJECT_MAP.md)  
**Status:** Completed  
**Nodes:** `svc:casparcg-scanner`, `app:casparcg-scanner`

---

## Endpoint Flow Documentation

This document explicitly maps out the interaction chain that bridges the physical filesystem with the Node.js media library database.

### 1. Initialization (This does that)
The `casparcg-scanner.service` systemd unit boots the official CasparCG Scanner binary. The scanner daemonizes and watches the `/home/casparcg/media` directory via kernel filesystem events (`inotify`), establishing an HTTP REST endpoint for polling.

### 2. Execution Mechanism (In that way)
When a new `.mp4` video file drops into the media directory, the scanner detects the creation event. It internally spawns a subprocess invoking `ffprobe` and `ffmpeg` against the new file. This subprocess extracts deeply technical metadata—such as framerate, codec, interlacing field order, audio channel layout, and duration—and generates a base64 thumbnail image. It caches this payload into its internal SQLite database.

### 3. Final Result (Which results in that reacting this way)
As a result, the HighAsCG Node backend, which routinely polls the Scanner's HTTP endpoint, receives the new metadata JSON payload. The backend reacts by patching its internal Vuex/Pinia media store, instantly updating the operator web UI with the new clip, its duration, and its thumbnail, without requiring the operator to hit refresh.
