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
 * @returns {Promise<{ ok: boolean, batched: boolean, responses: object[] }>}
 */
function sequentialRaw(lines, client) {
	return lines
		.reduce((acc, line) => {
			const key = line.trim().split(/\s+/)[0].toUpperCase()
			return acc.then((responses) => client._send(line, key).then((r) => [...responses, r]))
		}, Promise.resolve(/** @type {object[]} */ ([])))
		.then((responses) => ({ ok: true, batched: false, responses }))
}

/**
 * @param {import('./amcp-client').AmcpClient} client
 * @param {string[]} lines
 * @returns {Promise<{ ok: boolean, batched: boolean, rawLines: string[], innerCount: number }>}
 */
/**
 * True when this line is the **AMCP batch** closing ack (second status token is `COMMIT`).
 * Examples: `202 COMMIT OK`, `RES uid 202 COMMIT OK`.
 * Per-command replies are `202 MIXER OK`, `202 PLAY OK`, etc. — those are **not** batch completion.
 * Do not match on a bare `COMMIT` substring (avoids confusion with mixer-related text).
 * @param {string} line
 */
function isBatchCommitAckLine(line) {
	const s = String(line).trim()
	if (!s) return false
	// After optional REQ id tokens: `<code> COMMIT` must be the AMCP status word (not `202 MIXER …`).
	return /^(\S+\s+)*2\d{2}\s+COMMIT(\s|$)/i.test(s)
}

/**
 * @param {{ skipMixerPreCommit?: boolean }} [options]
 */
function runBeginCommitBatch(client, lines, options) {
	const skipMixerPreCommit = options?.skipMixerPreCommit === true
	const connection = client._context
	const payload = ['BEGIN', ...lines, 'COMMIT'].join('\r\n') + '\r\n'
	/** @type {{ lines: string[], onLine: (line: string) => void, rejectBatch: (err: Error) => void } | null} */
	let drainRef = null
	/** @type {((reason?: Error) => void) | null} */
	let rejectP = null
	const p = new Promise((resolve, reject) => {
		rejectP = reject
		const drain = {
			lines: [],
			/** @param {string} line */
			onLine(line) {
				this.lines.push(line)
				if (isBatchCommitAckLine(line)) {
					if (connection._amcpBatchDrain === drain) connection._amcpBatchDrain = null
					if (typeof connection.log === 'function') {
						connection.log(
							'debug',
							`AMCP ← BEGIN…COMMIT OK (${lines.length} cmd${lines.length === 1 ? '' : 's'})`,
						)
					}
					resolve({
						ok: true,
						batched: true,
						rawLines: this.lines.slice(),
						innerCount: lines.length,
					})
				}
			},
			/** @param {Error} err */
			rejectBatch(err) {
				if (connection._amcpBatchDrain === drain) connection._amcpBatchDrain = null
				rejectP(err instanceof Error ? err : new Error(String(err)))
			},
		}
		drainRef = drain
	})
	// Mixer COMMIT must not use client.mixerCommit() here: that calls _send, which appends to
	// _amcpSendQueue behind the pending batch job — deadlock (mixer never sends, batch never completes).
	const ch = inferProgramChannelFromAmcpLines(lines)
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
			connection.socket.send(payload)
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
	 * @param {{ skipMixerPreCommit?: boolean }} [options] - when true, do not send `MIXER <ch> COMMIT` before this batch (see file header)
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
		const useBatch = clean.length >= 2 && isAmcpBatchEnabled(connection)
		if (!useBatch) {
			return sequentialRaw(clean, client)
		}

		return runBeginCommitBatch(client, clean, options).catch((e) => {
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
			return Promise.resolve({ ok: true, batched: false, responses: [] })
		}
		const maxCmd = resolveMaxBatchCommands(this._client._context)
		/** @type {object | null} */
		let last = null
		let chain = Promise.resolve()
		for (let i = 0; i < clean.length; i += maxCmd) {
			const chunk = clean.slice(i, i + maxCmd)
			chain = chain.then(async () => {
				last = await this.batchSend(chunk, options)
			})
		}
		return chain.then(() => last || { ok: true, batched: false, responses: [] })
	}
}

module.exports = {
	AmcpBatch,
	validateBatchLine,
	isAmcpBatchEnabled,
	isMixerCommitBeforeAmcpBatchEnabled,
	inferProgramChannelFromAmcpLines,
	resolveMaxBatchCommands,
	MAX_BATCH_COMMANDS,
	/** @public One AMCP line at a time (no BEGIN…COMMIT chunking). Used for PIP overlay CG+MIXER blocks — see {@link sendPipOverlayLinesSerial}. */
	sendAmcpLinesSequential: sequentialRaw,
}
