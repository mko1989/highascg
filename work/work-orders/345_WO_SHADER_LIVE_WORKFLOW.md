# WO-345 — live shader workflow: shades-bunny toggles a live-shader editor with param rides

**Source:** owner 2026-07-27 — "a new workflow for working with shaders live. activated by clicking
the logo with glasses, that should change the looks list/editor into shaders editor that always
shows parameters for the live shader ... each shader should have it's many different parameters
available as sliders, color pickers etc."

**Status: OPEN → implementing now.**

## Design

1. **Trigger:** clicking the header mascot WHILE it is the shades bunny (i.e. cefEnableGpu on —
   the same condition that swaps the logo) toggles Shader Live mode: a full-workspace overlay
   replaces the looks list/editor visually; clicking again (or ✕) restores it.
2. **Live shader discovery:** from `stateStore` `scene.live` — every live scene layer whose
   `source.value` matches `shaders/` across all channels (PGM banks via
   `scene.programLayerBankByChannel`, PRV bank-less). The panel lists them
   (shader · ch · layer), auto-selecting the PGM one; the list follows `scene.live` broadcasts so
   it "always shows the live shader".
3. **Parameters:** WO-340's `scanShaderParams` over the shader's library source
   (`GET /api/shaders/<id>`), rendered as color pickers / sliders (same classification and
   span-rewrite as the modal panel).
4. **LIVE application (the new mechanism — WO-340 v2-lite):** rewriting + re-saving would restart
   the CG producer. Instead `template/shaders/player.js` `window.update()` learns
   `{ common?, passes?: { <key>: { source } } }`: it patches the baked config and calls the
   ShaderToyLite pass setters again — an in-place RECOMPILE on the running producer (same canvas,
   same audio texture, iTime continues; no PLAY/ADD, no black frame). The editor sends the
   rewritten source via `CG <ch>-<layer> UPDATE 0 "<json>"` (`POST /api/raw`) to every live
   instance of that shader on slider release / picker close.
5. **Persistence:** live tweaks are ephemeral until the panel's **Save** button POSTs the
   rewritten source to `/api/shaders` (library + re-export, existing path). The panel shows a
   dirty marker while live state differs from the library.
6. **Caveat (accepted):** producers loaded BEFORE this deploys run the old update() contract and
   ignore source payloads — re-take the look once after deploy.

## Files
`template/shaders/player.js` (update contract), `client/components/shader-live-editor.js` (new:
overlay, discovery, params, CG UPDATE, Save), logo hook in header-bar.js, `client/app.js` init,
CSS. Reuses `client/lib/shader-param-scan.js` untouched.

## Acceptance
- Shades-bunny click toggles the editor; normal-logo click does nothing.
- With a shader look on PGM: its parameters appear automatically; moving a slider / picking a
  color changes the ON-AIR shader within ~100 ms with NO producer restart (audio reactivity and
  clock uninterrupted); Save persists to the library.
- Multiple live shaders: selectable list, params follow the selection; PRV instances included.
- Exiting restores the looks workspace untouched.
