# HighAsCG HTML Wiki

Standalone documentation browser — **not served by the playout server**.

## Open

Double-click **`index.html`**, or from the repo root:

```bash
npm run wiki:open
```

## Rebuild after editing docs

Markdown source lives under `docs/`. After changes:

```bash
npm run wiki:build
```

This regenerates `assets/wiki-bundle.js` (embedded HTML for all pages) and `manifest.json`.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Shell UI (sidebar, search, content pane) |
| `assets/wiki.css` | Styles |
| `assets/wiki.js` | Navigation + search (client-side) |
| `assets/wiki-bundle.js` | **Generated** — all page HTML |
| `manifest.json` | **Generated** — page index |

Works offline with `file://` — no Node server required.
