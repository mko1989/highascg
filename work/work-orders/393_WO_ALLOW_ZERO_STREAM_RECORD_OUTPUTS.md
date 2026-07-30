# WO-393 — Allow 0 stream / record outputs

**Status: DONE (2026-07-30 — suite 1737/0/2 incl. new smoke-wo393; live: GET /api/settings returns `streamOutputs: []` on this box's real empty config, `rec_1` intact)**
**Source:** `work/work-orders/todos30.07.26` §"in highascg it does not allow to have 0 stream or record outputs, which should be possible."
**Related:** WO-172 (remove-output flow + restart-dirty rules), WO-244 (stream credential preserve-on-save), WO-270 (settings modal sections).

---

## 1. Investigation (2026-07-30)

Removal itself is fully wired and unconstrained — `device-view-cable-outputs.js:89-122`
saves the filtered array and prunes the graph connector. What makes 0 impossible is
**empty-array re-seeding**: four sites treat `length === 0` the same as "key missing"
and substitute a phantom default output:

- `src/api/settings-get.js:86` — `streamOutputs: (Array.isArray(cfg.streamOutputs) && cfg.streamOutputs.length ? cfg.streamOutputs : [{ id: 'str_1', … }])`
- `src/api/settings-get.js:109` — same for `recordOutputs` (`rec_1`)
- `src/config/device-graph-suggest.js:213` — seeds a `str_1` stream_out connector when none configured
- `src/config/device-graph-suggest.js:265-267` — same for `rec_1`

So deleting the last output works on disk (`config/stream_outputs.json` is literally `[]`
on this box) but the next settings GET resurrects `str_1` in the UI, and any subsequent
settings save persists the phantom back. `settings-post.js` itself is fine (`Array.isArray`
checks only, no length).

Ruled out as blockers for zero outputs:
- `routes-streaming-channel-shared.js:209` returns null when `outputs` is empty — start
  actions degrade gracefully, no crash path found.
- Client add-handlers (`device-view-bands-render.js:332,341`) only fall back when the key
  is **not an array** — with the server returning real (possibly empty) arrays they never
  seed; adding from 0 produces `str_1`/`rec_1` again (`idx = length + 1`).

Adjacent pre-existing bug (observed, NOT fixed here): `onAddStreamOutput` ids collide after
sparse removals (e.g. remaining `[str_2]` → next add mints `str_2` again). Follow-up if the
owner hits it.

## 2. What was done

"Key absent" (legacy/fresh config → seed one default, matching `defaults-core.js`) is now
distinguished from "empty array" (operator removed all outputs → stays empty): the four
sites dropped their `.length` condition, seeding only when the key is not an array.

## 3. What was VERIFIED

- New `tools/smoke/smoke-wo393-zero-outputs.test.js` (3 tests: empty arrays → no connectors;
  absent keys → one seeded default each; source guard against length-conditional re-seed),
  added to the curated CI list. Full suite **1737 pass / 0 fail / 2 skip**.
- Live on the box after service restart: `GET /api/settings` returns `streamOutputs: []`
  (this box's `config/stream_outputs.json` is genuinely empty — previously this GET seeded a
  phantom `str_1`) and `recordOutputs` still lists the owner's real `rec_1`.
- Owner QA: in Devices view, "Remove record output" on the last one — it must stay gone
  across reloads; "Add stream output" from zero must create Str1 again.
