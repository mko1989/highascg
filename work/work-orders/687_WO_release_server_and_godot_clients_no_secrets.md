# WO-687 — Release: server tarball + Godot clients; stop shipping the box's secrets in public releases

**Status: DONE (22.10, release `2026-10-22_214247` published from a clean checkout of 00c994cf; assets downloaded back and checked). Old releases DELETED 23.10 (owner: "just remove the releases, theyre deprecated either way"; no key rotation — owner: "nobody has any keys").**

Owner, 22.10: *"Push and make a release with server tar ball and clients for multi platform."*

## Investigation (22.10)

- Release tooling: `tools/release/make-github-release-server.sh` (`npm run release:github-server`) tars
  `archive_common_server_tar_members` (`scripts/lib/archive-common.sh:19`: index.js, package*.json, src, **config**,
  template, scripts, tools/runtime, dist-web) + node_modules **from the working tree**, plus the two starter zips.
- **The working tree on the box holds per-machine secrets in `config/`**, untracked: `device-identity.json`
  (`privateKeyPem`, the ed25519 replication signing key), `certs/highascg-key.pem` (TLS private key),
  `hardware-identity.json` (hardware id, MAC, hostname), `replication-local-identity.json`, `tailscale.json`, `nginx/`,
  plus generated `casparcg.config*`, `*.corrupt-*` and `.bak` files.
- **Earlier public releases shipped them.** `mko1989/highascg` is PUBLIC; the latest release
  (`2026-10-04_033256`, `highascg-server_2026-10-04T033256Z.tar.gz`) contains `config/device-identity.json` with
  `privateKeyPem` set, `config/certs/highascg-key.pem` and the other files above (listed with `tar -t`, key names only
  read). 74 releases exist; older ones were not checked one by one.
- **The script's existing `./` excludes never match.** Members are passed as `config`, `src`…, so tar archives
  `config/…`; a pattern `--exclude=./config/certs` does not match it (tested in the scratchpad: the dot form kept
  `config/certs/k.pem`, the plain form dropped it). So `--exclude=./node_modules` (`--zip-exclude-node-modules`),
  `./dist-web` (`RELEASE_SERVER_ONLY`) and the bulk `./media` etc. are no-ops for top-level members too; they only
  bite where the member itself is not listed. Not changed here beyond the new excludes.

## What was done (22.10)

- `scripts/lib/archive-common.sh` `archive_common_server_tar_excludes`: excludes `config/certs`, `config/nginx`,
  `device-identity.json`, `hardware-identity.json`, `replication-local-identity.json`, `tailscale.json`,
  `audio_capture.json`, `casparcg.config` (+ copy / `.bak.*` / `.tmp`) and `*.corrupt-*`, written without `./` so they
  match.
- `tools/release/make-github-release-server.sh`: after the starter zips, `godot/export-client.sh` (WO-686) exports the
  three clients; attached as `highascg-operator_<stamp>_windows-x86_64.zip` (the .exe), `_macos-universal.zip` (the
  .app zip), `_linux-x86_64.tar.gz` (keeps the exec bit); release notes get a table + first-start note.
  `--no-godot-clients` skips them.
- Pushed 00c994cf to `godot` + `main`. The release was **not** built from the box's working tree: a detached
  `git worktree` of 00c994cf in the scratchpad, `npm ci --include=optional`, `npm run build:client`, then the script
  from there (so `config/` = the committed factory files only). Worktree removed afterwards.
- `npm ci` skips three install scripts (`@serialport/bindings-cpp`, `naudiodon`, `segfault-handler`); the box's own
  `node_modules` has the same state (serialport loads its `prebuilds/linux-x64`; the other two are not built on the box
  either), so the tarball matches what runs here.

## What was VERIFIED (22.10)

- Release https://github.com/mko1989/highascg/releases/tag/2026-10-22_214247 — prerelease (as every server release
  so far), tag at 00c994cf. Assets: server tarball 48.6 MB, Windows 39.8 MB, macOS 62.4 MB, Linux 30.4 MB, both
  starter zips.
- Downloaded back from GitHub:
  - server tarball: 9214 entries, `dist-web/` + `node_modules/` + `src/` present, `BUILD_STAMP` = package.json
    version = `2026-10-22T214247Z`; no identity / cert / tailscale / nginx / corrupt / bak / generated
    `casparcg.config` under `config/`;
  - Linux client: runs headless against `http://192.168.0.23:4200` (settings ok, WS connected);
  - Windows zip: one .exe; pack has the font, logo, `core/platform.gd`, no `tests/`, no `addons/hshm`;
  - macOS zip: `HighAsCG Operator.app` with the binary and the .pck.

## Owner decisions

- **Older releases carry the box's secrets** (at least `2026-10-04_033256`: `device-identity.json` private key,
  `certs/highascg-key.pem`). The repo is public. Options: delete those releases' server tarballs, and rotate the
  device key (`config/device-identity.json`, used to sign replication handshakes) and the TLS cert. Not done: deleting
  releases and rotating keys are owner calls (rotation also needs the peer boxes to re-pair).


## Old releases deleted (2026-10-23)

Owner, 23.10: *"no, its fine. nobody has any keys. just remove the releases, theyre deprecated either way."* — no key
rotation. A partial scan before the decision (streamed `tar -t` of each asset) had found `config/device-identity.json`,
`config/certs/highascg-key.pem` and `config/tailscale.json` in every server tarball checked from 2026-09-03 to 2026-10-04.

- `gh release delete` on 71 of 76 releases (tags kept — source only, the secrets were never tracked). Kept:
  `2026-10-22_214247` + `client_2026-10-22_221506` (clean, this WO), `v.142` (CEF binary) and `v1.4.0` (scanner .deb)
  — both downloaded by `scripts/lib/install-config.sh` — and `v2.6.0` (Caspar build, no app config).
- `tools/ci/HOW_TO_UPDATE_HIGHASCG.md` pointed at the deleted `2026-08-13_151414` tarball → now `2026-10-22_214247`
  (URL checked: HTTP 200).
- Verified: `gh release list` shows exactly the 5 kept releases.
