# WO-626 — main CI red since 03.10; made green before merging godot into main

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
  3. **Offline tests:** `smoke-wo577-shader-controls` "library" test. In CI it reads `data/shaders`, which is the
     git-ignored runtime library, so `readdirSync` throws. On the box it failed on the junk label "Value" in
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
- Shader naming: `FN_ARGS.mix = ['mix from', 'mix to', 'mix amount']`. The wo577 library test skips when
  `data/shaders` is absent (CI) and runs in full on the box.
- `npm update brace-expansion` changed `package-lock.json` only, 5.0.9 → 5.0.12.

## What was VERIFIED

See the merge commit's gate run (below). Box-only, still open: 3 of 190 library shaders have author-declared
single-letter constants (`const vec3 W` luminance weights in `sh-sa-magfest-station-event`, `float w` in
`sh-sa-moving-without-travelling`, `float z` in `sh-sa-tribute-to-my-old-atari`) that the wo577 junk-label rule
flags. These are the authors' own names and were not renamed here. On the box this test still fails on them; in CI it
skips.
