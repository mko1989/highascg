'use strict'

/**
 * AMCP BEGIN … COMMIT batching for CasparCG Server (see AMCP wiki “Batching Commands”).
 * All sends still go through the connection’s _amcpSendQueue so ordering matches single-command mode.
 *
 * Large batches have been associated with server instability / stack issues on some Caspar builds.
 * Batching is **opt-in** via `config.amcp_batch` (boolean true, or `"true"` / `1`). Otherwise commands are sent sequentially.
 *
 * **Chunk size** — {@link resolveMaxBatchCommands}: default **64** commands per BEGIN…COMMIT; maximum **512**.
 * Set `config.amcp_max_batch_commands` or env `HIGHASCG_AMCP_MAX_BATCH`. Larger chunks mean fewer TCP round-trips.
 *
 * **Caspar `MIXER <channel> COMMIT`** cannot appear inside a BEGIN…COMMIT batch ({@link validateBatchLine}). When
 * {@link isMixerCommitBeforeAmcpBatchEnabled} is true (default), we send one `MIXER <ch> COMMIT` immediately **before**
 * mixer-only AMCP batches (BEGIN…lines…COMMIT) so deferred mixer state is flushed before those lines run.
 * Batches that include **`CG`** (PIP borders, multiview chrome, etc.) **skip** that pre-flush so channel mixer state
 * is not committed between content setup and overlay CG+MIXER — the take path ends with its own `mixerCommit`.
 *
 * **Look takes** (`scene-take-lbg`) send many `MIXER … DEFER` lines then one channel `COMMIT`. Chunked batches
 * must not inject a pre-flush `MIXER <ch> COMMIT` between chunks — that would apply a subset of DEFER lines early.
 * Use {@link AmcpBatch#batchSendChunked} with `{ skipMixerPreCommit: true }` for those sequences.
 *
 * **Inner failures** (WO-281 4.1) - `amcp-protocol.handleLine` hands every line to the batch drain and
 * returns *before* its error-classification switch, so a `404`/`5xx` on one command inside BEGIN...COMMIT
 * used to produce no log, no rejection and no GUI signal (a look silently recalling all-but-one layer).
 * {@link extractBatchFailures} now reads the drained lines, and every batch result carries
 * `failures: [{ code, line, command }]`, `benignFailures` (optional-REMOVE misses) and `okAll`.
 *
 * `ok` deliberately stays **transport-level** - true whenever the batch framed and the `2xx COMMIT` ack
 * arrived - because callers treat a false/rejected result as "fall back or abort", and a partially-applied
 * take must still finish its remaining phases and trailing `MIXER <ch> COMMIT`. Read `okAll`/`failures`
 * for the per-command verdict.
 */

/** @deprecated Use {@link resolveMaxBatchCommands} — kept for static imports that need a default cap. */
const MAX_BATCH_COMMANDS = 64

const DEFAULT_MAX_BATCH_COMMANDS = 64
const MAX_BATCH_ABS_MIN = 1
const MAX_BATCH_ABS_MAX = 512

/**
 * @param {{ config?: { amcp_max_batch_commands?: unknown } } | null | undefined} connection
 * @returns {number}
 */
function resolveMaxBatchCommands(connection) {
	const cfg = connection?.config?.amcp_max_batch_commands
	if (typeof cfg === 'number' && Number.isFinite(cfg)) {
		const n = Math.floor(cfg)
		if (n >= MAX_BATCH_ABS_MIN && n <= MAX_BATCH_ABS_MAX) return n
	}
	if (cfg != null && cfg !== '') {
		const n = parseInt(String(cfg), 10)
		if (Number.isFinite(n) && n >= MAX_BATCH_ABS_MIN && n <= MAX_BATCH_ABS_MAX) return n
	}
	const raw = process.env.HIGHASCG_AMCP_MAX_BATCH
	if (raw !== undefined && raw !== '') {
		const n = parseInt(String(raw), 10)
		if (Number.isFinite(n) && n >= MAX_BATCH_ABS_MIN && n <= MAX_BATCH_ABS_MAX) return n
	}
	return DEFAULT_MAX_BATCH_COMMANDS
}

/**
 * @param {{ config?: { amcp_batch?: unknown } } | null | undefined} connection
 * @returns {boolean}
 */
function isAmcpBatchEnabled(connection) {
	const v = connection?.config?.amcp_batch
	return v === true || v === 'true' || v === 1
}

/**
 * When true (default), send Caspar `MIXER <channel> COMMIT` immediately before **mixer-only** BEGIN…COMMIT batches
 * (batches with no `CG` lines). Set `config.amcp_mixer_commit_before_amcp_batch` to false to disable entirely.
 * @param {{ config?: { amcp_mixer_commit_before_amcp_batch?: unknown } } | null | undefined} connection
 */
function isMixerCommitBeforeAmcpBatchEnabled(connection) {
	const v = connection?.config?.amcp_mixer_commit_before_amcp_batch
	if (v === false || v === 'false' || v === 0) return false
	return true
}

/**
 * WO-259: take-scoped two-phase BEGIN…COMMIT batching for the live take pipeline (default **true** —
 * owner-requested behavior). Explicit `config.take_two_phase_batch === false` restores the pre-WO-259
 * per-command sequential/staggered AMCP line sequence with zero further code changes (instant rollback).
 * Independent of the global {@link isAmcpBatchEnabled} flag — see {@link AmcpBatch#batchSend}'s
 * `forceBatch` option, which lets take-scoped callers force a BEGIN…COMMIT batch without flipping
 * `config.amcp_batch` (which still gates every other AMCP caller in the app).
 * @param {{ config?: { take_two_phase_batch?: unknown } } | null | undefined} connection
 * @returns {boolean}
 */
function isTakeTwoPhaseBatchEnabled(connection) {
	const v = connection?.config?.take_two_phase_batch
	if (v === false || v === 'false' || v === 0) return false
	return true
}

/**
 * Infer video channel number from the first MIXER/CG/PLAY/… line (`channel-layer` form).
 * @param {string[]} lines
 * @returns {number | null}
 */
function inferProgramChannelFromAmcpLines(lines) {
	for (const l of lines) {
		const s = String(l).trim()
		if (!s) continue
		const m = s.match(/^(?:MIXER|CG|PLAY|STOP|LOADBG|LOAD|PAUSE|RESUME|CLEAR|SWAP)\s+(\d+)-/i)
		if (m) {
			const ch = parseInt(m[1], 10)
			return Number.isFinite(ch) && ch >= 1 ? ch : null
		}
	}
	return null
}

/**
 * True if the batch payload includes any `CG …` line (templates / PIP borders / multiview overlay).
 * Pre-batch {@link isMixerCommitBeforeAmcpBatchEnabled} channel COMMIT must not run before these batches:
 * it would apply deferred mixer from the take before CG ADD + overlay MIXER, misaligning borders vs video.
 * @param {string[]} lines
 */
function batchIncludesCgCommand(lines) {
	for (const l of lines) {
		if (/^CG\s/i.test(String(l).trim())) return true
	}
	return false
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function validateBatchLine(line) {
	const s = String(line).trim()
	if (!s || s.length > 12000) return false
	const first = s.split(/\s+/)[0].toUpperCase()
	if (['BEGIN', 'COMMIT', 'DISCARD', 'REQ', 'INFO', 'DATA', 'THUMBNAIL', 'CLS', 'CINF', 'TLS', 'VERSION'].includes(first)) {
		return false
	}
	/** @see scenes-preview-runtime — channel-level mixer commit must be sent outside BEGIN…COMMIT batches. */
	if (/^MIXER\s+\d+\s+COMMIT\b/i.test(s)) return false
	if (/^CALL\b/i.test(s)) return false
	if (/^CG\b/i.test(s)) return true
	return /^(MIXER|PLAY|STOP|PAUSE|RESUME|LOADBG|LOAD|CLEAR|SWAP|ADD|REMOVE)\b/i.test(s)
}

/**
 * @param {string[]} lines
 * @param {import('./amcp-client').AmcpClient} client
 * @returns {Promise<{ ok: boolean, okAll: boolean, batched: boolean, responses: object[], failures: BatchFailure[] }>}
 */
function sequentialRaw(lines, client) {
	return lines
		.reduce((acc, line) => {
			const key = line.trim().split(/\s+/)[0].toUpperCase()
			return acc.then((responses) => client._send(line, key).then((r) => [...responses, r]))
		}, Promise.resolve(/** @type {object[]} */ ([])))
		// Sequential sends are already classified + logged per line by amcp-protocol's error switch
		// (a failing `_send` rejects), so `failures` is structurally empty here — present only so
		// callers can read the same field regardless of which transport ran.
		.then((responses) => ({ ok: true, okAll: true, batched: false, responses, failures: [] }))
}

const {
	isBatchCommitAckLine,
	parseBatchStatusLine,
	extractBatchFailures,
} = require('./amcp-batch-failures')

/**
 * @param {{ skipMixerPreCommit?: boolean }} [options]
 */
function runBeginCommitBatch(client, lines, options) {
	const skipMixerPreCommit = options?.skipMixerPreCommit === true
	const connection = client._context
	const ch = inferProgramChannelFromAmcpLines(lines)
	try {
		const { shouldFollowerSkipLocalPgmAmcp } = require('../replication/amcp-fanout')
		if (ch != null && shouldFollowerSkipLocalPgmAmcp(connection, ch, { previewOnly: false })) {
			if (typeof connection.log === 'function') {
				connection.log(
					'debug',
					`[replication] skip local PGM AMCP batch ch=${ch} (${lines.length} cmds, leader fan-out drives air)`,
				)
			}
			return Promise.resolve({ ok: true, okAll: true, batched: true, skipped: true, responses: [], failures: [] })
		}
	} catch {
		/* replication optional */
	}
	const payload = ['BEGIN', ...lines, 'COMMIT'].join('\r\n') + '\r\n'
	/** @type {{ lines: string[], onLine: (line: string) => void, rejectBatch: (err: Error) => void } | null} */
	let drainRef = null
	/** @type {((reason?: Error) => void) | null} */
	let rejectP = null
	/** @type {ReturnType<typeof setTimeout> | null} */
	let drainTimeout = null
	const clearDrainTimeout = () => {
		if (drainTimeout) {
			clearTimeout(drainTimeout)
			drainTimeout = null
		}
	}
	const p = new Promise((resolve, reject) => {
		rejectP = reject
		const drain = {
			lines: [],
			/** @param {string} line */
			onLine(line) {
				this.lines.push(line)
				if (isBatchCommitAckLine(line)) {
					clearDrainTimeout()
					if (connection._amcpBatchDrain === drain) connection._amcpBatchDrain = null
					const rawLines = this.lines.slice()
					const { failures, benign } = extractBatchFailures(rawLines, lines)
					/* WO-360: a take (or other flow) can arm a sink to COLLECT inner failures —
					 * the log lines below were the only trace, invisible to the operator. */
					if (Array.isArray(connection._batchFailureSink) && failures.length > 0) {
						connection._batchFailureSink.push(...failures)
					}
					if (typeof connection.log === 'function') {
						// One line per failure, carrying the offending command and Caspar's own status line.
						// Before WO-281 §4.1 these were invisible: the drain short-circuits amcp-protocol's
						// error-classification switch, so a failed layer inside a take batch left no trace.
						for (const f of failures) {
							connection.log(
								'error',
								`AMCP batch: command failed inside BEGIN…COMMIT — ${f.command ? `cmd="${f.command}" ` : ''}reply="${f.line}"`,
							)
						}
						if (benign.length > 0) {
							// Aggregated on purpose: optional-REMOVE teardown misses are expected, and one line
							// per absent consumer per batch would be pure noise (WO-281 §1 pattern #7).
							connection.log(
								'warn',
								`AMCP batch: ${benign.length} optional REMOVE miss(es) inside BEGIN…COMMIT (consumer absent — benign)`,
							)
						}
						connection.log(
							'debug',
							failures.length > 0
								? `AMCP ← BEGIN…COMMIT committed with ${failures.length} failed command(s) (${lines.length} cmd${lines.length === 1 ? '' : 's'})`
								: `AMCP ← BEGIN…COMMIT OK (${lines.length} cmd${lines.length === 1 ? '' : 's'})`,
						)
					}
					resolve({
						// `ok` stays transport-level ("the batch framed and committed") — see the module header
						// for why it is not flipped on inner failures. `okAll` is the per-command verdict.
						ok: true,
						okAll: failures.length === 0,
						batched: true,
						rawLines,
						innerCount: lines.length,
						failures,
						benignFailures: benign,
					})
				}
			},
			/** @param {Error} err */
			rejectBatch(err) {
				clearDrainTimeout()
				if (connection._amcpBatchDrain === drain) connection._amcpBatchDrain = null
				rejectP(err instanceof Error ? err : new Error(String(err)))
			},
		}
		drainRef = drain
	})
	// Mixer COMMIT must not use client.mixerCommit() here: that calls _send, which appends to
	// _amcpSendQueue behind the pending batch job — deadlock (mixer never sends, batch never completes).
	const tail = connection._amcpSendQueue || Promise.resolve()
	let chain = tail
	if (
		!skipMixerPreCommit &&
		isMixerCommitBeforeAmcpBatchEnabled(connection) &&
		ch != null &&
		ch >= 1 &&
		!batchIncludesCgCommand(lines)
	) {
		chain = client._sendAfter(chain, `MIXER ${ch} COMMIT`, 'MIXER')
	}

	connection._amcpSendQueue = chain
		.then(() => {
			if (!connection.socket || !connection.socket.isConnected) {
				throw new Error('Not connected')
			}
			if (!drainRef) throw new Error('AMCP batch: internal error')

			connection._amcpBatchDrain = drainRef
			if (typeof connection.log === 'function') {
				connection.log('debug', `AMCP → BEGIN…COMMIT (${lines.length} cmd${lines.length === 1 ? '' : 's'})`)
			}
			// A drain with no timeout is a wedge: if the `2xx COMMIT` ack never arrives (command
			// error inside the transaction, ack format drift), the stale drain swallows EVERY
			// subsequent response line and each queued single burns its full timeout — the
			// 2026-07-19 "GUI actions fire minutes late" incident. Bound it like single sends.
			const { resolveSendTimeoutMs } = require('./amcp-client-static')
			const batchTimeoutMs = resolveSendTimeoutMs('COMMIT')
			drainTimeout = setTimeout(() => {
				drainTimeout = null
				if (connection._amcpBatchDrain !== drainRef) return
				connection._amcpBatchDrain = null
				const got = drainRef ? drainRef.lines.length : 0
				if (typeof connection.log === 'function') {
					connection.log(
						'warn',
						`AMCP batch COMMIT ack timeout (${batchTimeoutMs}ms): ${lines.length} cmds sent, ${got} response line(s) drained — clearing stale batch drain`,
					)
				}
				connection._amcpSendQueue = Promise.resolve()
				const err = new Error(`AMCP batch COMMIT ack timeout (${lines.length} cmds)`)
				/* Review 03.08 engine §3: the payload had already hit the socket when this timer
				 * armed — Caspar very likely executed the transaction and only the ack was lost/
				 * late (exactly the 2026-07-19 ack-drift incident). Callers must NOT replay. */
				err.amcpPayloadSent = true
				if (rejectP) rejectP(err)
			}, batchTimeoutMs)
			connection.socket.send(payload)
			try {
				const { fanoutBatchPayload } = require('../replication/amcp-fanout')
				fanoutBatchPayload(payload)
			} catch {
				/* replication optional */
			}
			return p
		})
		.catch((e) => {
			if (rejectP) rejectP(e instanceof Error ? e : new Error(String(e)))
		})
		.catch(() => {})
	return p
}

class AmcpBatch {
	/**
	 * @param {import('./amcp-client').AmcpClient} client
	 */
	constructor(client) {
		this._client = client
	}

	begin() {
		return this._client._send('BEGIN', 'BEGIN')
	}

	commit() {
		return this._client._send('COMMIT', 'COMMIT')
	}

	discard() {
		return this._client._send('DISCARD', 'DISCARD')
	}

	/**
	 * @param {string[]} commandLines - raw AMCP lines (no BEGIN/COMMIT)
	 * @param {{ skipMixerPreCommit?: boolean, forceBatch?: boolean }} [options] - `skipMixerPreCommit`: when true, do not send `MIXER <ch> COMMIT` before this batch (see file header).
	 *   `forceBatch` (WO-259): force a BEGIN…COMMIT batch for this call regardless of the global `config.amcp_batch`
	 *   flag — take-scoped opt-in, does not affect any other caller. Still subject to the same 2+ line / size-cap rules.
	 * @returns {Promise<object>}
	 */
	batchSend(commandLines, options) {
		const client = this._client
		const connection = client._context
		const clean = []
		for (const l of commandLines) {
			const t = String(l).trim()
			if (t) clean.push(t)
		}
		for (const l of clean) {
			if (!validateBatchLine(l)) {
				return Promise.reject(new Error(`batch: disallowed or unsupported command: ${l.slice(0, 100)}`))
			}
		}
		const maxCmd = resolveMaxBatchCommands(connection)
		if (clean.length > maxCmd) {
			return Promise.reject(new Error(`batch: max ${maxCmd} commands`))
		}

		// Multi-command BEGIN…COMMIT expects per-command 202 lines then a final `202 COMMIT OK` (see
		// {@link isBatchCommitAckLine}). A single AMCP line has one `202 <CMD> OK` reply and no separate
		// batch COMMIT ack on some paths — wrapping it in BEGIN…COMMIT then waiting for `202 COMMIT OK`
		// never completes. Send one-command chunks with normal `_send` (same as non-batch mode).
		const forceBatch = options?.forceBatch === true
		const useBatch = clean.length >= 2 && (isAmcpBatchEnabled(connection) || forceBatch)
		if (!useBatch) {
			return sequentialRaw(clean, client)
		}

		return runBeginCommitBatch(client, clean, options).catch((e) => {
			/* Review 03.08 engine §3: a COMMIT-ack timeout fires AFTER the payload was written —
			 * the commands very likely ran inside Caspar, and replaying them sequentially
			 * double-executes on air (every PLAY restarts its clip from frame 0 mid-transition,
			 * without transaction atomicity). Only failures raised BEFORE the socket write
			 * (not connected, validation) are safe to retry sequentially. */
			if (e && e.amcpPayloadSent === true) {
				if (typeof connection.log === 'function') {
					connection.log('warn', 'AMCP batch: ' + (e?.message || e) + ' — NOT resending (payload already sent; a replay would double-execute)')
				}
				return Promise.reject(e)
			}
			if (typeof connection.log === 'function') {
				connection.log('debug', 'AMCP batch: ' + (e?.message || e) + ' — falling back to sequential')
			}
			return sequentialRaw(clean, client)
		})
	}

	/**
	 * Split long command lists into {@link resolveMaxBatchCommands}-sized slices (each slice is one BEGIN…COMMIT or sequential block).
	 * Prefer this over {@link #batchSend} when the total line count may exceed the AMCP batch limit.
	 * @param {string[]} commandLines
	 * @param {{ skipMixerPreCommit?: boolean }} [options] - passed to each {@link #batchSend} chunk
	 * @returns {Promise<object>} Last chunk result (same shape as {@link #batchSend})
	 */
	batchSendChunked(commandLines, options) {
		const clean = []
		for (const l of commandLines) {
			const t = String(l).trim()
			if (t) clean.push(t)
		}
		if (clean.length === 0) {
			return Promise.resolve({ ok: true, okAll: true, batched: false, responses: [], failures: [] })
		}
		const maxCmd = resolveMaxBatchCommands(this._client._context)
		/** @type {object | null} */
		let last = null
		// WO-281 4.1: only the LAST chunk's result is returned, so failures from earlier chunks would
		// be dropped on the floor. Accumulate across every chunk instead.
		/** @type {BatchFailure[]} */
		const failures = []
		/** @type {BatchFailure[]} */
		const benignFailures = []
		let chain = Promise.resolve()
		for (let i = 0; i < clean.length; i += maxCmd) {
			const chunk = clean.slice(i, i + maxCmd)
			chain = chain.then(async () => {
				last = await this.batchSend(chunk, options)
				const r = /** @type {{ failures?: BatchFailure[], benignFailures?: BatchFailure[] }} */ (last || {})
				if (Array.isArray(r.failures)) failures.push(...r.failures)
				if (Array.isArray(r.benignFailures)) benignFailures.push(...r.benignFailures)
			})
		}
		return chain.then(() => ({
			...(last || { ok: true, batched: false, responses: [] }),
			okAll: failures.length === 0,
			failures,
			benignFailures,
		}))
	}
}

module.exports = {
	AmcpBatch,
	validateBatchLine,
	isAmcpBatchEnabled,
	isMixerCommitBeforeAmcpBatchEnabled,
	isTakeTwoPhaseBatchEnabled,
	inferProgramChannelFromAmcpLines,
	resolveMaxBatchCommands,
	MAX_BATCH_COMMANDS,
	/** @public One AMCP line at a time (no BEGIN…COMMIT chunking). Used for PIP overlay CG+MIXER blocks — see {@link sendPipOverlayLinesSerial}. */
	sendAmcpLinesSequential: sequentialRaw,
	/** @internal exported for the batch-drain-timeout smoke test only */
	runBeginCommitBatch,
	isBatchCommitAckLine,
	/** @internal exported for the WO-281 4.1 batch-failure tests */
	parseBatchStatusLine,
	extractBatchFailures,
}
