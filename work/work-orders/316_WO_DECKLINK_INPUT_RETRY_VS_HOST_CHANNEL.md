# WO-316 — DeckLink input retry loop fails forever when the device is already open

**Status: FIXED 2026-07-21.** See "CORRECTED ROOT CAUSE" below — the live evidence did not
match the assumption this WO was written on, and the shipped fix is different (and smaller)
than the one originally proposed here. The original analysis is kept for the record.

## CORRECTED ROOT CAUSE (measured on the box, not inferred)

The device is NOT held by a different "host channel". It is held by **the target layer itself**.

`INFO 5` showed channel 5 layer 4 already running `producer=decklink`, `file.path=4`
(= device 4), `has_signal=false`. Meanwhile `PLAY 5-4 DECKLINK 4` — the same device, the same
channel-layer — failed every 20s with "Could not enable video input".

Ruled out at the same time: the running `casparcg.config` declares NO decklink consumers at
all, and channel 3's runtime output consumer is `<index>3</index>`, not 4. No other channel
ran a decklink producer. Nothing but 5-4 held device 4.

A card input can only be enabled once, and Caspar constructs the new producer BEFORE tearing
down the one already on the layer — so re-PLAYing a device the target layer already holds fails
deterministically, forever. The retry was fighting its own producer.

Why it entered the retry set at all: `has_signal=false`. The card is open and the SOURCE is
missing (nothing powered/cabled into it), which is a different operator problem from "the input
never opened" — and one that no amount of retrying can fix.

### What shipped
- `src/caspar/channel-info-xml.js`: `foregroundProducerOnLayer()` + `isDecklinkProducerForDevice()`
  read what is actually running on a layer. Unparseable INFO returns null = UNKNOWN, and callers
  must fall through to attempting the PLAY — never treat null as "already open".
- `src/config/routing-setup.js` `tryPlayDecklinkInput()`: checks BEFORE playing and, if the PLAY
  fails, re-checks after (race guard — something else may have opened it in between). Either way,
  a layer already holding the requested device is reported `alreadyOpen`, never `failed`, so it
  does not enter the retry set.
- Status carries `alreadyOpen` (with `hasSignal`) distinctly from a fresh PLAY, and logs
  "no signal: check the source is powered and cabled" when the card is open but dark.
- The transient classification is untouched: a genuinely un-openable input (source off, not
  cabled, profile conflict) still retries every 20s. That was the 2026-07-19 fix and must not
  regress.

7 tests in `tools/smoke/smoke-wo316-decklink-already-open.test.js`, built on the real INFO XML
shape captured from this build. Proven non-vacuous two ways: making the already-open check
always-false, and deleting the pre-PLAY check.

### Still open (deliberately not done)
The `route://` idea below is NOT needed for this fault and was not implemented. If a future
setup genuinely wants the same physical input on a second channel, route:// from the owning
channel-layer remains the right answer — but nothing on this box needs it today.

---

## ORIGINAL ANALYSIS (superseded — kept for the record)

**Source:** todos21.07.26 — "highascg peridically tries to play decklink input, its already
playing on the host channel and it wont be able to play anywhere else thats why it fails."
Log evidence: `work/work-orders/todos21.07.26-logs`.

## Verified facts (2026-07-21, live log + source read)

From the Caspar log: `PLAY 5-4 DECKLINK 4` fires at 15:49:40.796, 15:50:00.839, 15:50:20.886 —
a 20-second cadence — and every attempt throws
`DeckLink 8K Pro [4|1080p5000] Could not enable video input` (`EnableVideoInput` failed →
`404 PLAY FAILED`), dumping a full exception stack trace into the log each time. Meanwhile
`route://5-4` is consumed elsewhere (`LOADBG 3-10 route://5-4`), i.e. the system expects that
channel-layer to carry the input.

The 20 s cadence is `DECKLINK_INPUT_RETRY_MS = 20000` — this is the WO-53 dedicated-input-channel
retry loop in `src/config/routing-setup.js`:
- `setupInputsChannel` (line 27): one dedicated channel per DeckLink input; initial
  `tryPlayDecklinkInput` per device; failures go into `_decklinkInputsStatus.failed`.
- `tryPlayDecklinkInput` (line 83): sends a bare `PLAY ${channel}-${layer} DECKLINK ${device}`
  — no STOP first, and no check of whether the device is already claimed.
- `scheduleDecklinkInputRetries` (line 105): re-PLAYs every failed entry every 20 s, re-arming
  for as long as anything is failed. There is no terminal-failure classification at all.

The retry loop was made honest recently (the header comment at lines 76-79 records that
`404 PLAY FAILED` used to be pattern-matched as SUCCESS, hiding dead inputs) — that fix is
correct, but it exposed this case: **a DeckLink card input can only be enabled by ONE producer
process-wide.** When the same physical device is already producing on the host channel
(`src/config/host-live-sources.js` / `setupHostLiveSources`, which the log's working `route://5-4`
consumers corroborate), the dedicated-channel PLAY can NEVER succeed. The retry is not "waiting
for the camera to come back" — it is retrying a permanently impossible command every 20 s,
forever, filling the Caspar log with stack traces.

> Verify at pickup (5 min): confirm which subsystem currently owns the successful DECKLINK 4
> producer (host channel number from `getChannelMap`, `host-live-decklink.js` does
> STOP → MIXER CLEAR → PLAY on its own path) and that 5-4 is the dedicated input channel-layer
> for that device in the current channel map. The analysis above matches the log and source but
> the channel-ownership half comes from the owner's report.

## Fix direction

Two changes, both in `routing-setup.js` (+ whatever small ownership helper is needed):

1. **Don't double-open — route instead.** Before `PLAY ... DECKLINK <device>`, check whether
   that device already has a live producer on another of OUR channels (host channel map is
   config-derived; no probing needed). If it does, satisfy the dedicated input channel with
   `PLAY <ch>-<layer> route://<ownerCh>-<ownerLayer>` instead of opening the card again.
   route:// is exactly what it is for, and downstream consumers of the dedicated channel keep
   working unchanged. Log one info line saying the input is served by route from the host
   channel.
2. **Terminal-failure classification in the retry loop.** `scheduleDecklinkInputRetries` must
   distinguish "transient — camera off / not cabled, keep retrying" from "structural — device
   owned by another of our channels, or config conflict; retrying cannot ever succeed". A
   structural entry leaves the retry set (status shows it as `served_via_route` or
   `conflict`, not `retrying`) and is only re-evaluated on the next `setupInputsChannel` run
   (config apply / reconnect), not every 20 s.

Note `setupInputsChannel` already skips devices that collide with decklink OUTPUTS
(`outputDevices` set, line 47-57) — this WO adds the equivalent awareness for input-side
ownership, which it never had.

## Acceptance
- With the input live on the host channel: no `PLAY ... DECKLINK` retries in the Caspar log at
  all after boot settles; the dedicated channel carries the picture via route://; consumers of
  `route://<dedicated>` see the video.
- With the input genuinely dead (camera off, not claimed anywhere): behavior unchanged — retry
  every 20 s, recover automatically when the source returns (this path must not regress; it is
  the 2026-07-19 fix).
- `_decklinkInputsStatus` (GUI devices tab) reflects the three states distinctly:
  playing-direct / served-via-route / failed-retrying.
- Offline tests: ownership-check decision table, retry-loop classification (structural entries
  leave the set, transient ones stay), route-string construction. Extend
  `tools/smoke/smoke-decklink-input-retry.test.js`; `npm run test:ci` → 0 fail.

## Constraints
- LIVE box: coordinate any AMCP experiments with the owner; the input in question is on air via
  the host channel.
- Do not "fix" this by reverting the 404-is-failure classification — dead inputs must stay
  visible and retried.
