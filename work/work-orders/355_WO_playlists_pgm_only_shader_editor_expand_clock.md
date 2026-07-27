# WO-355 — Playlists run on PGM only; Shader Live editor expansion; wall clock

**Status: DONE (2026-07-27)** · Source: todos27.07.26 batch 5 (owner, six items).

## 1. Playlists never run on the preview channel

Consequence of WO-354's channel-scoped state: PRV entries started advancing independently —
owner: "everything can be done inside the pgm channel only." `isPlaylistChannelEligible`
(isPreviewCasparChannel) now gates `setupLayerPlaylists` AND the OSC advance loop: a preview
recall shows the staged item statically — no timers, no hops, no preloads on a PRV bus.

## 2. "Playlist continues even though its look was taken from the pgm"

Timers were only cleared when the SAME look restaged (pKey match). Two guards:
- `clearChannelPlaylistState(self, channel)` wipes the channel's whole `${channel}:`-prefixed
  runtime state (timers/indices/prev-paths) at the top of every take's playlist setup — the
  outgoing look's timers die with it.
- The image-timer callback re-checks `liveSceneState.getChannel(channel).scene.id === scene.id`
  before hopping — covers FTB/clear/any exit path between arm and fire.

## 3. Shader Live editor

- **Blinking dropdown**: the state store fires ~every second and the instance list re-rendered
  identical options each time (killing open pickers, visible blink). The `<select>` DOM is now
  only touched when the options HTML actually changes.
- **Right side truncated**: param rows overflowed their grid column (fixed 160px name + 160px
  slider + 84px number per row). Rows now `min-width:0; flex-wrap:wrap`, name shrinks
  (flex 0 1 140px), numbers 62px — nothing clips, color pickers visible again (their
  disappearance WAS the clipping).
- **Parameter labeling / decode**: every param row gains ✎ — prompt for a display name, saved
  to the shader library (`paramLabels` map, new whitelisted field in shader-store
  normalizeShaderConfig, bounded 96×60chars). Labeled params render bold prose; the tooltip
  always carries the decode: `pass — raw name` (deep names embed the ◆ code context).
  Label keys: `pass:name` / `pass:deep:name` — deep labels follow their literal until the
  source itself is edited.

## 3b. Follow-up (same day) — auto-decoded HUMAN parameter names in categories

Owner: "i cant belive the simple shader code cant be decoded to be human readable parameters in
cattegories… it regressed to displaying parts of code." New `client/lib/shader-param-naming.js`
decodes each literal's role from its code context — declaration/assignment targets
(`float speed = ◆` → "speed"), known-function argument roles (`mix(a,b,◆)` → "mix amount",
`pow(c,◆)` → "exponent"), multiplier semantics (`iTime * ◆` → "speed", `uv * ◆` → "scale"),
loop bounds (`i < ◆` → "iterations") — and buckets rows into fixed categories: Colors,
Speed & time, Scale & shape, Intensity, Detail, Other values. The editor renders one section
per category (no more "Auto — from the code" bucket of snippets); duplicate names get ordinals;
the raw `#N …◆…` context moves to the tooltip and remains the stable key for ✎ labels.
smoke-wo340 extended (23 subtests) AND added to the curated test:ci list — it was never
registered there (now 1555 CI tests).

## 4. Wall clock

Small HH:MM:SS (24h, tabular numerals, muted) rides the right end of the rundown/progress row
(`.scenes-rundown-row` wraps the playback slot + `.scenes-wall-clock`, 1s tick).

## Verification

test:ci 1532/0, lint 0, 500-line gate 0; service restarted, kiosk reloaded. Owner checks:
PRV recall of a playlist look sits still; after taking a different look the old playlist stops;
Shader Live dropdown steady, params fully visible incl. color pickers, ✎ labels persist across
reload; clock ticking beside the progress bar.
