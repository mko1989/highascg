**Status: IMPLEMENTED (2026-09-22, offline suite 2505/2507 / 0 fail / 2 pre-existing skips, new smoke 3/3, max-file-lines clean) — client not rebuilt, needs kiosk reload + owner on-hardware confirmation**

## Investigation

Owner (`work/work-orders/todos22.09.26`): changing the audio output device in the dropdown, then
clicking "Save audio settings", reverts the dropdown back to the old device — "the procedure needs
to be done again to actually change and save the audio settings." Also asks for auto-save instead
of the explicit button, "just like most settings are auto saved."

**The save itself is correct — the bug is purely in what happens right after it.**

`saveBtn.onclick` in `client/components/device-view-inspector-audio.js:167-196` reads the live DOM
value at click time (`device-view-inspector-audio.js:172`,
`String(manualDevIn.value || deviceSel.value || '').trim()`), builds the patched `audioOutputs`
array and POSTs it via `Actions.saveSettingsPatch(patch)` (`:190`). Server side,
`src/api/settings-post.js:337-369` takes the posted `deviceName` as-is and writes it into
`config/audio_outputs.json` / server state — no staleness there.

The revert happens in the very next line, `device-view-inspector-audio.js:195`:
`await load()` — called with **no options**, i.e. `forceRefresh` defaults to `false`.

`load` is `ctx.load` in `client/components/device-view-render.js:225-254`: it keeps a 5-second
client-side cache of the last fetched payload (`lastPayload`/`lastPayloadAt`, module scope at
`:20`). When `forceRefresh` is false and the cache is still fresh (`shouldUseCache`,
`device-view-render.js:229-232`), the function returns at `:249-253` **without fetching anything**
and re-renders straight from the pre-save `state.currentSettings` — which still holds the old
device name. Since opening the inspector, changing the dropdown, and clicking Save all normally
happen well inside that 5-second window, `shouldUseCache` is true on essentially every real click:
this isn't a rare race, it's the default outcome.

This is the exact bug class WO-490 (`work/work-orders/490_WO_REMOVED_DESTINATION_STAYS_UNTIL_NEXT_ADD.md`)
diagnosed and fixed everywhere it was found at the time — "a plain `ctx.load()` here is answered
from the 5s payload cache and skips the network fetch" — converting every genuine post-mutation
reload in Device View to `await load({ forceRefresh: true })`. Proof the fix shape is already
established in this same file family:
- `device-view-bands-render.js:373,380,391` (`onAddAudioOutput`/`onRemoveAudioOutput`) —
  `await load({ forceRefresh: true })` after the identical `saveSettingsPatch({ audioOutputs })`.
- `device-view-cable-outputs.js:120-133` (`removeAudioOutputConnector`) — same pattern.

`device-view-inspector-audio.js:195` is simply the one call site in the audio-output family that
was never converted — either it predates WO-490 or was added afterward without the pattern.

**Owner's second ask — auto-save instead of a button.** The pattern already exists elsewhere in
Device View: `client/components/device-view-destinations-inspector-form.js:190` and `:206-209`
wire a `select`'s `change` event straight to `patchDestination(...)`
(`client/components/device-view-actions.js:84-86`, POSTs immediately, no button, no explicit
reload needed since that panel re-renders from its own local patch result). That's the "most
settings auto-save" behaviour the owner is referring to.

**Scope note for whoever fixes this:** a repo-wide check
(`grep -rn "load()" client/components/device-view*.js | grep -v forceRefresh`) turned up the same
bare-`load()`-after-mutation shape still present in several *other* inspectors —
`device-view-inspector-stream.js`, `device-view-inspector-decklink-output.js`,
`device-view-inspector-record.js`, `device-view-inspector-gpu.js`,
`device-view-inspector-caspar.js`, `device-view-inspector-virtual-cam.js`,
`device-view-inspector-gpu-layout-editor.js`, `device-view-inspector-decklink-rear-order.js`.
These are candidates for the identical revert bug but were not reproduced against the owner's
actual report and are out of scope for this WO — flagged here so a follow-up WO can sweep them
deliberately rather than have them get opportunistically touched mid-fix here.

## What was done

`client/components/device-view-inspector-audio.js`:

- **The actual revert bug:** the save handler's trailing `await load()` is now
  `await load({ forceRefresh: true })`, matching the fix shape WO-490 already established for
  every other post-mutation reload in this file family — this alone fixes the reported symptom.
- **Auto-save, per the owner's second ask:** the save logic was extracted from the button's
  `onclick` into a standalone `async function save()` (unchanged internals — same field reads,
  same payload shape, still writes the exact `role`/`type` fields WO-406's smoke pins), and every
  field that used to require the "Save audio settings" click now calls `save()` on its own
  `change` event: device type, device dropdown, manual device-name field, monitor checkbox, host
  API, buffer/latency/FIFO (their math-input wrapper still commits on blur, which still fires a
  native `change`), PortAudio layout, and the label field. This mirrors the already-established
  pattern elsewhere in Device View (`device-view-destinations-inspector-form.js`'s
  `patchDestination` on `change`). The button itself is removed; "Remove audio output" (a
  destructive, confirm-gated action) is untouched.
- New smoke `tools/smoke/smoke-wo578-audio-output-autosave.test.js` (registered in
  `run-offline-tests.js`): pins `forceRefresh: true` on the reload, pins that every relevant field
  wires a `change` → `save()` listener and that no bare `Save audio settings` button remains, and
  re-pins the exact WO-406 `role`/`type` lines so this change can't silently break that WO's own
  smoke assumptions.

## VERIFIED

- New smoke: 3/3 pass. WO-406 smoke (`smoke-wo406-monitor-bus.test.js`, reads this same file):
  still 4/4 pass — the monitor-role/type save lines are untouched, only relocated into `save()`.
- Full offline suite: 2505/2507 pass, 2 pre-existing environment-gated skips, 0 failures (one
  pre-existing `Date.now()`-based 1ms timing flake in an unrelated test,
  `smoke-wo537-look-timeline-starts-where-asked.test.js`, reproduces on `HEAD` in isolation too —
  not caused by this change).
- `node tools/ci/check-max-file-lines.js`: 0 files over 500 lines. `eslint` on the touched files:
  0 warnings, 0 errors.
- **Not yet done:** not committed, `dist-web/` not rebuilt, nothing live-verified. Owner should,
  after a kiosk reload: open an audio output's inspector, pick a different device from the
  dropdown, confirm it does NOT revert and no button-click is needed; then also touch a couple of
  the other fields (label, buffer/latency/FIFO, host API) and confirm each persists across a
  re-open without a separate save action.
