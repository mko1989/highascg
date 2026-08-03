# Codebase review 2026-08-03 — engine, state, caspar (AMCP), OSC, autofollow

Read-only review wave (7 reviewers over the full repo), owner-requested full codebase review (todos03.08.26).
Scope: src/engine, src/state, src/caspar, src/osc, src/autofollow (+take entry points in src/api for concurrency context).

Verification status: findings #1, #2, #4 independently re-verified in source by the coordinating
session (param() lacks CR/LF handling + raw-string passthrough at scene-template-cg.js:102;
bare `catch (_) {}` on the Phase-B PLAY/crossfade block; `healthy` negation wraps the GOOD
condition at osc-state.js:131). Others are the reviewer's source-verified claims.

Covered in full: the AMCP transport/protocol/batch/escaping stack (`src/caspar/*` core files), OSC ingest (`osc-listener`, `osc-float-endian`, `osc-state*`, `osc-variables`, `osc-config`), the take pipeline (`scene-take-lbg*` incl. jobs/pipeline/batch/teardown/exit-fade, `scene-route-deps`, `scene-transition`), state (`state-manager`, `live-scene-state`, `live-scene-reconcile`, `playback-tracker*`), `clip-end-fade`, `loop-restart-watchdog`, `screen-timers`, autofollow (skeleton), plus take entry points in `src/api/routes-scene-take.js`/`routes-project.js`; skimmed/skipped: `timeline-playback*` internals, `multiview-*`/`pip-overlay*` detail, `project-*` modules, `scene-take-pgm-only`/playlist internals.

### 1. [HIGH] `param()` does not escape CR/LF — user template data with a newline breaks AMCP framing (injection)

`src/caspar/amcp-utils.js:11`

```js
function param(str) {
	if (str == null || str === '') return ''
	const s = String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
	return /\s/.test(s) ? `"${s}"` : s
}
```

`param()` escapes backslash and quote but not `\r`/`\n`. The sibling `dataStore()` in `src/caspar/amcp-data.js:17` explicitly rewrites `\r\n`/`\r`/`\n` to `\\n` — proof this hazard is known, but every other path skips it. Raw strings reach `param()` unmodified via `src/engine/scene-template-cg.js:102` (`if (typeof raw === 'string') return raw` from `layer.cgData ?? layer.templateData ?? layer.source?.data ?? layer.params`) into `CG … ADD/UPDATE 0 ${param(dataStr)}` (lines 141–151), and via the generic passthrough `b.data` in `src/api/routes-cg.js:26`. Failure: a look layer whose data field contains a literal newline (pretty-printed JSON, multi-line text) produces a command whose CRLF splits mid-string — Caspar executes a truncated `CG ADD`, and the remainder of the payload is parsed as a *new AMCP line* (executed if it starts with a verb, otherwise "Protocol out of sync" and a desynced response stream where subsequent callbacks mis-pair). Inside a BEGIN…COMMIT batch the extra line also shifts the reply-to-command mapping in `extractBatchFailures`.

### 2. [HIGH] Take PLAY/crossfade phase errors swallowed with zero logging — teardown then blacks the channel

`src/engine/scene-take-lbg-amcp-pipeline.js:277-338`

```js
		try {
			if (crossfadeLines.length > 0 && takeJobs.length === 0) {
				...
			} else {
				await sendPhasedTakePlays(amcp, channel, takeJobs, self, { twoPhaseBatch })
			}
		} catch (_) {}
```

The entire Phase-B block — the PLAYs that put the incoming look on air, the crossfade opacity batch, and the `MIXER <ch> COMMIT`s — is wrapped in a bare `catch (_) {}` with no log line. If it throws (batch COMMIT-ack timeout, "Not connected", per-command timeout), `fadeClockRef.start` stays null, so `runSceneTakeLbgTeardown` (`scene-take-lbg-teardown.js:68-69`) computes `teardownWait = 0` and immediately `STOP`/`MIXER CLEAR`s every exiting layer. Failure scenario: one wedged AMCP response during a take → outgoing look torn down instantly, incoming look never played → black program output with *no* diagnostic anywhere (contrast every other phase in this file, which logs its failures).

### 3. [MED] Batch COMMIT-ack timeout falls back to re-sending all commands sequentially — double execution on air

`src/caspar/amcp-batch.js:386-391`

```js
		return runBeginCommitBatch(client, clean, options).catch((e) => {
			...
			return sequentialRaw(clean, client)
		})
```

The `.catch` cannot distinguish "batch never reached the socket" (safe to retry) from "payload was written but the `2xx COMMIT` ack timed out" (`drainTimeout` path, `amcp-batch.js:301-314`). In the second case the commands very likely executed inside Caspar; the fallback then replays every line one-by-one. Failure: a slow COMMIT ack during a take (Caspar busy opening a heavy producer) → all PLAYs of the look run a second time — clips visibly restart from frame 0 mid-transition, deferred MIXER lines re-queue, and the second pass runs *without* transaction atomicity.

### 4. [MED] Channel profiler `healthy` flag is inverted

`src/osc/osc-state.js:131`

```js
const healthy = !(Number.isFinite(actual) && Number.isFinite(expected) && expected > 0 && actual <= expected * 1.05)
```

`/channel/N/profiler/time` is `[actual frame time, expected frame time]`; keeping up means `actual <= expected`. The negation is placed around the *good* condition, so a channel meeting its frame budget reports `healthy=false`, and a channel overrunning (dropping frames) reports `healthy=true`. Consumed at `src/osc/osc-variables.js:128-129` as the operator-visible `profiler_ch{N}_healthy` variable. The smoke test (`tools/smoke/smoke-wo401-perf-first-wave.test.js:125-127`, args `[10, 20]` → "sets healthy=false") pins the inverted behavior rather than validating it. Failure: monitoring shows "unhealthy" during normal operation and "healthy" exactly when the channel is dropping frames — a masked real incident on a live box.

### 5. [MED] `.../background/type` OSC corrupts foreground layer state; dedicated handler is unreachable

`src/osc/osc-state-layer.js:86-88, 100-113`

```js
		if (tail.startsWith('background/')) {
			return this._routeLayer(ch, layerId, tail.slice('background/'.length), vals, 'background')
		}
		...
		if (tail === 'time') { ... } else if (tail === 'type') {
			const t = vals[0] != null ? String(vals[0]) : 'empty'
			let changed = layer.type !== t
			layer.type = t
			if (t === 'empty') { ... layer.file = {} ... }
		} ... else if (tail === 'background/type') {   // ← dead: recursion above consumed it
```

A `stage/layer/N/background/type` message recurses with `tail='type'`, `fileTarget='background'` — but the `'type'` branch ignores `fileTarget` and writes `layer.type` (foreground) and, for `"empty"`, wipes `layer.file`, `layer.backgroundFile`, *and* `layer.template`. The explicit `tail === 'background/type'` branch at line 113 can never match. Failure (old-lineage binary that emits `background/type`): every "background empty" tick flags the foreground as empty and clears its file timing — the exact "every layer looks empty" symptom class documented for WO-235. Latent on the current 2.6-dev binary (which emits `background/producer`, handled correctly), but it's a loaded trap for the dual-lineage support this file explicitly promises.

### 6. [MED] Sync-push and replication mirror bypass the per-channel take serialization

`src/api/routes-project.js:113-121`

```js
			await runSceneTakeLbg(ctx.amcp, {
				channel,
				self: ctx,
				currentScene: null, // Force full refresh
				incomingScene: entry.scene,
				forceCut: true,
			})
```

Normal takes are serialized per channel through `ctx._sceneTakeChainByChannel` (`routes-scene-take.js:353-357`, `routes-scene-shared.js:50-54`) — precisely because two concurrent `runSceneTakeLbg` on one channel race the A/B bank pointer. `handleSyncPush` (above) and `src/replication/mirror-apply.js:117` call `runSceneTakeLbg` directly. Failure: operator hits Sync-Push while a crossfade take is mid-flight (takes span seconds: shader warm-up sleep, `teardownWait`); both takes read `programLayerBankByChannel` before either flips it (`scene-take-lbg.js:66`, flip at `:386-388`), the second stages onto the bank the first is vacating — split-brain content vs. mixer state, orphaned producers left on air.

### 7. [LOW] Reconcile clears live scene without awaiting the serialized write before broadcasting

`src/state/live-scene-reconcile.js:195, 217`

```js
					liveSceneState.clearChannel(ch)   // returns a promise (runSerialized) — not awaited
					...
	if (anyCleared) liveSceneState.broadcastSceneLive(self)
```

`clearChannel` queues its persistence write in `runSerialized`; `broadcastSceneLive` reads `getAll()` synchronously afterward and can broadcast the *stale* (uncleared) map. This is the exact ordering class fixed for `setChannel` in WO-341 ("MUST be awaited", `routes-scene-take.js:187-190`). Failure: after a Caspar restart the reconcile clears a channel but every client still shows the dead look as live until the next unrelated broadcast.

### 8. [LOW] Batch-drain line handler unprotected in the non-legacy socket feed

`src/caspar/connection-manager.js:159-161`

```js
			if (this._context._amcpBatchDrain) {
				this._context._amcpBatchDrain.onLine(line)
			} else if (this._protocol) {
```

`AmcpProtocol.handleLine` wraps the same `drain.onLine` call in try/catch (`amcp-protocol.js:117-123`); `_feedPlainAmcpSocketData` — the path actually live on this box (non-legacy transport) — does not. `onLine` runs `extractBatchFailures` plus arbitrary `connection.log` callbacks on the COMMIT-ack line; a throw there propagates into the library's patched `_processIncomingData` and aborts the remaining lines of that TCP chunk — dropped responses, desynced callback queue, and the drain left installed (the every-command-times-out wedge the drain timeout was built to prevent).

### 9. [LOW] Screen timer re-assign to a screen whose channel changed orphans the old CG on air

`src/engine/screen-timers.js:118-141, 168-172`

```js
		if (record && record.screens && record.screens[String(screenIdx)]) {
			const existing = record.screens[String(screenIdx)]
			if (existing.channel === channel) { ...update path... }
		}
		// falls through: allocates a new slot, then:
		record.screens[String(screenIdx)] = { channel, layer, visible: true }
```

When a timer is already assigned to `screenIdx` but the screen now maps to a different Caspar channel, the code falls through to allocation and *overwrites* the screen entry without emitting `CG <oldChannel>-<oldLayer> CLEAR`. Failure: after a routing/screen remap, re-assigning the timer leaves the old channel's countdown CG playing forever in the 980-band (which the look/orphan sweeps deliberately never touch — file header contract), with no registry record pointing at it, so even `unassignTimer` can't remove it.

### 10. [LOW] Clip-end fade: failed commit after opacity-0 leaves an invisible-but-playing layer (audio ghost)

`src/engine/clip-end-fade.js:199-207`

```js
			await amcp.mixerOpacity(channel, physLayer, 0, fadeFrames)
			await amcp.mixerCommit(channel)
		} catch (e) {
			this._log('warn', `[ClipEndFade] fade command failed ${key}: ${e?.message || e}`)
			this._pending.delete(key)
			return
		}
```

If `mixerOpacity` succeeded but `mixerCommit` (or a response timeout on either) rejects, the entry is deleted and the cleanup `STOP`/`MIXER CLEAR` timer is never scheduled — yet the opacity-0 fade may already be live on the layer. `MIXER OPACITY` does not gate audio: the producer keeps playing (and looping clips keep sounding) on an invisible layer until the next take happens to hit that physical slot. A one-off AMCP timeout at exactly clip-end converts a cosmetic fade into a persistent audio ghost.

---

**Overall health.** This is an unusually well-documented codebase for its size — nearly every non-obvious branch carries a WO-referenced rationale, escaping/teardown/bank contracts are written down where they're enforced, and the batch/drain machinery has real wedge-recovery paths (stale-drain clearing, drain timeouts, callback rejection on disconnect) that clearly came from live incidents. The send queue's synchronous read-modify-write discipline is sound, OSC parsing is defensive (endian voting, sanity clamps, prune/decay), and resource lifecycle (timers, intervals, listeners) is consistently cleaned up. The residual risk concentrates in three themes: silent `catch (_) {}` swallowing in the most safety-critical take phase (finding 2 — the single change to prioritize on a live box, since it converts recoverable faults into undiagnosable black-outs), retry logic that can't tell "never sent" from "sent, ack lost" (finding 3), and the one systematic gap in an otherwise careful escaping story (finding 1). The inverted profiler flag (finding 4) is trivially fixable but worth doing before it miscolors a real performance incident.
