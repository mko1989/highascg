# WO-379 — shader store halves diverged (the 404), and a stacked shader could never be taken off air

**Status: DONE (28.07.26 — the box's 9 broken shaders repaired live and the 404 gone; stack clear implemented. SERVER change: the stack-clear action and the automatic self-heal need a highascg restart.)**

Source: `work/work-orders/todos28.07.26`, owner lines added 28.07:

> there is no way to remove a shader from a pgm stack in shaders editor.
> sh-mirrors shader fails to load with 404

## 1. Investigation — the 404 was not one shader

A shader lives in **two** files:

| file | written by | read by |
|------|-----------|---------|
| `data/shaders/<id>.json` | `saveShader` | the shader **library** (`listShaders`, the modal, `/api/shaders`) |
| `template/shaders/<id>.html` | `saveShader` (via the exporter) | **Caspar** — the template catalog and every play path |

`saveShader` writes both and `deleteShader` unlinks both, so the pair only diverges when something
touches ONE side — a git checkout, a Syncthing revert, a half-finished copy. Both directions then
fail silently, and differently:

- **JSON without HTML** → the shader IS in the library; playing or previewing it 404s.
- **HTML without JSON** → Caspar's catalog lists it; `/api/shaders/<id>` 404s. ← the owner's report

Measured on the box, 28.07:

```
data/shaders JSON : 16        template HTML : 11

HTML without JSON (catalog lists it, /api/shaders 404s):
    sh-console, sh-mirrors
JSON without HTML (library lists it, play/preview 404s):
    sh-3d-meters, sh-3d-meters-c2, sh-3d-meters-c3, sh-3d-meters-c4,
    sh-audio, sh-ksbhdgdgb, sh-ksjb
```

`GET /api/shaders/sh-mirrors` → **404**, while `GET /templates/shaders/sh-mirrors.html` → **200**.
Nine broken shaders, and the owner had only noticed the two that fail in the direction the UI
shows. This is [WO-368](./368_WO_shader_store_git_ownership.md)'s ownership mess producing
casualties — the shader store is tracked by git, ignored by Syncthing, and edited live.

## 2. Investigation — the PGM stack was append-only

`routes-shader-stack.js` accepted exactly one action: land `value` on a layer. An occupied layer
could be **exchanged**, never emptied, and `shader-live-stack.js` rendered rows with no remove
affordance at all — clicking a row always meant "land the PRV shader here". So a stacked shader
could only be removed by clearing the whole look.

## 3. What was done

### 3a. `reconcileShaderStore()` — repair, never delete

New in `src/shaderfx/shader-store.js`, called from `listShaders()` (the read where a divergence
becomes visible), best-effort so it can never fail the list:

- **missing HTML** → re-export from the JSON. The exporter is pure and deterministic.
- **missing JSON** → recover from the config the exporter **embeds** in the HTML
  (`window.__SHADERFX_CONFIG__`), un-escaping the `<\/` guard, normalise, write.

**Nothing is ever deleted.** With the library single-copy (WO-368), rebuilding the missing half is
the only safe direction; an unparseable orphan is left alone, because a 404 beats a fabricated
config.

### 3b. Stack clear

`POST /api/shader-stack { mainIndex, layerNumber, clear: true, transition? }`:
fade the layer's opacity to 0 over the transition, **wait for the fade**, then `CLEAR` — clearing
immediately would throw away the transition the operator asked for (the WO-175 fade-then-clear
shape) — and drop the layer from the live scene so the row reads empty everywhere. `value` is
still required for a landing; the 10–20 band check applies to both actions.

Client: a `✕` on **occupied** rows only, faint until the row is hovered (WO-353's "all trashcans →
✕", and the stack is meant to stay quiet). It sits inside the row button, so the handler tests it
FIRST and stops propagation — otherwise clearing a layer would also land a shader on it.

## 4. What was VERIFIED

- **The owner's 404 is gone, and so are the eight others.** After reconciliation on the live box:
  `sh-mirrors`, `sh-console`, `sh-audio`, `sh-3d-meters` all return **200 on both halves**
  (`/api/shaders/<id>` and `/templates/shaders/<id>.html`); the library went **16 → 18** shaders.
  7 templates re-exported, 2 configs recovered.
- **Reconciliation is idempotent** — a second run on the healed store returns
  `{exported: [], recovered: []}`.
- **The recovery round-trip is exact**, including the `</script>` escape: a shader source
  containing `// </script> trap` is escaped in the export and comes back verbatim.
- New smoke `tools/smoke/smoke-wo379-shader-store-and-stack-clear.test.js` (7 tests, curated FILES
  list): the round trip, idempotence, the unparseable-orphan refusal, the heal-before-list wiring,
  the clear action's fade-then-clear order and scene removal, and the UI rules (✕ only on occupied
  rows, clear tested before land, hover-quiet CSS).
- **Full suite: 1652 tests, 1650 pass / 0 fail / 2 skip.** Lint 0, prettier clean, unwired-export
  gate clean, 500-line gate clean, `npm run build:client` OK.

## 5. Process note — a gate I broke and had to fix

While formatting the WO-378 batch I ran `prettier --write` over `src/` files. **`format:check` is
scoped to `tools/ci` only** — `src/` has never been prettier-formatted — so that reformatted
`src/config/routing-map.js` wholesale: +97/−47 lines of noise which pushed it **499 → 549** lines
and broke the CI 500-line gate. I missed it because I read the gate's output through `tail -1`.

Fixed by restoring the file and re-applying only the functional change (now 2 hunks, 490 lines).
The other `src/` files touched by that command were audited individually — their diffs are
proportionate to their functional changes, no mass reformatting. **Do not run `prettier --write`
on `src/` in this repo**; it is deliberately outside the format scope.

## 6. Owner QA owed

- **Restart highascg** for the stack-clear action and the automatic self-heal (the nine shaders are
  already repaired on disk — that ran out-of-process).
- In Shader Live: an occupied PGM stack row now shows a ✕ on hover; clicking it should fade that
  shader out and leave the row empty, without disturbing the rest of the look.
- The underlying cause of the divergence is still [WO-368](./368_WO_shader_store_git_ownership.md)
  §2 (A/B/C) — this WO stops the bleeding; it does not decide who owns the shader files.
