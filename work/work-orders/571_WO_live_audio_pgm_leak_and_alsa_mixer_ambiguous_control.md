**Status: IMPLEMENTED (2026-09-11, offline suite 2424/0/2, client build clean, live-verified
GET responses, `highascg` service restarted with owner's go-ahead, kiosk reloaded) — owner-QA
still owed: actually toggle the per-slot PGM buttons off + Save in the Live Audio Mixer and
confirm audio drops off PGM; re-test the ALSA mixer sliders/mute on the live capture card.**

## Investigation

Owner report, `work/work-orders/todos11.09.26`: "i have live audio input set now, its set to NOT
be routed to outputs as it is only used as fft source for shaders. yet it is present on pgm
outputs... the other problem i had was with alsa mixer settings to make the audio capture
active... i had errors and had to do it manually thru alsamixer from terminal."

Two independent bugs, both in the live-audio input path.

### Bug 1 — live audio present on PGM despite nothing being routed there

The owner's mental model was that the "Shader FFT source" checkbox
([inspector-live-audio-input.js:36](../../client/components/inspector-live-audio-input.js#L36),
persisted as `audio_fft_source_slot`) meant "FFT-only, keep off PGM." It doesn't — it only adds
an extra raw-PCM UDP tee for the shader engine
([live-audio-bridge.js:174-192](../../src/audio/live-audio-bridge.js#L174-L192)); it has no
effect on PGM routing at all.

Clarified with the owner (AskUserQuestion) that the actual expectation is simpler and doesn't
involve the FFT flag at all: the Live Audio Mixer's per-slot **"Route to program"** buttons
([live-audio-mixer-modal.js](../../client/components/live-audio-mixer-modal.js), `PGM ch N`
toggles per slot) are the intended control, and with none of them selected, audio should not
reach PGM. It did anyway.

Root cause, in [routing-setup-live-inputs.js](../../src/config/routing-setup-live-inputs.js)
`setupLiveAudioPgmRoutes` (called at startup and via `/api/audio/live-inputs/apply`): a
completely separate, global, default-`true` flag, `live_audio_pgm_always_on`
([defaults-caspar-server.js:101](../../src/config/defaults-caspar-server.js#L101)), blanket-routed
**every configured slot** to **every PGM screen** returned by
`resolveLiveAudioPgmTargetScreens` — with zero awareness of the per-slot button state. That
per-slot selection was never even persisted server-side to begin with: it lived only in the
browser's `localStorage`
([live-audio-play-targets.js:1-3](../../client/lib/live-audio-play-targets.js#L1-L3): "Persisted
in localStorage until the server stores play targets on slots" — an acknowledged gap). Live
config confirmed both `live_audio_pgm_always_on: true` and `audio_fft_source_slot: 1` set
together on this box, so slot 1 was always going to reach every PGM screen regardless of any
button.

A second, independent instance of the same "empty state gets silently discarded" bug existed
purely client-side, in the mixer modal's own `readUiFromDom`
([live-audio-mixer-modal.js:120](../../client/components/live-audio-mixer-modal.js) before the
fix): `routeTargets.push(targets.length ? targets : getMultiPlayTargets(i))` — if the owner
unchecked every PGM button for a slot and clicked Save, the freshly-scanned (empty) DOM state was
discarded in favor of whatever was previously cached in `localStorage`, so "none checked" could
never actually save as "none."

A smoke test, `smoke-live-audio-pgm-screens.test.js`, already exercised (and pinned as a feature)
the blanket "route every slot to every screen when `live_audio_pgm_always_on` is true" behavior —
so removing it outright would have been a regression for anyone relying on the zero-config
default. The fix instead makes an explicit per-slot selection override the blanket default only
once it exists.

### Bug 2 — ALSA mixer settings error out from the app UI

[settings-alsa-mixer-panel.js](../../client/components/settings-alsa-mixer-panel.js)
`bindControlHandlers` called `setAlsaMixerControl({ card, name, ... })` for every slider/mute/enum/
switch, never passing the control's `index`. Server-side,
[alsa-mixer-controls.js:38-50](../../src/audio/alsa-mixer-controls.js#L38-L50)
`formatAmixerControlId` throws `ambiguous_control` (→ HTTP 400) whenever a card has more than one
control sharing a name and no `index` disambiguates it. Verified live on this box (read-only GET,
no state changed):

```
$ curl -s 'http://localhost:4200/api/audio/alsa-mixer?card=0' | …
AMBIGUOUS: Capture [ 0, 1 ]
AMBIGUOUS: Input Source [ 0, 1 ]
```

Even the stock onboard HDA codec on this box has two controls both named "Capture" — so every
attempt to unmute/raise capture gain from the Settings panel 400'd, matching exactly the errors
the owner described, forcing the `alsamixer`-in-terminal workaround (which lets a specific index
be picked).

Secondary contributing gap: the server already computes a "this is probably the right card"
hint (`resolveSuggestedAlsaMixerCard`, from the configured `live_audio_input_N_device`) and
returns it as `suggestedCard` in the GET payload
([routes-audio.js:125](../../src/api/routes-audio.js#L125)), but the client's
`normalizeAlsaMixerPayload` never read it and the panel hardcoded `currentCard = 0` on load — so
the owner could also land on the wrong card before ever reaching the ambiguous-control error.

## What was done

**Bug 1 — per-slot PGM routing now respected, with a documented legacy fallback:**

- `src/config/live-audio-input.js`: added `resolveLiveAudioSlotPgmChannels(cfg, slot)`. Reads
  `live_audio_input_N_pgm_channels` (comma-joined channel numbers). If the key is **present**
  (even as `''`) it is authoritative — an empty list means "route to nothing." If the key was
  **never written**, falls back to the legacy blanket `live_audio_pgm_always_on` +
  `resolveLiveAudioPgmTargetScreens` behavior, so a slot nobody has ever touched through these
  buttons keeps working exactly as before. `listConfiguredLiveAudioSlots` now carries
  `pgmChannels` per slot; `listLiveAudioPgmProtectedLayers` was rewritten to iterate each slot's
  own `pgmChannels` instead of the old "every screen × every slot" cross product, so protected
  layers always match what's actually routed.
- `src/config/routing-setup-live-inputs.js` `setupLiveAudioPgmRoutes`: rewritten to loop each
  slot and route only to `slot.pgmChannels` — a slot with an empty list is skipped entirely, no
  `PLAY`/`MIXER` calls issued for it. Removed the now-unused `resolveLiveAudioPgmTargetScreens`
  import and per-screen outer loop.
- `src/api/routes-audio.js` POST `/api/audio/live-inputs/config`: whitelists and persists
  `live_audio_input_N_pgm_channels`, normalized to a comma-joined list of positive integers.
- `client/lib/live-audio-inputs.js`: `readLiveAudioCasparSettings` now derives `routeTargets`
  (per-slot `{channel, layer}[]`, or `null` when the slot has no persisted key at all) from that
  same field; `buildLiveAudioConfigBody` writes `live_audio_input_N_pgm_channels` from
  `ui.routeTargets[i-1]` whenever it's a real array (including empty), and omits the key entirely
  when it's `null` so an untouched slot's "never configured" state survives an unrelated save
  from the plain Settings panel.
- `client/components/live-audio-mixer-modal.js`: fixed the `readUiFromDom` coalescing bug (now
  always pushes the scanned DOM state, never falls back to stale `localStorage` on empty); the
  initial `renderPanel()` fill now prefers the persisted server `routeTargets` over
  `localStorage`, falling back to it only for a slot that's never been saved.

Considered persisting via `live_audio_pgm_always_on: false` + relying solely on the existing
per-slot Save/Apply flow instead — rejected, because that flow only fires an immediate one-time
AMCP apply and still wouldn't survive a service restart; the box needs the selection to be a real
persisted setting, not a one-shot action.

**Bug 2 — ALSA mixer control index + card suggestion:**

- `client/lib/alsa-mixer-api.js`: `normalizeAlsaMixerPayload` now also returns `suggestedCard`.
- `client/components/settings-alsa-mixer-panel.js`: every rendered control (slider, mute button,
  enum select, boolean switch) now carries `data-index` from the control's own `ctrl.index`;
  `bindControlHandlers` reads it via a small `controlIndex(el)` helper and includes it in every
  `setAlsaMixerControl` call. On load, if the owner hasn't manually picked a card yet and the
  server suggests a different one than what's currently loaded, the panel re-fetches with the
  suggested card automatically.

## What was verified to work

- Full curated offline suite: `node tools/ci/run-offline-tests.js` → **2424 pass / 0 fail / 2
  skip** (skips are the two pre-existing "run locally without CI=1" network tests, unrelated).
  Added 3 new cases to `smoke-live-audio-pgm-screens.test.js` (unconfigured slot still falls back
  to the legacy blanket screens; an explicit empty selection routes nothing; an explicit
  selection routes only the chosen channel) and registered that file in the curated
  `tools/ci/run-offline-tests.js` FILES list — it existed but was never wired into the fast gate.
- `node tools/ci/check-max-file-lines.js` — no new files over the limit (pre-existing
  `scene-take-lbg.js` at 522 is untouched by this change).
- `npx eslint` on every touched file — 0 new errors; the 3 pre-existing warnings on
  `live-audio-mixer-modal.js`/`settings-alsa-mixer-panel.js` (unescaped `innerHTML` interpolation
  of static markup, one unrelated unused var) predate this change.
- `npm run build:client` — clean, no new warnings.
- Live-verified Bug 2's premise directly (read-only GET, no state changed): card 0 on this box
  really does expose two controls both named `Capture` and two both named `Input Source` — not a
  hypothetical.
- Live-verified Bug 1's fix loaded and behaving correctly after the owner approved a
  `highascg` restart: `GET /api/audio/live-inputs` shows slot 1 with
  `pgmChannels: [1, 3]` and matching `status.pgmRoutes` — i.e. since the owner has never yet
  saved through the per-slot buttons, the documented legacy fallback is exactly reproducing prior
  behavior (nothing broke on restart). Did **not** exercise the "save with none checked → PGM
  routes actually clear" path live, since that would have cut real PGM audio output on this
  on-air box without the owner driving it — left for owner-QA via the actual UI.

## Owner-QA still needed

1. Open Live Audio Mixer, deselect all "PGM ch" buttons for the input, Save & Apply — confirm the
   route actually drops from both PGM channels (not just from the UI).
2. Confirm the ALSA mixer panel in Settings can now unmute/raise the capture control without a
   400, and lands on the right card automatically.
