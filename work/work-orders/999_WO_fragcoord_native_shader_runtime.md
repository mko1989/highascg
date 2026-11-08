# WO-999 — Run FragCoord shaders natively in Visuals (u_* uniforms, the 512×512 audio spectrogram, passes), no Shadertoy conversion
**Area:** godot-client, engine, audio
**Status: IN PROGRESS (step 1 done 08.11: FragCoord u_audio rows on the server + the 512×512 history model in Godot, verified on live frames; steps 2-4 open)**

Owner, 08.11, after the FragCoord feasibility check (`https://fragcoord.xyz/s/30gw2t1g`): *"Can we just use these
shaders without converting them to shader toy's convention. I especially like the audio spectrogram instead of plain
FFT. Start a work order"*

## Investigation

### What FragCoord is and how its code reaches us

- **Source is public without login.** Append `.md` to `/s/<slug>`, or use the MCP server `https://fragcoord.xyz/mcp`
  (Streamable HTTP, no auth for public reads). Its tools include `get_shader`, `search_shaders` and `convert_shader`.
  Both were probed 08.11.
  - `get_shader` returns the same markdown: title, author, **license**, tags, then one fenced block per pass
    ("Common", "Main", aux passes).
  - Marketplace shaders can hide their source (`Source is not included`). There is nothing to fetch for those.
  - This is the opposite of Shadertoy: WO-380's import needs an API key because Cloudflare blocks unauthenticated
    fetches.
- **Licenses.** Every shader carries a license tag (MIT, CC0, CC-BY*, NC, GPL, or none).
  - "none" means all rights reserved; FragCoord itself says to link, not copy.
  - The example shader ("Cauldron" by Xor, `30gw2t1g`) is **none**. It must not go into the library, which ships in
    a public repo and on a box used for paid shows. No code from it is quoted here.
  - The importer has to read the license, refuse "none" (and warn on NC for commercial use), and keep the author and
    URL for attribution licenses.
- **The "golf" dialect.** Many shaders, including the example, are written in a compact macro dialect (`f3`, `nor`,
  `len`, `@(40)` loops, `C`, `O`, `R`, `T`), not GLSL.
  - FragCoord's `convert_shader {from: "golf", to: "glsl"}` expands it. I checked this on a snippet written for the
    test (not the example's code): it returned a plain `void main()` writing `fragColor`, with `u_resolution` and
    `gl_FragCoord`.
  - The macro set is not documented, so converting through that API at import time is the realistic path. The
    result should be stored as GLSL, with the golf original kept for provenance.

### FragCoord's runtime contract (authoring guide `llms-full.txt`, docs, and the public player bundle)

- **Language:** GLSL ES 3.00 without `#version` or `precision` (the runtime adds them). Entry is either
  `void main()` writing a predeclared `fragColor`, or `mainImage(out vec4, in vec2)`, but not both.
  `gl_FragCoord` origin is bottom-left.
- **Built-in uniforms:**
  - `u_resolution` (vec2 on 2D passes), `u_time`, `u_time_delta`, `u_frame` (int);
  - `u_mouse` (vec4: xy pointer, zw click, negative while the button is up), `u_drag`, `u_scroll`;
  - `u_date` (year, month, day, seconds), `u_refresh_rate`;
  - camera `u_camera_pos`, `u_camera_dir`, `u_camera_view`, plus `u_color_gamut`, `u_recursion`,
    `u_max_recursion`.
- **Textures:** `u_audio`, `u_keyboard` (256×3), `u_webcam`, `u_pass1…N`, and `u_main` (the main pass's own
  previous frame).
- **Custom controls:**
  - `uniform float u_x; //default, [min, max]` becomes a slider; a vec3 in 0..1 becomes a colour.
  - `uniform sampler2D u_tex; //https://…` is a texture fetched from that URL.
- **Passes:**
  - A Common tab is prepended to every pass.
  - The render order is aux passes 1..N, then main (player: `[1..n, 0]`). Later passes read earlier ones as
    `u_passN`. A pass that samples itself gets feedback. Buffers default to rgba8.
- **`u_audio`, the part the owner wants**, as read from the player code (`index-*.js`; the analyser is in `nN()`,
  the row writer in `r1`/`Bt`/`fh`):
  - **512×512 RGB** history: x = frequency bin (0..511), y = time.
  - **60 rows/s**, so 512 rows ≈ **8.5 s** of history.
  - **Row 0 is the newest.** Each step shifts the buffer up by the number of elapsed rows, then writes the new rows
    from 0. After a gap longer than the history, every row is set to the current row.
  - **R = weighted FFT:** analyser float dB plus an **A-weighting curve** (per bin, made monotonic non-decreasing
    from −80 dB, capped at 0 dB), mapped from −90..−10 dB to 0..255.
  - **G = waveform:** `getByteTimeDomainData`, the first 512 of 1024 samples.
  - **B = raw FFT:** `getByteFrequencyData`, the same −90..−10 dB range, no weighting.
  - Analyser: `fftSize 1024`, `smoothingTimeConstant 0.8`.

### What HighAsCG has today

- **Shaders run in the Godot Visuals only** (WO-883; the Caspar CEF player is retired for shaders).
  - `godot/client/features/visuals/shadertoy_rd.gd` (251 lines) renders a config on the RenderingDevice.
  - `shadertoy_glsl.gd` (167 lines) wraps the code: a std140 UBO with Shadertoy's inputs, `iChannel0-3`, a
    `mainImage` footer, ES→450 renames, zero-init.
  - Passes are Shadertoy's `bufferA-D` + `image`, with channels bound to `audio` or a buffer letter.
  - Rows are stored the Shadertoy way up (memory row = `fragCoord.y`), so a FragCoord texture's row 0 lands at
    uv.y = 0 as it expects.
- **The audio today is Shadertoy's 512×2 R8 strip** (`shadertoy_rd.gd:10,109,145`): row 0 FFT, row 1 wave. The
  bytes come from the WS `audio_fft` frame (`visuals_tab.gd:132`) through `spectrum_smooth.gd` (WO-875).
  - The server frame (`src/audio/audio-capture-fft.js`, `fft.js`) is 512 freq bytes and 512 wave bytes.
  - It uses AnalyserNode byte semantics: Blackman window, `fftSize 1024`, smoothing **0.6**, **−100..−30 dB**,
    48 kHz, at `emitHz` **30** (configurable 5-60, `defaults-core.js:94`).
  - The source is a live-input slot or a screen's PGM/PRV (WO-976).
- **Library storage:** `src/shaderfx/shader-store.js`, `{id: 'sh-…', name, common, passes: {image, bufferA..D:
  {source, channels[4]}}, audio, opts}`. It has no dialect field.

### What has to bridge (the gaps)

| FragCoord | HighAsCG today | Native plan |
|---|---|---|
| `u_*` uniforms, `main()`+`fragColor` or `mainImage` | Shadertoy UBO + `mainImage` footer | a second wrapper (`fragcoord_glsl.gd`) with FragCoord's names and both entry forms |
| `u_audio` 512×512 history at 60 rows/s, R/G/B weighted/wave/raw | 512×2 strip at 30 frames/s | a client-side spectrogram texture fed from `audio_fft` frames |
| −90..−10 dB, smoothing 0.8, A-weighted R | −100..−30 dB, smoothing 0.6, unweighted | re-map the bytes in the client (byte→dB→range); A-weighting per bin; levels calibrated against a known tone |
| `u_pass1..N`, `u_main` feedback, Common | bufferA-D + image, channel bindings | store passes as `main` + `pass1..N`; bind by name, not by channel |
| custom `uniform float … //d,[a,b]` sliders | auto-detected params (WO-340/894 glide slots) | parse the comment ranges into the existing params UI |
| `u_webcam`, `u_keyboard`, URL textures | virtual camera channel (WO-376) | webcam → the existing camera feed if routed; keyboard → black; URL textures fetched at import |
| golf dialect | — | converted to GLSL at import via FragCoord's `convert_shader` |

## Plan

1. **Spectrogram texture** (Godot, `features/visuals/`):
   - A shared 512×512 RGBA8 history, advanced on render time at 60 rows/s with FragCoord's shift and gap rules.
   - Each row is built from the latest `audio_fft` frame: R weighted, G wave, B raw.
   - Built once per app, so every FragCoord layer samples the same texture.
   - A pure model (row math, dB re-map, A-weighting, gap fill) with headless tests, then RD upload.
2. **FragCoord wrapper and runner:**
   - `fragcoord_glsl.gd`: the UBO with `u_resolution`, `u_time`, `u_time_delta`, `u_frame`, `u_mouse`, `u_date`,
     `u_refresh_rate` and the custom uniforms; samplers `u_audio`, `u_main`, `u_pass1..N`, `u_webcam`, `u_keyboard`
     and URL textures; both entry forms; the shared ES→450 fixes from `shadertoy_glsl.gd`.
   - `shadertoy_rd.gd` learns the FragCoord pass order and bindings, or a sibling runner does (500-line limit).
3. **Library and import** (server):
   - `shader-store` gets `dialect: 'fragcoord'`, passes `main` + `pass1..N`, and `license` / `author` /
     `sourceUrl`.
   - `src/shaderfx/fragcoord-import.js`, a sibling of `shadertoy-import.js`: link → slug → `get_shader` (or `.md`)
     → parse passes → golf → GLSL through `convert_shader` → license gate → save.
   - The paste-a-link entry point in the client.
4. **Verify:**
   - Headless: spectrogram row and level math against FragCoord's rules.
   - Box: an openly licensed FragCoord audio shader on a Visuals layer, fed from the routed FFT source; frames
     captured, with the spectrogram scrolling at 60 rows/s.
   - Compare levels with the same music in FragCoord's editor.

## What was done

### Step 1 — the spectrogram (08.11)

- **Why on the server, not a client re-map** (the plan's first idea): the Shadertoy bytes can't be turned back into
  FragCoord's levels.
  - They clip at −30 dB, where FragCoord keeps up to −10 dB.
  - Their magnitude is 2|X|/N (`fft.js`), while the Web Audio analyser FragCoord reads uses |X|/N, so ours sit
    6 dB hotter.
  - They are smoothed at 0.6, not 0.8.
  - A-weighting has to be added to the float dB before rounding.
  - So the box computes FragCoord's two rows itself from the same sample ring.
- **`src/audio/fft-fragcoord.js`** (new): `createFragcoordAnalyser({sampleRate, fftSize})` → `rows(samples)`
  returns `{weighted, raw}`, each 512 bytes, plus `reset()`.
  - Blackman window, |X|/N, its own smoothing state at 0.8, dB.
  - **raw** maps −90..−10 dB to 0..255.
  - **weighted** is dB plus the per-bin A table, then the same mapping. The table is FragCoord's: IEC 61672 with
    +2 dB, made non-decreasing from −80 dB and capped at 0 dB.
  - It is its own file because `audio-capture-fft.js` was at 491 lines; it is now 498.
- **`audio-capture-fft.js`**: every fresh frame carries `fc: fc.rows(ring)`. The stale frame carries zero rows and
  resets the smoothing.
- **`audio-capture-lifecycle.js`**: the WS `audio_fft` frame gains `fcWeighted` and `fcRaw` (base64, 2 × 512 bytes
  at `emitHz`).
- **`godot/client/features/visuals/fc_spectrogram.gd`** (new): the history as FragCoord's player keeps it.
  - 512×512, **row 0 newest**, R = weighted, G = wave, B = raw.
  - Stored **RGBA8** with alpha 255, because RGB8 is not a sampled format on most Vulkan drivers.
  - Step rules:
    - The first step writes row 0.
    - Elapsed time then accrues; every whole 1/60 s shifts the history down a row and writes the current row on top.
    - A step shorter than a row rewrites row 0.
    - A gap longer than the history (> 513/60 s) fills every row.
  - `shared()` gives one instance per app. `pull(frame, dt)` advances it at most once per drawn frame, however many
    layers read it.
  - A feed silent for 1 s scrolls in silence (spectrum 0, wave 128).
  - The WS frame is kept as-is and decoded only on `pull()`, so the feed costs nothing until a FragCoord layer
    exists.
  - A server without the rows gives a black spectrum and the wave only.
- **`visuals_tab.gd`**: the `audio_fft` handler feeds `FcSpec.shared()`.
- **Not in step 1:** the RD texture itself. It is a 1 MB `texture_update` per frame from `pull()`, made by the
  FragCoord runner in step 2, which owns the uniform sets. Until then nothing reads the history.
- **Known differences from FragCoord:**
  - Our server sends 30 frames/s, so each row is written twice. FragCoord's analyser updates every browser frame.
    `audio_fft.emitHz` goes up to 60 if the pair striping shows; this was not changed in live config.
  - The wave is the newest 512 samples of the 1024 ring. FragCoord's is the first 512 of its analyser buffer.
- **Tests:**
  - `tools/smoke/smoke-wo999-fragcoord-audio-rows.test.js` (curated, `offline-test-files-3.js`), 10 tests: A-weight
    reference points, table shape, silence, the Web Audio level of a full-scale tone, 6 dB headroom, smoothing 0.8,
    the low cut, reset, and the wiring greps.
  - `godot/client/tests/test_fc_spectrogram.gd`, 8 tests: layout, 60 rows/s scroll with leftovers, sub-row
    rewrite, gap fill, once-per-frame pull, stale silence, old-server frames, the shared instance.

## What was VERIFIED

### Step 1

- **Offline:** the new smoke has 10/10 passing, and the WO-333 FFT smoke still passes (26/26 together).
  `run-offline-tests.js`: 5535 tests, 0 fail. No files are over 500 lines. ESLint is clean.
  - Prettier flags `audio-capture-fft.js` and `audio-capture-lifecycle.js`, but both were already unformatted at
    HEAD, and the gate covers `tools/ci` only.
- **Godot:** `--check` boots clean. `--test`: **26057 passed, 0 failed**, 28 more than before.
- **Live on the box** (node restarted on the new code):
  - The FFT feed was switched to a bumper's music with `POST /api/audio/test-music
    {file: "projects/a_s/BUMPERY/WSS-27s.mp4"}`; the live input had been silent.
  - I captured `/api/ws` for 10 s: **300 frames in 9.9 s (30 Hz), all with 512-byte `fcWeighted`/`fcRaw`**.
  - Peaks per row (median): the Shadertoy `freq` is **255 (clipped)**, while FragCoord's raw row is **195**, so the
    loud end is kept.
  - Bins 1-4 (47-188 Hz): raw 175.9, weighted 114.6. That is a 61-byte cut (≈19 dB), which is the A curve there.
    Bins 64-67 (3 kHz): 91.2 for both, unweighted as intended.
  - I fed the captured frames through `fc_spectrogram.gd` at 60 fps (headless `-s` script, 595 pulls) and saved
    the history as a PNG. Its R and B planes show a real spectrogram: newest at row 0, the track's risers as
    diagonal sweeps, beats as bands, and the bass columns dimmer in R than in B.
  - **Left as found:** `{stop: true}` gave the FFT its live input back.
  - The operator GUI was not relaunched (the owner is working in it). The new client code is the feed line in
    `visuals_tab.gd`; `--check` covers it compiling, and it runs on the next relaunch.
