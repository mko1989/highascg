# WO-687 — Release: server tarball + Godot clients; stop shipping the box's secrets in public releases

**Status: IN PROGRESS**

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
