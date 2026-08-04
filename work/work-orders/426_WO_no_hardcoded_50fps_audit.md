# WO-426 — 50 fps hardcoding audit: 60 Hz regions must work end-to-end

**Status: DONE (2026-08-04 — full-source sweep classified; 2 real defects fixed; smoke green; suite 1826/0/2)**

Owner: "check if nothing is hardcoded to 50fps. im in europe where thats the standard but
others will want to run in 60fps."

## Audit result (sweep over src/ + client/, patterns: p5000, framerate/fps constants, frame math)

Three classes found:

1. **Derived from data — correct, the overwhelming majority.** Mode ids carry their rate
   (`1080p6000`), `STANDARD_VIDEO_MODES` includes the full 60-family
   (`720p5994/6000`, `1080p5994/6000`, `1080i5994/6000`, `2160p5994/6000`),
   `getLowestStandardVideoModeIdForFps(60) → 720p6000` (the WO-421 monitor bus rate-matches
   60 too), `inferProjectFpsFromConfig` reads the screens, ffmpeg/streaming/vcam paths take
   fps from config, OSC/playback trackers read the channel's reported framerate.
2. **Fallback-only 50s — acceptable and kept.** ~25 sites use 50 ONLY when no real value
   exists (unset config keys, custom `WxH` modes with no rate, factory defaults like
   `1080p5000`). A 60 Hz user changes screen/destination modes (and
   `machineProfile.defaultProjectFps`) and every derived value follows. These are defaults,
   not hardcodes.
3. **Real defects — fixed:**
   - `client/lib/mapping-node-service.js` `videoModeToResolution` matched only the RESOLUTION
     prefix: `"1080p6000"` returned fps **50**. Now parses the rate digits from the id
     (`/^(720|1080|2160)[pi](\d{4})$/` → digits/100), so 60/59.94 canvases size their timing
     correctly. Old prefix fallbacks kept for non-standard strings.
   - `src/api/routes-mixer.js` converted a frames duration to ms with `const fps = 50` for
     the compose-preview settle timer — now `inferProjectFpsFromConfig(ctx.config)`.

Sites checked and deliberately left (documented so the next audit doesn't re-open them):
`routes-scene-border` (already resolves the channel rate, 50 = fallback),
`server-info-config.resolutionFromVideoModeString` (custom `WxH` has no rate; the real fps is
carried by the destination's own `fps` field), `mapping-gpu-os-layout` / client editor
defaults / `playback-timing-clock` (all fallback-when-absent).

## What was VERIFIED

Smoke: 60-family modes present, cheapest-mode helper answers 720p6000/720p5994, the client
parser change pinned, `routes-mixer` pinned free of hardcoded fps. Suite 1826/0/2; client
rebuilt + kiosk reloaded; server restarted.
