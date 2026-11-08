# WO-999 — Run FragCoord shaders natively in Visuals (u_* uniforms, the 512×512 audio spectrogram, passes), no Shadertoy conversion
**Area:** godot-client, engine, audio
**Status: DONE (08.11 — headless suites + six openly licensed FragCoord shaders imported and rendered in the live Visuals stage with music on u_audio, screenshots; level A/B against FragCoord's own editor not done)**

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

### Step 2 — the FragCoord wrapper and runner (08.11)

- **A sibling runner, not a mode of `shadertoy_rd.gd`.** The two dialects share almost nothing at bind time: names vs
  channels, `pass1..8` + `main` vs `bufferA-D` + `image`, a 432-byte UBO vs Shadertoy's. Folding both into one file
  would cross the 500-line limit and tangle two binding models. Only the ES→450 renames and zero-init are shared
  (`shadertoy_glsl.gd` `_rename`).
- **`godot/client/features/visuals/fragcoord_glsl.gd`** (new, 217 lines, pure):
  - `BLOCK`: one std140 UBO with every FragCoord built-in. `u_frame` and the other ints are real `int`s; the custom
    values ride in `vec4 _hgC[16]` from byte 176 (`UBO_SIZE` 432).
  - `passes(cfg)`: pass1..8 in order, then main; empty sources are skipped; `format` falls back to rgba8.
  - `uniforms(cfg)`: every `uniform` line in common + passes. Value uniforms get a slot with their defaults (an
    initialiser or the `//d, [a,b]` comment; the last value fills the rest; no default → 0 clamped into the range).
    Texture uniforms keep their type and the comment's URL/`proc3d:`. Built-ins and `u_passN` are left out; the
    first declaration wins, common first.
  - `fragment()`: strips `#version`, `precision`, `out vec4 fragColor;` and every `uniform` line, but keeps the
    line itself so `#line 1` error lines match the editor. Each value uniform becomes a `#define u_x (_hgC[i].xyz)`
    (int / bool wrapped). Only the samplers a pass actually names are declared, in binding order: built-ins,
    passes, custom. A user `main` is renamed `fc_user_main`; `mainImage`'s `out` becomes `inout`, because SPIR-V
    does not zero an out param the way WebGL does. The footer zeroes `fragColor` and calls the entry. The library's
    alpha flag adds the existing alpha key to main.
- **`godot/client/features/visuals/fragcoord_rd.gd`** (new, 305 lines): the same surface as `shadertoy_rd.gd`
  (`texture`, `error`, `use`, `render`, `release`), so `scenes/shader.gd` swaps runners without other changes.
  - `use()` recompiles only when common, passes or uniforms change. A value change just refills the slots.
  - Targets: main renders into `image` (copied to `prev` after the draw when it reads `u_main`). Aux passes are
    ping-pong pairs in their format (rgba8, or rgba16f/32f when named). A pass reads another pass's half drawn
    earlier this frame, or last frame's.
  - `u_audio` is the shared spectrogram from step 1, uploaded only when its `rev` changes and pulled once per drawn
    frame however many layers use it.
  - Unbound inputs: `u_keyboard` and `u_webcam` read black. URL, video and `proc3d:` textures read white of their
    type (2D, 3D or cube), so the shader compiles and draws.
  - The UBO fills `u_date` (0-based month, as FragCoord's), `u_refresh_rate` from the display, and a fixed camera
    at (0,0,3) looking down −z.
- **`scenes/shader.gd`**: `set_shader` picks `fragcoord_rd.gd` when `cfg.dialect == "fragcoord"`, else the
  Shadertoy runner, releasing the old one and rebinding the material's texture.

### Step 3 — library, import and the license gate (08.11)

- **`src/shaderfx/fragcoord-config.js`** (new): the library shape. It has `dialect: 'fragcoord'`, passes `main` +
  `pass1..8` with an optional format, `values`, and `source` provenance (site, slug, url, title, author, license,
  licenseUrl, `licenseKind` open/nc/none, and the golf originals).
- **`src/shaderfx/shader-store.js`**: normalisation branches on the dialect. FragCoord shaders get no Caspar
  template export, because Caspar's HTML player runs Shadertoy configs only (`casparPath: null`). The list carries
  `dialect`, `license` and `licenseKind`.
- **`src/shaderfx/fragcoord-import.js`** (new): link or slug → MCP `get_shader`, falling back to `/s/<slug>.md` →
  parse the header and pass headings → license gate → golf passes converted through `convert_shader` →
  `sh-fc-<slug>-<words>` config.
  - **Gate:** "none" (all rights reserved) and hidden-source marketplace shaders are always refused. NC is refused
    unless `allowNonCommercial: true` is sent. Share-alike licenses come back as a warning.
  - Golf is detected by its markers (`@(`, `f2`/`f3`/`f4`, `uniform f|f2|s2`), not by tags; a tag rule misfired on
    plain GLSL.
  - The converter wraps every body in `void main(){}`. Common gets that empty main stripped again
    (`stripEmptyMain`), or every pass would carry two mains.
  - The User-Agent is generic (`highascg-shader-import/1.0`).
- **`src/api/routes-shaders.js`**: `POST /api/shaders/import` with a FragCoord link imports and saves straight away,
  returning `{ok, saved, config, warnings}`. A Shadertoy link takes the old WO-380 path.
- **`client/components/shader-fx-modal.js`**: the web modal's import box accepts the link and refreshes the list
  (its pass editor is Shadertoy-only, so there is nothing to review).

### Known limits (not in this WO)

- URL, video and `proc3d:` textures read white; `u_keyboard` and `u_webcam` read black. `u_mouse`, `u_drag` and
  `u_scroll` are 0, and the camera is fixed.
- MRT, `u_passes[]` and non-2D buffers are not supported.
- FragCoord's markdown does not carry pass formats, so imports run rgba8 everywhere. A shader that needs float
  buffers needs its `format` set in the library.
- There is no paste-link box in the Godot client yet; import goes through the API or the web modal.
- `audio_fft.emitHz` stays 30, so each spectrogram row is written twice (step 1).
- The library's shader files live in `data/shaders/` (gitignored, box-local), so imports are not in the repo.

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

### Steps 2-3

- **Godot:** `--check` boots clean. `--test`: **26109 passed, 0 failed**. That includes
  `tests/test_fragcoord_glsl.gd` (6 tests): pass order and formats, custom uniforms → slots and overrides, the main
  form, the mainImage form with redeclarations dropped, the UBO constants, and 3D/cube sampler types.
- **Offline:** `tools/smoke/smoke-wo999-fragcoord-import.test.js` (curated), 14 tests: link → slug, markdown parsing, the
  license classes and gate (none, NC, hidden source), golf detection (including the plain-GLSL regression), the empty-main strip, id shape, the store
  round trip without a template, and the route wiring. `run-offline-tests.js`: **5540 passed, 0 failed**. No files
  over 500 lines.
- **Live import** (node restarted on the new code), `POST /api/shaders/import`:
  - **Refused:** Cauldron `30gw2t1g` (license none) and an NC shader without the opt-in.
  - **Saved:**
    - `sh-fc-ao6dc217-audio-equalizer-demo` (CC0);
    - `sh-fc-anl8jy1b-audioreactive-crossection` (MIT, sampler3D LUT);
    - `sh-fc-u4uhc9b9-radiance-cascades-2d-gi` (MIT, main + 2 passes);
    - `sh-fc-l34e0isf-lightwell` (CC BY 4.0, 3 passes);
    - `sh-fc-bpg0gxcb-birds-flying` (MIT);
    - `sh-fc-sclzvh0m-short-coding-for-unwind` (MIT, golf → GLSL).
- **Live render in the owner's GUI** (relaunched on the Visuals tab with the new code):
  - Each shader was put on a Visuals layer through the project autosave (stored doc + rev, same slug; no output
    ring, so nothing went to air). The bumper music fed the FFT (`test-music`). `:0` was captured with `xwd`.
  - **Equalizer:** the bars move with the music, so u_audio → spectrogram → RD texture works end to end.
  - **Lightwell** (3 passes) and **birds** render as on the site. The converted golf shader renders its fractal.
  - **Radiance cascades** draws its cascade pattern. With `u_mouse` at 0 it has no light source.
  - **Crossection** draws a hard black/white silhouette, because its 3D LUT reads white (known limit).
  - The client log has no shader or compile errors for the run.
- **Left as found:**
  - test-music was stopped.
  - The Visuals slice was set back. `visuals` is Godot-owned (WO-863, `project-client-slices.js`), so an autosave
    that omits the key keeps the stored copy. It was cleared with `visuals: null`, which `visuals_model.gd`
    `slice_of` reads exactly like the missing key; the project was otherwise identical to the backup.
  - `projects/_trash` stayed at 1 entry. The GUI was relaunched on Live.
- **Not done:** a level A/B of the same music in FragCoord's editor against our spectrogram.
