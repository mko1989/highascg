# WO-472 — the GUI still empties the exfat folder: the client re-merges what WO-469 un-merged

**Status: DONE (11.08.2026, verified: repro reproduced + fixed in node against the real client
module, new smoke registered, offline suite + eslint green) — owner QA: reload the GUI with a
stick inserted and confirm both folders list their files**

Successor to [WO-469](./469_WO_MEDIA_BROWSER_DEDUPE_SWALLOWS_DUPLICATE_FOLDER.md), which fixed only
the server half of this bug.

## 1. Investigation

Owner 11.08: "even though the media files are both in exfat (stick) and bridge the gui only shows
the media in bridge folder" — with four `ls` listings proving all eight files are present under
`~/exfat/media`, `~/bridge/media`, `~/highascg/media/exfat` and `~/highascg/media/bridge`.

Same symptom as WO-469, one day after WO-469 shipped. Not a regression of that fix — the fix is
intact and still correct; it was simply incomplete.

**Not the mount, again.** `journalctl -b` shows `home-casparcg-highascg-media-exfat.mount`
(bind `~/exfat/media` → `~/highascg/media/exfat`) mounted 10.08 17:04:21 and the boot sync copying
the stick payload onto the bridge (`[exfat-sync] boot usb-media-ingest (usb): volume → project only
(copied=9)`). Both folders genuinely held the same eight names, which is the precondition for the
collapse.

**Where it still collapses.** `dedupeMediaList` (server) now keys on the folder-scoped
`canonicalMediaRowKey`, so `/api/media` returns 18 rows. But the client merges that HTTP list with
the WS `state.media` list a second time, and that merge kept the old key:

- [client/components/sources-panel-helpers.js:274](../../client/components/sources-panel-helpers.js#L274)
  `mediaCatalogMergeKey` — folders keyed `dir:<full path>`, files keyed
  `file:${normalizeMediaIdForMatch(raw)}`.
- [client/lib/mixer-fill.js:109](../../client/lib/mixer-fill.js#L109) `normalizeMediaIdForMatch`
  does `.replace(/^.*\//, '')` — it drops the directory by design, because `findMediaRow` resolves a
  layer `source.value` that carries a bare clip name with no path.

So `exfat/TALK2.mp4` and `bridge/TALK2.mp4` both keyed `file:talk2` and merged into one row. Which
id survives is decided by `preferMergedMediaId`'s last line, `b.length >= a.length ? b : a`: both
ids contain `/`, so it picks the LONGER string — and `bridge/` is exactly one character longer than
`exfat/`. Bridge therefore won every row, deterministically, for every one of the eight files. The
folder row itself is keyed `dir:` on the full path, has no collision, and survives — which is why
the operator sees an `exfat` folder that opens onto nothing.

Reproduced against the real module (node, importing
`client/components/sources-panel-helpers.js` directly), three files in both folders:

```
before: [ 'bridge/', 'exfat/', 'bridge/TALK2.mp4', 'bridge/leader2050_intro.mp4', 'bridge/M_czwartek_glowki frn26_28.png' ]
after:  [ 'bridge/', 'exfat/', 'bridge/…' ×3, 'exfat/…' ×3 ]
```

Consumers of the broken merge — all three call sites of `mergeMediaProbeOverlay`:
[sources-panel-render.js:78](../../client/components/sources-panel-render.js#L78),
[sources-panel-media-selection.js:67](../../client/components/sources-panel-media-selection.js#L67),
[sources-panel-project-gather.js:43](../../client/components/sources-panel-project-gather.js#L43) —
so the browser list, media selection and project gather all saw the same swallowed rows.

**State of the box while investigating (not the cause, worth recording):** the stick was pulled at
`Aug 11 10:01:17` (`usb 1-1: USB disconnect` → both mounts torn down), so `~/exfat/media` and
`~/highascg/media/exfat` are the bare empty mountpoints now; and `highascg.service` has been
`inactive (dead) since 10.08 13:40:31`, with nothing listening on 4200. The fix was therefore
verified offline, not on a live GUI.

## 2. What was done

- **client/components/sources-panel-helpers.js** — `mediaCatalogMergeKey` now scopes file rows to
  their folder: `file:<lowercased dir>/<canonical basename>`, the client-side mirror of the server's
  `canonicalMediaRowKey`. Separators are normalised (`\` → `/`, collapsed `//`) before the split so
  a backslash id still merges with its slash twin. The directory is lowercased so the merge that
  MUST happen still does: WS `BRIDGE/TALK2` (CLS is uppercase and extensionless) folds onto the disk
  scan's `bridge/TALK2.mp4`.
- `normalizeMediaIdForMatch` is left untouched and directory-blind — `findMediaRow` depends on it.
- **tools/smoke/smoke-media-browser-merge-folder-scope.test.js** (new, registered in the curated
  `FILES` list in `tools/ci/run-offline-tests.js`) — the eight real filenames in both folders must
  survive the overlay; the CLS-onto-disk merge inside one folder must still happen; root vs nested
  same-name files stay distinct; `normalizeMediaIdForMatch` stays directory-blind.

Why not fix `normalizeMediaIdForMatch` itself: it has a second, legitimate caller that matches a
path-less value. Scoping at the dedupe key is the same split WO-469 made server-side
(`canonicalMediaRowKey` vs `canonicalMediaBasenameKey`), and keeping the two halves symmetrical is
the point.

## 3. What was verified

- Repro before/after in node against the actual client ESM module (output above).
- `node --test tools/smoke/smoke-media-browser-merge-folder-scope.test.js` — 4/4 pass.
- Offline suite + eslint + max-file-lines: see the commit message for counts.
- `npm run build:client` rebuilt `dist-web/` (the GUI is served from there, not from `client/`).

**Not verified live:** no stick is plugged in and `highascg.service` is down, so the GUI list itself
was not observed. Owner QA: insert the stick, start the server, reload the GUI (F5), open Sources →
media browser and confirm `exfat/` lists its eight files alongside `bridge/`.
