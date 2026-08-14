# WO-539 — The operator-GUI stream's `fps` option is accepted, announced to the client, and never encoded

**Status: OPEN — proved, and marked in code. NOT fixed: both candidate fixes change a live consumer, and which one is right is the owner's call (§4).**
**Priority:** Medium (latent today — every channel on this box is 50, which is also the default)
**Source:** found while auditing the 218 lint warnings for real faults rather than tidiness (WO-538 §7.1)
**Related:** WO-406 (the 25-vs-50 rate mismatch that really did chop audio here), WO-367 (same
thesis: unused code is usually a symptom)

---

## 1. The chain, end to end

```
gui-stream-ingest.js:112     const fps = opts.fps ?? DEFAULT_FPS
gui-stream-ingest.js:141     args: { scale, bitrateKbps, fps, gop }        → threaded in
gui-stream-nvenc-args.js:98  const fps = clampInt(opts.fps, 1, 120, …)     → clamped
gui-stream-nvenc-args.js:107 const parts = [ … ]                           → NEVER USED
```

The built command, asked for 25 fps:

```
-filter:v format=yuv420p -codec:v h264_nvenc -preset:v p1 -tune:v ull
-b:v 8000k -g:v 12 -filter:a … -codec:a aac -b:a 128k -format mpegts
```

No `-r:v`, no `-framerate`. The consumer inherits the Caspar channel's rate, and the option is inert.

## 2. Why it is worth a WO rather than a deletion

The other end of the same feature **does** act on it:

```js
// gui-stream-ws-relay.js:119 — the first message the browser gets
{ type: 'gui_stream_config', codec, fps: opts.fps ?? 50, gop }
```

So the client is *told* a framerate that the encoder was never configured for. Today both are 50
(`DEFAULT_FPS = 50`, and `channelResolutionsByChannel` reports 50 on all six channels), so the lie is
invisible. The day a channel runs at another rate — or someone passes `fps` expecting it to work —
the browser decodes against a declared rate the stream does not have.

This box has already lost time to exactly this class of fault: WO-406, where a monitor bus at 25
against a 50 Hz main produced a real audible chop.

## 3. What was done here

Nothing behavioural. The local is renamed `_fps` (so it stops consuming one of the 218 lint
warnings) with a comment naming this WO, so the next person to sweep unused variables does not
delete the only in-code trace of an unimplemented option.

## 4. The decision the owner needs to make

**A. Emit it** — add `-r:v ${fps}` to `parts`. Correct if the option is meant to work, and makes the
relay's handshake honest. It is a behaviour change on the operator-GUI encode path, which carries
three hard-won traps already documented in that file ("TRAP 1/2/3"), so it wants a look at the GUI
stream after the change.

**B. Drop it** — remove the option from `buildGuiStreamNvencArgs`, from `gui-stream-ingest`'s
threading, and make the relay announce the channel's real rate instead of `opts.fps ?? 50`. Correct
if the consumer should always inherit the channel, which is arguably the safer default on a box where
rate-matching is the rule.

B is the smaller on-air risk; A is what the API currently promises. Not guessing between them.

## 5. Work log

- 2026-08-14 — Found by checking the "assigned but never used" lint warnings for genuine faults
  instead of clearing them in bulk. Of the plausible candidates only this one was real: the AMCP
  transport's unused `p` is redundant (its `execute` returns `p` on every path), the two `labelY`
  cases sit under commented-out `fillText` calls, and `publish-modal`'s discarded `await fetch` is a
  deliberate reachability probe. Marked in code; the fix is the owner's choice.
