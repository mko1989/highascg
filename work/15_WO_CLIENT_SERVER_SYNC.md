# Work Order 15: Client-Server Preshow Sync & Split Architecture

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Enable HighAsCG to run locally on a user's laptop as a "Preshow/Preparation Studio" (without a CasparCG engine required), while providing a seamless, one-click mechanism to publish the full show (HighAsCG configuration, CasparCG configuration, and all relevant media files) to the remote production HighAsCG server running alongside CasparCG on Ubuntu.

Rather than zipping entire directories, the sync mechanism should compare local file paths/hashes against the remote server and intelligently upload missing or modified assets sequentially.

## Current State

- HighAsCG currently integrates with CasparCG and expects to be co-located or at least network-connected to a CasparCG server.
- While "Offline Preparation Mode" (WO-14) allows metadata caching and draft syncing, it does not fully encompass deploying massive media files directly from the local laptop to the remote production server.
- The `install.sh` has fortified the production server to accept uploads directly to `/opt/casparcg/media`, but requires bridging a local HighAsCG instance to the remote HighAsCG instance.

## Tasks

### Phase 1: Local Media Management & Thumbnails
When running HighAsCG locally without a CasparCG backend, media files uploaded into the UI must be processed locally so the user can build scenes.
- [x] **T1.1** Universal Media Drag & Drop: Allow users to drag and drop media files into the Sources panel regardless of the active tab (e.g., if on 'Live', drop should still accept the file and auto-switch to the 'Media' tab).
- [x] **T1.2** Online vs Offline Ingest: In Online mode, dropping a file triggers an immediate upload to the server. In Offline (Preshow) mode, dropping a file stores the local path reference, copies it to the local project folder, and extracts a thumbnail locally.
- [x] **T1.3** Plus Icon Ingest Menu: Replace the current plain "upload/ingest" UI with a "+" icon button. Clicking it opens a small drop-up menu with two options: "Open file" (native file picker) and "Paste a link" (URL/WeTransfer download).
- [x] **T1.4** Sync-Time Processing: In Phase 3, the sync engine will collect all media files from their stored local offline locations and upload them sequentially to the server.

### Phase 2: Configuration & Show Packaging
- [x] **T2.1** Show Data Bundling: Add logic to serialize the complete local state (`highascg.config.json` preferences, `state.json` scenes & timelines, and generated `casparcg.config` XML settings).
- [x] **T2.2** Media Reference Map: Build a JSON-based manifest of all media files used in the current project or residing in the local media directory, including their file sizes, relative paths, and modification timestamps/hashes.

### Phase 3: Intelligent "Publish to Server" Sync Engine
- [x] **T3.1** Server Connection Identity: UI to define the Target Production Server (IP/Hostname + Auth) in the Settings or a dedicated "Publish" modal.
- [x] **T3.2** Manifest Diff API: Create a `/api/sync/manifest` endpoint on the production server that takes the local manifest, compares it to its own `/opt/casparcg/media` directory, and returns a checklist of files that need to be uploaded.
- [x] **T3.3** Sequential Upload Queue: A local queue worker that iterates over the required files and uploads them sequentially to the production server's ingest API (`/api/ingest/upload`).
- [x] **T3.4** Configuration Handoff: Once all media is successfully uploaded, `POST` the serialized state and configurations to the production server and trigger a server and/or CasparCG restart if required.

---

## Technical Considerations

- **Cross-Platform:** The local laptop could be macOS or Windows. Rely on vanilla Node.js `fs` handling and bundle a generic `ffmpeg-static` for thumbnail generation, or ensure the laptop user has `ffmpeg` in their path.
- **Bandwidth/Resilience:** The sequential file upload must handle large files (e.g., 200GB Prores files) properly. Ensure chunking or stream piping so the laptop's RAM doesn't overflow during upload.
- **JSON Manifest:** Avoid local `.zip` file generation, as 200GB zips will duplicate local storage usages and impose massive wait times.

---

## Work Log

### 2026-04-06 | Antigravity - Sync Engine Implementation
- **Publish Modal**: Created `web/components/publish-modal.js` featuring a multi-step sync UI (Bundle → Diff → Upload → Apply).
- **Differential Sync**: Implemented `/api/project/diff` to identify only missing or size-mismatched files on the target server.
- **Media Streaming**: Added `GET /api/ingest/preview` to the server to allow the client to stream local media blobs to the remote server during sync.
- **Directory Structure Persistence**: Enhanced `handleUpload` in `routes-ingest.js` to support a `path` field, preserving directory hierarchy on the production server.
- **Atomic Handoff**: `handleApplyBundle` now automatically clears `offline_mode: true` on the production server and triggers a service restart (`process.exit(0)`).
- **UI Integration**: Updated `HeaderBar` with "Sync to Local" and "Publish to Live" buttons, styled with modern status indicators and progress bars.

**Instructions for Next Agent:**
- Perform end-to-end testing with a real production server instance.
- Monitor large file uploads (200GB+) to ensure browser `Blob` memory usage and network timeouts are handled gracefully.
- Consider adding a "Dry Run" mode to the Publish modal to estimate bandwidth requirements before starting.

---
*Work Order updated: 2026-04-06 | Parent: 00_PROJECT_GOAL.md*
