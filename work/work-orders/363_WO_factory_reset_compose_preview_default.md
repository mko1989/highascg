# WO-363 — Factory reset lands on JPEG-stream compose preview (todos28.07.26 §2)

**Status: DONE (28.07.26, verified offline — see §3; destructive live reset intentionally NOT run)**

## 1. Investigation

Owner report: after a webui factory reset the default preview compose becomes the "jpeg
stream"; it should be the simple thumbnails.

Traced the reset path: `Actions.factoryResetConfig()` (button in
`client/components/device-view-inspector-caspar.js`) → `ConfigManager.factoryReset()`
(`src/config/config-manager.js:408`), which purges the config dir and rebuilds from
`{ ...defaults }`. Those defaults come from `coreDefaults()` in
`src/config/defaults-core.js`, where `composePreview.mode` was **`'ffmpeg_jpeg'`** — so every
reset (and every fresh boot, and the factory starter in `src/config/factory-starter.js`,
which deep-copies the same defaults) landed on the ffmpeg JPEG poll instead of canvas
thumbnails. The client's own no-setting fallback is already `'canvas'`
(`client/lib/compose-preview-url.js` `resolveComposePreviewMode`) — only the server default
disagreed.

Safety check before flipping: `mode: 'canvas'` means no embedded JPEG consumers
(`isFfmpegJpegComposePreview` → false gates `config-generator-audio-xml.js:142` and
`compose-preview-consumer.js`), and Companion thumbnails keep working via the PNG fallback in
`compose-preview-cache.js` `resolvePreviewImagePath` (jpg → png).

## 2. What was done

`src/config/defaults-core.js` — `composePreview.mode` default flipped `'ffmpeg_jpeg'` →
`'canvas'` with a comment marking the JPEG stream as explicit opt-in. One-line root fix: the
reset path, fresh-boot path, and factory starter all read this single source, so no per-path
patching. Existing saved configs that explicitly chose `ffmpeg_jpeg`/`stream` are untouched
(normalizeComposePreviewSettings preserves explicit values).

## 3. What was VERIFIED

- `coreDefaults().composePreview.mode === 'canvas'`; server
  `resolveComposePreviewMode(defaults) === 'canvas'`, `isFfmpegJpegComposePreview === false`
  (node one-liner on the box).
- Offline suite: 1555 tests, 1553 pass, 0 fail — no smoke pins the old default (all pass
  `mode` explicitly).
- NOT run live: an actual factory reset (would destroy the box's real config). Remains owner
  QA: next time a reset is genuinely wanted, confirm the preview comes up as simple
  thumbnails.
