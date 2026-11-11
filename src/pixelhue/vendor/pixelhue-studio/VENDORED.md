# pixelhue-studio (vendored)

A pinned, unmodified copy of the owner's PixelHue Studio (github.com/mko1989/pixelhue-studio): `server.js`, `lib/`,
`public/` (without `public/fonts`), `package.json` (ES modules), `README.md`. The commit is in `VENDORED_COMMIT`.

HighAsCG runs its server in-process on a loopback port (src/pixelhue/studio-bridge.js) and serves its API under
`/api/pixelhue/studio/*`; the Godot client's PixelHue tab is a native UI over that API (WO-1039).

Do not edit files here. To update: `tools/dev/vendor-pixelhue-studio.sh <path to a pixelhue-studio checkout>`.
