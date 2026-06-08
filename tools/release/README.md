# Release tooling (server repo)

| Script | Purpose |
|--------|---------|
| [`make-github-release-server.sh`](./make-github-release-server.sh) | **Server only:** `src/`, `index.js`, `config/`, `tools/runtime/`, … — tag `server_…` (**`npm run release:github-server`**) |
| [`make-dev-github-release.sh`](./make-dev-github-release.sh) | **Full:** Eggs ISO + tarball (**`npm run release:dev-github`**, deprecated monolith path) |
| [`make-dev-github-release-iso-quick.sh`](./make-dev-github-release-iso-quick.sh) | Fast ISO-only eggs produce |

**Operator UI / Electron launcher:** [https://github.com/mko1989/highascg-client](https://github.com/mko1989/highascg-client) — `release:github-client`, `release:github-launcher`, stick tools, simulation.

**Runbook:** [`docs/DEV_RELEASE_GITHUB.md`](../../docs/DEV_RELEASE_GITHUB.md)

**NPM (this repo):** `release:github-server` · `eggs:build` · `deploy:dev`

**Shared layout:** [`scripts/lib/archive-common.sh`](../../scripts/lib/archive-common.sh) — server at repo root only; no `client/` in this repository.
