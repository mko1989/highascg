# WO-467 — Release tooling: starter zips as assets, and a `--latest` switch

**Status: DONE (2026-08-10; release `2026-08-10_143258` published and verified on GitHub)**

Owner: *"create and push a fresh latest release to github"* + *"with the starter layouts zips"*.

## 1. Investigation

`tools/release/make-github-release-server.sh` published exactly one asset — the server tarball —
via `release_lib_create_prerelease`, which hardcoded `--prerelease`. Two gaps against the request:

- **The starter zips were attached by hand.** `gh release view 2026-08-07_141931` shows
  `HIGHASCGEXF-starter-layout.zip` and `HIGHASCGDAT-starter-layout.zip` on the previous release,
  but nothing in the script puts them there (WO-456 added them manually). A manual step that has
  to be remembered every time is a step that eventually is not.
- **Every release was a prerelease.** GitHub does not point `releases/latest` at a prerelease, so
  "the latest release" had to be promoted by hand too.

**Third thing, found by checking rather than assuming:** the previous tarball was **46 MiB**, and
the working tree at release time had `node_modules` at **150 MB / 220 packages** because dev
dependencies had been restored (WO-465). Releasing from that state would have shipped the dev
toolchain to every playout stick. Production-only is **17 MB / 100 packages**, and that is the
shape the ISO squashfs ships and the shape proven to run — the box booted from the 1221 ISO has
production-only `node_modules` and started fine (all 12 declared runtime deps present, `acorn`
and friends absent). So the tree was pruned before building.

## 2. What was done

- `tools/release/release-lib.sh` — `release_lib_create_prerelease` honours
  **`RELEASE_LIB_LATEST=1`**, swapping `--prerelease` for `--latest`. Default unchanged, so other
  callers still get prereleases.
- `tools/release/make-github-release-server.sh`:
  - **`--latest`** flag → sets that variable.
  - **Starter zips attached by default**, with `--no-starter-zips` to opt out. Both zips are
    **rebuilt** from the repo (`pack-exfat-starter-zip.sh`, `pack-bridge-starter-zip.sh`) rather
    than copied from `docs/guides/stick/` — that checked-in pair is documented as a snapshot that
    lags, and a release is exactly where a stale copy does damage. A missing zip after packing is
    a hard error: better no release than a release advertising an asset it does not have.
  - Release notes gained a row per zip saying **where each one is unzipped** (`HIGHASCGEXF` root,
    `HIGHASCGDAT` root) and a link to the rewritten Ventoy stick guide.
- The tree was pruned with `npm prune --omit=dev --omit=optional` before publishing and restored
  with `npm install --include=optional` afterwards.

## 3. What was VERIFIED to work

- `--dry-run --latest` first, and both pack scripts run standalone, before anything was published.
- **Published: [`2026-08-10_143258`](https://github.com/mko1989/highascg/releases/tag/2026-08-10_143258)** — read back from the API:
  `prerelease: false`, `draft: false`, `targetCommitish: main`, and three assets:

  | Asset | Size |
  |-------|------|
  | `highascg-server_2026-08-10T143258Z.tar.gz` | 13 770 023 B |
  | `HIGHASCGEXF-starter-layout.zip` | 15 183 B |
  | `HIGHASCGDAT-starter-layout.zip` | 1 865 B |

- `gh api repos/mko1989/highascg/releases/latest` returns **`2026-08-10_143258`** — GitHub's
  `latest` pointer moved, which is what the flag exists for.
- `package.json` version bump reverted and no `BUILD_STAMP` left behind (working tree checked).
- `bash -n` clean on both changed scripts.

**Tarball is 13.8 MiB, down from 46 MiB.** That is the dev-dependency prune, not lost content. If
a runtime path ever turns out to need a package declared as a devDependency it would now be
missing — the counter-evidence is that the ISO ships this same production-only set and the box
boots and serves the UI on it.

**Note for the record:** all commits were already on `origin/main` before this release
(`gh api …/commits/main` = `cab7977` = local `HEAD`). Several earlier replies in this session
claimed "N commits local, still unpushed" — that was wrong. There is no post-commit hook in
`.git/hooks`, so the push is happening through something outside the repo; worth identifying
before anyone relies on "unpushed" as a safety margin.
