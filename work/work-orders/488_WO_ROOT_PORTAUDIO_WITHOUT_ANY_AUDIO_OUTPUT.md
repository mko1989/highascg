# WO-488 — a root `<portaudio>` block on a box with no audio outputs

**Status: DONE (11.08.2026, verified: new smoke 4/4, suite 1976/1974 pass/0 fail/2 skip)**

## 1. Investigation

Owner 11.08: *"even though my config has no audio outputs at the top of the caspar config there is a
portaudio called to existance."*

`buildCustomLiveRootXml()` (`config-generator-audio-xml.js`) gated the root block on:

```js
if (globalPa && countPortAudioConsumers(config) <= 1) { … emit <portaudio> … }
```

`<= 1` also catches **zero**. The root block exists to hold the settings of *the* single global
PortAudio consumer — when there is exactly one, its per-consumer element is emitted empty
(`<portaudio/>`) and the settings live at the root. With no consumers at all there is nothing to
configure, yet Caspar was still handed a `<portaudio>` block and opened a device nobody asked for.

Newly relevant: a fresh box now ships **zero** audio outputs by default (WO-468/470/473), so the
zero case went from unusual to normal in the same session.

## 2. What was done

The gate is now `countPortAudioConsumers(config) === 1` — exactly one, not "at most one". Two or
more still fall through to per-consumer settings, and `caspar_global_portaudio: false` still emits
nothing, both unchanged.

`<system-audio>` at the root is left alone: it names the default OpenAL device (empty element =
system default) rather than instantiating a consumer, and the owner's report was specifically about
PortAudio. Worth a look if OpenAL ever turns out to open a device on its own.

## 3. What was verified

- `tools/smoke/smoke-no-root-portaudio-without-consumers.test.js` (curated list) — 4/4: zero
  consumers emit no block; one keeps the root settings block with its device name; two or more keep
  per-consumer settings; the flag off never emits.
- Suite **1976 tests, 1974 pass, 0 fail, 2 skip**.

**Not verified live:** not deployed. Owner QA: re-apply the config on a box with no audio outputs —
`<portaudio>` should be gone from the top of `casparcg.config`.
