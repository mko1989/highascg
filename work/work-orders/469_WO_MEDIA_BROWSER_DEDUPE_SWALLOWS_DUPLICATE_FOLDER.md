# WO-469 — Media browser: the exfat folder shows empty when the same files exist on the bridge

**Status: DONE (2026-08-10 — root-caused from the live `/api/media` body, fixed, smoke pinned; suite 1935/0/2). Owner QA: reload the GUI on highascg7579 after deploy.**

**Source:** owner, 2026-08-10 on highascg7579 — "still in the gui the exfat (stick) folder is empty
even though the media is in both", with `ls` proving the same eight files under
`/home/casparcg/exfat/media` and `/home/casparcg/bridge/media`.

## Investigation

`GET /api/media` on the box returned the exfat folder as a row with **no children**, while every
bridge file was listed:

```
DIR  bridge
FILE bridge/06f - J Lin - ... .mp4          ← all 8 present
...
DIR  exfat                                   ← no children at all
DIR  projects
DIR  projects/new_project_1
```

Ruled out first, with evidence rather than inference:

- **Not the scanner.** `scanMediaRecursiveForBrowser` (`src/media/local-media-paths.js:206-209`)
  pushes a directory then immediately walks it; `projects/` produced its child, so `walk()` works.
- **Not the mount.** `home-casparcg-highascg-media-exfat.mount` is active and the host lists the
  files. Both binds are visible **inside the service's own namespace**
  (`/proc/<MainPID>/mountinfo` carries `8:19 /media … media/exfat`), the service and the shell share
  one namespace (`mnt:[4026531841]`), and `PrivateMounts=no ProtectHome=no ProtectSystem=no`. Two
  earlier hypotheses — a private mount namespace, and a bind established before the stick mounted —
  were both **disproved** by that output.

The fault is in dedupe. `getRawMediaCatalog` (`src/api/media-catalog.js:51`) ends with
`dedupeMediaList`, which keyed rows on `canonicalMediaBasenameKey` — and that function strips the
directory outright:

```js
.replace(/^.*\//, '')       // "exfat/" and "bridge/" alike
.replace(/\.[^./]+$/, '')   // extension
```

So `exfat/TALK2.mp4` and `bridge/TALK2.mp4` both key to `talk2`, `mergeMediaRows` folds them into
one row, and its `localeCompare` tie-break puts `bridge/` first. **Every exfat file was swallowed by
its bridge twin.** The folder row survived (key `exfat`, no collision), which is exactly the reported
shape: a folder that is present but empty.

This only became visible once something copied the stick payload onto the bridge disk (see WO-468
§3) — before that the names did not collide. Measured on the box's real list: 18 rows collapsed to
**10** distinct keys under the old scheme, **18** under the new one.

The dedupe is there for a real case — Caspar CLS lists the same clip with different casing, with and
without extension, and with `_h265`-style variants — but that is always *within one folder*. Two
files with the same name in different folders are two different media.

## What was done

`src/utils/media-browser-dedupe.js` — added `canonicalMediaRowKey(id)`: the existing canonical
basename **scoped to its lowercased directory**. `dedupeMediaList` now keys on it.

`canonicalMediaBasenameKey` is deliberately left directory-blind and still exported unchanged —
`src/media/caspar-cls-id.js:90` and `src/state/playback-tracker-media.js:68` use it to resolve a bare
clip name that carries no path, and scoping those would break Caspar id matching. Only the browser
dedupe is folder-aware.

## What was VERIFIED to work

- Replaying the box's own eight filenames present in both folders: **bridge 8 / exfat 8** after the
  fix (exfat 0 before). Within-folder merges still collapse (`BRIDGE/TALK2` + `bridge/TALK2.mp4`
  → one row; `clip_h265.mp4` + `clip.mp4` → one row).
- New `tools/smoke/smoke-media-dedupe-folder-scope.test.js` (registered in the curated `FILES` list)
  pins: both folders keep all eight; the folder row survives; cross-folder no longer merges;
  CLS casing/extension and encoding-tag variants still merge inside a folder; nested paths scope by
  full path; backslash/duplicate-separator normalisation; and that the loose key stays
  directory-blind for the two matching call sites.
- `npm run test:ci` → **1935 tests, 1933 pass, 0 fail, 2 skipped**. eslint 0. 0 files over 500 lines.

## Noted, not fixed (separate, cosmetic)

`canonicalMediaBasenameKey`'s `\.[^./]+$` extension strip eats part of a dotted filename:
`CONFERENCE ACKNOWLEDGEMENTS 3.16.2026 REV3` → `conference acknowledgements 3.16`. That is why the
CLS row and the disk row for that clip appear as two entries in the live `/api/media` body. Present
before this change and unaffected by it.
