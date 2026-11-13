# WO-1055 — LTC in / out Device: a dropdown of the box's sound cards instead of a text box

**Area:** audio, godot-client
**Status: IN PROGRESS (13.11 — built; smoke 3/3 + Godot test; owner check of the dropdown pending)**

Owner, 13.11, while setting up LTC out through the Focusrite Scarlett Solo: *"there is also an input box for the device
instead of a drop down"*.

## Investigation

- `godot/client/features/settings/ltc_pane.gd` (WO-974) bound `ltc.input.device` / `ltc.output.device` to `f.text(...)` with
  placeholders `plughw:2,0` / `plughw:3,0`. The owner had to know ALSA names.
- `GET /api/audio/devices` exists but is **playback only** (`aplay -l` / `-L` plus PipeWire) and has a 30 s cache. LTC in needs
  the **capture** cards (`arecord -l`).
- Card numbers are not stable: the Scarlett Solo is card 4 today (`aplay -l`), and a USB replug can renumber it. ALSA's card
  id (`USB` here) is stable, so `plughw:CARD=USB,DEV=0` is the safe value. `plughw` converts format and channel count, which
  LTC's `aplay` (S16_LE 48 kHz) needs on the Scarlett (S32_LE only).
- At the time, the Scarlett's playback side was free (`/proc/asound/card4/stream0` Playback: Stop). LTC out was enabled with an
  empty device ("no output device chosen").

## What was done

- `src/audio/audio-devices.js`:
  - `parseAlsaCardList(text)` turns `card N: <id> [<name>], device D: … [<what>]` lines into
    `{value: "plughw:CARD=<id>,DEV=<D>", label: "<name> — <what>", card, device}`.
  - `listAlsaCards(dir, run?)` reads `arecord -l` for capture and `aplay -l` for playback. If the tool is missing it returns
    an empty list. It is uncached; the pane asks once.
- `src/api/routes-audio.js` + `src/api/router.js`: `GET /api/audio/alsa-cards?dir=capture|playback`. The API contract doc was
  regenerated.
- `godot/client/features/settings/ltc_model.gd`: `device_items(cards, current)` lists None first, then the cards. A stored device
  that isn't connected stays listed as "… (not connected)", so saving never quietly changes it. `index_of(items, value, cards)`
  matches a stored `plughw:4,0` / `hw:4,0` to the card listed as card 4 device 0.
- `ltc_pane.gd` `_device()`: both Device rows are now `f.option` dropdowns. The cards are fetched once when the pane first
  hydrates. Picking a card stores its stable `plughw:CARD=…` value.

## What was verified

- On the box: `listAlsaCards('playback')` lists `plughw:CARD=USB,DEV=0` "Scarlett Solo USB — USB Audio".
  `listAlsaCards('capture')` lists PCH 0 / PCH 2 / Lync / Scarlett.
- `tools/smoke/smoke-wo1055-alsa-cards.test.js` (curated in `offline-test-files-3.js`): 3/3 (parser, direction + missing tool,
  route registered + handled).
- Godot: `tests/test_ltc_pane.gd test_device_items`, full-suite results in the commit.
