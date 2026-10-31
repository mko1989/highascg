# WO-895 — Visuals playlists: an ordered list of looks and visuals that runs unattended

**Area:** godot-client
**Status: OPEN (31.10.26, owner-approved design; implementation queued after WO-890 dynamic visual layers)**

## Owner request

Owner, 31.10: *"there also needs to be an option to create playlists of visuals, so operator can set it up and forget."*

## Investigation

File references are as found on 31.10.26; to re-verify at implementation.

- The Visuals Show already has looks, an **Auto** mode that changes look every N bars or on drops
  (`features/visuals/visuals_autopilot.gd`, BARS [0, 4, 8, 16, 32]), and tap tempo.
- Visuals state lives in the project slice `project.visuals` (`{…, looks, auto, …}`). WO-880 resume restores it after a
  restart.
- Auto changes look on the bar counts above or on drops. No ordered sequence of looks exists yet (to re-verify at
  implementation whether Auto already keeps any order).
- Sources ▸ Visuals (WO-885) already gives draggable visuals and scenes, so the entries for a playlist can come from
  the same source.

## Design (approved 31.10.26)

- Named, ordered **playlists** in `project.visuals.playlists`. Each entry is a look or a visual (scene, shader, game).
- Entries are added by dragging from Sources ▸ Visuals or from the looks list.
- Each entry has a hold: a number of bars, a number of seconds, or until the next drop. Seconds is the fallback when
  there is no tempo lock.
- Playlist options: loop (default) or shuffle.
- The active playlist is driven by **Auto**: Auto advances to the next entry when its hold ends. Auto stays the single
  switch.
- The editor is a Visuals work-area mode (alongside 3D, Flow and Shader).
- Entries capture the WO-890 layer stack, so a multi-layer look replays as it was built.
- Survives restart through the WO-880 resume: the active playlist and position restore with the rest of the visuals
  slice.

## Acceptance / verification plan

- Create a playlist of three looks with mixed holds (bars, seconds, until drop). Run it with Auto on; each entry
  appears for its hold, in order, and loops.
- Shuffle: every entry plays once per pass; no entry repeats back to back when more than one is left.
- No tempo lock (tap tempo off): seconds holds advance on time.
- Stop Auto mid-entry, restart it: it resumes from the current entry or the next one, as stated in the editor.
- Restart the node with a playlist active: the playlist, its position and Auto state restore (WO-880 path).
- A multi-layer entry reproduces its layer stack, checked against the look it was saved from.
- Godot suite green, `run-client.sh --check` clean, no file over 500 lines.
- Box: probe client on a private Xvfb with `--tab=Visuals`; build a three-entry playlist through the probe, run it,
  screenshot each entry, and check the journal after a node restart.

## Dependencies

- **WO-890** (dynamic visual layers, per-layer shaders): entries capture the layer stack. Implementation waits for it.
- **WO-880**: resume after restart. The playlist state rides on the same slice.
- **WO-885**: Sources ▸ Visuals is the drag source for playlist entries.
- Autopilot (`features/visuals/visuals_autopilot.gd`): Auto becomes the playlist driver. Its existing look-cycling
  behaviour must stay the default when no playlist is set.
