# WO-874 — Visuals: the shader library as a scene (Shadertoy code on the Godot RenderingDevice)

**Area:** godot-client, engine
**Status: DONE (31.10, all 190 library shaders compile and render on the box GPU — whole-library Xvfb probe, compared with headless Chrome; Godot suite 23959/0)**

Owner, 30.10 (during WO-873): *"Add shaders to the visuals too"*.

## 1. Investigation

- **The library already exists.** There are 190 Shadertoy-style shaders in `data/shaders/*.json`, served by `GET /api/shaders`
  and `GET /api/shaders/:id` (`src/api/routes-shaders.js:24-30`). They come from WO-266, WO-586 (118 ShaderAmp `sh-sa-*`) and
  WO-587 (`sh-bg-*`). Caspar plays them through `template/shaders/player.js` + `ShaderToyLite.js` (WebGL2, GLSL ES 3.00).
  Each config is `common` plus passes `image` and `bufferA–D`, each `{source, channels[4]}`.
- **Survey of the store** (node script over `shader-store.getShader`):
  - Only 8 shaders use buffers, and only 1 has `common`.
  - Channel values are just `audio` (167), `null` (624) and `A`/`B`/`C`.
  - 13 sources use `dFdx`/`dFdy`/`fwidth`, so the passes must be fragment shaders. A compute shader has no derivatives.
- **Godot's own shading language cannot take this code.** The ShaderAmp conversion (WO-586) relies on mutable globals
  (`vec4 sa_FragColor; vec2 vUv;`), and shaders define names Godot reserves (`#define light(…)`). A translator would fail
  broadly.
- **The RenderingDevice compiles raw GLSL 450** (`shader_compile_spirv_from_source`). GLSL 450 accepts GLSL ES 3.00 code
  nearly unchanged, and is laxer (implicit int→float). A wrapper that declares Shadertoy's uniforms and calls `mainImage`
  is enough.
- **Audio is already in the client.** Every WS `audio_fft` frame carries `freq` and `wave` as base64 512-byte rows, the same
  bytes player.js writes into its 512×2 texture (`player.js:240-246`). The Visuals tab already subscribes (WO-863).
- **GPU compile sweep, measured as the wrapper evolved.** A Godot script compiled every pass of the 188 stored configs with
  the real RenderingDevice on a private Xvfb. Each fix below was driven by a sweep or render result:
  1. 187/188 compiled; `sh-sa-turbulent-flame-vs-glasshawk` failed with `'highp' : overloaded functions must have the same
     parameter precision qualifiers`. The cause is that it defines `max3(float,float,float)`, which collides with glslang's AMD
     trinary min/max built-ins. Fix: rename `min3`/`max3`/`mid3`. Precision qualifiers and statements are stripped as well.
  2. That gave 188/188 compiled in 0.36 s. **Rendered**, though, 44/190 were near-black and 5 white without audio, and 8 dark
     and 17 white with test music on (`POST /api/audio/test-music`, GTZAN disco on loop). The outliers were rendered through
     the real Caspar template in headless Chrome (`tools/shaders/validate-shader-configs.js`) and compared side by side:
     - **`out vec4` of mainImage is undefined in SPIR-V; WebGL zeroes it.** `O -= O; O += …` (sh-bg-slowstars-2) went
       white. Fix: `mainImage(out` → `mainImage(inout`, with the caller passing `vec4(0)`.
     - **ANGLE zero-initialises every uninitialised variable, SPIR-V does not.** `vec3 col; col += …` rendered black or
       white (sh-sa-cheshire-cat…, sh-sa-attempt-at-vdj-effects, sh-sa-shit-just-got-real, sh-waveform-microphone,
       sh-sa-audio-reactive-scene-1st-attempt). Fix: bare declarations (`T a;`, `T a, b;`) get `= T(0)`. Struct bodies are
       skipped, because members cannot have initialisers. After this fix all five matched Chrome.
     - **The Alpha flag** (`opts.alpha`; player.js keys near-black to transparent and premultiplies). sh-bubles, sh-ksjb and
       sh-3d-meters-c* look white in Chrome only because the page is transparent. The same keyed, premultiplied footer is
       used here, so they composite on black.
     - **Bindings the player supplies.** `ensureAudioChannelBinding` (`player.js:366-376`): `audio.enabled` with no pass
       binding audio puts audio on the image's first free channel.
     - **Bindings the library lost.** sh-chillwave-planet's image samples `iChannel0` unbound, and its bufferA is read by
       nobody; sh-revision-qualification-2018-cupe's three buffers are likewise unread. Fix: an orphan buffer goes on the
       image's lowest unbound channel that its code samples. sh-chillwave-planet's bufferA also expects itself on ch0 and a
       noise texture on ch2, neither in the store, so it stays dark here. Its Chrome "red curtain" is leftover GL texture
       state, not the planet: **a library-data issue in both renderers**.
     - **Gain mapping.** The first mapping (`(0.4 + 2·glow)·(0.8 + pulse)`) reached 4× when the starter graph drove glow and
       pulse with the music, and bright skies (sh-bg-simple-2d-clouds) clipped white. It is now 1 at the defaults and at most
       about 1.7.

## 2. What was done

- `godot/client/features/visuals/shadertoy_glsl.gd` (new, pure):
  - The GLSL 450 header: a std140 block for `iResolution, iTime, iMouse, iDate, iTimeDelta, iFrameRate, iFrame,
    iSampleRate, iChannelResolution[4], iChannelTime[4]`; `iChannel0–3` samplers at bindings 1–4; and a fullscreen-triangle
    vertex shader.
  - `fragment(common, source, alpha)` applies the rewrites listed in §1:
    - GLSL 450 / Vulkan keywords renamed (`buffer`, `shared`, `sampler`, `texture3D`, …);
    - three.js's `texture2D(` → `texture(`;
    - precision stripped;
    - `inout` mainImage;
    - zero-initialised declarations.
  - `passes(cfg)` returns buffers A–D then image, with channels normalised and the two repairs applied.
  - Rows are stored the Shadertoy way up (`fragCoord.y` = memory row), so buffer reads, `texelFetch` and the audio rows need
    no flip. Only the display flips.
- `shadertoy_rd.gd` (new):
  - `use(cfg)` compiles on the caller's thread, so a broken shader reports at once with the pass name and glslang's first
    lines.
  - `render(size, time, delta, audio)` builds and draws on the render thread (`RenderingServer.call_on_render_thread`):
    - buffers are RGBA32F ping-pong pairs (linear, clamp);
    - two uniform sets per pass, one per frame parity. A pass reads a buffer already drawn this frame from its new half, and
      itself or later buffers from last frame's;
    - the image is RGBA16F, exposed as a `Texture2DRD`;
    - unbound channels read a 1×1 black texel.
  - A rebuild (new shader or size) makes the new set live before freeing the old one.
  - `gpu_ms` comes from RD timestamps around the passes. Godot reports them in ns.
- `scenes/shader.gd` (new): a quad that fills the stage camera.
  - As the **main** scene it is opaque and 300 units out, behind everything. As **layer 2** it is additive, 2 units out,
    without depth test.
  - Parameters:
    - **speed** is the shader's clock, integrated (0.3 = real time; WO-580: no phase jumps);
    - **hue** rotates hue (0.55 = the shader's own colours);
    - **glow/pulse** set gain;
    - **amount** sets opacity;
    - **burst** gives a flash plus a short clock surge;
    - **spin** is unused (rotating the quad would show its corners).
  - The shader wrote sRGB, so the display shader converts to the stage's linear space.
- `visuals_stage.gd`:
  - `"shader"` added to `SCENES`;
  - `set_shader(cfg)` returns the compile error;
  - `audio_frame(d)` decodes `freq`/`wave` into the 1024-byte texture rows, which go silent after 1 s without frames;
  - a layer's role (main or second) is passed with `set_overlay`.
- `visuals_model.gd`: Shader is added to `SCENES`, and the slice gains `shader` (the library id, `""` = none).
- `visuals_page.gd`: a **Shader** picker (the library sorted by name; shown only while Shader is the scene or layer 2) and a
  status line (compile error / "Pick a shader." / no box).
- `visuals_tab.gd`:
  - `_fetch_shader()` gets the list once, then the picked config. A sequence number drops stale replies.
  - Every `audio_fft` frame goes to `scene.audio_frame`.
  - Dev probe `--probe-visuals-shaders=<dir>`: every library shader, the compile result, canvas and shader GPU ms, mean
    brightness, and a 320-wide PNG.
  - `--probe-visuals-shots` gains shader + particles and tunnel + shader.
- Why not render through Caspar's HTML producer and feed that back: the Visuals stage is one Godot world sent to Caspar over
  the shm ring (WO-742/743). Running shaders inside it is what lets them layer with the WO-873 scenes and take the Flow
  graph's parameters.

## 3. What was VERIFIED

- **GPU compile:** all 188 stored configs, every pass, through the real RenderingDevice (RTX PRO 4000, Vulkan 1.4) on Xvfb:
  188/188 in 0.39 s.
- **GPU render, whole library** (`--probe-visuals-shaders`, 1280×720, test music on): 190/190 rows `OK`. Shader GPU time
  per frame: median 0.13 ms, p90 1.0 ms, max 3.9 ms (sh-sa-resonance-club-3d-audio). Next heaviest: sh-sa-cosmic-scene
  2.9, sh-sa-sailing-beyond-hyper-tunnel 1.9. All fit a 50 fps frame many times over. The canvas viewport itself stays at
  0.1–0.15 ms.
- **Compared with Chrome** (the real Caspar template, `validate-shader-configs.js`):
  - 7 of the 16 outliers are dark or white in Chrome too;
  - the 5 broken by uninitialised variables match after the zero-init fix (contact sheet checked by eye);
  - the alpha-flagged ones composite on black as intended;
  - sh-chillwave-planet is the library-data issue above;
  - sh-sa-audio-flight-v2-strobes differs only in the moment captured.
- **Layers:** shots of shader + particles and tunnel + shader (additive) checked by eye. The scene shots from WO-873 are
  unchanged.
- **Godot suite: 23959 passed, 0 failed.**
  - New `tests/test_shadertoy_glsl.gd`: pass order and channels, both binding repairs, the rewrites, zero-init (struct and
    prototype left alone), Alpha footer, and the shader scene headless (no RD → error, not crash; speed clock; burst surge;
    additive layer 2).
  - `test_visuals_model.gd`: the `shader` slice field.
  - `test_visuals_stage.gd` (unchanged, iterates the model's scenes): the shader scene steps 40 frames with bursts as main under a second layer.
  - `run-client.sh --check` boot OK.
- **Not proven:**
  - the shader scene on a PGM screen over SHM (scene-agnostic WO-863 path, same as WO-873);
  - live picking in the owner's GUI, which needs a relaunch to load the new code;
  - a compile hitch when switching shaders on air. glslang runs on the main thread, and the sweep's 0.39 s for 188 configs
    suggests a few ms each, but it was not timed per switch in the GUI.

## 4. Open

- sh-chillwave-planet needs its bindings restored in the library (bufferA ch0 = A, ch2 = a noise texture we do not ship).
  The fix belongs in `data/shaders`, not here.
