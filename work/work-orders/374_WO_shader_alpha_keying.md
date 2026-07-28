# WO-374 — "alpha doesnt work on shaders": the page and the context were transparent, the SHADER never was

**Status: DONE (28.07.26 — root cause proven from the shader sources, fix live-verified by measuring the alpha plane; owner sign-off on the key threshold owed).**

Source: `work/work-orders/todos28.07.26`, owner line added 28.07:

> alpha doesnt work on shaders.

## 1. Investigation

### 1a. Everything the alpha flag was supposed to do, it already did

WO-266 designed transparency in two places and **both work**:

- `src/shaderfx/shader-template-export.js:29` — `const background = config.opts.alpha ? 'transparent' : '#000'`,
  written into the exported page's CSS.
- `template/shaders/player.js` — the first `getContext('webgl2', …)` caller fixes the context
  attributes, so the player claims `{ alpha: true, premultipliedAlpha: true, … }` *before*
  ShaderToyLite (which hardcodes `alpha:false`) can.

The flag also persists and exports correctly. Measured on the box: 5 of the library's shaders carry
`"opts":{"alpha":true}` and their exported HTML does say `background: transparent`.

### 1b. The shaders themselves are opaque — alpha could never have worked

Shadertoy shaders are written for an opaque canvas and end by writing a **fully opaque** pixel.
Every alpha-enabled shader in this library does exactly that:

```
sh-matrix   fragColor = vec4( tot, 1.0 )
sh-bubles   fragColor = vec4(col,1.0)
sh-mirrors  fragColor = vec4(col,1.0)
```

A transparent page behind a canvas whose every pixel has `a = 1.0` is invisible. Nothing in the
pipeline was broken; the missing piece was that **the shader source has to participate**, and
asking the operator to hand-edit `fragColor.a` in pasted Shadertoy code is not a workflow.

## 2. What was done

`template/shaders/player.js` — when `opts.alpha` is on, the **image pass** is wrapped before it
reaches ShaderToyLite:

1. the author's `void mainImage(` is renamed to `void mainImageAuthor(`;
2. a generated `mainImage` calls it and derives alpha:

```glsl
float key = max(c.r, max(c.g, c.b));
float a = c.a < 1.0 ? c.a : smoothstep(0.0, 0.060, key);
fragColor = vec4(c.rgb * a, a);
```

Three deliberate properties:

- **Near-black keys out.** That is what "alpha" means for an overlay on this box — the shader's
  black background disappears over the video below it.
- **An authored alpha wins.** A shader that actually writes `a < 1.0` keeps its own value; the key
  only fills in where the author wrote a fully opaque pixel.
- **Premultiplied output.** The context is claimed `premultipliedAlpha: true`, so RGB is multiplied
  by the final alpha — without this, keyed edges fringe bright.

**Fail-safes:** the wrap is skipped unless the source contains *exactly one* `void mainImage(`
(anything ambiguous behaves exactly as before), and it is gated on the Alpha flag, so unticking it
restores the old behaviour. The WO-345 hot-recompile path passes the pass key through, so a live
source edit does not silently drop the keying.

Fixed in `player.js` rather than the exporter **on purpose**: `player.js` is shared and loaded
fresh by every `sh-*.html`, so the owner's existing shaders start working on their next load — no
re-export, and nothing rewrites the box-owned shader store (see WO-368: that library is currently
single-copy).

## 3. What was VERIFIED

Rendered headless against the live server with a transparent backdrop
(`page.screenshot({ omitBackground: true })`) and **measured the alpha plane** — with a negative
control, because a probe that cannot separate good from bad proves nothing:

| shader | `opts.alpha` | fully transparent | fully opaque | mean alpha |
|--------|--------------|-------------------|--------------|------------|
| `sh-matrix`  | **true**  | **67.5 %** | 20.8 % | 65.3 |
| `sh-balatro` | false | 0.0 % | **100 %** | 255.0 |

The alpha-enabled shader is now two-thirds transparent; the alpha-disabled one is untouched at
100 % opaque. Composited over a flat blue frame, `sh-matrix` shows its green grid with the black
background gone — the "shader over video" case the owner is asking for.

- New smoke `tools/smoke/smoke-shader-alpha-and-audio-binding.test.js` (8 tests, curated FILES
  list) pins the wrap's invariants: single-declaration guard, author-alpha respected,
  premultiplied output, flag-gated, hot-recompile passes the key, and the exporter still writes a
  transparent page only for alpha shaders.
- Full suite green (see the batch commit); `player.js` is eslint-ignored (`template/**`), so it was
  syntax-checked with `node --check`.

## 4. Owner sign-off owed

- The key threshold is `smoothstep(0.0, 0.06, key)` — a soft key on near-black. If a shader is
  meant to keep dark-but-not-black areas, that number is the knob (`ALPHA_KEY_SOFT` in player.js).
- Check one alpha shader over live video on the real output.
- Shaders whose *background* is not black (e.g. a coloured field) will not key — that is inherent
  to a luma key. If one of those needs transparency, it needs authored alpha in the source, and
  this WO's wrap deliberately steps aside for it.
