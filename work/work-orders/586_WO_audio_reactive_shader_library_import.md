# WO-586 — import a large library of audio-reactive shaders (ShaderAmp → 118 `sh-sa-*` shaders)

**Status: IMPLEMENTED 30.09.26. Every shader compiles and renders through the real exported template in headless Chrome, and was imported through `POST /api/shaders` (118/118 ok, library 43 → 161). NOT yet seen on air: whether each one looks right with real program audio on the GPU is owner QA (§4). Licence decision is the owner's (§5).**

Owner, 30.09: *"can you find a large library of audio reactive shaders and add them to the shader
library in highascg?"*

## 1. Investigation: where a library can come from

| source | result |
|---|---|
| Shadertoy API (WO-380 route) | No `shadertoyApiKey` configured, and unauthenticated access is Cloudflare-blocked (measured in WO-380). Not usable. |
| Hugging Face `Vipitis/Shadertoys` (full API dump) | Gone or private now (`datasets-server` says it doesn't exist). `Vipitis/Shadereval-inputs` is 467 image-only eval rows with no audio. `marx161-cmd/audio-reactive-shaders-data` is black-hole textures only, with no shaders. |
| `hughesdo/OneOffRender` (GitHub, 577 GLSL) | 258 are flagged `audio_reactive` in `Shaders/metadata.json`, but they are rewritten into standalone `#version 330` + `main()`, their audio texture is 512×256 with FFT in rows 0–1, there's no repo licence, and ~160 of them are copies of the ShaderAmp set anyway. It would work as a second pass, not a first. |
| **`ArthurTent/ShaderAmp`** (GitHub, MIT extension, 209 `.frag` + `.frag.meta`) | **Chosen.** It's a curated audio-visualiser collection. Every shader has a meta file with author, Shadertoy URL and **licence**, and the code is Shadertoy code inside a thin three.js wrapper. Clone used: `dcb1e1b`. |

How ShaderAmp differs from our runtime (read from `src/content/AnalyzerMesh.tsx` in that repo):

- **Entry point:** 70 files use `main(){ mainImage(gl_FragColor, vUv*iResolution.xy); }`. The rest put the code directly in `main()`, reading `vUv` and writing `gl_FragColor`. Extracting `mainImage` would therefore only port about a third of them.
- **Audio:** audio arrives as `uniform sampler2D iAudioData`, a `DataTexture(fftSize/2, 1)` built from `getByteFrequencyData`. That is **one row of FFT**, so ShaderAmp shaders read FFT at any y (`0.0`, `0.25`, `0.5`, even `4.`). Ours (`player.js:6`) is Shadertoy's 512×2 with the **waveform in row 1** and `LINEAR` + `CLAMP_TO_EDGE`, so a y above 0.25 would blend in waveform, which reads 0.5 during silence.
- **Unbound channels:** any `iChannelN` not set in meta gets a fallback sky JPEG, so a shader that samples an unbound channel depends on an image we don't ship.
- **Extras:** `iAmplifiedTime` is a time value that runs faster with loudness, and three.js supplies `saturate()`, which GLSL ES doesn't have.

## 2. What was done

`tools/shaders/convert-shaderamp.py` wraps each shader **whole** instead of extracting its `mainImage`, so both entry-point styles convert the same way:

- `main` → `sa_main`, `mainImage` → `sa_mainImage`, and `gl_FragColor` → a global `sa_FragColor`.
- `varying vUv` becomes a global, set by a new `mainImage` (`vUv = fragCoord / iResolution.xy`) that runs `sa_main()` and returns `sa_FragColor`.
- `iAudioData` → the first `iChannelN` the code doesn't touch, bound `'audio'`. Each `texture*/texelFetch(iAudioData, P…)` coordinate is wrapped in `sa_fft()` / `sa_fftI()`, which **pins y to the FFT row** and keeps ShaderAmp's behaviour.
- The rest:
  - `iAmplifiedTime` → `iTime`.
  - `saturate` becomes a `clamp` macro, but only when a shader uses it without defining it.
  - Builtin uniform declarations are dropped because ShaderToyLite declares them.
  - `customUniforms` floats become consts set to their defaults.
- Buffers map from meta `output` 0–3 to `bufferA–D`, and `bufferN` channel refs map to `A–D`.
- An attribution header (name, author, Shadertoy URL, ShaderAmp porter, **licence**) is prepended to each image pass.
- Ids are `sh-sa-<slug>`, never reusing an existing id, so the batch can be found or removed as a unit.

Skipped rather than mis-wired (67, full list in the appendix):

- 22 need an image or video asset.
- 16 need the webcam, plus 4 that use `iVideo`.
- 10 sample a channel ShaderAmp fills with its fallback image.
- 5 are experimental ShaderAmp feature demos.
- 2 never sample audio.
- 5 have unsupported uniforms or keyboard input.
- 3 were excluded by hand:
  - `AGiftForYou`: ShaderAmp's own promo and credits screen.
  - `Fork_Complicating_things_even_further`: samples FFT at x=1..12, which clamps to the silent top bin, so it is dark by construction in ShaderAmp too.
  - `Informer`: hangs the headless renderer, so it couldn't be verified.

`tools/shaders/validate-shader-configs.js` runs each config through `normalizeShaderConfig` and `buildShaderTemplateHtml`, the exact functions the store uses. It loads the page with the real `player.js`/`ShaderToyLite.js` in headless Chrome (`headless-chrome-cdp.js`, 320×180, `?shaderThumb=1` synthetic spectrum). It traps `console.error`, which is where ShaderToyLite reports GLSL compile failures, and records luminance stats for two frames 1 s apart plus a screenshot. After any timeout it relaunches Chrome, because the first run showed that one hung renderer made every later page time out.

Import: each passing config was POSTed to `/api/shaders`, which the server normalises and saves, writing `data/shaders/<id>.json` and `template/shaders/<id>.html`. No server code changed.

## 3. What was VERIFIED

- **The harness catches what it claims to.** Controls:
  - 3 existing library shaders render clean (`sh-audio-reactive-galaxy`, `sh-blue-thunder`, `sh-dot-globe`).
  - A deliberately broken copy is caught: `Fragment Shader compilation failed: … '{' : syntax error`.
- **Iterations:**
  - First run: 92/123 clean. 4 hit `saturate … no matching overloaded function` (fixed in the converter), and 27 were cascade timeouts after `Informer` hung the renderer (fixed in the harness).
  - After that: the `saturate` detector wrongly treated `return saturate(` as a definition; fixed by matching only type-prefixed definitions.
- **Final run on the exact configs imported: 121/121 compiled with 0 errors.** 118 were kept after the exclusions above. I looked at every screenshot on contact sheets:
  - `habitable-planet` shows only stars at t≈2.5 s. With time shifted +20 s the planet is in frame (lit 0.45), so this is just its orbit.
  - `audio-visualizer-5-wipeout` is white under the loud static thumb spectrum and black in silence (`NOTHUMB=1`). `genizm-id-visualizer` is a pale full frame when loud and a shape when quiet. Both are level-driven, not broken, but **their library thumbnails will look blank**, because thumbs use the same loud synthetic spectrum (WO-344).
- **Import:** 118/118 `{"ok":true}`. `GET /api/shaders` now lists 161 shaders, 118 `sh-sa-*`, all with `audio: true`. All 118 `template/shaders/sh-sa-*.html` are byte-identical to the validated pages once the injected error trap is removed.
- **Tools:** `npx eslint tools/shaders/validate-shader-configs.js` is clean, and the 500-line gate reports 0 files over.
- **NOT verified:**
  - On-air look with real program audio on the GPU. SwiftShader proves compile and render, not taste or performance.
  - Performance of the heavy raymarchers at 1080p/4K on the RTX. Some are expensive (`vt220-at-night` took 7 s per page on SwiftShader).
  - Thumbnail generation for 118 new looks.

## 4. Owner QA

- [ ] Browse the Shader library and audition a handful on PRV with music playing. Delete any you don't want, which removes both files.
- [ ] Watch the GPU on the heaviest ones before putting them on air.

## 5. Licence — owner decision

**107 of the 118 are CC BY-NC-SA (non-commercial)**, the Shadertoy default. The others: 9 CC0, 1 MIT, 1 CC BY 3.0. Each shader carries its licence and author in the header of its image pass (Shader editor → Image). If the box is used for paid work, the NC ones need either permission from the author or removal. The CC0/MIT/CC-BY ones are listed in the appendix. The pre-WO library likely has the same exposure: its Shadertoy-sourced shaders (e.g. `sh-audio-reactive-galaxy`) fall under the same site default unless their authors said otherwise.

## Appendix — imported shaders and skips (generated from the converter report)

| id | name | author | license | source |
|---|---|---|---|---|
| `sh-sa-3d-audio-visualizer` | 3D Audio Visualizer | kishimisu | CC BY-NC-SA 4.0 | https://www.shadertoy.com/view/dtl3Dr |
| `sh-sa-3d-audio-visualizer-2` | 3D Audio Visualizer #2 | kishimisu | CC BY-NC-SA 4.0 | https://www.shadertoy.com/view/Dtj3zW |
| `sh-sa-abstract-music` | Abstract Music | MatHack | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/4stSRs |
| `sh-sa-acid-blossom-visualizer-sound` | Acid blossom visualizer (Sound!) | Forthro | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/mlcfW2 |
| `sh-sa-another-synthwave-sunset-thing` | another synthwave sunset thing | stduhpf | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/tsScRK |
| `sh-sa-attempt-at-vdj-effects` | Attempt at VDJ effects | mrange | CC0 | https://www.shadertoy.com/view/XctGzf |
| `sh-sa-audio-band-eq-demo` | Audio Band EQ Demo | byt3_m3chanic | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/WfByz1 |
| `sh-sa-audio-flight-v2-strobes` | Audio Flight v2 (strobes) | byt3_m3chanic | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/7tfyRl |
| `sh-sa-audio-reactive-fractal` | Audio Reactive Fractal | FaustianBargainForTop | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/dtSBR1 |
| `sh-sa-audio-reactive-scene-1st-attempt` | Audio-reactive scene 1st attempt | kishimisu | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/cslSRr |
| `sh-sa-audio-visualizer` | Audio-Visualizer | CoolerZ | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/wd3XzS |
| `sh-sa-audio-visualizer-5-wipeout` | Audio Visualizer #5 - Wipeout | kishimisu | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/ddXfzf |
| `sh-sa-audiovisual` | AudioVisual | Passion | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/MsBSzw |
| `sh-sa-audiovisualizer-bars-3-sidhu` | AudioVisualizer bars 3 (sidhu) | ramansinghdhiman | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/lcBSWR |
| `sh-sa-auroras` | Auroras | nimitz | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/XtGGRt |
| `sh-sa-basic-audio-visualizer` | Basic Audio Visualizer | chronos | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/lsdGR8 |
| `sh-sa-blueprint-of-the-architekt` | Blueprint of the Architekt | s23b | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/4tySDW |
| `sh-sa-bubbles-music-visualizer` | Bubbles music visualizer | liyouvane | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/llXBWB |
| `sh-sa-burning-heart` | Burning Heart | dnnkeeper | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/llXGRX |
| `sh-sa-call-of-the-siren` | Call of the Siren  | Quasimondo | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/7sSSDd |
| `sh-sa-cheshire-cat-and-cute-little-shader-combined-https-w` | Cheshire Cat and cute little shader combined. https://www.shadertoy.com/view/wsf3RN | teassy000 and julianlumia | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/MdtSWr |
| `sh-sa-christmas-tree` | Christmas tree ::) | vanshika | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/MfGBWm |
| `sh-sa-cloned-rainbow-spectrum` | cloned: rainbow spectrum | hornet | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/ldX3D8 |
| `sh-sa-cosmic-scene` | Cosmic scene | Thominator | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/Xl3fWr |
| `sh-sa-cross-sdf-fractal` | Cross SDF fractal | bradjamesgrant | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/tssfz7 |
| `sh-sa-danaga-s-wingman` | danaga's wingman | s23b | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/MdtXDf |
| `sh-sa-dancing-color-rings` | Dancing Color Rings | QuantumSuper | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/md3GDl |
| `sh-sa-domain-warped-fbm-noise` | Domain warped FBM noise | liamegan | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/wttXz8 |
| `sh-sa-ethereal-pulsar-music-visualizer` | Ethereal Pulsar Music Visualizer | Forthro | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/dtyfzD |
| `sh-sa-evacuation` | Evacuation | Xor | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/4l2GW1 |
| `sh-sa-everybody-dance` | Everybody Dance | s23b | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/XsySDW |
| `sh-sa-exclamation-heart-nr-2-3` | Exclamation Heart Nr.2 <3! | ArthurTent | CC BY-NC-SA 4.0 | https://www.shadertoy.com/view/43dGDn |
| `sh-sa-exit-the-matrix` | Exit the Matrix | Kali | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/NlsXDH |
| `sh-sa-eye-of-haji-sauron` | Eye of Haji Sauron | arminkz | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/X3jcWR |
| `sh-sa-fft-domain-coloring` | FFT Domain Coloring | pixelbeast | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/Mt2GWt |
| `sh-sa-fft-experiment` | fft experiment | nshelton | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/4tK3zG |
| `sh-sa-flower-speaker` | Flower Speaker | coposuke | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/ttXczX |
| `sh-sa-fluidic-space` | Fluidic Space | EnigmaCurry | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/tdS3DD |
| `sh-sa-fork-dancing-glow-lights` | Fork: Dancing Glow Lights | QuantumSuper | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/DtsBWH |
| `sh-sa-fork-dive-into-music` | Fork: Dive Into Music | QuantumSuper | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/cst3zl |
| `sh-sa-fork-ltt-logo-radiantmusicvis` | Fork LTT Logo + RadiantMusicVis | ArthurTent | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/4XKGRw |
| `sh-sa-fork-neural-stanford-c-base` | Fork: Neural Stanford c-base | ArthurTent | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/4fyfzK |
| `sh-sa-fork-nixie-tube-clock` | Fork Nixie Tube Clock | picoplanetdev | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/Dds3WB |
| `sh-sa-foxie` | Foxie | z0rg | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/NdlGzs |
| `sh-sa-fractal-77-music-visualizer` | Fractal 77 Music Visualizer | orblivius | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/XXBGzw |
| `sh-sa-frequency-balls` | frequency balls | nshelton | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/4scGW2 |
| `sh-sa-frequency-visualization` | Frequency Visualization | rakeshcjadav | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/MdVSWG |
| `sh-sa-galaxy-of-universes` | Galaxy of Universes | Dave_Hoskins | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/MdXSzS |
| `sh-sa-gauges` | Gauges | QuantumSuper | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/DsjcRD |
| `sh-sa-genizm-id-visualizer` | Genizm - Id (Visualizer) | gurudevbk | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/7ldyzN |
| `sh-sa-glowest` | Glowest | TornaxO7 | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/w3tcWr |
| `sh-sa-glxy-epilogue` | glxy epilogue | vadevaman | CC BY-NC-SA 4.0 | https://www.shadertoy.com/view/MtdfRM |
| `sh-sa-habitable-planet` | Habitable Planet | Kali | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/WdScRW |
| `sh-sa-i-don-t-know-how-i-made-this` | i don't know how i made this | xbvuno | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/43KBRK |
| `sh-sa-ictalurus-forest` | Ictalurus Forest | Nimajamin | MIT | https://www.shadertoy.com/view/MsVSWK |
| `sh-sa-inercia-royaliptic` | Inercia Royaliptic | leon | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/md2GDD |
| `sh-sa-livecoding-airport-animefes-2023` | LiveCoding@AirPort AnimeFes 2023 | gam0022 | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/dldyz2 |
| `sh-sa-log-spherical-kifs-zoomer` | Log Spherical KIFS 'Zoomer' | derSchamane | CC0 | https://www.shadertoy.com/view/ctcGRf |
| `sh-sa-low-frequency-flow` | ♫ Low Frequency Flow | patu | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/MtKSRc |
| `sh-sa-magfest-station-event` | ♫ [MAGFest] Station event | patu | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/4llfDs |
| `sh-sa-mandelkoch-music-visualiser-ver` | MandelKoch- Music Visualiser ver | Pelegefen | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/sslXzX |
| `sh-sa-merry-christmas-388-chars` | Merry Christmas! [388 chars] | kishimisu | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/4fs3WS |
| `sh-sa-mind-flowers` | Mind flowers | mrange | CC0 | https://www.shadertoy.com/view/DslfR7 |
| `sh-sa-mind-flowers-2` | Mind flowers | mrange | CC0 | https://www.shadertoy.com/view/DlB3WG |
| `sh-sa-modified-bear` | Modified Bear | s23b | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/XtGGW3 |
| `sh-sa-more-glow-experiments` | More glow experiments | mrange | CC0 | https://www.shadertoy.com/view/W3X3zl |
| `sh-sa-moving-without-travelling` | Moving without travelling | mrange | CC0 | https://www.shadertoy.com/view/NtXSzl |
| `sh-sa-music-mandlebrot` | Music + Mandlebrot | sujay | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/4dKBDh |
| `sh-sa-musical-heart` | Musical Heart | Passion | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/XdsyW4 |
| `sh-sa-mystic-flower-interactive` | Mystic Flower interactive | timmaffett  | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/mdjGDc |
| `sh-sa-nanokontrol2` | nanoKontrol2 | byt3_m3chanic | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/NlsfDM |
| `sh-sa-neon-bridge` | Neon Bridge | kishimisu | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/msjXzR |
| `sh-sa-neon-octagonal-audio-visualizer` | Neon Octagonal Audio Visualizer | Emiel | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/Wd23Rw |
| `sh-sa-new-colorful-galaxy` | new colorful galaxy | nayk | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/l3fczr |
| `sh-sa-otherworldy` | Otherworldy | lherm | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/MlySWd |
| `sh-sa-pop-shift` | Pop Shift | QuantumSuper | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/cdcBWs |
| `sh-sa-quicky-058` | 大龙猫 - Quicky#058 | totetmatt | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/fdcGRj |
| `sh-sa-radar-music-visualizer` | Radar Music Visualizer | laserdog | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/Ml2cDK |
| `sh-sa-rainbow-soundviz` | 🎶 Rainbow soundviz 🎶 | avin | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/ttfGzH |
| `sh-sa-recogniser` | Recogniser | fizzer | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/MdX3Dn |
| `sh-sa-resonance-club-3d-audio` | Resonance Club 3D (Audio) | dathor | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/sXV3zR |
| `sh-sa-ribbons` | Ribbons | XT95 | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/lds3zr |
| `sh-sa-ripplelppir` | ripplelppir | bombblob | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/w3sGR7 |
| `sh-sa-sailing-beyond-hyper-tunnel` | ♫ Sailing Beyond - Hyper Tunnel | patu | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/4t2cR1 |
| `sh-sa-sesh-maybe` | SESH maybe? | MeDope | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/ftSGWy |
| `sh-sa-sh18-babytoy` | [SH18] BabyToy | Martijn Steinrucken aka BigWings | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/lldyWn |
| `sh-sa-shatter-flake` | Shatter Flake | QuantumSuper | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/ctBSWt |
| `sh-sa-shit-just-got-real` | Shit just got real | db0x90 | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/Xdjczt |
| `sh-sa-soap-bubble-music-visualizer-1` | Soap Bubble Music Visualizer #1 | Ruzzyr | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/XtVSDt |
| `sh-sa-solum-object` | Solum Object | QuantumSuper | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/mtKGRW |
| `sh-sa-sonic-pulse` | Sonic Pulse | WillKirkby | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/4dcyD2 |
| `sh-sa-sound-blob` | Sound Blob | seb0fh | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/Ms3SWr |
| `sh-sa-sound-everyone-s-favorite-song` | (sound) Everyone's Favorite Song | Tilmann | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/fldcWf |
| `sh-sa-sound-oscilloscope-from-spectrum` | Sound Oscilloscope from spectrum | jaszunio15 | CC BY 3.0 | https://www.shadertoy.com/view/Ws2GWD |
| `sh-sa-sound-reactive-circle` | Sound Reactive Circle | Friend | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/NlsfDM |
| `sh-sa-spaceship-console` | Spaceship Console | QuantumSuper | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/DlVXDc |
| `sh-sa-speaker-visualizer` | Speaker visualizer | jaszunio15 | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/wsdXDN |
| `sh-sa-supernoise` | ♫ SuperNoise | patu | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/XtlfWX |
| `sh-sa-synesthetic-rings` | Synesthetic Rings | isaacchurchill | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/Wt2cWR |
| `sh-sa-synthwave-canyon` | Synthwave canyon | mrange | CC0 | https://www.shadertoy.com/view/slcXW8 |
| `sh-sa-techno-core` | Techno Core | Kali | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/wtdXzS |
| `sh-sa-testmoney` | TestMoney | uratowel12 | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/ds23zd |
| `sh-sa-the-dark-side-of-the-moon` | The Dark Side of the Moon | nyri0 | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/sdSyz3 |
| `sh-sa-the-popular-shader` | The Popular Shader | fizzer | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/XdB3Dw |
| `sh-sa-the-popular-shader-2` | The Popular Shader | fizzer | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/XdB3Dw |
| `sh-sa-the-raven-that-refused-to-sing` | The Raven That Refused To Sing | s23b | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/4dSyDm |
| `sh-sa-the-voiceless` | The Voiceless | python273 | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/ls3cWM |
| `sh-sa-toydivision` | ToyDivision | seani | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/MlG3zm |
| `sh-sa-tribute-to-my-old-atari` | Tribute to my old Atari | mrange | CC0 | https://www.shadertoy.com/view/3lyBRt |
| `sh-sa-truchet-kaleidoscope-ftw` | Truchet + Kaleidoscope FTW | mrange | CC0 | https://www.shadertoy.com/view/7lKSWW |
| `sh-sa-turbulent-flame-vs-glasshawk` | Turbulent Flame vs Glasshawk | Cotterzz | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/tfjXWK |
| `sh-sa-twisted-thingy` | twisted thingy | wj | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/3dXSDB |
| `sh-sa-tycho-awake-album-cover` | Tycho / Awake - Album Cover | vochsel | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/MsGGzR |
| `sh-sa-vinyl-visualizer` | Vinyl Visualizer | s23b | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/XlcXDX |
| `sh-sa-vortex` | 大龙猫 - Vortex | totetmatt | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/3tdfD2 |
| `sh-sa-vt220-at-night` | vt220 at night | sprash3 | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/lt2SDK |
| `sh-sa-warp-speed` | Warp speed | Dave_Hoskins | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/Msl3WH |
| `sh-sa-waveform-music-445` | Waveform Music [445] | Xor | CC BY-NC-SA 3.0 | https://www.shadertoy.com/view/wfcGR2 |

Skipped (67):

- `CustomUniformDemo.frag` — ShaderAmp feature demo (experimental)
- `InteractiveCubes.frag` — ShaderAmp feature demo (experimental)
- `LCARSDisplay.frag` — ShaderAmp feature demo (experimental)
- `MoreCubesForTheCubeLovers.frag` — ShaderAmp feature demo (experimental)
- `things_audio_and_shapes.frag` — ShaderAmp feature demo (experimental)
- `AGiftForYou.frag` — ShaderAmp's own promo / credits screen, not content
- `MandelbrotMultiverse.frag` — iChannel0 needs asset images/38c3-c-base1.png
- `NyanCatAudioRainbow.frag` — iChannel0 needs asset images/NyanCatSprite.png
- `ForkRadarPanel.frag` — iChannel0 needs asset images/otaviogood_shader_fontgen.png
- `Shaderwave.frag` — iChannel0 needs asset images/otaviogood_shader_fontgen.png
- `knightrider.frag` — iChannel0 needs asset images/pexels-eberhard-grossgasteiger-966927.jpg
- `CubeMusicTransmitter.frag` — iChannel0 needs asset images/pierre-bamin-_EzTds6Fo44-unsplash.jpg
- `PlasmaGlobe.frag` — iChannel0 needs asset images/pierre-bamin-_EzTds6Fo44-unsplash.jpg
- `ThirtyThousandWaves.frag` — iChannel0 needs asset images/pierre-bamin-_EzTds6Fo44-unsplash.jpg
- `[TWITCH]GenuaryNr02_Flopine.frag` — iChannel0 needs asset images/pierre-bamin-_EzTds6Fo44-unsplash.jpg
- `Blunderbuss.frag` — iChannel0 needs asset images/sky-night-milky-way-star-a7d722848f56c2013568902945ea7c1b.jpg
- `FunkyDiscoBall2.frag` — iChannel0 needs asset images/sky-night-milky-way-star-a7d722848f56c2013568902945ea7c1b.jpg
- `March_12_2021.frag` — iChannel0 needs asset images/sky-night-milky-way-star-a7d722848f56c2013568902945ea7c1b.jpg
- `StarTrekInAShader.frag` — iChannel0 needs asset images/sky-night-milky-way-star-a7d722848f56c2013568902945ea7c1b.jpg
- `[SH16B]WIPWarpTunnel.frag` — iChannel0 needs asset images/sky-night-milky-way-star-a7d722848f56c2013568902945ea7c1b.jpg
- `[SH17A]FunkyDiscoBall.frag` — iChannel0 needs asset images/sky-night-milky-way-star-a7d722848f56c2013568902945ea7c1b.jpg
- `inFX.1b.frag` — iChannel0 needs asset images/sky-night-milky-way-star-a7d722848f56c2013568902945ea7c1b.jpg
- `tardigrade.frag` — iChannel0 needs asset images/sky-night-milky-way-star-a7d722848f56c2013568902945ea7c1b.jpg
- `Day30-XargantianPolyjupe.frag` — iChannel0 sampled without a binding (ShaderAmp fallback image)
- `DiscoGoldrays.frag` — iChannel0 sampled without a binding (ShaderAmp fallback image)
- `DnB_corridor.frag` — iChannel0 sampled without a binding (ShaderAmp fallback image)
- `DodecaIcosaAndStellations.frag` — iChannel0 sampled without a binding (ShaderAmp fallback image)
- `QuiteSaturdayAfternoon.frag` — iChannel0 sampled without a binding (ShaderAmp fallback image)
- `FractalLand.frag` — iChannel1 needs asset images/NyanCatSprite.png
- `tHegRiD.frag` — iChannel1 needs asset images/pexels-eberhard-grossgasteiger-966927.jpg
- `NeonWorld.frag` — iChannel1 needs asset images/pierre-bamin-_EzTds6Fo44-unsplash.jpg
- `LHC.frag` — iChannel1 sampled without a binding (ShaderAmp fallback image)
- `ThunderEye.frag` — iChannel1 sampled without a binding (ShaderAmp fallback image)
- `WeNeedAnExpertDaveHoskins.frag` — iChannel1 sampled without a binding (ShaderAmp fallback image)
- `fru-isco.frag` — iChannel1 sampled without a binding (ShaderAmp fallback image)
- `nyan_cat_visualizer.frag` — iChannel2 needs asset images/NyanCatSprite.png
- `Audiophilecampfireatnight.frag` — iChannel2 sampled without a binding (ShaderAmp fallback image)
- `MirrorOnTheWallsAudio.frag` — iChannel3 needs asset images/otaviogood_shader_fontgen.png
- `Anastasia.frag` — needs video/webcam
- `CozyCabinTV.frag` — needs video/webcam
- `DancingCubeField_Visualiser.frag` — needs video/webcam
- `EdgeDetectionUsing_dFdx_dFdy.frag` — needs video/webcam
- `EdgeDetectionUsing_dFdx_dFdy_c-base.frag` — needs video/webcam
- `ElectricDream.frag` — needs video/webcam
- `EverydaySkeletons_c-base.frag` — needs video/webcam
- `FontDemo.frag` — needs video/webcam
- `ForkWaveform[Orblivionized].frag` — needs video/webcam
- `JetAnotherVisualizer.frag` — needs video/webcam
- `MatrixRainShader.frag` — needs video/webcam
- `Pixellerman.frag` — needs video/webcam
- `Shaderwave_vid.frag` — needs video/webcam
- `Shaderwave_vid_c-base.frag` — needs video/webcam
- `echappatoire.frag` — needs video/webcam
- `echappatoire_with_heart.frag` — needs video/webcam
- `Hexagone.frag` — not audio reactive (never samples iAudioData)
- `WavingGridTunnel.frag` — not audio reactive (never samples iAudioData)
- `Informer.frag` — renderer hang in validation (headless render never completes) — unverifiable
- `Fork_Complicating_things_even_further.frag` — samples FFT at x=1..12, clamped to the silent top bin — dark by construction (also in ShaderAmp)
- `AHugeEverGrowing.frag` — unsupported uniform float iBPS
- `TombWorldOfSiliconBeats.frag` — unsupported uniform float iPlanetFlash
- `its-a-skurr.frag` — unsupported uniform float mod1
- `MatrixClock.frag` — unsupported uniform vec2 resolution
- `KeyboardInputTest.frag` — uses iKeyboard
- `BINTANG_HITAM.frag` — uses iVideo
- `FixForBrokenSoundCloudURLs.frag` — uses iVideo
- `PsychedelicEye.frag` — uses iVideo
- `symbolism.frag` — uses iVideo
