# WO-408 — todos03.08 UI batch: live-input label bar color, capture-button unification, test-pattern double resolution

**Status: DONE (2026-08-03 — suite 1781/0/2, built + kiosk reloaded + service restarted; owner eyeball owed on all three)**
**Priority:** Normal (owner todos03.08.26 items 4–6)
**Source:** `work/work-orders/todos03.08.26`
**Related:** WO-323 (source tiles), WO-346/WO-272 (tile capture buttons), WO-80 (custom xrandr modes — why video-mode ids ARE resolutions on this box)

## 1. Investigation

1. **"live inputs need to have a blue label bar (not red)"** — compose-preview tiles color the
   footer label row by role: default red `#c92a2a`, `data-role='prv'` teal
   (`10b-operator-compose-tiles.css`). Dropped live-source tiles (WO-323) have role `mvcell`
   with `def.sourceTile` set — no rule matched, so they fell through to the PGM red.
2. **"pgm has capture button and others have prt should be unified"** — both buttons do the
   same Caspar PRINT snapshot: PGM via `POST /api/pgm/capture` (labeled CAPTURE, WO-272),
   other tiles via `POST /api/amcp/print` (labeled PRT, WO-346). No CSS differed
   (`operator-tile__btn--prt` had no rules) — the inconsistency was purely label/class.
3. **"test pattern displays the resolution twice"** — `config-compare.js:57` built
   `resolutionLabel = "W×H · <video-mode>"` unconditionally. This box's custom modes are
   NAMED by their resolution (`1728x960`), so the label read **"1728×960 · 1728x960"**.
   Standard modes ("1080p5000") were fine — which is why it only shows on this box's
   custom-mode screens.

## 2. What was done

- `operator-compose-tiles-tile-controller.js` — tiles with `def.sourceTile` set
  `data-live-source='1'`; the non-PGM capture button is now labeled CAPTURE with the
  `--capture` chrome class and the PGM title wording.
- `10b-operator-compose-tiles.css` — `.operator-tile[data-live-source='1']
  .operator-tile__labelrow { background: #2563eb; }` (blue, beats the red default).
- `config-compare.js` — mode id appended only when it is NOT just the resolution string;
  the `· —` filler for missing modes is gone too.
- `tools/smoke/smoke-wo408-compose-ui-batch.test.js` (in the CI list) — pins all three.

## 3. What was VERIFIED to work

- Suite 1781 pass / 0 fail / 2 skip (incl. the 3 new WO-408 tests); file-lines guard clean
  (tile controller trimmed back under 500).
- `build:client` + kiosk F5 done; `highascg` service restarted (config-compare is server-side;
  caspar untouched — supervisor is init-parented, verified).
- Owner QA: drop a live source on compose preview → blue bar; any non-PGM tile shows
  CAPTURE; LED test pattern top line shows the resolution once.
