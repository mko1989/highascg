# CG Studio (Template Editor)

Lower-thirds template editor. Runs on the **operator machine** (optional Electron launcher or local dev), **not** on the playout server.

Source lives in **this repo**: `src/cg-studio/`.

## Architecture

| Process | Port | Where |
|---------|------|--------|
| HighAsCG playout (API + operator UI) | 4200 | Playout server — `client/` → `dist-web/` |
| CG Studio | 4300 | Operator machine (Electron module) |

The optional Electron launcher ([highascg-client](https://github.com/mko1989/highascg-client)) — packaged from `client/tools/electron-launcher/` — starts `studio-server.js` locally. Templates are read from and exported to `template/` in **this** checkout.

**Do not confuse with the operator UI:** dashboard, scenes, and device view live in **`client/`** in this repo and run on playout `:4200`.

## Run from this repo (dev)

```bash
npm run cg-studio
```

Open `http://127.0.0.1:4300/`. Optional: `HIGHASCG_CG_STUDIO_PORT=4301`.

## Run from Electron launcher

1. Build/install [**highascg-client**](https://github.com/mko1989/highascg-client) (packaging extract from this repo).
2. Modules tab → enable **CG Overlay Studio**.
3. `npm run launcher:prepare` (syncs `src/cg-studio/` from this repo into the launcher bundle).
4. Click **CG Studio** in the launcher.

Set `HIGHASCG_SERVER_ROOT` to this repo path if the launcher cannot find templates.

## Export

Exports write `template/studio/lt-<name>.html` (Caspar path `studio/lt-<name>`). The playout server picks them up on the next lower-thirds scan.

## Electron launcher toggle

When **CG Overlay Studio** is enabled in the Modules tab, the launcher starts the studio server on `:4300` in the background. Disabling the module stops the server and closes any CG Studio window. Click **CG Studio** to open the editor.
