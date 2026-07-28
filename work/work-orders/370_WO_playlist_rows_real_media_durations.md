# WO-370 — Playlist rows show the timeless default on media clips instead of each clip's real length

**Status: DONE (28.07.26 — implemented + offline-proven against the live 133-entry media list; owner eyeball on the glass owed).**

Source: `work/checklist27.07.26_manual_verify.md` item 39, owner note added 28.07 14:26:

> it displays correctly. the issue is with in the list it displays the timeless value even on
> media clips that have their own values which should be displayed.

Third report of this family. Earlier passes: checklist item 3 (*"movie files have 5s set as their
time"*) and item 19 (*"it still displays 5s for media clips with time"*). `a059051` was supposed to
close it. It half did — see below.

## 1. Investigation

### 1a. This is NOT a deploy gap

`dist-web/` was rebuilt 28.07 **14:02**, kiosk Firefox restarted **14:02:17**, and the owner saved
this note at **14:26**. The `a059051` client fix is live and the behaviour is still wrong.

### 1b. `a059051` fixed one of the two render sites

**Fixed — the Playlists panel dropdown**, [playlist-control-panel.js:86-91](../../client/components/playlist-control-panel.js#L86-L91):

```js
/* Owner 27.07: timed media carries its own length — the (Ns) tag is only true
 * for timeless items; labels show the file name, not the path. */
const dur = isTimelessItem(it) && it.duration != null ? ` (${it.duration}s)` : ''
```

Correctly gated on `isTimelessItem`.

**Missed — the layer inspector's playlist rows**, [inspector-layer-playlist.js:168](../../client/components/inspector-layer-playlist.js#L168):

```js
<input type="number" class="playlist-item-duration"
  title="Duration in seconds (static images / timeless items, or to limit video playback)"
  value="${item.duration ?? 5}" ... />
```

No `isTimelessItem` check anywhere on this row, and a **hardcoded `5`** fallback. So every movie
in the inspector list renders a seconds box reading `5` — exactly "it displays the timeless value
even on media clips". `isTimelessItem` *is* already imported in this file
([inspector-layer-playlist.js:2](../../client/components/inspector-layer-playlist.js#L2)) and used
for the settings block further down; the row render just never calls it.

### 1c. The real durations are already in the client's hands

The owner does not want the box blanked — they want *"their own values ... displayed"*. That data
is already present. `GET /api/media` (the CLS-backed `state.media` list every client receives, the
same list `clipMissing` indexes) carries `durationMs` per entry:

```json
{"id": "0.1_VB2_Summer Rally intro video...mp4", "durationMs": 17584, "hasAudio": true,
 "resolution": "1920×1080", "codec": "h264", "fps": 29.97}
```

133 entries on this box, `durationMs` populated. No new endpoint, no probe, no server work.

### 1d. Trap for whoever implements this — duplicate entries with contradictory durations

The same asset appears twice in the list with different provenance and wildly different numbers:

```json
{"id": "0.0_VB1_OPENING TREEFILM MASTER",       "durationMs": 30257742, "fps": 0.04,   "cinf": "...1262 1001/24000"}
{"id": "0.0_VB1_Opening Treefilm Master.mp4",   "durationMs": 52636,    "fps": 23.98,  "codec": "h264"}
```

30257742 ms is 8.4 **hours** for a 52-second clip — the CINF-derived row's frame-count/timebase
maths is wrong (`fps: 0.04` is the tell). The ffprobe row is right. Any lookup must prefer the
probed entry and sanity-check the result, or the UI will confidently print "8h 24m" next to a
53-second video. `media-exists.js` already normalises ids case-insensitively with the extension
stripped and a basename fallback — reuse `norm()`/`baseOf()` from there rather than writing a
third matcher, but be aware that normalisation is exactly what collapses these two rows onto each
other, so the tie-break must be explicit.

## 2. What needs doing (plan — NOT executed)

1. Gate the inspector row on `isTimelessItem(item)`:
   - **timeless** (image / template / shader) → keep today's editable seconds input, but drop the
     hardcoded `5` in favour of the playlist's configured timeless seconds (`timelessSecsOf`), so
     it matches the "Timeless (s)" field instead of contradicting it.
   - **timed media** → render the clip's real length as **static text**, not an input. It is not
     an operator-settable value.
2. Add a small shared lookup (`client/lib/media-duration.js` or an export from `media-exists.js`,
   which already owns the index) returning `durationMs` for a playlist item value:
   - prefer an entry with a real codec/fps (the ffprobe row) over a CINF-only row;
   - reject implausible values (e.g. `fps < 1`, or duration disagreeing with a sibling entry by
     more than an order of magnitude) and return `null` rather than a wrong number;
   - `null` → render nothing, never `5`.
3. Format compactly — these rows are deliberately minimal (WO-353). `0:53` / `1:24:06`, not
   `53.4 s`.
4. Check the third surface: the multiview timer labels show playlist `current -> next`
   (WO-212). Confirm they are not reading the same `item.duration ?? 5` default.

## 3. Acceptance criteria

- A playlist of three movies shows three real lengths in the layer inspector; no `5` anywhere.
- Adding a PNG between two movies shows an editable seconds box on the PNG only, pre-filled from
  the playlist's timeless setting.
- The 8.4-hour CINF entry does not appear for any clip; the file above reads ~`0:53`.
- Panel dropdown behaviour (already correct) is unchanged.
- New smoke over the duration lookup, including the duplicate-entry tie-break, added to the
  curated FILES list in `tools/ci/run-offline-tests.js`.

## 4. What was DONE

**New — `client/lib/media-duration.js`** (123 lines). Index over `state.media`, same
normalisation shape as `media-exists.js` (case-insensitive, extension-stripped, basename
fallback), initialised from `client/app.js` next to `initMediaExistsIndex`. The §1d trap is
handled by an explicit three-step tie-break, applied per key at index build:

1. drop implausible candidates — no positive `durationMs`, or an fps **below 1** (the
   CINF frame-count/timebase miscalculation's tell, `fps: 0.04`);
2. prefer probed rows (those carrying `codec`/`resolution`) over CINF-only rows;
3. if the survivors still disagree by more than 10x, return `null`.

`mediaDurationMs()` returns `null` for anything untrustworthy and callers render **nothing** —
the hard rule from §2.2. `formatClipDuration()` gives `0:53` / `1:24:06` (§2.3).

**Changed — `client/components/inspector-layer-playlist.js`:**

- Row render gates on `isTimelessItem(item)`: timeless items keep an editable seconds input,
  now defaulting to `timelessSecsOf(playlist)` instead of the hardcoded `5` (it agrees with the
  "Timeless items (s)" field instead of contradicting it); timed media renders a static
  `.playlist-item-length` cell with the clip's real length, blank when unknown.
- The two item-creation sites (mode switch to `list`, drag-and-drop) no longer stamp
  `duration: 5` on movies — a duration is written **only** for timeless items. This was the
  source of the stray 5s in saved scenes, not just in the render.
- The `parseInt(...) || 5` fallback in the change handler follows the same default.
- Removed a dead `isImg` local (unused since the thumb rewrite; one fewer lint warning).

Justification for making timed rows non-editable: the server arms a wall-clock timer from
`item.duration` **only** for timeless items — `scene-take-lbg-playlist.js:339`
(`schedulePlaylistImageTimer`) is called exclusively under `isTimelessPlaylistItem` guards
(:102, :204). On a movie the box was both a lie and dead code; the input's old tooltip claim
"or to limit video playback" was never implemented.

## 5. What was VERIFIED

- **Live data, real lookup:** the full 133-entry `GET /api/media` payload fed through the new
  index — 0 implausible results (nothing over 3 h), the 8.4-hour CINF row resolves to `0:53`
  under **both** id spellings, and all **33** timed-extension entries carry a `durationMs`, so
  every movie in a playlist gets a real length rather than a blank. The 96 nulls are entries
  with no `durationMs` at all (stills/graphics — timeless, so they render the input anyway) and
  2 sub-1-fps CINF rows with no probed sibling, correctly refused.
- **New smoke** `tools/smoke/smoke-wo370-playlist-media-durations.test.js` (9 tests), added to
  the curated FILES list in `tools/ci/run-offline-tests.js`: the duplicate-entry tie-break on
  real box fixtures, path/case/extension tolerance, null-not-a-number for unknowns, the >10x
  disagreement refusal, formatting, plus source pins that the hardcoded `5` is gone, the input
  is gated, and the index is actually wired at app init (WO-367's dead-code lesson).
- **Full offline suite: 1570 tests, 1568 pass / 0 fail / 2 skip.** Lint clean on all touched
  files (the 2 remaining warnings in the inspector are pre-existing WO-103 innerHTML notices on
  untouched blocks). `check-max-file-lines` 0 over.
- `npm run build:client` OK.
- §2.4 checked: the MV playlist labels (`multiview_master.js:253-279`) build `current -> next`
  from item **values** only — no `duration ?? 5` anywhere in the templates. Nothing to fix there.
- The panel dropdown (`playlist-control-panel.js:88`, already correct) was not touched.

**Owner QA owed:** open a playlist of movies in the layer inspector — real lengths, no `5`.
