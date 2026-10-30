# WO-734 — Show timers on the served pages: presentation (OSCPoint via Companion), video inside it, main video

**Area:** companion, web-client
**Status: DONE (24.10.26) — offline smoke 8/8; live on this box against the real Companion (v5, OSCPoint module 1.4.0) with simulated OSCPoint messages; the strip was screenshotted on both pages. Open: the owner must set the Companion port (8000 → 8001), see below, and do QA with a real presenter laptop.**

Owner, 24.10: *"for all the pages that the server serves, intake, operator dashboard, i need an inteligent timer
display system, when a presenter has a presentation, and there is a presentation timer it should display the timer
from the presentation, and slides count/total from companion, via oscpoint to companion variable, read from there to
serve, when a video inside presentation is playing then show that timer as additional, when there is video playing
from highascg that is a main video (would need to filter out looped videos) show that timer etc."*

## Investigation

**Pages.** The server serves two hand-written pages: the presenter intake (`/intake` → 302
`/api/tracking/presenters/intake`, `src/tracking/presenter-intake.html`) and the WO-731 audio operator dashboard
(`/audio` → 302 `/api/tracking/presenters/audio`, `src/audio-desk/audio-page.html`), see
`src/server/http-server.js:330-335`. The Vite web client (`client/`, `dist-web/`) has been the remote fallback since the
Godot port (WO-608). It is out of scope here. The kiosk header already has its own PGM timer (`pgm_timer_model.gd`).

**OSCPoint → Companion.** OSCPoint (the PowerPoint add-in on the presenter laptop) sends OSC to the Companion module
`zinc-oscpoint` v2.0.0 (source read: `src/osc-listener.js`, `variables.js`, `feedbacks.js`). The module turns it into
Companion variables:
- `state`: `edit` | `running` | `paused`. `paused` = a slideshow whose auto-advance is paused; the presenter is still
  presenting.
- `currentSlide`, `slideCount`, `slideCountVisible`, `slidesRemaining`, `presentationName`.
- `mediaState`: `playing` | `paused` | `stopped` | `notReady`.
- `mediaPosition`, `mediaRemaining`, `mediaDuration`: whole seconds, floored. They are refreshed on every
  `/slideshow/media/remaining` message (about every 500 ms while a clip plays) and **keep their last value after the clip
  stops**, so they only mean something while `mediaState` is `playing`/`paused`.

**OSCPoint has no presentation timer.** There is no elapsed or slideshow-clock variable or OSC address in the module.
"The timer from the presentation" therefore has to be timed here, from the `state` changes: it starts when the slideshow
starts and stops in edit mode.

**Companion HTTP API on this box.** Companion v4 runs on `127.0.0.1:8001` (the listener is node pid 456981; casparcg-scanner
holds 8000).
- `GET /api/variable/<connection label>/<name>/value` returns plain text, or 404 when the variable is unknown or the
  connection is disabled.
- `GET /api/connections` returns `[{id,label,moduleId,enabled,status}]`. Live: `OSCPoint` (zinc-oscpoint) exists but is
  **disabled**, `HighAsCG` and `pixelhue` are disabled too.

**Companion port mismatch (pre-existing, not fixed here).** `config/companion.json` has `port: 8000`, which is the
scanner. `GET /api/companion/connection-status` answers `http.connected: true, status: 404`: something answered, but it
is not Companion. HighAsCG's Companion button presses (`zone-actions.js`, `timeline-playback.js`,
`routes-companion-preview.js`) go to the wrong service today. The variable reader uses the same configured host and
port (`resolveCompanionConfig`). Fixing the port makes the presses start reaching Companion on a live box, so that change
is the owner's call (Settings → Companion → port 8001).

**Main video.** The OSC snapshot (`ctx.oscState.getSnapshot().channels[ch].layers[n]`) carries `type`, `paused`,
`_lastOscAt` and `file {name, elapsed, remaining, duration, loop}`. `loop` comes from `.../foreground/loop`
(`src/osc/osc-state-layer.js:127-143`, WO-239). `duration` is only set when it is positive (`:227-233`). The program
channels and screen labels come from `channelMap` (live: `programChannels [1,3]`, labels `PGM/PRV 1`, `PGM/PRV 2`). The
active bank is `ctx.programLayerBankByChannel[ch]` (`'b'` = layers 110-199, otherwise 10-99). The same layer rules as the
kiosk timer (`pgm_timer_model.gd`) apply: skip the timer band 980-989, the border 998, route layers, and layers silent
for over 12 s.
- Live now: PGM ch1 plays two clips at layers 10/11, both with `loop: true` (backgrounds), and ch3 has only routes.
  Expected result: **no main video**. A looped clip is a background, not something to time.

## What was done

New `src/show-timers/`:
- `presentation-clock.js`: times the slideshow from OSCPoint's `state`. `running` and `paused` count, `edit` stops the
  clock. Back in the slideshow within 60 s (an Esc by mistake) carries on. A longer break, or another
  `presentationName`, starts from zero.
- `companion-vars.js`: lists the enabled `zinc-oscpoint` connections (`GET /api/connections`, cached 30 s), then reads
  `/api/variable/<label>/<name>/value` with an 800 ms timeout. A port that does not answer like Companion gives
  `no Companion at host:port (HTTP n)`.
- `main-video.js`: per program screen, the topmost `ffmpeg` layer of the live bank that has `loop !== true` and a
  positive duration. Skips the timer band, border, routes and silent layers (the kiosk timer's rules). Paused clips
  are kept and marked paused.
- `show-timers-service.js`: polls every second, starting with the first page request and never stopping (cheap, and
  the presentation clock stays right for a page opened mid-talk). It reads the media variables only while
  `mediaState` is `playing`/`paused`, because they keep stale values after a stop. Several OSCPoint connections
  (several laptops) each give their own row.
- `show-timers-routes.js`: `GET /api/show-timers` → `{at, presentations:[{source,name,state,slide,slides,elapsed_s,
  video}], videos:[{screen,channel,layer,label,elapsed_s,remaining_s,duration_s,paused}], companion:{ok,error}}`, and
  `GET /api/show-timers/widget.js`. Both are asked in `src/api/router-dispatch.js`, before the module hook.
- `widget.js`: fills `<div id="show-timers">`, polls every 500 ms, and shows nothing when there is nothing to time. Rows:
  presentation name · slide n / total · clock; an indented "Video in presentation" row with remaining time; and
  `<screen> · <clip>` with remaining time. When there is nothing to show and Companion is unreachable, one dim line says
  why.

Pages: `src/tracking/presenter-intake.html` (under the title) and `src/audio-desk/audio-page.html` (under the header)
each got the div and the script tag.

Why it is built this way: the pages are plain served HTML with no build step, so they share one script. The timing
stays on the server, so every page and phone shows the same clock. Companion is read over its HTTP API, not by
listening to OSCPoint directly, as the owner asked ("via oscpoint to companion variable") and because Companion's
module already owns UDP 35550.

## What was VERIFIED

- Offline: `tools/smoke/smoke-wo734-show-timers.test.js` 8/8 (added to the curated FILES list). It covers the clock
  (Esc grace, a long break, another file), the main-video rules (looped backgrounds ignored, a clip under a looped
  overlay timed, bank a/b, timer band, border, route, stale and no-duration layers skipped, preview channels not
  timed), and the service against a fake Companion HTTP server: disabled connections not read, media read only while
  playing, the connection cache, and a non-Companion port.
- Live, after a server restart: `GET /api/show-timers` →
  `{"presentations":[],"videos":[],"companion":{"ok":false,"error":"no Companion at 127.0.0.1:8000 (HTTP 404)"}}`.
  This is correct for today's config and the two looped PGM clips. `/intake` and `/audio` both carry the strip; the
  widget is served as `text/javascript`.
- Live against the real Companion (`127.0.0.1:8001`). I enabled the OSCPoint connection; Companion has no triggers,
  and the 5 buttons that use OSCPoint only act when pressed. I sent OSCPoint's own messages to the module's UDP 35550
  and read them back through the real service:
  - slide 4/18, `running`, elapsed 0 → after 3 s, slide 5/18, elapsed 3;
  - media `playing` 12.5 s / 42 s → `video: {elapsed_s: 12, remaining_s: 29, duration_s: 42}`;
  - media `stopped` → video gone;
  - `edit` → presentation gone.

  Then I disabled the connection again: it is back to `enabled: false`. The installed module is zinc-oscpoint
  **1.4.0** (not 2.0.0). Its variable names and the ms → s flooring were checked to be the same.
- Visual: headless Chrome screenshots of both pages with stub data (presentation 12:34 · slide 5 / 18, video −0:29,
  `PGM/PRV 1 · OPENER` −3:05).

**Owner, to make it live:**
1. Settings → Companion → port **8001**. Companion runs there; 8000 is casparcg-scanner. This also makes HighAsCG's
   Companion button presses (timeline flags, zone actions) reach Companion, which they do not today.
2. Enable the OSCPoint connection in Companion, with the remote host set to the presenter laptop.
3. QA with a real deck: clock, slide count, an embedded video, and a non-looped clip on PGM.
