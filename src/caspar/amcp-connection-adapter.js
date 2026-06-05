'use strict'

/**
 * Map library-deserialized `response.data` to HighAsCG `{ ok, data: string|string[] }`.
 * @param {unknown} data
 * @returns {string|string[]|undefined}
 */
function normalizeResponseData(data) {
	if (data === undefined || data === null) return undefined
	if (Array.isArray(data)) {
		if (data.length === 0) return []
		if (typeof data[0] === 'string') return data
		return data.map((row) => (typeof row === 'string' ? row : JSON.stringify(row)))
	}
	if (typeof data === 'object') {
		const d = /** @type {{ fullVersion?: string, version?: number|string }} */ (data)
		if (typeof d.fullVersion === 'string') return d.fullVersion
		if (d.version !== undefined && d.version !== null) return String(d.version)
		return JSON.stringify(data)
	}
	return String(data)
}

/**
 * Adapter between casparcg-connection (npm) and HighAsCG's AmcpClient.
 * Replaces TcpClient + AmcpProtocol for transport and response parsing.
 */
class AmcpConnectionAdapter {
	/**
	 * @param {import('casparcg-connection').CasparCG} ccgInstance
	 * @param {{ log?: (level: string, msg: string) => void }} [opts]
	 */
	constructor(ccgInstance, opts = {}) {
		this.ccg = ccgInstance
		this._log = opts.log || (() => {})
		/**
		 * When false (default), HighAsCG sends plain AMCP lines on the TCP socket and parses
		 * standard `202 … OK` replies via {@link AmcpProtocol}. CasparCG Server rejects the
		 * npm library's `REQ <id> …` prefix with `400 ERROR` on most builds.
		 */
		this.useLibraryTyped = opts.useLibraryTyped === true
	}

	get isConnected() {
		return this.ccg.connected
	}

	_socket() {
		return this.ccg?._connection?._socket || null
	}

	/**
	 * Write plain AMCP to the TCP socket (no REQ/RES prefix).
	 * Single commands get `\r\n`; multi-line BEGIN…COMMIT payloads are written as-is.
	 * @param {string} data
	 */
	send(data) {
		let payload = String(data)
		if (!payload.trim()) return
		if (!payload.endsWith('\r\n')) {
			payload = payload.trimEnd() + '\r\n'
		}
		const socket = this._socket()
		if (!socket) {
			this._log('error', 'Cannot send AMCP: library socket not available')
			return
		}
		socket.write(payload)
	}

	/**
	 * Normalize library SendResult to HighAsCG { ok, data } shape.
	 * @param {import('casparcg-connection').SendResult<any>} sendResult
	 * @returns {Promise<{ ok: boolean, data?: string|string[] }>}
	 */
	async normalizeResponse(sendResult) {
		// Library shape: { error?, request: Promise<Response<T>> }
		if (sendResult.error) {
			return { ok: false, data: sendResult.error.message || String(sendResult.error) }
		}

		if (!sendResult.request) {
			return { ok: false, data: 'No request promise returned from library' }
		}

		try {
			const response = await sendResult.request
			
			// Response shape: { reqId, command, responseCode, data, type, message }
			// HighAsCG expects { ok: boolean, data?: string|string[] }

			if (response.responseCode >= 400) {
				return { ok: false, data: response.message }
			}

			// If the raw response gave us multiple lines, or a string
			// We try to return it in the format HighAsCG expects for raw().
			// Note: The library deserializers might parse data into objects.
			// When using sendCustom(), the library does NOT deserialize because the command is Commands.Custom.
			// Let's verify this, but typically raw response lines are in response.data as string array.
			const normalized = normalizeResponseData(response.data)
			if (normalized !== undefined) {
				return { ok: true, data: normalized }
			}
			
			// OK, but no data (e.g., 202)
			return { ok: true, data: `${response.responseCode} ${response.command} OK` }

		} catch (error) {
			return { ok: false, data: error.message || String(error) }
		}
	}
}

module.exports = { AmcpConnectionAdapter }
