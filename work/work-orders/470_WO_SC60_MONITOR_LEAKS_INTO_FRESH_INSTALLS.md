# WO-470 — This box's SC60 headset is committed as a monitor output and reaches other machines

**Status: DONE (2026-08-10 — committed default blanked, standing CI gate added; suite 1935/0/2). Owner action owed: re-seed the stick/bridge `configs/` copies, which still carry the old entry.**

**Source:** owner, 2026-08-10 — "i fucking told you to not hardcode the sc60 as a monitor. why is it
even in the fresh install on another machine." Seen on highascg7579 as Caspar
`Failed to find specified OpenAL output device` → `Failed to initialize audio device`.

## Investigation

`git show HEAD:config/audio_outputs.json` — **committed**, not merely a dirty working tree:

```json
{ "id": "audio_monitor_usb", "label": "Audio 2",
  "type": "system-audio", "deviceName": "sc60mon", "role": "monitor" }
```

[WO-425](./425_WO_monitor_output_generic_label.md) diagnosed this exact class — *"lived only in THIS
box's config … re-committed with the post-produce baseline"* — but its fix renamed only the label
(`USB headphones` → `Audio 2`) and states outright: *"Role/device (`system-audio` / `sc60mon`)
untouched."* So the machine-specific device survived the fix meant to remove it, and its smoke test
then **pinned that entry as required** (`assert.ok(mon, 'box config still has its monitor-role
output')`), locking the leak in.

Nothing gated it either: `npm run config:write-defaults` — the script that sets
`factoryConfig.audioOutputs = []` (`tools/ci/write-repo-default-config.js:117`) — is referenced only
in `package.json` as a manual command, nowhere in CI. So the live box's config kept being committed
over the factory default.

**Propagation vector, confirmed on the box** (not the ISO): `write-iso-default-config.js` deletes
every `config/*.json` except `casparcg.config.iso` and `exfat-sync.json`, and
`config/casparcg.config.iso` contains no `system-audio` block — so a clean ISO does not carry it.
The owner's diagnostic showed the entry arriving from the **operator stick and bridge**:

```
/home/casparcg/exfat/configs/audio_outputs.json      ← carries sc60
/home/casparcg/bridge/configs/audio_outputs.json     ← carries sc60
/home/casparcg/highascg/config/audio_outputs.json    mtime 17:48, boot was 17:16
```

i.e. applied ~32 minutes after boot by the config-apply, not shipped in the image. Those `configs/`
trees are snapshots of a box that had the headset.

The factory builder itself was already correct — verified directly:
`buildFactoryModularConfig()` emits no `audioOutputs` key and its full JSON contains no `sc60`.

## What was done

- `config/audio_outputs.json` → `[]`, matching the factory default (owner: "this is a dev box, so
  blanking configs is fine"). `config/device_graph.json` was checked and holds no matching
  `audio_monitor_usb` connector, so nothing is left dangling.
- New `tools/smoke/smoke-config-defaults-no-machine-audio.test.js` (curated `FILES`) — the standing
  gate WO-425 lacked. It asserts the factory builder emits no audio outputs, that
  `config/audio_outputs.json` ships empty (error message points at `config:write-defaults`), and
  generically that **no** committed `config/*.json` ships a `role:"monitor"` audio output — the
  monitor bus resolves by role at runtime (`monitor-bus.js`), so a shipped monitor entry can only be
  a box's own hardware leaking into the defaults. `sc60` is named explicitly so a re-commit fails
  loudly.
- `tools/smoke/smoke-wo425-427-audio-fps-decklink.test.js` — the assertion requiring the monitor
  entry to exist is superseded and now asserts the committed config ships **zero** audio outputs
  (stricter, not weaker). Any future shipped entry must still carry a generic `Audio N` label.

## What was VERIFIED to work

- `npm run test:ci` → **1935 tests, 1933 pass, 0 fail, 2 skipped** (WO-425's suite green against the
  superseding assertion). eslint 0 on all changed files. 0 files over 500 lines.
- The new gate fails loudly on re-commit: it rejects both a `role:"monitor"` entry and any `sc60`
  reference under `config/`.

## Owner action owed / still open

1. **The stick and bridge `configs/` copies still carry the old entry** — blanking the repo default
   does not rewrite them. Re-seed them, or the next insert re-applies `sc60mon` to whatever box
   receives it. This is the actual delivery path and is NOT closed by this WO.
2. Deeper fix not attempted here: Caspar throws rather than degrading when a configured
   `system-audio` device is absent. Skipping a `system-audio` consumer whose device is not present
   in the box's audio inventory would make any carried-over config portable, instead of relying on
   the defaults staying clean. Worth its own WO if the config-carrying workflow stays.
