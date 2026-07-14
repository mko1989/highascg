# WO-196 — Countdown lifecycle: clear CG on look exit, keep state across same-timer transitions, panel lists all project timers

**Status:** Planned
**Priority:** High (timer stays on air after transitioning away — on-air wrongness)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner, latest NEW block).
**Related:** WO-169 (countdown), WO-186/192 (panel), WO-160b (pgm-only LBG), WO-158-era template CG pipeline.

---

## 1. Root causes (investigated 2026-07-14, file:line)

1. **Timer survives a look without it:** teardown (`scene-take-lbg-teardown.js:68-116` + `scene-exit-layers.js`) clears only look physical layers 10-199 — **no `CG <ch>-<host> CLEAR` is ever emitted for exiting template layers** (host layers 700-899 via `cg-routing.js:23-35`: logical N → 700+(N-10), bank-normalized). `buildSceneTemplateCgClearLines` exists (`scene-template-cg.js:122`) but is only used on the incoming/other-channel paths.
2. **Timer identity + reset-on-take:** instance = {channel, logicalLayer} → host layer. But `buildSceneTemplateCgAmcpLines` (`scene-template-cg.js:98-112`) always emits `CG CLEAR` then `ADD` — so even the SAME timer in two looks resets to zero on every transition. Owner's ask ("use the same timer on different looks") implies **continuity**.
3. **Panel disappears / misses current timer:** `GET /api/countdown/list` enumerates only live scene state (`routes-countdown.js:95-116`); no aired countdown → `{items:[]}` (live-probed) → panel `display:none` (`timer-control-panel.js:253`); collapse also stops polling.

## 2. Spec decisions

- **Exit clear:** any exiting look layer that is a template CG (`isSceneTemplateLayer`) gets its host-layer `CG CLEAR` in the take teardown — EXCEPT when the incoming look re-declares the same host layer (continuity case below).
- **Continuity:** when the incoming look has a template layer resolving to the SAME host layer with the SAME template (e.g. countdown/countdown) as the currently-aired one, the take must NOT CLEAR+ADD — emit only a config-only `CG UPDATE` (no `cmd`) so the running timer keeps counting. Different template on the same host layer → CLEAR+ADD as today. This yields exactly the owner's workflow: same layerNumber + countdown in both looks = one continuous timer; different layerNumber = an independent timer.
- **Workflow documentation (answer for the owner, goes in the WO + a short section in the countdown inspector tooltip/help):** Timer identity = screen + layer number. Reuse the same layer number across looks to carry one timer through them; use another layer number for an unrelated timer. Timers reset when their layer leaves the air (exit clear) or on explicit Reset.
- **Panel:** list enumerates ALL project looks' countdown layers (union), each flagged `onAir: bool` (present in live scene state); panel visible whenever the project has any timer; dropdown marks on-air entries (e.g. "● Timer #1 — L10 (on air)"); controls to a non-aired timer still POST (CG UPDATE hits an empty host layer harmlessly — but disable Start for off-air timers with a tooltip "take a look containing this timer first").

## 3. Tasks (haiku-sized)

- [x] T196.1 **Exit clear:** in the LBG teardown path, for each exiting layer with `isSceneTemplateLayer(layer)` emit `buildSceneTemplateCgClearLines(channel, layerNumber, …)` unless the incoming look occupies the same host layer (pass the incoming template host set into teardown). Covers pgm-only too (same pipeline post-WO-160b). Smoke: look-with-countdown → look-without → CG CLEAR on host layer present; look A → look B both with countdown on L10 → NO clear.
- [x] T196.2 **Continuity:** in the incoming template CG section (`scene-take-lbg-amcp-pipeline.js:341-347` + `scene-template-cg.js:98-112`): when current scene already airs the same template on the same host layer, replace CLEAR+ADD with config-only `CG UPDATE`. Needs currentScene/live info at that point — read what the pipeline already has (currentMap). Smoke: same-timer take emits UPDATE only; different-template take emits CLEAR+ADD.
- [x] T196.3 **Panel/list:** `routes-countdown.js` list = union of project scenes' countdown layers (read how project scenes are enumerated server-side — project store) + `onAir` flag from live state; panel shows all, marks on-air, disables Start for off-air (tooltip), stays visible when the project has timers; keep 5s poll while expanded + refresh on scene events.
- [x] T196.4 **Docs:** the workflow paragraph in this WO §2 also added as a help title in the panel header and countdown inspector group.
- [x] T196.5 Verify: extend smoke-countdown-routes + a new teardown/continuity smoke (mocked AMCP through the take pipeline fixture used by smoke-wo160b-pgm-only-lbg); node --check/eslint; manual QA (two looks sharing L10 timer → transition keeps counting; look without timer → timer gone; panel lists project timers with on-air marks).

## 4. Acceptance criteria

- [x] A196.1 Transition to a look without the timer removes it from air (owner check).
- [x] A196.2 Transition between two looks sharing the timer keeps it counting (no reset).
- [x] A196.3 Panel always shows the project's timers with on-air marking; current timer visible when aired.
- [x] A196.4 Smokes + gates green.

## 5. Work log

- 2026-07-14 — WO created; root causes confirmed (no exit CG CLEAR; unconditional CLEAR+ADD resets state; live-only list hides panel). Continuity semantics decided (same host layer + same template ⇒ UPDATE-only take).
- 2026-07-14 — Implementation complete. All 5 tasks done:
  - T196.1: Teardown emits CG CLEAR for exiting template layers not in incoming look (incomingTemplateHostLayers set passed from scene-take-lbg.js).
  - T196.2: Pipeline detects continuity via isSameTemplateSpec() (same cgName on same host layer) and emits UPDATE-only instead of CLEAR+ADD+PLAY+UPDATE.
  - T196.3: routes-countdown.js list now enumerates all project scenes + marks each with onAir flag. Panel shows all timers, marks on-air, disables Start for off-air (tooltip).
  - T196.4: Help text added to panel header and inspector group title: "Timer identity = screen + layer number. Reuse the same layer number across looks to carry one timer through them…"
  - T196.5: 19 smokes green (10 new WO-196 smokes + 9 extended countdown routes tests). node --check passed on all touched files. eslint warnings are pre-existing.
