# Release tooling (unified repo)

| Script | Purpose |
|--------|---------|
| [`make-github-release-server.sh`](./make-github-release-server.sh) | Server + **`dist-web/`**: `src/`, `index.js`, `config/`, `tools/runtime/`, … — tag `server_…` (**`npm run release:github-server`**) |
| [`make-dev-github-release.sh`](./make-dev-github-release.sh) | **Full:** Eggs ISO + tarball (**`npm run release:dev-github`**, deprecated monolith path) |
| [`make-dev-github-release-iso-quick.sh`](./make-dev-github-release-iso-quick.sh) | Fast ISO-only eggs produce |

**Operator UI:** built from in-repo **`client/`** → **`dist-web/`** (`npm run build:client`).  
**Optional Electron packaging:** [highascg-client](https://github.com/mko1989/highascg-client) — simulator, multiserver, modules from `client/tools/electron-launcher/`; opens browser to playout `:4200`.

**Runbook:** [`docs/DEV_RELEASE_GITHUB.md`](../../docs/DEV_RELEASE_GITHUB.md)

**NPM (this repo):** `build:client` · `release:github-server` · `eggs:build` · `deploy:dev`

**Shared layout:** [`scripts/lib/archive-common.sh`](../../scripts/lib/archive-common.sh) — unified repo; ship **`dist-web/`**, not raw **`client/`** sources, on playout.
