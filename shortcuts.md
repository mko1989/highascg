# HighAsCG Web UI Shortcuts

Here is a list of keyboard shortcuts available in the HighAsCG web UI, grouped by the workspace or feature they apply to. Note that `Ctrl` can generally be substituted with `Cmd` on macOS.

## Global
- **`Ctrl` + `,`**: Open the Settings Modal.
- **`Escape`**: Closes most open dialogs or modals (e.g., Settings, Logs, USB Import, Audio Mixer).

## Scenes Workspace
- **`Space`**: Take the current preview to the program output. *(Disabled when typing in an input field)*.

## Timeline Workspace
- **`Space`**: Toggle play/pause for the active timeline.
- **`Ctrl` + `C`**: Copy the currently selected clip or flag.
- **`Ctrl` + `V`**: Paste the copied clip or flag at the playhead position.
- **`Delete` / `Backspace`**: Delete the currently selected clip or flag.
- **`Shift` + `Arrow Left` / `Arrow Right`**: Jump the playhead to the previous/next snap point (e.g., clip edges, flags, timeline boundaries).
- **`Alt` + `Arrow Left` / `Arrow Right`**: Move the selected clip or flag to the previous/next snap point.
- **`Arrow Left` / `Arrow Right`**: Nudge the selected clip or the playhead left/right by exactly one frame.
- **`Enter`**: When the timeline has focus, immediately focus the current timecode input field.

### Clip Keyframe Shortcuts
When a clip is selected in the timeline, you can use these shortcuts to quickly add keyframes at the playhead position:
- **`I`**: Add opacity fade-in keyframes (0 to 1) over the first 500ms of the clip.
- **`O`**: Add opacity fade-out keyframes (1 to 0) over the last 500ms of the clip.
- **`P`**: Add a position keyframe based on the clip's current placement.
- **`S`**: Add a scale keyframe.
- **`V`**: Add a volume keyframe.
- **`T`**: Add an opacity keyframe.

## Inspector & Number Fields
When focusing on number inputs within the Inspector panel:
- **`Arrow Up` / `Arrow Down`**: Increment or decrement the numeric value. Hold **`Shift`** to nudge by a larger step.
- **`Enter`**: Commit the entered value and blur the input field.

## Device Setup (Map Workspace)
- **`Ctrl` + `Z`**: Undo the last cable action.
- **`Delete` / `Backspace`**: Remove the currently selected cable (edge) between devices.

## Previs 3D Viewer
- **`1` - `9`**: Recall a saved camera preset view by its index.
- **`F`**: Frame the currently selected mesh (automatically moves the camera to focus on the object).
- **`G`**: Toggle the visibility of the ground grid.
- **`W`**: Toggle global wireframe rendering mode.
- **`Escape`**: Clear the current 3D object selection.
