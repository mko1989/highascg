# WO-775 — media versions: a new version may change the container (previz .mp4 → show .mov)

**Area:** media
**Status: DONE (26.10, bdf862ef) — offline suite 3365 / 0 / 2 skipped, smoke 8 / 8 (4 new), live API round trip on the
box (mp4 → ProRes mov → back), CI green (run 40316158890).**

Owner, 26.10:
> it doesnt let me exchange a version of a media file, because it says it needs to be the same file extension. there
> shouldnt be such a harnes. very commonly i get mp4 previz quality and then on show mov hap prores whatever.
> make sure it allows such changes

Parent: [WO-592](./592_WO_media_library_links_versions_inspector.md) B (version control), [WO-601](./601_WO_godot_port_inspector.md)
(Godot inspector port).

## Investigation

- Server refusal: `src/api/routes-media-versions.js:45` (HEAD 38002ed8) — `incomingExt !== ext` → 400 "the new version
  must be a .mov file". Staging used the OLD extension.
- Design premise in `src/media/media-versions.js` header: "A file's PATH never changes across versions (so every look
  … plays the newest without any rewrite)". A different container necessarily changes the path (`clip.mp4` → `clip.mov`),
  so the premise only holds per container.
- Both UIs repeated the rule: web `client/components/inspector-media-file-versions.js` (`accept=ext` + name check) and
  Godot `godot/client/features/live/media_versions.gd` (`FileDialog.filters = *ext` + `_confirm_upload` check).
- The rename machinery already rewrites every reference: `media-links.js applyRenamesToProjects` (active project via
  persistProject + project_sync, the rest on disk). `rewriteProjectMediaRefs` matches with-extension values by exact
  path and leaves extension-less CLS ids (`CLIPS/SHOW`) untouched — they stay valid across a container change.

## What was done

- `media-versions.js`: `targetFor(config, entry, file)` — the entry's path with the version file's extension when it
  differs; `targetClash` refuses (409, nothing moved) when another file already holds that name. `installNewVersion` and
  `restoreVersion` move to the target, set `entry.path`, and return `renamed: { from, to } | null`. Stashed versions
  keep their own extension (`v1.mp4`), so Go back restores the old container.
- `routes-media-versions.js`: any extension accepted (only "no extension" refused), staged with the incoming one;
  `afterChange` runs `applyRenamesToProjects` for a `renamed` result before the media rescan; restore is async; both
  replies carry `renamed`. `media-links.js` exports `applyRenamesToProjects`.
- Web: no `accept` filter / name check; confirm says "The file becomes <name>.<ext>"; `reselect(res)` dispatches
  `media-library-changed { renamed }` so the Sources selection follows.
- Godot: no filter / check, same confirm line; `changed(new_id)` carries the reply's `renamed.to`, and
  `media_inspector.gd` re-shows the row under the new id.

Why not keep the old path with a mismatched extension: Caspar and ffprobe pick the demuxer by content, but the media
list, HAP/ProRes badges and every operator's reading of the name would lie.

## Verified

- `tools/smoke/smoke-wo592-media-versions.test.js`: mp4 → mov (entry follows, old kept as v1.mp4), same-container
  version reports no rename, Go back moves the path back, clash → 409 with nothing moved, references follow (3 refs;
  CLS id unchanged). 8 / 8; with media-links 22 / 22. Offline suite 3365 pass / 0 fail / 2 skipped. Lint 215 ≤ 216.
- Live (node restarted): a 2 s test mp4 + a 3 s ProRes mov in `media/_ver_ext_test/`; upload → `renamed` mp4 → mov,
  `/api/media` probed it as `prores` 25 fps; restore v1 → back to mp4; deleted through `/api/media/delete` (versions
  store removed).
- Owner QA: a real previz → show swap on a look that uses the clip (looks/timelines follow live).
