# WO-587 — slow, uncluttered background shaders (29 `sh-bg-*`)

**Status: IMPLEMENTED 30.09.26. 29 backgrounds imported through `POST /api/shaders` (library 161 → 190), each measured slow and calm at t≈2.5 s, +60 s and +300 s and picked by eye from contact sheets. Not yet seen on air (§4). 27/29 are CC BY-NC-SA, so the licence call is the owner's, as in WO-586 §5.**

Owner, 30.09: *"now id like you to find slow moving and not too crowded shaders for use as backgrounds. no need for audio reactivity here."*

## 1. Investigation

- **Source.** `Vipitis/shadertoys-dataset` (GitHub, `data/annotated/*.jsonl`) holds the full Shadertoy public-API "20k" set: 19,622 shaders with name, author, tags, likes, **detected licence** and a compile-test result. The Shadertoy API itself still has no key (WO-380).
- **Permissive-only attempt first.** The goal was to avoid WO-586's non-commercial problem. Filtering to single-pass shaders with no channels, a passing compile test and an MIT/CC0/CC-BY/BSD/Apache/… licence left **450**. All were rendered. The calm and slow ones turned out to be almost entirely Inigo Quilez-style maths and SDF **tutorial demos** (domain colouring, bezier diagrams, test cubes): only 2 are real backgrounds (`anya-s-rose`, CC0, and `perlin-noise-fire`, MIT). Permissive licences on Shadertoy are overwhelmingly teaching code.
- **Broadened.** Across the full set, kept single-pass shaders with no channels and ≥15 likes carrying at least one background-ish tag (clouds, sky, aurora, fog, water, plasma, stars, gradient…) and none of tutorial/test/sdf/game/text/audio/interactive/glitch/strobe/fractal. That gave **309**, 90 % of them NC.

## 2. What was done

`tools/shaders/validate-shader-configs.js` (from WO-586) gained three measurements. All come from two 320×180 frames `GAP_MS` apart, rendered through the real exported template:

- **`motion`**: mean |Δ| per channel (0–255) over the gap. This is "how fast it moves".
- **`detail`**: mean luminance gradient. This is "how crowded it is".
- **`fps`**: rAF ticks per second on SwiftShader. It sits at the 60 cap for light shaders and only flags heavy ones.

Selection:

- **Metrics:** motion < 9 (tier 2: < 16) over **2 s**, detail < 7 (tier 2: < 11), mean luminance 12–215, some contrast, fps ≥ 25. Medians across the pool were motion 29 and detail 9.5.
- **By eye:** contact sheets of every survivor. Objects, diagrams, loaders, single props and checkerboard floors were rejected.
- **Over time:** every pick was re-rendered with `iTime` shifted **+60 s and +300 s** (table below) and viewed again at +60 s, so a shader that turns busy or fast later would show up. None did. `k-moon` and `fly-by-night` change composition (moon phase, orbit) but stay calm.

Each shader's image pass starts with a header giving name, author, Shadertoy URL and licence. Ids are `sh-bg-<slug>`, so the library (sorted by id) groups them. `audio.enabled` is false.

## 3. What was VERIFIED

- Rendered **759** candidates in total (450 permissive + 309 tagged), with 0 compile errors in the tagged set.
- Final set: 29/29 clean on the exact configs imported. The import returned 29/29 `ok`, and `GET /api/shaders` lists 190, of which 29 are `sh-bg-*`, none with the audio flag.
- All 29 `template/shaders/sh-bg-*.html` are byte-identical to the validated pages.
- The validator changes are lint-clean.
- **NOT verified:**
  - Look on the real output (scale, banding at 1080p/4K).
  - GPU cost on the RTX. SwiftShader fps only proves none are heavy by that crude measure. `starfield-dots-ii` (28 fps) and `sunset-cloud` (43) were the slowest.

## 4. Owner QA

- [ ] Audition on PRV, keep the ones you like, and delete the rest (deleting removes both files).

## Appendix — the 29 (motion at 2.5 s / +60 s / +300 s; detail at 2.5 s)

| id | name | author | licence | motion | detail | source |
|---|---|---|---|---|---|---|
| `sh-bg-simple-parallax-snow` | Simple parallax snow | fenwick67 | CC-BY-NC-SA-3.0 | 1.95 / 2.2 / 2.32 | 2.27 | https://www.shadertoy.com/view/MdXcW8 |
| `sh-bg-cloudy-sunset` | cloudy sunset | miloszmaki | CC-BY-NC-SA-3.0 | 3.32 / 3.33 / 3.21 | 1.97 | https://www.shadertoy.com/view/XlsXDB |
| `sh-bg-perlin-water-noise` | Perlin Water Noise | jackdavenport | CC-BY-NC-SA-3.0 | 4.29 / 4.68 / 3.93 | 1.49 | https://www.shadertoy.com/view/Mt2SzR |
| `sh-bg-21-august-2017` | 21 August 2017 | rigel | CC-BY-NC-SA-3.0 | 2.89 / 2.94 / 2.55 | 2.93 | https://www.shadertoy.com/view/ls2fzK |
| `sh-bg-starfield02` | StarField02 | xaot88 | cc-by-nc-sa-3.0 | 2.31 / 2.31 / 2.31 | 3.81 | https://www.shadertoy.com/view/MdSXRd |
| `sh-bg-worley-algorithm-cell-noise` | Worley Algorithm (Cell Noise ) | Yeis | CC-BY-NC-SA-3.0 | 5.53 / 5.06 / 7.99 | 1.21 | https://www.shadertoy.com/view/Xl33Wn |
| `sh-bg-traveling-through-mist` | Traveling Through Mist | Emil | CC-BY-NC-SA-3.0 | 5.78 / 5.78 / 5.31 | 1.41 | https://www.shadertoy.com/view/MtcyWr |
| `sh-bg-redsmoke` | RedSmoke | Makio64 | CC-BY-NC-SA-3.0 | 6.77 / 8.7 / 9.31 | 0.46 | https://www.shadertoy.com/view/llsSzB |
| `sh-bg-fbm-multiple-octave-noise` | fbm multiple octave noise | hellochar | CC-BY-NC-SA-3.0 | 4.47 / 4.66 / 3.6 | 3.59 | https://www.shadertoy.com/view/ltdBzr |
| `sh-bg-sunset-cloud` | Sunset Cloud | kuvkar | CC-BY-NC-SA-3.0 | 5.56 / 5.71 / 5.59 | 2.71 | https://www.shadertoy.com/view/llj3RD |
| `sh-bg-wavy-background-effect` | Wavy Background Effect | gigaherz | CC-BY-NC-SA-3.0 | 5.23 / 6.54 / 6.07 | 3.14 | https://www.shadertoy.com/view/ltGSWD |
| `sh-bg-slowstars-2-197-chars` | Slowstars 2  ( 197 chars ) | FabriceNeyret2 | CC-BY-NC-SA-3.0 | 6.25 / 6.11 / 5.97 | 2.19 | https://www.shadertoy.com/view/XsVSWG |
| `sh-bg-auroras` | Auroras | nimitz | cc-by-nc-sa-3.0 | 6.39 / 4.17 / 4.14 | 2.43 | https://www.shadertoy.com/view/XtGGRt |
| `sh-bg-worley-noise-waters` | Worley Noise Waters | Kyle273 | CC-BY-NC-SA-3.0 | 7.25 / 5.26 / 7.58 | 1.8 | https://www.shadertoy.com/view/llS3RK |
| `sh-bg-night-sky-01` | Night Sky 01 | xaot88 | cc-by-nc-sa-3.0 | 6.35 / 6.5 / 6.72 | 3.28 | https://www.shadertoy.com/view/XsSXz3 |
| `sh-bg-light-circles` | Light Circles | Deefunct | CC-BY-NC-SA-3.0 | 6.11 / 0.72 / 4.84 | 4.63 | https://www.shadertoy.com/view/MlyGzW |
| `sh-bg-simple-2d-clouds` | simple 2D clouds | zxxuan1001 | CC-BY-NC-SA-3.0 | 10.23 / 7.13 / 7.65 | 1.75 | https://www.shadertoy.com/view/tlB3zK |
| `sh-bg-starfield-dots-ii` | Starfield DOTs II | patu | CC-BY-NC-SA-3.0 | 11.07 / 12.87 / 9.11 | 4.24 | https://www.shadertoy.com/view/XtjcW3 |
| `sh-bg-star-field-4-433-chars` | star field 4 (433 chars) | FabriceNeyret2 | CC-BY-NC-SA-3.0 | 7.86 / 8.16 / 8.18 | 7.9 | https://www.shadertoy.com/view/ltBXDd |
| `sh-bg-2d-simplex-clouds` | 2D Simplex Clouds | voax | CC-BY-NC-SA-3.0 | 14.6 / 17.58 / 7.23 | 1.72 | https://www.shadertoy.com/view/XtfSW4 |
| `sh-bg-foamy-water` | Foamy water | k_mouse | CC-BY-NC-SA-3.0 | 12.76 / 12.73 / 10.29 | 4.49 | https://www.shadertoy.com/view/llcXW7 |
| `sh-bg-electric-sinusoid` | Electric Sinusoid | ddoodm | CC-BY-NC-SA-3.0 | 13.19 / 16.26 / 20.82 | 4.07 | https://www.shadertoy.com/view/XdXXzr |
| `sh-bg-k-moon` | K-moon | Kali | CC-BY-NC-SA-3.0 | 10.04 / 16.87 / 10.35 | 8.02 | https://www.shadertoy.com/view/4tXGzj |
| `sh-bg-sunlight-through-water` | Sunlight through Water | bbcollinsworth | CC-BY-NC-SA-3.0 | 10.85 / 11.27 / 11.87 | 7.74 | https://www.shadertoy.com/view/ld2yWy |
| `sh-bg-fly-by-night` | Fly by Night | mhnewman | CC-BY-NC-SA-3.0 | 15.51 / 20.44 / 16.38 | 5.77 | https://www.shadertoy.com/view/XlXGD7 |
| `sh-bg-paint-archipelago` | Paint Archipelago | samlo | CC-BY-NC-SA-3.0 | 12.54 / 12.47 / 10.52 | 10.14 | https://www.shadertoy.com/view/3lf3z2 |
| `sh-bg-synth-waves` | Synth waves | avin | CC-BY-NC-SA-3.0 | 12.49 / 12.27 / 11.47 | 10.74 | https://www.shadertoy.com/view/Wts3DB |
| `sh-bg-anya-s-rose` | Anya's Rose | lmno | cc0-1.0 | 1.67 / 1.7 / 3.52 | 2.35 | https://www.shadertoy.com/view/3lyBW1 |
| `sh-bg-perlin-noise-fire` | Perlin noise fire | BenWheatley | mit | 6.83 / 5.67 / 9.04 | 1.22 | https://www.shadertoy.com/view/MsdyDN |

`CC-BY-NC-SA-3.0` in upper case means no licence header, so Shadertoy's site default applies. Lower case means the author stated it.
