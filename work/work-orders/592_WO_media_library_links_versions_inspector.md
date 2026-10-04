**Status: DONE (2026-10-04, offline suite + live on the box) — A links, B versions, C inspector, D multi-rename, trim/mute defaults, final delete, mojibake repair. Owner QA: look layer picks up file trim/mute on drop; remote browser view; .stignore mirror on the Mac.** Nothing implemented. Box was on show: no measurements that load the CPU/GPU were run.**

# WO-592 — Media library: stable links, version control, media inspector, multi-rename

Owner, 04.10: "i need quality of life operations on files, but i also need version control. so i
think a system where it creates links to the actual files, and any moving, renaming is done to the
link. the link is referenced in all the looks timelines etc. version control should be in the files
inspector which is not a thing yet. media files inspector is top preview (for video files … a player
in the webui which gets the file served directly) (tell me about performance hit for that). waveform
for audio. under play pause trimming controls. mute toggle. delete should be final for the file."
Follow-up: "ability to multi-rename. select multiple files that are called similarly with numbers
and be able to change the 'title' but leave the numbering. (not an automatic thing, needs explicit
user interaction)". Quick fixes from the same message: WO-591.

## Investigation

**How references work today.** Looks, playlists and timelines store the raw relative path *with
extension* as `source.value` / playlist item `value` (e.g. `projects/_autosave/npcc.json`: 73
refs like `Tlo Orange Ball/BAZA 2.mp4`). That string goes straight to Caspar (`PLAY … "path"`).
`POST /api/media/move` (`src/api/routes-media.js` `handleMediaMove`) moves the file and rescans
but rewrites no reference, so **every move/rename today silently orphans the clip in every look**
(the UI shows it as missing via `client/lib/media-exists.js` `clipMissing`).

**What already exists and is reused:**
- Waveform peaks: `GET /api/local-media/<id>/waveform?bars=N` with an on-disk cache
  (`src/media/local-media-api.js` `HANDLERS.waveform`, `data/waveforms`, already in `.stignore`).
- ffprobe: `GET /api/local-media/<id>/probe`.
- Raw file: `GET /api/local-media/<id>/file`. It streams the whole file as an
  `attachment`, with **no HTTP Range / 206 support**, so a `<video>` element can't seek it.
- Per-look transport and trim (WO-570): pause/resume/seek routes, `trimIn/trimOut` on scene layers,
  LENGTH wiring, and the WO-582 rule that every SEEK needs an explicit `IN`.
- Multi-select, copy, move and delete (`sources-panel-media-selection.js`, `media-file-ops.js`).

**Library codecs** (ffprobe of every video file under `media/`, 691 GB, 418 files):

| codec | files | browser-playable? |
|---|---|---|
| NotchLC (5760×1728, 1920×2304) | 131 | no |
| HAP (various up to 5760×1728) | 58 | no |
| ProRes HQ/4444 (2560×1024, 3840×1344) | 53 | no |
| H.264 (1080p, 3840×1344) | 15 | yes |
| DV / rawvideo | 3 | no |

**Disk:** `/` (nvme0n1p2, ext4) holds media, data and projects: 938 G, **87 % used, 120 G free**.

## Performance: a player in the web UI

"Serve the file directly" plays only **~6 % of this library**. Firefox can't decode NotchLC, HAP or
ProRes, and those are 94 % of the clips. So direct serving can't be the main path; it can only be
the fast path for H.264/VP9/AV1/MP3/WAV/AAC.

Costs, by approach:

1. **Direct serving (H.264 or audio files only).** Server cost is just disk reads at the clip
   bitrate (NVMe, negligible) plus Range support (small change, needed anyway). The real cost is
   **decode on the viewing machine**. On the kiosk (firefox-esr on this box), H.264 decode is
   probably software, so a 3840×1344 clip takes about 1–2 cores of the 28 *on the playout machine*.
   That's tolerable but not free. A remote laptop costs the box nothing beyond network. **Zero
   effect on Caspar output either way**: it never touches the Caspar process or GPU pipeline.
2. **Proxy files (recommended, covers 100 %).** Per file version, transcode once to a small
   H.264 + AAC proxy (≈960 px wide, ~2–3 Mbps, all-intra-ish GOP for snappy scrubbing). Stored in
   `data/media-proxies/` (add to `.stignore`), roughly 1 GB per 1 h of footage. Playback cost
   ≈ nothing on either side. **Generation is the cost.** NotchLC and HAP decode on the CPU in ffmpeg;
   encode can use NVENC (RTX PRO 4000). Estimate: a few seconds to a minute per clip, the whole
   library in tens of minutes. Not measured, because measuring would load the show machine.
   Mitigations: run at `nice 19` / `ionice -c3`, one job at a time, generate lazily on first
   inspect (and right after ingest), plus a **"pause background jobs while on air"** gate (same idea
   as the HAP encode queue, WO-575, which already runs ffmpeg jobs with progress and cancel).
3. **Preview through Caspar** (play on a hidden PRV layer, view it in the compose preview). This is
   true playback of any codec, but it uses real Caspar decode, channel and GPU budget during a show,
   and the preview is the low-fps JPEG compose feed. Rejected as the default.

Waveforms are already cached server-side (one ffmpeg pass per file), so the audio view costs
nothing after first open.

## Proposed design

### A. Links (stable media IDs)
- Server-owned registry `data/media-library/registry.json` (`.stignore`, written atomically like
  other config, replicated with media to followers). Entry:
  `{ id: "m_<uuid>", path, versions:[…], current, defaults:{ trimIn, trimOut, muted } }`.
- **References store `mediaId` next to `value`.** `value` stays the resolved path, a cache that
  the server keeps true. Why not resolve-at-emit: `value` feeds dozens of AMCP emit sites (takes,
  playlists, timelines, multiview, Companion, replication). Leaving them untouched is the low-risk
  path on a live box. Moving or renaming through the UI renames on disk, updates the registry, then
  rewrites `value` for every reference with that `mediaId` in all projects and live scene state,
  and broadcasts `project_sync`. The user experiences "links"; Caspar keeps getting real paths.
- Adoption is idempotent. A scan assigns ids to unregistered files; project load backfills `mediaId`
  by path match. Files changed outside the UI (USB import, Syncthing, shell `mv`) are re-linked by
  inode → size+mtime → partial hash. Otherwise they're marked missing (existing `clipMissing` UI).

### B. Version control (in the media inspector)
- "New version…" (button or drop a file on the inspector): the new file takes over the **same
  path**, so every look gets it immediately with no rewrites. The old file is renamed to
  `data/media-versions/<id>/v<n>.<ext>`: same filesystem, so it's an instant rename with no copy,
  and it sits outside Caspar's media root, so it doesn't clutter the library.
- Version list: number, date, size, duration/codec, optional note, *Restore* (atomic swap).
  Swapping a clip that is currently on air is safe on Linux (Caspar's open handle keeps the old
  inode), and the next load plays the restored version. Show an "on air" badge anyway.
- Retention matters at 120 G free (a NotchLC master can be tens of GB). Show per-version size, a
  *Purge old versions* button, and optionally keep-last-N.
- **Delete is final:** removes the current file, **all versions**, its proxy and its registry entry.
  The confirm dialog states usage ("used in 4 looks, 1 timeline") and does not offer undo.

### C. Media inspector
Opens when a single media item is selected in the Media tab. Exception to the 26.07 "Sources tab has
no inspector" rule, which was about live-input controls. Top to bottom:
1. **Preview**: `<video>` on the proxy (or the original if browser-playable), image for stills,
   **waveform** (existing endpoint) for audio, plus a waveform strip under video that has audio.
2. **Transport**: play/pause, scrub bar, timecode.
3. **Trim**: in/out handles on the scrub bar plus numeric fields (math inputs).
4. **Mute** toggle.
5. **Info**: codec, resolution, fps, duration, size, path, "used in …".
6. **Versions** (B).
7. **Actions**: rename, move, delete (final).

Trim and mute here are **media defaults** stored on the link. A look layer copies them when the clip
is dropped in, and WO-570's per-layer trim stays the per-use override (see Decisions).

### D. Multi-rename (explicit, never automatic)
Select several files → *Rename…* in the selection bar → dialog:
- Each name is split into tokens: number runs vs text. Example: `01_Grzegorz Zytka.mov`,
  `02_Panel I.mov` → `[01][_][Grzegorz Zytka]`.
- The user edits the **title** field (or find → replace within titles). Numbers, separators and
  extensions are kept. Options: keep or renumber (start, step, padding), position of the number.
- **Live preview table** (old → new) with conflict and duplicate detection. Nothing happens until
  *Rename N files* is pressed.
- Executed through the link layer (A), so every look, playlist and timeline follows the new names.
  One server call, all-or-nothing: on any failure, the files already renamed are rolled back.

### Order of work
1. Range support on `/file` (+ inline disposition variant), registry + adoption + reference
   rewrite on move/rename (fixes today's orphaning even before any new UI).
2. Media inspector shell: info, waveform, direct-play for browser codecs, transport, trim, mute.
3. Proxy generation queue (on-air gate, nice/ionice, NVENC).
4. Multi-rename dialog.
5. Versions + final delete.

## Decisions (owner)
**Answered 04.10:** 1 → file defaults copied into looks. 3 → keep all versions until purged
manually; the inspector shows the full list of old versions and the owner can go back to any chosen
one (Restore = swap, the current file becomes a version, so nothing is lost). 4 → keep numbers,
change title, optional renumbering is enough (no pattern field). 2 → **no proxies** (04.10, after the show): "do the preview only for the kiosk using the operator screen consumer; the remote client should get waveform if possible even for video files". Proxy plan dropped; kiosk previews through Caspar, remote gets thumbnail + waveform.

1. Trim/mute in the media inspector: **file default copied into looks (recommended)**, or edits the
   file itself (destructive trim via re-encode), or preview-only?
2. Proxies: OK to spend ~1 GB/hour of footage on disk and background CPU off-air? (Recommended yes.)
3. Version retention: keep all until purged manually (recommended), or keep last N?
4. Multi-rename: is "keep numbers, change title" plus optional renumbering enough, or is a free
   pattern field (`{n:2}_{title}`) wanted?

## Progress — C. Media inspector (04.10)

### What was done (commits 18e1f787 + seek fix)
- **Kiosk preview through Caspar.** New `POST /api/media/preview` (`src/api/routes-media-preview.js`):
  `load` → `LOAD` on the operator-GUI channel (ch3 here, 1080p50, screen consumer only → silent)
  at fixed `MEDIA_PREVIEW_LAYER` 50, outside the route range 10–49 so compose-cell churn never
  re-numbers and restarts it; `play`/`pause` → RESUME/PAUSE; `seek {seconds}`; `stop` → STOP + MIXER CLEAR.
- **Hole.** New cell role `media` (`computeMediaPreviewEntry` in operator-gui-channel-geometry.js,
  aspect-fit from the clip's own `srcW/srcH`). `src/system/operator-gui-media-layer.js`: the apply
  only FILLs the layer; it STOPs + clears it on the media-cell present→absent transition only (a
  compose-only report racing a fresh LOAD can't kill it). Media cells are **never persisted**
  (`operatorGuiLayout`, project) **nor broadcast** as shared compose layout.
- **Client.** `reportMediaPreviewRect` (surface `mediainspector`); `inspector-media-file.js` +
  `-wave.js`; Media-tab single selection fires `media-file-select` → inspector panel `mediaFile`.
  Kiosk + video → hole + ▶/❚❚ + timecode + click-waveform-to-seek, playhead from OSC
  `onLayerState(ch, 50)`. Remote / stills → thumbnail. Every client gets the waveform (existing
  cached endpoint; video files with an audio track included). Controls sit below the hole (click-dead).

### Found while verifying
- The real `AmcpClient` has **no flat `load` alias** (`amcp-client-commands.js`) — first live call
  failed `ctx.amcp.load is not a function`; now `ctx.amcp.basic.load`, and the smoke fake mirrors
  the real shape so this can't pass offline again.
- **SEEK counts CHANNEL frames on this build**: on the 50p GUI channel SEEK 100 / 200 landed at
  2 s / 4 s of a 30p NotchLC clip. The API takes `seconds` and converts with the GUI channel's fps.

### Verified
- Offline: `smoke-wo592-media-preview` 6/6; full suite 2566 → 2563 pass / 1 fail / 2 skip. The one
  failure is `smoke-wo577-shader-controls` "library: main panel stays small", which reads the live
  `data/shaders` library (a shader exposing a control labelled "Value"); unrelated to this WO.
  check-max-file-lines clean; eslint 0 errors.
- Live, API vs AMCP `INFO 3`: NotchLC `S_AKT_1_START_1.mov` LOADs paused at 0; play → 1.98 s
  after 2 s; pause holds; seek 7.5 s → 7.5 s exactly; stop → layer empty.
- Live on the kiosk (xdotool + scrot): selecting a HAP clip opens the inspector with Caspar's frame
  in the hole; ▶ plays (timecode + playhead advance, INFO paused=false); clicking mid-waveform → 31.06 s;
  ❚❚ pauses; deselecting closes the inspector, layer 50 empties, no leftover hole.
- Waveform: a 1-min H.264 with sound → 600 bars, 591 non-silent. The HAP clip's PCM track is
  genuinely silent (all zero) — the flat strip is correct.
- **Owner QA:** remote browser shows thumbnail + waveform (not exercised from the box).

## Progress — A links, D multi-rename, defaults, B versions, final delete, mojibake repair (04.10)

Owner 04.10 after the show: "no audio at this point. you can fix the files. continue building".

### Investigation (links)
- References: scene-layer `source`, layer `playlist[]`, timeline clip `source` (the set
  `normalizeProjectMediaRefs` walks). Values come in 3 shapes: root-relative with extension,
  **project-relative** (`00. Intro_Bumper_MAIN_HAP.mov` under `projects/dtlodz/` — 252 playlist
  labels in dtlodz alone), and Caspar CLS (uppercase, no ext). Labels often hold the full path.
- Active project = `loadFullProject` → `persistProject` → `scheduleProjectSyncBroadcast`; clients
  `importProject` on `project_sync` (scenes + timelines wholesale) — same path WO-585 uses.
- Media root has a different device under `bridge/` → registry keys on dev+ino.

### What was done
- `src/media/media-reference-rewrite.js` (pure): rewrite every ref to a renamed file **in its own
  shape**; a value WITH an extension must match the exact path (case-insensitive, NFC) — only an
  ext-less value matches by CLS id, so `clip.mov` never drags `clip.mp4`. Labels follow when they
  were the path / old value / basename. `findProjectMediaUsage` for "used in".
- `src/media/media-library-registry.js`: `data/media-library/registry.json` (.stignore'd), one
  entry per file; `reconcileRegistry` adopts new files, re-links a vanished entry by (dev, ino) else
  a UNIQUE (size, mtimeMs) match, marks the rest `missingSince`.
- `src/media/media-links.js`: `renameMediaFiles` (validate all → rename → roll back on failure;
  extension changes refused), `followMediaMoves` (UI move), `applyRenamesToProjects` (active via
  persistProject + project_sync; others: project file + autosave on disk), `scheduleMediaReconcile`
  (debounced, serialized; hooked onto every `runMediaLibraryQueryCycle` + once at boot).
- Routes (`routes-media-library.js`): `POST /api/media/rename`, `GET /api/media/library/entry`,
  `GET|POST /api/media/library/defaults`. `/api/media/move` now follows links; `/api/media/delete`
  forgets the link and removes every stored version (final).
- Defaults: per-file `trimInMs/trimOutMs/muted` (look-layer field names); `client/lib/media-file-defaults.js`
  + one hook in `sceneState.patchLayer` — when a layer's media source CHANGES, fields the patch
  doesn't set are copied from the file. Covers every drop path (compose, editor strip, deck).
- Multi-rename (`client/lib/media-multi-rename.js` + modal): lead number owns the numbering
  (`03_LOOP_2x3` keeps "LOOP_2x3" as title), trailing number only with a separator; blank title =
  keep titles; optional renumber; duplicate/existing-name checks; list order, not click order.
- Versions (`src/media/media-versions.js`, `routes-media-versions.js`, inspector panel): new version
  keeps the path; old ones in `data/media-versions/<id>/v<n>` (.stignore'd), listed until purged;
  Go back = swap. Upload refuses a different extension.
- Inspector: trim in/out (+ set-from-playhead on kiosk), mute, trim shading on the strip, preview
  plays In→Out, used-in, rename, final delete, versions; duration falls back to waveform/Caspar.

### Mojibake repair (owner: "you can fix the files")
10 files in `projects/airport` had double-encoded names from the old busboy latin1 bug
(`GÅÃ³wne TÅo` = UTF-8 read as Latin-1 and re-encoded). Fixed by `name.encode('latin1').decode('utf8')`
+ NFC through `POST /api/media/rename`: 10 renamed, **5 references in the airport project followed**
(project + autosave: 0 garbled strings left). Caspar CLS now lists `GŁÓWNE TŁO…`; the 6 "Error: 501
CINF FAILED" rows in the media list are gone — Caspar could not open those names at all before.

### Verified
- Offline: wo592 links 13/13 (rewrite shapes, reconcile, all-or-nothing rename on temp dirs,
  planner, defaults copy, wiring), versions 4/4, preview 6/6. Full suite 2583: 2580 pass / 1 fail
  (pre-existing wo577 shader-library data test). `smoke-wo537-look-timeline-starts-where-asked`
  is timing-flaky (1 of 3 standalone runs failed) — unrelated, observed once in a full run.
- Live: registry built at boot (357 entries = 357 files). Probe file kept its id through an API
  rename AND a shell `mv` + rescan; final delete removed file + entry. Kiosk UI (xdotool): selected 3
  numbered probes → Rename… → "Stage Loop" → preview `01_Stage Loop.mov`… → disk renamed, selection
  followed. Inspector: trim 2/6 s + mute saved to the registry; new version via upload endpoint →
  same path, new hash, v1 listed; "Go back" from the kiosk restored the original hash with v2 kept;
  inspector Delete → native confirm → file, versions dir and entry gone. Probes cleaned up.
- Found live and fixed: version list showed a stale size (stats only refreshed on rescan) and the
  list thumbnail showed the replaced version (browser image cache, same URL) — stats now refresh at
  swap; thumbnail URLs carry `&v=<fileSize>`.

### Owner QA / open
- Drop a clip that has trim/mute defaults onto a look: the layer should open with that trim + mute
  (unit-tested; not exercised live — it would have modified a show file).
- Remote browser: thumbnail + waveform + versions/rename/delete.
- `.stignore` gained `data/media-library` and `data/media-versions`; `.stignore` doesn't sync —
  mirror both lines on the Mac.
- Playlist items don't take file defaults (playlist rows have no per-item trim today).
