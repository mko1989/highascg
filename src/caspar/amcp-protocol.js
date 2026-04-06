'use strict'

/** @see companion-module-casparcg-server/src/tcp.js */
const ACMP_STATE = { NEXT: 0, SINGLE_LINE: 1, MULTI_LINE: 2 }

const RETCODE = {
	INFO: 100,
	INFODATA: 101,
	OKMULTIDATA: 200,
	OKDATA: 201,
	OK: 202,
	COMMAND_UNKNOWN_DATA: 400,
	INVALID_CHANNEL: 401,
	PARAMETER_MISSING: 402,
	PARAMETER_ILLEGAL: 403,
	MEDIAFILE_NOT_FOUND: 404,
	INTERNAL_SERVER_ERROR_DATA: 500,
	INTERNAL_SERVER_ERROR: 501,
	MEDIAFILE_UNREADABLE: 502,
	ACCESS_ERROR: 503,
}

function swapObj(obj) {
	const ret = {}
	for (const key in obj) ret[obj[key]] = key
	return ret
}
const RETCODE2TYPE = swapObj(RETCODE)

/**
 * Mutable callback queue context (same shape as legacy module instance fields).
 * @typedef {object} AmcpConnectionContext
 * @property {import('./tcp-client').TcpClient} [socket]
 * @property {Record<string, Array<((err: Error|null, line?: string) => void) | ((line: string) => void) | ((lines: string[]) => void)>>} response_callback
 * @property {string|undefined} [_pendingResponseKey]
 * @property {{ onLine: (line: string) => void } | null | undefined} [_amcpBatchDrain]
 * @property {Promise<void>} [_amcpSendQueue]
 * @property {(() => void) | undefined} [runCommandQueue]
 * @property {{ amcp_batch?: boolean }} [config]
 * @property {(level: string, msg: string) => void} [log]
 */

/**
 * AMCP response state machine + callback dispatch (no TCP, no Companion).
 * Feed one CRLF-stripped line at a time from {@link TcpClient} `data` events.
 */
class AmcpProtocol {
	/**
	 * @param {{ log?: (level: string, msg: string) => void, context: AmcpProtocolContext }} options
	 */
	constructor(options) {
		this.log = options.log || ((level, msg) => level === 'error' && console.error(msg))
		/** @type {AmcpConnectionContext} */
		this._ctx = options.context
		this._amcpState = ACMP_STATE.NEXT
		/** @type {number|undefined} */
		this._errorCode = undefined
		/** @type {string[]} */
		this._multilineData = []
		/** @type {string} */
		this._responseCurrent = ''
	}

	/** Call when TCP reconnects so parser state does not span connections */
	reset() {
		this._amcpState = ACMP_STATE.NEXT
		this._errorCode = undefined
		this._multilineData = []
		this._responseCurrent = ''
	}

	/**
	 * @param {string} line - One AMCP line without trailing CRLF
	 */
	handleLine(line) {
		const self = this._ctx
		if (self._amcpBatchDrain && typeof self._amcpBatchDrain.onLine === 'function') {
			try {
				self._amcpBatchDrain.onLine(line)
			} catch (e) {
				this.log('error', 'AMCP batch drain: ' + (e?.message || e))
				self._amcpBatchDrain = null
			}
			return
		}

		let error = false
		if (this._amcpState === ACMP_STATE.NEXT) {
			const codeMatch = line.match(/^(\d+)\s+(\S*)/)
			let status
			if (codeMatch && codeMatch.length > 1) {
				if (codeMatch.length > 2) status = codeMatch[2]
				const code = parseInt(codeMatch[1], 10)

				switch (code) {
					case RETCODE.INVALID_CHANNEL:
					case RETCODE.PARAMETER_MISSING:
					case RETCODE.PARAMETER_ILLEGAL:
					case RETCODE.MEDIAFILE_NOT_FOUND:
					case RETCODE.INTERNAL_SERVER_ERROR:
					case RETCODE.MEDIAFILE_UNREADABLE:
					case RETCODE.ACCESS_ERROR:
						error = true
						this._errorCode = code
						this._amcpState = ACMP_STATE.NEXT
						break
					case RETCODE.INFO:
					case RETCODE.OK:
						this._amcpState = ACMP_STATE.NEXT
						this._errorCode = undefined
						break
					case RETCODE.COMMAND_UNKNOWN_DATA:
					case RETCODE.INTERNAL_SERVER_ERROR_DATA:
						error = true
						this._errorCode = code
						this._amcpState = ACMP_STATE.SINGLE_LINE
						break
					case RETCODE.INFODATA:
					case RETCODE.OKDATA:
						this._amcpState = ACMP_STATE.SINGLE_LINE
						this._responseCurrent = status || ''
						this._errorCode = undefined
						break
					case RETCODE.OKMULTIDATA:
						this._amcpState = ACMP_STATE.MULTI_LINE
						this._responseCurrent = status || ''
						this._errorCode = undefined
						this._multilineData = []
						break
					default:
						this.log('error', 'Unrecognized data from server: ' + line)
						return
				}
				if (error && this._amcpState === ACMP_STATE.NEXT) {
					this.log('error', 'Got error ' + RETCODE2TYPE[code] + ': ' + line)
				}
				const cbKey =
					status &&
					self.response_callback[status.toUpperCase()] &&
					self.response_callback[status.toUpperCase()].length > 0
						? status.toUpperCase()
						: self._pendingResponseKey
				if (
					this._amcpState === ACMP_STATE.NEXT &&
					cbKey &&
					self.response_callback[cbKey] &&
					self.response_callback[cbKey].length > 0
				) {
					const cb = self.response_callback[cbKey].shift()
					if (cbKey === self._pendingResponseKey) self._pendingResponseKey = undefined
					if (typeof cb === 'function') cb(error ? new Error(line) : null, line)
				}
			} else {
				this.log('error', 'Protocol out of sync, expected number: ' + line)
				return
			}
		} else if (this._amcpState === ACMP_STATE.SINGLE_LINE) {
			this._amcpState = ACMP_STATE.NEXT
			if (this._errorCode !== undefined) {
				const errType = RETCODE2TYPE[this._errorCode] || String(this._errorCode)
				this.log('error', 'Got error ' + errType + ': ' + line)
				const key = self._pendingResponseKey
				if (key && self.response_callback[key] !== undefined && self.response_callback[key].length > 0) {
					const cb = self.response_callback[key].shift()
					self._pendingResponseKey = undefined
					if (typeof cb === 'function') cb(new Error(errType + ': ' + line))
				} else {
					self._pendingResponseKey = undefined
				}
				if (self.runCommandQueue) self.runCommandQueue()
			} else {
				const response_current = this._responseCurrent.toUpperCase()
				if (self.response_callback[response_current] !== undefined && self.response_callback[response_current].length) {
					const cb = self.response_callback[response_current].shift()
					if (typeof cb === 'function') cb(line)
				}
			}
		} else if (this._amcpState === ACMP_STATE.MULTI_LINE) {
			if (line === '') {
				this._amcpState = ACMP_STATE.NEXT
				const response_current = this._responseCurrent.toUpperCase()
				if (self.response_callback[response_current] !== undefined && self.response_callback[response_current].length) {
					const cb = self.response_callback[response_current].shift()
					if (typeof cb === 'function') {
						cb(this._multilineData)
						this._multilineData = []
					}
				}
			} else {
				this._multilineData.push(line)
			}
		}
	}
}

/**
 * Reject every waiter in {@link AmcpConnectionContext#response_callback} so pending
 * `amcp.raw()` / query promises settle when the TCP socket is destroyed (otherwise shutdown can hang).
 * @param {import('./amcp-protocol').AmcpConnectionContext} ctx
 */
function rejectAllPendingAmcpCallbacks(ctx) {
	if (!ctx || !ctx.response_callback) return
	const err = new Error('AMCP connection closed')
	for (const key of Object.keys(ctx.response_callback)) {
		const arr = ctx.response_callback[key]
		if (!Array.isArray(arr)) continue
		while (arr.length) {
			const cb = arr.shift()
			if (typeof cb === 'function') {
				try {
					cb(err)
				} catch (_) {
					/* ignore */
				}
			}
		}
	}
	ctx.response_callback = {}
	ctx._pendingResponseKey = undefined
	ctx._amcpBatchDrain = null
	if (ctx._amcpSendQueue) {
		ctx._amcpSendQueue = Promise.resolve()
	}
}

module.exports = {
	ACMP_STATE,
	RETCODE,
	RETCODE2TYPE,
	AmcpProtocol,
	rejectAllPendingAmcpCallbacks,
}
