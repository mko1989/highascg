# WO-867 — Caspar build: CasparCG/server#1762 effects (BLUR / SHARPEN / GRAIN) brought up to the PR's August fixes

**Area:** amcp, os-iso
**Status: DONE (2026-10-30, build-26 `2.5.1 a09a40f12` deployed; AMCP BLUR lens / GRAIN set + query + clear on 8-99; PRV restored after the restart)**

Owner 30.10: "are these effects added to the casparcg server build? https://github.com/CasparCG/server/pull/1762" → "yes pull both".

## 1. Investigation

- PR #1762 (C-alcaide, "Add image effects: MIXER BLUR, SHARPEN and GRAIN") is OPEN upstream, not merged.
- Our fork (`~/caspar-build/src-v2`, branch `wo742-shm-producer`) carries its July version as four commits:
  `530542a16`, `6953a7f7d`, `b8eb86f9f` and `7aa818c12`. The live binary (`2.5.1 4eab31c06` + uncommitted WO-820 / WO-800
  patches) answered `MIXER 8-99 BLUR|SHARPEN|GRAIN` with 201.
- The PR was rebased on 14.08 onto upstream master. `git range-diff` shows the four commits changed only in context, from
  master's colour-grading series. It then gained two fixes:
  - `13dc0e387`: the grain response used a luma with R and B exchanged (the pixel is BGR in the mixer).
  - `62fb8c2bf`: the same R/B exchange for the lens-blur bokeh weight (and Rec.601 instead of Rec.709). Combining
    transforms took `sharpen_radius` / `grain_size` from a float test against the default, and the strengths grew without
    bound.
- `13dc0e387` cherry-picks cleanly. `62fb8c2bf` conflicts in five files: it also carries master's colour-grading
  `grade_limits` table and the white-balance / LMG / CDL fields, which are not in 2.5.1.
- The trailing `|| lhs.enable_geometry_modifiers == …` in `image_transform operator==` is upstream 2.5.1's own code, not
  the PR's. It was left alone.

## 2. What was done

- `5f99d1fcb`: cherry-pick of `13dc0e387` (grain luma on `.bgr`).
- `a09a40f12`: hand port of `62fb8c2bf`'s two fixes only:
  - the lens weight uses Rec.709 on `.bgr`;
  - `apply_transform_colour_values` keys radius / size off the incoming effect being on;
  - strengths are clamped to the PR's ranges (sharpen 0–5, radius 0.1–10, grain 0–1, size 0.5–10).
- Both commits are exported as `caspar/patches/wo867-pr1762-effects-fixes.patch`, next to the WO-790 / 800 / 820 patches.
- The build is `~/caspar-build/build-26.sh`, which includes the uncommitted WO-820 / WO-800 worktree patches as before.
- The deploy is the usual swap:
  - the old binary is kept as `bin/casparcg.pre-1762fix` (md5 bbe75049);
  - the new `bin/casparcg` is md5 bd39a0ee;
  - then `AMCP RESTART`, then a node restart. No Apply was running.

## 3. What was VERIFIED

- The build ran with no unresolved libs, linked against FFmpeg 62 / Boost 1.90 / ICU 78.
- The running process is the new binary (`/proc/<pid>/exe` md5 bd39a0ee), and `VERSION` answers `2.5.1 a09a40f12 Stable`.
- On the empty monitor layer 8-99:
  - `MIXER BLUR 12 lens` → 202, and the query shows `12.000000 lens …`;
  - `GRAIN 0.3 2` → 202, and the query shows `0.300000 2.000000`;
  - `CLEAR` → BLUR back to `0 gaussian`.
- After the restart, the node reconnected, PRV ch 2 has the Intro look again (5 layers), and the `opgui` / `pgm1` rings were
  rewritten. PGM ch 1 had no live look before the restart.
- Not checked by eye: the visual difference of the lens / grain luma fix. It only shows on saturated red vs blue
  highlights, and the PR author did not measure it either.
