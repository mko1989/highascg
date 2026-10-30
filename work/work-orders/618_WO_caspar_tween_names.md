# WO-618 — Non-linear tweens were never valid Caspar tween names

**Area:** amcp, engine
**Status: DONE (2026-10-18, AMCP-probed + offline smoke + live timeline playback on the shop dev box) — owner-QA: pick a non-linear tween on a look take and on keyframes and check that the curve looks right. Found while porting the timeline keyframes ([WO-602](./602_WO_godot_port_timeline.md)).**

## Investigation

- The UI offers transition tweens `linear / easein / easeout / easeboth` (`client/lib/transition-presets.js:10`,
  `client/components/settings-modal-templates.js:79-81`, the timeline take tween in `timeline-transport.js:238`). It
  offers keyframe easings `linear / ease-in / ease-out / ease-in-out` (`client/components/inspector-fill-timeline.js:73,121,169`).
- The server turned these into Caspar tokens in three separate mappers:
  `src/engine/scene-transition.js` `mapTween`, `src/engine/timeline-keyframe-mixer.js` `mapKeyframeTween` and
  `src/engine/ftb-pgm-prv.js` `mapTween`. Their output was `easein`, `easeout`, `easeboth` or lowercase pass-through.
- Caspar's tweener (`~/caspar-build/src-v2/src/common/tweener.cpp:423-467` `get_tweens`) knows only `linear`,
  `easenone` and the Penner family names (`easeinquad`, `easeoutsine`, `easeinoutcubic`, …). `get_tweener` throws
  `user_error` on anything else. The v1 prod binary (`bin/casparcg.253c16c`) has the same table (`strings -eL`: no
  `easein` / `easeboth`).
- Probed live on build v2 over AMCP, on spare layer 1-999:

  | Command | Result |
  |---|---|
  | `MIXER 1-999 OPACITY 0.5 25 easein` | `403 MIXER OPACITY FAILED` |
  | `MIXER 1-999 OPACITY 0.5 25 easeboth` | `403 MIXER OPACITY FAILED` |
  | `PLAY 1-999 #00000000 MIX 10 easeboth` | `403 PLAY FAILED` |
  | `PLAY 1-999 #00000000 MIX 10 easein` | `403 PLAY FAILED` |
  | `easeinquad`, `easeinoutquad`, `linear` | `202 OK` |

- Consequences:
  - A look take with a non-linear tween failed its PLAY/LOADBG outright.
  - Keyframe `ease-out` / `ease-in-out` (sent as `easeout` / `easeboth`) failed the DEFER'd segment tween, so the
    value held until the next segment.
  - Keyframe `ease-in` became `ease_in`, which was not a key in the map, so it silently played linear.
- Latent in practice: every tween in the live project and config is `linear` (`GET /api/project`, `config/`).
- This also corrects the WO-602 inventory line "server output honours easing": it never did.

## What was done

- `src/caspar/caspar-tween.js` (new) adds `toCasparTween(name)`:
  - It folds case and `-` / `_`, maps the shorthands to the quad family (`easein` → `easeinquad`, `easeout` →
    `easeoutquad`, `easeboth` / `easeinout` → `easeinoutquad`) and passes real Caspar names through. Caspar's
    `:p0:p1` parameter suffix is kept.
  - Anything unknown becomes `linear`, so a tween name can never fail a take again.
  - `CASPAR_TWEENS` matches tweener.cpp exactly (diffed), including its `easeoutintback` spelling.
  - Quad was picked as the softest standard Penner curve. A different family is a one-line change in `ALIASES`.
- The three mappers now delegate to it. It is also applied at the AMCP emitters, so raw API tweens are covered:
  `amcp-mixer.js` (every `param(tween)` and the typed payload), `amcp-command-plan.js` (the PLAY/LOAD/LOADBG
  transition token and the plan's `tween` used by the library-typed path) and `amcp-layer-diff-plan.js`.
- No UI change: stored values stay as they are and are translated at the AMCP edge.

## What was VERIFIED

- `tools/smoke/smoke-wo618-caspar-tween.test.js` (added to the curated list) covers every UI value, pass-through,
  parameters, unknown → linear, the take path (`normalizeTransition`) and the serialized `PLAY … MIX 25 easeinquad`.
- Offline suite: 2669 / 2672. The 1 failure is `smoke-wo577-shader-controls`, which reads the untracked box-local
  `data/shaders/sh-sa-fluidic-space.json` (dated 30 Sep). It is unrelated, and CI does not have that file.
- On the box after a server restart, the test timeline played on preview with opacity keys 0 → 1 (`ease-out`,
  0–3 s) → 0.3 (`ease-in-out`, 3–6 s). `data/amcp-last50.txt` showed
  `MIXER 2-210 OPACITY 1 75 easeoutquad DEFER`, then `MIXER 2-210 OPACITY 0.3 75 easeinoutquad DEFER` at the
  segment change. No 403 or FAILED in the journal.
- Not exercised live: a look take with `easeboth`. The serialized line is covered by the smoke test, and the same
  token was `202 PLAY OK` in the AMCP probe.
