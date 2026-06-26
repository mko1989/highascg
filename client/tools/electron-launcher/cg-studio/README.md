# CG Studio (Template Editor)

Lower-thirds template editor. Runs on the **operator machine** (Electron launcher or local dev), **not** on the playout server.

Source lives in this repo: `/Users/marcin/highascg/src/cg-studio/`.

## Architecture

| Process | Port | Where |
|---------|------|--------|
| HighAsCG playout | 4200 | Playout server |
| CG Studio | 4300 | Operator machine (launcher-hosted) |

The Electron launcher starts `studio-server.js` locally and opens it in a **separate window/tab**. Templates are read from and exported to `template/` in **this** checkout.

## Run from this repo (dev)

```bash
cd /Users/marcin/highascg
npm run cg-studio
```

Open `http://127.0.0.1:4300/`. Optional: `HIGHASCG_CG_STUDIO_PORT=4301`.

## Run from Electron launcher

1. Clone [**highascg-client**](https://github.com/mko1989/highascg-client) on the operator machine.
2. Modules tab → enable **CG Overlay Studio**.
3. `npm run launcher:prepare` (syncs `src/cg-studio/` from this repo into the launcher bundle).
4. Click **CG Studio** in the launcher.

Set `HIGHASCG_SERVER_ROOT=/Users/marcin/highascg` if the launcher cannot find templates.

## Export

Exports write `template/studio/lt-<name>.html` (Caspar path `studio/lt-<name>`). The playout server picks them up on the next lower-thirds scan.

## Electron launcher toggle

When **CG Overlay Studio** is enabled in the Modules tab, the launcher starts the studio server on `:4300` in the background. Disabling the module stops the server and closes any CG Studio window. Click **CG Studio** to open the editor.
