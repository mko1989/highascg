# WO-424 — GUI update-from-GitHub for installed boxes: the shipped flow was dead end-to-end; un-bricked and live-verified

**Status: DONE (2026-08-04 — `/api/system/update/check` LIVE-VERIFIED on this box: finds the 2026-06-28 release, `updateAvailable:true` against the 2026.05.20 stamp. Publishing a new release = one owner command, dry-run verified.)**

Owner 04.08: "i need an update system built in. so users can easily update highascg from the
gui when a new version is available on github. this is for installed systems ofcourse."

## Investigation — it was already built (WO-188), and could never work

Everything shipped 14.07: Settings → System Updates tab
(`settings-modal-system-updates.js`), `GET /api/system/update/check`,
password-gated apply with progress polling, sudo-restricted apply helper
(`highascg-webui-server-update.sh` — installed and NOPASSWD-listed on this box, verified),
and a publisher (`npm run release:github-server`). Two defects made the whole chain
permanently answer "up to date":

1. **The checker read `/releases/latest`, the publisher creates PRERELEASES.** GitHub's
   `releases/latest` endpoint only returns the newest full release — the May ISO release —
   so server drops (June 08, June 28) were structurally invisible. Forever.
2. **The stamp comparator sorted the fleet's mixed formats backwards.** Installed boxes carry
   `2026.05.20` (package.json fallback), releases carry `2026-06-28T172842Z`. Raw
   lexicographic compare: `-` (0x2d) < `.` (0x2e), so every newer dashed stamp sorted BELOW
   the older dotted one — even if gap 1 were fixed, `updateAvailable` stayed false.

Plus review 03.08 config §5 in the same file: `downloadFile` had no write-stream/response
error handlers (disk-full → `process.exit(1)` via the uncaughtException guard), no stall
handling (wedged apply job forever, "Update already in progress" until restart), an unbounded
redirect chain, and the write stream was created before redirects resolved.

## What was done

1. `src/system/server-update.js` `checkForUpdate` — scans `releases?per_page=15` and picks
   the newest non-draft release carrying a `highascg-server_*.tar.gz` asset, prerelease or
   not. (Publisher untouched: server drops staying prereleases keeps the repo's public
   "Latest" pointing at the ISO release, which is correct for humans.)
2. `src/system/build-stamp.js` `compareBuildStamps` — normalizes `.`/`_`/`T` to `-` before
   the lexicographic compare; all stamp formats in the fleet now order by date.
3. `downloadFile` hardened: per-final-200 write stream, `error` handlers on both streams,
   stall timeout fails the job ("Download stalled"), partial file unlinked on any failure,
   redirect chain bounded at 5, every path settles the promise.

## What was VERIFIED

- **LIVE on this box after restart:** `GET /api/system/update/check?force=1` →
  `latest: 2026-06-28T172842Z`, `updateAvailable: true`, correct asset URL. First time the
  flow has ever returned true.
- Publisher dry-run (`npm run release:github-server:dry`) builds the tarball + notes cleanly,
  no residue.
- Smoke (`smoke-wo423-wo424-install-and-update.test.js`): mixed-format compare cases,
  release-list scan + draft-skip pins, all four download-failure-path pins. Build-stamp
  neighbor smoke unmodified. Suite 1823/0/2.
- NOT exercised: a full Apply on this box (it would overwrite the working tree with the June
  release — this box runs from git and is AHEAD of every release). Apply is for installed
  fleet boxes; the helper + sudoers were verified present.

## How updates work now (owner workflow)

1. When the repo state is worth shipping: `npm run release:github-server` (on this box or the
   Mac — needs `gh` auth). That publishes `highascg-server_<stamp>.tar.gz`.
2. Installed boxes: Settings → System Updates → Check → Apply (nuclear password). The box
   downloads, applies via the sudo helper, restarts.
3. Sticks: unchanged — rebuild via eggs produce, or put the same tarball in the exFAT
   `drop-update/` folder (WO-188 path, verified working there).
