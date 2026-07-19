# WO-270 — Settings modal: screen labels + streaming channel move to the Devices tab

**Status:** Implemented (owner acceptance A270.1 pending)
**Priority:** MEDIUM (owner request 2026-07-18, chat: "in the defaults settings in the settings modal there are screen labels and streaming which should not be there — all of that should be available to set only from devices tab")

## Ground truth (verified 2026-07-18)
- Both sections lived in the `settings-pane-defaults` pane (`settings-modal-templates.js:118-172`): "Screen labels (WO-222)" (mount div + input listener in `settings-modal.js:277-294`) and the full "Streaming channel" form (collected in `buildSettingsPayload`, hydrated in `hydrateSettings`).
- Devices-tab coverage before this WO: streaming channel — YES (`device-view-inspector-stream.js` owns `streamingChannel`); screen labels — **NO editor anywhere else** (WO-222 only displays labels), so removal alone would have orphaned the feature.
- Latent bug found: `buildSettingsPayload` sent `operatorTools: { pointerConfineMultiview: false }` HARDCODED (no UI control exists for it anywhere) — every settings save forced pointer-confine off. Compounds with the settings-post rebuild bug fixed in WO-268.
- Dead code found: `mountScreenLabelsSection`/`saveChangedScreenLabels` were exported but `saveChangedScreenLabels` had no caller.

## Changes
- **T270.1 Devices tab gains the screen-label editor:** destination inspector (`device-view-destinations-inspector-form.js`) shows a "Screen label (S<n>)" input for `pgm_prv`/`pgm_only` destinations, keyed by `mainScreenIndex`, saving via the existing `POST /api/screens/label` (value from `currentSettings.channelMap.screenLabels` — verified present in the live `/api/settings` payload).
- **T270.2 Settings modal cleanup:** both sections removed from the defaults pane (replaced by a one-line pointer note); screen-label listener removed from `settings-modal.js`; streaming-channel collect + hydrate removed from `settings-modal-logic.js`; the clear-credentials confirm in `persistSettings` removed with its checkbox; dead label functions deleted; unused `api` import dropped. `operatorTools` is no longer sent by the modal at all — combined with WO-268's patch-only settings-post semantics, absent keys stay untouched server-side.
- **T270.3 smokes** — see `smoke-wo270-settings-devices-only.test.js` (curated gate): modal template carries neither `set-streaming-ch-` ids nor the labels mount; logic no longer collects `streamingChannel`/`operatorTools`; destination inspector has the label field wired to `/api/screens/label`; server inspector has the WO-268 CEF GPU checkbox.

## Constraints (standard)
Curated gate ONLY, node --check + repo eslint, <500 lines/file, honest checkboxes. Client changes need `npm run build:client` (orchestrator/owner) to reach dist-web.

- [x] T270.1 screen-label editor in destination inspector
- [x] T270.2 settings modal cleanup (markup + collect + hydrate + dead code)
- [x] T270.3 smokes in curated gate
- [ ] A270.1 (owner) after rebuild: defaults pane shows only the pointer note; editing a screen label in the Devices destination inspector renames S1/S2 across looks/multiview/panels; streaming channel still fully editable via the stream output inspector; saving any setting no longer resets pointer-confine/streaming values

## Work log

**2026-07-18 — implemented** (same session as WO-267/268/269; see those for the related operatorTools server fixes).
