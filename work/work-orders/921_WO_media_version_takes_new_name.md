# WO-921 — Media versions: the new version's file name replaces the old one in the media browser and in every look

**Area:** media, godot-client
**Status: OPEN**

Owner, 01.11.26:
> Check the media file versioning workflow. I also need for it to change the file name in media browser and in looks to
> the latest version so the user is sure it's using the new version and not the old one.

Parents: [WO-592](./592_WO_media_library_links_versions_inspector.md) B (version control) and
[WO-775](./775_WO_media_version_container_change.md) (a version may change the container).

## Investigation

- **The design premise is the opposite of the request.** The `src/media/media-versions.js` header says "A file's PATH
  stays put across versions (so every look … plays the newest without any rewrite)". `targetFor()` keeps the current
  path and changes only the extension when the container differs (WO-775). Uploading `intro_v3.mov` as a new version
  of `intro_v2.mov` therefore leaves the media browser and every look reading `intro_v2.mov`. The operator cannot tell
  from the name which version plays.
- **The upload loses the name.** `routes-media-versions.js handleVersionUpload` stages the upload as
  `.incoming-<ms><ext>` (`stagingPathFor`). Only the extension of `info.filename` survives. Both clients send the real
  name in Content-Disposition (`godot/client/core/stream_upload.gd:35`, web FormData).
- **Stashed versions forget their names.** They are stored as `v<n><ext>` with no record of what they were called, so
  Go back can only restore the current stem with the old extension.
- **The rewrite machinery already handles a full rename.**
  - `media-links.js applyRenamesToProjects`: the active show goes through persistProject + project_sync, the others
    are written on disk.
  - `media-reference-rewrite.js rewriteProjectMediaRefs` rewrites path-shaped, project-relative and CLS
    (extension-less) values in their own shape.
  - `rewriteLabel` follows a label equal to the old path, basename or stem.
  - Its pre-move existence judgement (`froms` count as existing, `tos` as not) also fits a version install, where the
    old file has already been stashed.
- **The UI texts promise the old behaviour.** Godot `features/live/media_versions.gd _confirm_upload` and the web
  `client/components/inspector-media-file-versions.js:71` both say "Every look plays the new version" and only mention
  a new extension.

## What was done

Nothing yet.

## What was verified

Nothing yet.
