# Work Order 46: Layer Playlists (List Workflow)

## Objective
Implement a "list" workflow for individual layers in the scene composer, allowing users to queue multiple media files on a single layer to act as a playlist, complete with auto-advance and transition settings.

## UI/UX Requirements
1. **Layer Inspector Toggle:** 
   - Add a small dropdown at the top of the layer inspector with two options: `1. single` (the current default workflow) and `2. list`.
2. **List Management:**
   - When set to `list`, display a drag-and-drop area underneath the dropdown.
   - Users can drop multiple media files (videos/images) into this list.
   - Users should be able to reorder items via drag-and-drop and remove items.
3. **Image Durations:**
   - For image media added to the list, provide an input field to explicitly set the duration the image should be displayed before advancing.
4. **Transition Settings:**
   - Provide a global list setting for transitions between clips in the playlist (Transition Type and Duration in frames).
5. **Playback Modes:**
   - **Looping:** Toggle to either loop the entire list continuously or play through it once and stop.
   - **Advance Mode:** 
     - `Auto Advance`: When one clip finishes, it automatically plays the next.
     - `Manual Next`: It plays the current video and stops/pauses at the end. The user must hit "Play" (or trigger the look again) to fire the next item in the list.

## Engine/Backend Requirements
1. **Schema Updates:**
   - Update `layer` data model in the scene state to support the `listMode` toggle, an array of media sources, transition settings, and playback behavior toggles.
2. **Auto-Advance (LOADBG AUTO):**
   - For `Auto Advance` mode, the backend must utilize CasparCG's `LOADBG ... AUTO` command. 
   - When the first item is PLAYed, the system should immediately issue a `LOADBG` command on the same channel/layer for the *next* clip in the list, appending `AUTO` and the defined transition string. This ensures frame-accurate, gapless playback as soon as the first clip ends.
3. **Manual Advance State Tracking:**
   - For `Manual Next`, the backend needs to track the playhead/index of the list. Re-triggering the scene or hitting play should advance the index and play the next clip.
4. **Image Handling:**
   - If an image is in the list with a set duration, the engine may need to use OSC/timeline tracking or Caspar's internal clipping/duration features (if available for stills) to trigger the `LOADBG AUTO` or next command at the appropriate timestamp.

## Implementation Steps
- [x] **Phase 1: Data Model & UI Layout**
  - [x] Extend the `sceneState` store to support layer arrays and playlist properties.
  - [x] Build the React/Vanilla UI for the dropdown, list rendering, and drag-and-drop sorting in the Layer Inspector.
- [x] **Phase 2: Backend AMCP Logic**
  - [x] Modify `resolveLayerFillForAmcp` and `pushSceneToPreview` / `takeSceneToProgram` to handle `list` layers.
  - [x] Implement the `LOADBG AUTO` appending logic for smooth looping/auto-advance.
- [x] **Phase 3: State Tracking & Manual Next**
  - [x] Implement server-side or client-side index tracking for the `Manual Next` workflow, ensuring it survives tab switches and routes to PGM correctly on take.
- [x] **Phase 4: Testing & Edge Cases**
  - [x] Test transitions between mixed media (video -> image -> video).
  - [x] Test manual next synchronization between PRV and PGM.
