# WO-476 — every fill-only DeckLink output asks the card for an external keyer

**Status: OPEN (11.08.2026 — diagnosed and proven from source; the fix needs a CasparCG rebuild,
owner decision pending)**

## 1. Investigation

Owner 11.08, on highascg0916 (192.168.0.28): *"there should be no keyer on decklink outputs 1 and 2."*

Every boot, on every run, the Caspar log carries:

```
DeckLink 8K Pro [1-1|2160p5000] Failed to enable external keyer.
DeckLink 8K Pro [1-1|2160p5000] && DeckLink 8K Pro [2|2160p5000] Failed to enable external keyer.
```

**Nobody asked for a keyer.** The config HighAsCG generates and the config Caspar actually loaded
(read back from the startup echo in the log) both say:

```xml
<decklink>
   <video-mode>2160p5000</video-mode>
   <keyer>default</keyer>
   <device>1</device>
   <ports><port><device>2</device><video-mode>2160p5000</video-mode></port></ports>
</decklink>
```

`default` is what this repo writes for a **fill-only** SDI output. From
[src/config/decklink-key-fill.js:22](../../src/config/decklink-key-fill.js#L22):

```js
const KEYER_VALUES = new Set(['internal', 'external', 'external_separate_device', 'default'])
/** Caspar fill-only SDI: no hardware keyer (not internal/external). */
const FILL_ONLY_KEYER = 'default'
```

`resolveDecklinkConsumerKeyer()` returns `default` whenever there is no separate key device, which
is the case here (`decklink_key_device = 0`).

**That assumption is false for our binary.** The deployed server is `2.6.0 253c16c Dev`, and
`253c16c3c` is a real commit in `~/caspar-build/src-tree`. At that commit — and still at the tree's
HEAD — the enum is:

```cpp
// src/modules/decklink/consumer/config.h:73
enum class keyer_t
{
    internal_keyer,
    external_keyer,
    default_keyer = external_keyer     // ← "default" IS external
};
```

`config.cpp:158` parses `<keyer>` and only recognises `external`, `internal` and
`external_separate_device`; **everything else — including `default` and an absent element — lands on
`default_keyer`, which is an alias for `external_keyer`.** `set_keyer()` then takes the
`else if (keyer == external_keyer)` branch, queries `BMDDeckLinkSupportsExternalKeying`, gets FALSE
on the 8K Pro, and logs the error.

So **there is no "off" value**: with this build, every fill-only DeckLink output HighAsCG emits is
asking the card to switch on external keying. The upstream keying-support pre-check
(`cd8b7f602`, confirmed an ancestor of our commit) does not save us here — it only bails when
`DoesSupportVideoMode(..., bmdSupportedVideoModeKeying, ...)` says the MODE cannot key; that
returned supported, and the per-flag external-keying capability is what actually failed.

**Why this is worth fixing beyond log noise.** On the 8K Pro the request fails, so the keyer never
engages — cosmetic. On any DeckLink that DOES report external-keying support, the same config
**succeeds silently**: a fill-only SDI output comes up with a hardware keyer enabled, keying the
programme against whatever is on the card's input. Nothing in the GUI would say so.

**Not the crash.** These errors appear on every boot including the runs that survived and the one
currently up, so they are unrelated to the restart loop investigated alongside this (Caspar exiting
20–60s after a clean start, no shutdown line, no exception).

## 2. What the fix has to be

Not expressible in config — the parser has no value that means "leave the keyer alone". The fix is
in our CasparCG fork:

- Give `default_keyer` its own enumerator instead of aliasing `external_keyer`, so `set_keyer()`
  falls through both branches and touches nothing (optionally `decklink_keyer->Disable()` once,
  explicitly). Accept `none`/`off` as spellings of it in `config.cpp` for clarity.
- `internal` and `external` keep working exactly as today — they are the only ways to get a keyer,
  which is what the operator's Key/Fill tickbox already means.
- The generator then needs no change: `FILL_ONLY_KEYER = 'default'` becomes true rather than
  aspirational. Its comment should cite this WO so the next reader does not re-derive it.

Cost: a CasparCG rebuild plus a binary swap on each box — hence OPEN pending the owner's call, not
done unilaterally on a live playout machine.

Interim, if a box ships a DeckLink that *does* support external keying and shows a keyed fill
output, the only lever available today is to give that output a real key device (making the keying
intentional) or to stop routing it through DeckLink.

## 3. What was verified

- Config Caspar actually loaded on .28 read back from its own startup echo (`<keyer>default</keyer>`),
  not just from `/api/caspar-config/generate` — they agree.
- `git cat-file -t 253c16c` in `~/caspar-build/src-tree`: the deployed binary's commit is in the
  tree, so the source read is the source built.
- `enum class keyer_t { …, default_keyer = external_keyer }` confirmed both at `253c16c3c` and at
  the tree's HEAD (`b96e58d60`).
- `git merge-base --is-ancestor cd8b7f602 253c16c3c` → true: the keying-support pre-check is in the
  deployed build, so the error path taken is the capability flag, not the mode check.
- Timeline check across seven server starts: the keyer errors fire on every run regardless of how
  long that run survived — they are not the crash.
