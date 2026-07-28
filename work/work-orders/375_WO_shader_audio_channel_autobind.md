# WO-375 — "audio reactive" was a flag that bound nothing: four shaders wore the ♪ badge and could not react

**Status: DONE (28.07.26 — measured, fixed in both the store and the runtime, live-verified).**

Source: `work/work-orders/todos28.07.26`, owner line added 28.07:

> when audio reactive is ticked on a shader audio must be chosen in image iCh0.

## 1. Investigation

Two independent things carried the word "audio" and nothing connected them:

- **The flag.** `client/components/shader-fx-modal.js:139` collects
  `audio: { enabled: el('shaderfx-audio').checked }`. That is all the checkbox does.
- **The binding.** `template/shaders/player.js` creates the 512×2 audio texture only when
  `usesAudioChannel()` is true — i.e. when some pass actually maps a channel to `'audio'`, which
  the operator has to set in a *separate* per-pass iChannel select.

Tick the box, forget the select, and the shader is **silently not reactive at all** — while the
library list still renders its ♪ badge (`shader-fx-modal.js` list item: `s.audio ? ' ♪' : ''`), so
the UI actively claims the opposite.

Measured across the exported library on this box — shaders with `audio.enabled: true` and no pass
binding `'audio'` anywhere:

```
sh-balatro.html   audio=ON  channels=[]  -> NOT REACTIVE
sh-console.html   audio=ON  channels=[]  -> NOT REACTIVE
sh-test.html      audio=ON  channels=[]  -> NOT REACTIVE
sh-wavy.html      audio=ON  channels=[]  -> NOT REACTIVE
```

Four shaders, including `sh-test` — the one WO-266 shipped as the reference example.

## 2. What was done

The flag now *means* something, in two places:

1. **`src/shaderfx/shader-store.js` `normalizeShaderConfig()`** — if audio is enabled and no pass
   binds `'audio'`, bind it to the first FREE image channel (iChannel0 first). Applies to every
   save, and therefore to every export.
2. **`template/shaders/player.js` `ensureAudioChannelBinding()`** — the same rule at load time,
   run before `usesAudioChannel()`. This is what makes the owner's **already-exported** shaders
   work: `player.js` is shared and loaded fresh by every `sh-*.html`, so the four above start
   reacting on their next load with **no re-export and no rewrite of the box-owned shader store**
   (WO-368: that library is single-copy right now — bulk-rewriting it would be the wrong move).

Two rules it deliberately follows:

- **Never displaces an existing binding.** A buffer wired to iChannel0 stays; audio takes the next
  free slot.
- **Never silently rewires a full config.** If all four image channels are occupied, the config is
  left exactly as-is rather than evicting something the author chose.

## 3. What was VERIFIED

- **Live, in a real page load:** `sh-balatro` — stored as `channels: []` — reports
  `{"audio":true,"imageChannels":["audio",null,null,null]}` after load, read back out of
  `window.__SHADERFX_CONFIG__` in headless Chrome against the live server. `sh-fft-test` likewise.
  No file was rewritten to achieve it.
- New smoke `tools/smoke/smoke-shader-alpha-and-audio-binding.test.js` (8 tests, curated FILES
  list) covers all five cases of the store rule: bind when unbound, take the first free slot,
  leave it alone when a buffer already owns it, do nothing when audio is off, and leave a
  fully-occupied config untouched. Plus source pins that the runtime half runs *before*
  `usesAudioChannel()` and does not displace bindings.
- Full suite green (see the batch commit).

## 4. Follow-up worth considering (not done)

The modal still lets the two controls disagree until save: ticking the box does not visibly move
the iChannel0 select, so the operator sees the old (empty) value until the shader is reloaded from
the server. The behaviour is now correct either way, but reflecting the auto-binding in the select
the moment the box is ticked would make the UI honest at the point of the decision. Small,
client-only.
