# WO-244 — Settings save must not wipe stored stream credentials (preserve-on-empty + mask-on-get)

**Status:** OPEN
**Priority:** HIGH (data loss on live box already happened 2026-07-15; also a secret-exposure issue)
**Owner check:** A244.1

## Incident evidence

- 2026-07-15 15:42:43 — full apply (`POST /api/caspar-config/apply`, live UI client, journal `[Caspar config] Full apply starting`) flushed in-memory config to `config/streaming_channel.json`, writing `rtmpServerUrl: ""` and `streamKey: ""` over the stored YouTube credentials.
- The in-memory wipe happened earlier: live probe `GET /api/settings` shows `streamKey: ""` in memory, while disk (pre-apply, recoverable via `git diff config/streaming_channel.json`) still had the key.
- Root cause: `src/api/settings-post.js:199-221` — when a settings payload contains a `streamingChannel` object, the section is **rebuilt from scratch**; lines 217-218 coerce absent/empty values to `''`:
  ```js
  rtmpServerUrl: String(s.rtmpServerUrl ?? '').trim(),
  streamKey: String(s.streamKey ?? '').trim(),
  ```
  Any tab (esp. a stale one loaded before the key was entered) that saves settings silently destroys the credential.
- Secondary issue: `src/api/settings-get.js:59` returns the **real** `streamKey` to every client on the LAN — it should never round-trip to browsers at all.

## Fix design

**T244.1 — preserve-on-empty (server, `src/api/settings-post.js`)**
In the `settings.streamingChannel` block: after computing the incoming trimmed values, if `streamKey` (resp. `rtmpServerUrl`) is `''` and the current `ctx.configManager.get().streamingChannel` has a non-empty value, keep the current value. An explicit clear is only honored when the payload sets `streamingChannel.clearCredentials === true` (boolean, also accept `'true'`), which clears **both** fields to `''`.

**T244.2 — never send the secret to clients (server, `src/api/settings-get.js`)**
In the settings GET payload, replace `streamingChannel.streamKey` with `''` and add `streamingChannel.hasStreamKey: true|false` (non-empty stored value). `rtmpServerUrl` is not a secret — keep returning it (T244.1 still protects it from empty-overwrite). `hasStreamKey` must be stripped on save (it is not a config field — ensure settings-post ignores it, which it does by rebuilding the section).

**T244.3 — UI affordance (client, streaming settings section — find the streamKey input, likely `client/components/settings-modal-*.js`, grep `streamKey`)**
- When `hasStreamKey` is true and the input is empty, show placeholder text `saved — leave blank to keep` (placeholder attribute, not a value).
- Add a small "Clear credentials" button/checkbox next to the key field that sets `clearCredentials: true` on the next save payload (with a confirm()).
- Do NOT prefill the input with the masked/real key.

**T244.4 — smoke test (`tools/smoke/smoke-wo244-stream-secret-preserve.test.js`, add to curated gate FILES list in `tools/ci/run-offline-tests.js`)**
Pure-function level: exercise the settings-post streamingChannel handling (require the module or extract-and-test the merge behavior with a stub ctx/configManager):
1. save with empty streamKey + existing non-empty → preserved;
2. save with new non-empty value → replaced;
3. save with `clearCredentials: true` + empty → cleared;
4. settings-get: response carries `streamKey: ''` + `hasStreamKey: true` when config has a key.
NO live server, NO AMCP, NO writes outside tmpdir. Follow the stub patterns used by existing `tools/smoke/smoke-wo2xx-*.test.js` files.

## Explicitly out of scope (noted as follow-ups)
- The generic stale-tab clobber (booleans like `screen_3_operator_monitor`, `multiview_always_on_top` flipped by an old tab whose keys win the merge). Real fix is a config revision / If-Match check on settings + apply POSTs → candidate WO-245, not this WO.
- Restoring the lost values on this box: owner decision (values recoverable from git). **Owner note:** the old stream key exists in git history of this repo — recommend rotating it at YouTube regardless of restore.

## Constraints (standard)
- No git operations, no service restarts, no AMCP, no `npx vite build` (orchestrator runs it).
- Verify with `node --check`, `./node_modules/.bin/eslint --quiet <files>`, `node tools/ci/run-offline-tests.js` (curated gate ONLY — never the full suite).
- Check checkboxes in this WO only for work actually shipped; note deviations honestly.

## Tasks
- [x] T244.1 preserve-on-empty + clearCredentials in settings-post.js
- [x] T244.2 mask streamKey + hasStreamKey in settings-get.js
- [x] T244.3 UI placeholder + Clear credentials control
- [x] T244.4 smoke test wired into curated gate
- [ ] A244.1 (owner) decide restore vs rotate; hard-reload all tabs after deploy
