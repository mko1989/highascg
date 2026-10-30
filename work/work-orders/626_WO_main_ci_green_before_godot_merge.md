# WO-626 — main CI red since 03.10; made green before merging godot into main

**Area:** testing-ci
**Status: DONE (20.10 — every CI step run on a clean `git archive` export of the merge commit; see VERIFIED)**

Owner 20.10: "commit push all the recent work … actually we can merge godot into main, its working out very well."

## Investigation

- `gh run list --branch main`: CI has failed on every push since 03.10, most recently run 37168303482 on d5521d50.
  The verify job stopped at **Unwired exports**, so the steps after it (boot, ESLint, Prettier, offline tests, npm
  audit) never ran and their state was unknown. The gates mask each other.
- `main` is an ancestor of `godot` (160 commits), so the merge is a fast-forward. Every step was therefore run
  locally on a clean `git archive godot` export, with no untracked runtime files (`data/shaders`, sync-conflict
  projects, `config/`):
  1. **Unwired exports:** 21 orphans. 15 were already on main, and 6 came from godot (operator-gui-source-cells,
     video-surfaces, fusion). All 21 are used inside their own file; they were exported but never imported.
  2. **ESLint:** 221 warnings against the `--max-warnings 218` budget. Main was already at 221.
  3. **Offline tests:** `smoke-wo577-shader-controls` "library" test. It reads `data/shaders`, the git-ignored
     runtime library. In a full CI run that directory DOES exist: `reconcileShaderStore`
     (`src/shaderfx/shader-store.js:226`) recovers all 190 JSONs from the tracked `template/shaders/*.html` whenever
     an earlier test lists shaders. Run alone in a fresh clone, though, `readdirSync` throws, because the recovery
     writes fail silently when `data/shaders` is missing (nothing created the directory). On the box it failed on the junk label "Value" in
     `sh-sa-fluidic-space`: the scanner named the first argument of `return mix(◆, 1., v)` "value", because
     `FN_ARGS.mix` (`client/lib/shader-param-naming.js:17`) named only the third argument.
  4. **npm audit (prod):** `brace-expansion` 5.0.9 high (two DoS advisories). It is a `devOptional` dependency via
     eslint → minimatch, and 5.0.12 is in range.
  - Boot, Prettier, the 500-line limit, repo integrity and the Godot tests already passed.

## What was done

- Unwired: a Haiku subagent removed the 21 names from `module.exports` or dropped their `export` keyword. Its diff
  was checked by hand: only export keywords and entries changed. The baseline was shrunk with `--update`
  (12 → 1 lines changed: 11 baseline entries are no longer orphans).
- ESLint: removed four unused imports of Node built-ins: `os` in `index.js`, `os` and `execSync` in
  `src/audio/audio-devices.js`, and `path` in `src/api/routes-companion-preview.js`, whose `path` was in any case
  shadowed by the handler parameter. That gives 217 warnings.
- Shader naming: `FN_ARGS.mix = ['mix from', 'mix to', 'mix amount']`.
- One-letter declared constants (`const vec3 W` luminance weights in `sh-sa-magfest-station-event`, `float w` in
  `sh-sa-moving-without-travelling`, `float z` in `sh-sa-tribute-to-my-old-atari`) are labelled with their section,
  e.g. "Look W" (`declaredLabel` in `client/lib/shader-controls.js`). The author's name is kept, but the label now
  says where the control lives rather than showing a bare letter. These three were the last junk labels in the library.
- `reconcileShaderStore` creates `data/shaders` before recovering into it, so a fresh clone gets its library on the
  first list. The wo577 library test calls it first, so it runs the same 190 shaders in CI as on the box, in any
  order. (An earlier draft skipped the test when `data/shaders` was absent. That premise was wrong, because the
  suite regenerates the directory, so the skip was removed.)
- `npm update brace-expansion` changed `package-lock.json` only, 5.0.9 → 5.0.12.

## What was VERIFIED

Clean `git archive` export of the commit, with no `data/shaders`, `.git` or `config/` runtime state:
- Integrity, 500-line limit, unwired exports, boot (`--no-http`), ESLint (217 ≤ 218), Prettier and npm audit (prod)
  all exit 0.
- `xvfb-run -a npm run test:ci`: 2870 tests, 2866 pass, 3 skipped, 1 fail. The failure is `smoke-wo498`
  ("nginx proxy is gone"), which runs `git ls-files` and so needs a `.git` that an archive does not have. In real CI
  it runs in a checkout.
- The wo577 test was also run ALONE in that export: 8/8 pass, and `data/shaders` was created with 190 JSONs.
- Godot client tests: 16087 pass.
- GitHub CI on the pushed main is recorded below.

## Follow-up — first CI run on the merged main was red (run 39469797612)

**Investigation.** The run failed in Offline tests: 2862 pass, 4 fail. The four were `smoke-wo598-deck-sync-persist-race`
(3) and `smoke-wo617-tests-never-touch-live-projects` (1), all with
`EACCES: permission denied, mkdir '/home/casparcg/highascg/media/projects/raceshow'`.
- `persistProject` (`src/engine/project-scenes.js:264`) calls `ensureProjectMediaDir`, which creates
  `<media root>/projects/<slug>`.
- With no `local_media_path`, the media root is the hard-coded `/home/casparcg/highascg/media`
  (`src/media/local-media-paths.js:60`). WO-617 sent test PROJECTS to a temp dir but never covered this media
  folder.
- On the box that path is writable, so the clean-export run passed and the suite quietly created empty `newshow`,
  `oldshow`, `raceshow` and `raceshow2` in the LIVE `media/projects` (dated 18.10 08:00, with no project files).
- Lesson: a local clean export cannot catch writes to absolute box paths. Only the runner, with no `/home/casparcg`,
  can.

**Done.** `ensureProjectMediaDir` (`src/media/project-media-root.js`): under the Node test runner it creates
folders only under `os.tmpdir()`, i.e. a temp `local_media_path` the test chose. Otherwise it returns null, as it
already does when project-scoped media is off. I removed the four empty test folders from the live
`media/projects` with `rmdir`, which only removes empty directories.

**Verified.**
- wo598, wo617 and `smoke-project-media-root`: 14/14 pass, and the four folders are not recreated.
- Full clean-export suite: 2874 tests, 2870 pass, 3 skipped, 1 fail (wo498, which needs `.git`, an archive artifact).
- After that full run, the live `media/projects` holds only the real project folders.
