# WO-921 — Media versions: the new version's file name replaces the old one in the media browser and in every look

**Area:** media, godot-client
**Status: DONE (01.11.26 — offline 5205/0, Godot 25745/0, live Godot GUI: upload renames media list + looks, take plays the new file, Go back, purge)**

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

- **`src/media/media-versions.js`**
  - New `versionFileName(raw)`: one safe path segment. It normalises to NFC, keeps only the basename (also for `\`
    paths), drops control characters, and refuses a name with no extension or a leading dot.
  - `targetFor(config, e, file, name)`: with a name, the target is that name in the current file's folder. Without
    one, the WO-775 rule applies (the extension follows).
  - `targetClash` refuses a target that another file already holds (409, nothing moved). A case-only change of the
    same file is not a clash.
  - `stash()` records the replaced file's `name`. `restoreVersion` passes that name, so Go back brings the old name
    back. Versions stashed before WO-921 have no name and keep the WO-775 behaviour.
  - `installNewVersion(…, { name })`.
- **`src/api/routes-media-versions.js`**: the multipart `info.filename` is cleaned with `versionFileName` and passed
  through. The journal line names the new path.
- **Godot `features/live/media_versions.gd`**:
  - The confirm reads "The new version keeps its own name: the media list and every look will read "<new>"", or
    "Every look plays it." when the name is the same.
  - Old version rows show their name ("intro_v2.mov · replaced …"); a long name elides with a tooltip.
  - The pure texts moved to the new `media_versions_model.gd`, so tests can load them, and the unused `ext_of` was
    removed.
- **Web `client/components/inspector-media-file-versions.js`**: the same confirm text and named rows.
- **Why rename and not a badge.** The owner wants the name itself to prove which version plays. The rename machinery
  (WO-592 A, `applyRenamesToProjects`) already rewrites every reference, including the server's live deck through
  `persistProject`, so this changes only where the file lands. Keeping the old name plus a "v3" tag was rejected: the
  look would still read the old file name.
- **Not changed.** A clip that is on air keeps playing the old file, because Caspar holds the inode (WO-592). The next
  take plays the new version under the new name.

### Follow-ups found in the live GUI pass (01.11)

- **A look named after its clip kept the old name.** A drop on the deck names the look by the clip's stem
  ("intro_v2"). After the upload it played intro_v3 but its card still read "intro_v2". `media-reference-rewrite.js`
  `forEachProjectMediaRef` now hands the owning look or timeline to the visitor. `rewriteProjectMediaRefs` puts the
  look's `name` through `rewriteLabel`, so a name equal to the old path, basename or stem follows. A look the operator
  named ("Opener") keeps its name. Plain renames (WO-592 A) get the same behaviour.
- **The open look editor showed the old file.** With a PRV bus, the editor frame is Caspar's PRV channel. PRV is
  restaged only by local edits, so after a server-side rewrite it kept playing the replaced file (red "VERSION 3"
  under a layer labelled intro_v4.mp4). `look_editor_backdrop.gd` `open()` now records the look's media
  (`sources_key`). `follow_media()`, run from the editor's `Store.project_changed`, schedules a PRV push when that
  media changed (not on a move or resize). It lives in the backdrop file because `look_editor_stale.gd` references
  the Store autoload, which the headless test runner can't compile, and `look_editor.gd` is at 500 lines.
- **Media inspector, Godot:**
  - "Used in" was fetched once, when the file was selected. Dropping the clip onto a new look left it reading "Not
    used in any look or timeline". It now refetches 0.5 s after `Store.project_changed`, and only the label changes
    (`_show_usage`), so a trim field being typed in keeps its text.
  - The facts line said "0.0 MB" for a 23 kB file; under 1 MiB it now shows kB.
- **Purge confirm** names the file: "Delete version v3 (intro_v4.mp4) permanently?". This is
  `media_versions_model.gd purge_text` in Godot and the `data-name` attribute in the web client.
- **The next TAKE after a version failed its PGM→PRV exchange.** A take flips the look that was on air back onto PRV
  from its `scene.live` snapshot (`routes-scene-take.js` `previousPgmScene`). The snapshot still held the old path,
  so the journal showed `cmd="LOADBG 3-10 _WO921/INTRO_V2 …" reply="404 LOADBG FAILED"` and the GUI showed "TAKE ⚠ 1
  command(s) failed". `media-links.js applyRenamesToProjects` now also runs `applyRenamesToLiveLooks`, which rewrites
  every `scene.live` channel's look (path and look name, with `updatedAt` kept) and broadcasts `scene.live`. Caspar
  keeps playing the open file, so only the snapshot changes. Renames get the same fix.

## What was verified

- **Offline suite:** `node tools/ci/run-offline-tests.js` passed 5206, failed 0.
  - `smoke-wo921-media-version-name.test.js` has 9 tests (the 9th: the on-air snapshot follows), among them a real multipart POST through
    `handleVersionUpload`, a 409 on a name clash, Go back to the old name, a pre-WO-921 version, and look-name follow.
- **Godot suite:** 25745 passed, 0 failed. `test_media_versions_wo921.gd` covers the confirm text, the row names, the
  purge text and the PRV restage on a media change only.
- **Gates:** the 500-line check and eslint are clean. The one warning in `inspector-media-file-versions.js:34` was
  already there. `npm run build:client` was run.
- **Live, in the Godot GUI** (test client on Xvfb :120 against the box server; New project "Untitled 2"; clip
  `media/_wo921/intro_v2.mov`, whose frames read "VERSION 2"):
  1. I dropped the clip on a new look and picked New version… → `intro_v3.mov`. The confirm read "…the media list
     and every look will read "intro_v3.mov"". The journal shows
     `[media-versions] _wo921/intro_v2.mov: new version v2 as _wo921/intro_v3.mov` and
     `… → _wo921/intro_v3.mov; 1 reference(s) in 1 project(s) follow`.
     - On disk there is only `intro_v3.mov`.
     - The media tree, the inspector title and the look's layer all read intro_v3.mov.
     - The deck thumbnail turned red "VERSION 3", and the row reads "v1 intro_v2.mov · replaced …".
     - TAKE: Caspar `INFO 2` shows `_WO921/INTRO_V3` playing.
  2. A new version from `intro_v4.mp4` (container change) gave `new version v3 as _wo921/intro_v4.mp4`. The look was
     rewritten and its thumbnail turned green "VERSION 4 MP4".
  3. Go back v1 gave `restored v1` and `_wo921/intro_v4.mp4 → _wo921/intro_v2.mov`. The name came back everywhere
     and the thumbnail is "VERSION 2".
  4. Purge v3: the confirm appeared and `data/media-versions/<id>/v3.mp4` is gone. A re-take shows `INFO 2` =
     `_WO921/INTRO_V2`.
  5. After the follow-ups and a server restart, I re-ran the flow with the editor open on the look "intro_v2":
     - New version intro_v4.mp4 renamed the look to "intro_v4".
     - "Used in" showed both looks within a second of the drop.
     - Go back v1 turned the look back into "intro_v2". The journal shows `[scene-take] preview-only path prv=3`
       right after the restore, and the editor frame showed blue "VERSION 2" under "L10 intro_v2.mov".
  6. The take exchange, after the scene.live fix and a server restart:
     - I took Look 1 and uploaded intro_v3.mov (`new version v5 as _wo921/intro_v3.mov`).
     - Taking look "intro_v3" gave `pgm->prv exchange done prvCh=3` with no failed command.
     - Caspar `INFO 2-10` and `INFO 3-10` both show `_WO921/INTRO_V3`.
     - The one 404 just before it, at 12:59:19 (`LOADBG 3-10 _WO921/INTRO_V4`), came from a snapshot written before
       the fix.
- **Not covered:** a clip on air during the upload keeps playing the old file until the next take (by design,
  above). The header's on-air strip honestly names the file that is actually playing.
