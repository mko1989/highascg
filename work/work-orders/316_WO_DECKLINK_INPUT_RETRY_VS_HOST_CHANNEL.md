# WO-316 — DeckLink input retry loop fails forever when the device is already open on the host channel

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
