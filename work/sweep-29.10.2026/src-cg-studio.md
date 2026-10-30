# src/cg-studio — sweep 29.10.2026 (batch 073)

Files: 13 · lines: 1773 · findings: 0 BUG-HIGH, 1 BUG, 0 DEAD, 2 RISK, 7 QUALITY

How checked: `bakeDefaults` was run on the real `template/lower-thirds/lt-classic-box.html`; usage of every export was grepped over `src client godot tools scripts index.js`; every `studio.css` class/id was matched against `app.js` / `index.html`.

## src/cg-studio/cg-studio-context.js
- `OK`

## src/cg-studio/export-template.js
- `BUG` src/cg-studio/export-template.js:75,81-84 (also :44,:46,:65) — user text is spliced into `String.prototype.replace` as part of the REPLACEMENT string (`` `$1${escaped}$3` ``), so `$1`, `$&`, `` $` ``, `$'` in a title or subtitle are expanded as replacement patterns. Failing case (ran `bakeDefaults(raw,{data:{title:'Only $1 today'}})` on lt-classic-box): exported HTML contains `<h1>Only <h1> today</h1>` — the text `$1` became the captured `<h1>` tag. Any price or "$10" in a baked lower third is corrupted (`$10` → group 10 absent → `$1` + `0`). Fix: use a replacer function (`(m, a, b, c) => a + escaped + c`), also for the `:root` / `</style>` / `</head>` replaces where a style value can contain `$`.
- `RISK` src/cg-studio/export-template.js:34-48 — `style.primaryColor` / `textColor` / `gradientMid` / `gradientEnd` / `panelColor` are written unescaped into a `:root{…}` block inside the exported template. A value like `red}</style><script>…` (only `</` is neutralised, and only for the `__LT_INITIAL_STYLE__` seed at :63) yields a script in a file that is later served from `/studio-assets/` and loaded by the studio iframe (`sandbox="allow-scripts allow-same-origin"`, index.html:89) and by Caspar's CEF. Authenticated operator only, but the export route accepts arbitrary JSON. Fix: validate colours (`/^#[0-9a-f]{3,8}$|^[a-z]+$|^rgba?\(…\)$/i`) before writing.
- `QUALITY` src/cg-studio/export-template.js:41-47 — when the base template has neither `:root` nor `</style>` the colour overrides are dropped silently, and `validateExportedHtml` (:98-111) only guards non-colour style, so such an export "succeeds" with the wrong colours.
- `QUALITY` src/cg-studio/export-template.js:136-143 — `exportName` is returned in the result but never persisted; the gallery shows `humanizeId(id)` (template-scan.js:43), so the display-name field in the export dialog (index.html:108-111) has no effect.

## src/cg-studio/http-utils.js
- `OK`

## src/cg-studio/lt-param-registry.js
- `OK` (field lists are pinned to `lt-engine.js` by `smoke-lt-engine-registry-sync`; the colour default `lightblue` is a non-hex value, see app.js:129-130).

## src/cg-studio/public/app.js
- `QUALITY` src/cg-studio/public/app.js:127-130 — the colour input only accepts `#rrggbb`; the default `primaryColor` is `'lightblue'` (lt-param-registry.js:13), so the swatch is shown as `#ffffff` while the preview and an export use lightblue until the operator touches the control. Fix: map named colours to hex (e.g. via a canvas `fillStyle` round trip) when filling the input.
- `RISK` src/cg-studio/public/app.js:200-220 `selectTemplate` — no stale-response guard. Click template A then B quickly: `current` is set to B synchronously, but if A's `fetch` resolves last it overwrites `payload`, the inspector and `preview.src` with A's. Export then posts `baseTemplateId: current.id` (B) with A's `payload` (lines 291-297). A 404 (template deleted since the list) throws on `detail.defaults.data` (:210) as an unhandled rejection. Fix: capture a token (`const my = ++seq`) and return if it changed after each `await`; check `res.ok`.
- `OK` otherwise (innerHTML only gets `escapeHtml`'d names; wheel/drag handlers are guarded).

## src/cg-studio/public/index.html
- `QUALITY` src/cg-studio/public/index.html:106 — `pattern="lt-[a-z0-9-]+"` is looser than the server's `EXPORT_ID_RE` (`^lt-[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`, export-template.js:13): ids ending in `-` or longer than 64 chars pass the browser and come back as "exportId must match lt-[a-z0-9-]+" from the server. The prefilled `current.id + '-custom'` (app.js:273) exceeds 64 chars for a long template id.

## src/cg-studio/public/placement-math.js
- `OK`

## src/cg-studio/public/studio.css
- `OK` (every class/id is referenced from app.js or index.html — checked by script; the only "unreferenced" tokens were hex colours).

## src/cg-studio/register.js
- `OK` (the duplicated repo-root walk is deliberate per its header comment).

## src/cg-studio/routes.js
- `QUALITY` src/cg-studio/routes.js:1-3 — header says "runs on Electron launcher, not playout server"; since WO-265 the same `handleStudioApi` is mounted on the playout server by register.js, and the launcher host was deleted (:156). `handleStudioRequest` / `serveStatic` / `resolveStudioPort` now serve only `scripts/cg-studio-run.js` (`npm run cg-studio`) and `smoke-cg-studio`, while the playout path uses `staticMounts`.
- `OK` otherwise (`serveStatic` rejects `..` and re-checks the resolved root).

## src/cg-studio/studio-lt-defaults.js
- `QUALITY` src/cg-studio/studio-lt-defaults.js:17 — `STUDIO_DIR` is rebuilt from `__dirname` instead of `cg-studio-context.getStudioDir()`; two sources of truth for where exports live (the context is configured by register.js from `findRepoRoot`). It also only reads the FIRST `:root` block, matching export-template.js:44.

## src/cg-studio/studio-server.js
- `OK`

## src/cg-studio/template-scan.js
- `QUALITY` src/cg-studio/template-scan.js:96-108 `getTemplateDetail` — `resolveTemplateFile` strips a `.html` suffix but the metadata lookup (`t.id === id`) and `getDefaultPayload(id)` / `getFieldsForTemplate(id)` use the raw id; `GET /api/templates/lt-gradient-wave.html` returns detail without `name`/`previewUrl` and without the gradient extras. Normalise `id` once at the top. The inline `require('./lt-param-registry')` at :106 duplicates the import at :10.
