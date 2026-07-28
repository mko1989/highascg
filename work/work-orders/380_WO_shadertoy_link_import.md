# WO-380 — paste a Shadertoy share link, get the code layers

**Status: IMPLEMENTED 28.07.26 — everything either side of the network call is built and proven; the fetch itself needs a free Shadertoy API key, because Cloudflare refuses every unauthenticated route (measured). §4.**

Source: `work/work-orders/todos28.07.26`, owner, 28.07:

> i noticed there is a share link on shader toy. it should be easy to be able to paste that link and
> it will fill in all the code layers.
> example link
> https://www.shadertoy.com/view/lldcR8

## 1. Investigation — how the shader can actually be fetched

Every route was tried from this box, 28.07:

| route | result |
|---|---|
| `GET https://www.shadertoy.com/view/lldcR8` (plain server request) | **HTTP 403** |
| `GET /api/v1/shaders/lldcR8` with no key | Cloudflare `"Just a moment…"` interstitial |
| `POST /shadertoy` with `s={"shaders":["lldcR8"]}` (the endpoint the site itself uses) | Cloudflare interstitial |
| the **same page in headless Chrome** (our thumbnail renderer) | `document.title === "Just a moment…"`, `window.gShaderToy` undefined after 8 s |

So scraping is out — not because of a missing trick, but because Cloudflare deliberately blocks
non-browser and automated clients, and headless Chrome is detected. Fetching from the operator's
own browser fails too: shadertoy.com sends no CORS headers, so the GUI cannot read the response.

**The one sanctioned route is the public API with a free app key**
(`shadertoy.com/howto#q2` → `GET /api/v1/shaders/<id>?key=<KEY>`). That is a one-time owner action
and it is the route this WO builds.

## 2. What was built

`src/shaderfx/shadertoy-import.js`, split so the untestable part is as small as possible:

- **`shadertoyIdFromInput()`** — accepts a `/view/` link, an `/embed/` link (query string and all),
  or a bare id.
- **`shadertoyConfigFromApiJson()`** — maps their `renderpass[]` onto our config. The load-bearing
  detail: Shadertoy wires channels by the **output id** of a buffer, not by its name (which is free
  text), so buffers are matched by `outputs[0].id` and `inputs[].id`. `common` → our common;
  `image` → image; buffers → `bufferA..D` in appearance order; `music`/`mic` → **`audio`**;
  `webcam` → **`camera`** (WO-376). `audio.enabled` is set only when a channel actually asked for
  it — the WO-375 rule that the flag must mean something.
- **`fetchShadertoyShader()`** — the thin network edge. `fetchImpl` is injectable so the failure
  paths are testable without touching the network.

**Nothing we cannot represent is silently dropped**: texture/cubemap/volume/keyboard channels and
`sound` passes are listed in `skipped[]` and surfaced to the operator, with the channel left
unbound rather than mis-wired.

`POST /api/shaders/import { url }` returns **the config only — it does not save**. The modal fills
the form (name, common, all pass sources, channels, flags) and the operator presses save
themselves, so a paste can never silently overwrite the shader they had open; `currentId` is
cleared, making an import always a NEW shader. In the modal: an Import field with the example link
as its placeholder, a Fetch button, and Enter in the field (a pasted link is usually followed by
Enter).

The key is read from `config.shadertoyApiKey` or `SHADERTOY_API_KEY`; with none configured the
error says exactly what to do rather than failing obscurely.

## 3. What was VERIFIED

- **The mapping, against Shadertoy's documented response shape** (image + buffer + common + a music
  channel + a webcam channel + a texture channel + a sound pass): code layers land in the right
  places, `image.iChannel0` resolves to `A` **by output id**, `music → audio`, `webcam → camera`,
  the texture channel and the sound pass are reported in `skipped[]` with the channel left `null`,
  and the result normalises cleanly through `normalizeShaderConfig`.
- **`audio.enabled` is false** when nothing asks for audio.
- **Refusals are clean**: no `renderpass` → "no renderpass"; no image pass → "no image pass"
  (rather than half-importing); no key → an error naming `shadertoy.com/howto#q2`; HTTP 403 and
  Shadertoy's own `{Error: …}` are both surfaced verbatim.
- **The key only ever appears in the API query string** — asserted, so a future refactor cannot
  start logging it.
- New smoke `tools/smoke/smoke-wo380-shadertoy-import.test.js` (11 tests, curated FILES list).
  One test input had to be corrected: `'nonsense'` is a *plausible* Shadertoy id (6+ alphanumerics)
  so it reached the network — the rejection case now uses input that cannot be an id, and the suite
  never touches the internet.
- **Full suite: 1670 tests, 1668 pass / 0 fail / 2 skip.** Lint 0, 500-line gate 0, unwired-export
  gate clean, `npm run build:client` OK.

## 4. What is owed

- **A Shadertoy API key** (free, one minute: shadertoy.com/howto#q2 → paste into
  `config.shadertoyApiKey`, or export `SHADERTOY_API_KEY`). Until then the endpoint answers with the
  instruction, and **the fetch itself is unverified** — I could not confirm that Cloudflare lets the
  keyed `api/v1` path through, only that it blocks every unkeyed route. If it turns out the API is
  gated too, the fallback is unchanged from today: paste the code into the existing per-pass boxes.
- **A highascg restart** for the new endpoint.
- Not built: a Settings field for the key (it is read from config/env). Worth adding next to the
  other integration keys once the route is confirmed working.
