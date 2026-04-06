'use strict'

/**
 * AMCP BEGIN … COMMIT batching for CasparCG Server (see AMCP wiki “Batching Commands”).
 * All sends still go through the connection’s _amcpSendQueue so ordering matches single-command mode.
 */

const MAX_BATCH_COMMANDS = 96

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
	if (/^CALL\b/i.test(s) || /^CG\b/i.test(s)) return false
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
function runBeginCommitBatch(client, lines) {
	const connection = client._context
	const payload = ['BEGIN', ...lines, 'COMMIT'].join('\r\n') + '\r\n'
	/** @type {{ lines: string[], timeout: ReturnType<typeof setTimeout>, onLine: (line: string) => void } | null} */
	let drainRef = null
	/** @type {((reason?: Error) => void) | null} */
	let rejectP = null
	const p = new Promise((resolve, reject) => {
		rejectP = reject
		const drain = {
			lines: [],
			timeout: setTimeout(() => {
				if (connection._amcpBatchDrain === drain) connection._amcpBatchDrain = null
				reject(new Error('AMCP batch timeout'))
			}, 20000),
			/** @param {string} line */
			onLine(line) {
				this.lines.push(line)
				if (/\bCOMMIT\b/i.test(line) && /\bOK\b/i.test(line)) {
					clearTimeout(this.timeout)
					if (connection._amcpBatchDrain === drain) connection._amcpBatchDrain = null
					resolve({
						ok: true,
						batched: true,
						rawLines: this.lines.slice(),
						innerCount: lines.length,
					})
				}
			},
		}
		drainRef = drain
	})
	connection._amcpSendQueue = (connection._amcpSendQueue || Promise.resolve())
		.then(() => {
			try {
				if (!connection.socket || !connection.socket.isConnected) {
					throw new Error('Not connected')
				}
				if (!drainRef) throw new Error('AMCP batch: internal error')
				connection._amcpBatchDrain = drainRef
				connection.socket.send(payload)
				return p
			} catch (e) {
				if (rejectP) rejectP(e instanceof Error ? e : new Error(String(e)))
				throw e
			}
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
	 * @param {{ force?: boolean }} [opts] - force: use BEGIN…COMMIT even when amcp_batch is off
	 * @returns {Promise<object>}
	 */
	batchSend(commandLines, opts = {}) {
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
		if (clean.length > MAX_BATCH_COMMANDS) {
			return Promise.reject(new Error(`batch: max ${MAX_BATCH_COMMANDS} commands`))
		}

		const useBatch = clean.length > 1 && (opts.force === true || connection.config?.amcp_batch === true)
		if (!useBatch) {
			return sequentialRaw(clean, client)
		}

		return runBeginCommitBatch(client, clean).catch((e) => {
			if (typeof connection.log === 'function') {
				connection.log('debug', 'AMCP batch: ' + (e?.message || e) + ' — falling back to sequential')
			}
			return sequentialRaw(clean, client)
		})
	}
}

module.exports = {
	AmcpBatch,
	validateBatchLine,
	MAX_BATCH_COMMANDS,
}
