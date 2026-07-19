'use strict'

const { amcpVerboseTrace } = require('./amcp-utils')
const { QUIET_CMDS, resolveSendTimeoutMs } = require('./amcp-client-static')
const { recordAmcpHistory } = require('./amcp-client-history')
const { swallow } = require('../utils/swallow')

module.exports = {
	/**
	 * @param {string} cmd
	 * @param {string} [responseKey]
	 * @returns {{ p: Promise<{ ok: boolean, data?: string|string[] }>, execute: () => Promise<{ ok: boolean, data?: string|string[] }> }}
	 */
	_sendPrepare(cmd, responseKey) {
		const self = this._context
		const trimmed = cmd.trim()
		const key = (responseKey || trimmed.split(/\s+/)[0]).toUpperCase()
		const timeoutMs = resolveSendTimeoutMs(trimmed)

		let resolveP, rejectP, settled = false
		/** @type {ReturnType<typeof setTimeout> | null} */
		let timeoutHandle = null

		const cb = (a, b) => {
			if (settled) return
			settled = true
			if (timeoutHandle) {
				clearTimeout(timeoutHandle)
				timeoutHandle = null
			}
			if (a instanceof Error) return rejectP(a)
			const data = b !== undefined ? b : a
			resolveP({ ok: true, data })
		}

		const p = new Promise((resolve, reject) => {
			resolveP = resolve
			rejectP = reject
			if (self.response_callback[key] === undefined) self.response_callback[key] = []
			self.response_callback[key].push(cb)
		})

		const execute = () => {
			try {
				if (settled) return p
				try {
					const { shouldBlockLocalPgmAmcpCommand } = require('../replication/amcp-fanout')
					if (shouldBlockLocalPgmAmcpCommand(self, trimmed)) {
						if (typeof self.log === 'function') {
							self.log(
								'debug',
								`[replication] skip local PGM AMCP (leader fan-out drives air): ${trimmed}`,
							)
						}
						if (!settled) {
							settled = true
							resolveP({ ok: true, skipped: true, data: '202 OK' })
						}
						return p
					}
				} catch {
					/* replication optional */
				}
				if (!self.socket || !self.socket.isConnected) {
					throw new Error('Not connected')
				}
				self._pendingResponseKey = key
				if (typeof self.log === 'function' && (amcpVerboseTrace() || !QUIET_CMDS.has(key))) {
					self.log('debug', `AMCP → ${trimmed}`)
				}
				recordAmcpHistory(self, trimmed)

				if (typeof self.socket.send === 'function') {
					self.socket.send(trimmed)
				} else if (typeof self.socket.sendRaw === 'function') {
					self.socket.sendRaw(trimmed).then(res => {
						if (settled) return
						settled = true
						if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null }
						if (!res.ok) rejectP(new Error(res.data || 'AMCP error'))
						else resolveP(res)
					}).catch(err => {
						if (settled) return
						settled = true
						if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null }
						rejectP(err)
					})
				} else {
					throw new Error('AMCP socket has no send method')
				}

				try {
					const { fanoutSingleCommand } = require('../replication/amcp-fanout')
					fanoutSingleCommand(trimmed)
				} catch {
					/* replication optional */
				}

				timeoutHandle = setTimeout(() => {
					if (settled) return
					settled = true
					timeoutHandle = null
					const arr = self.response_callback[key]
					if (arr) {
						const idx = arr.indexOf(cb)
						if (idx !== -1) arr.splice(idx, 1)
					}
					if (self._pendingResponseKey === key) self._pendingResponseKey = undefined
					// Sends are serialized, so a batch drain still installed while a SINGLE timed out
					// is stale — and a stale drain swallows every response line, turning one missed
					// ack into a permanent every-command-times-out wedge. Clear it here too.
					if (self._amcpBatchDrain) {
						const stale = self._amcpBatchDrain
						self._amcpBatchDrain = null
						if (typeof self.log === 'function') {
							self.log('warn', 'AMCP: cleared stale batch drain during single-command timeout')
						}
						try {
							if (typeof stale.rejectBatch === 'function') stale.rejectBatch(new Error('stale batch drain (single-command timeout)'))
						} catch (_) {
							/* non-fatal */
						}
					}
					try {
						if (typeof self._resetAmcpProtocol === 'function') self._resetAmcpProtocol()
					} catch (_) {
						/* non-fatal */
					}
					self._amcpSendQueue = Promise.resolve()
					if (typeof self.log === 'function') {
						const isVersion = key === 'VERSION' || trimmed.toUpperCase().startsWith('VERSION')
						const hint = isVersion
							? ' — Caspar did not reply in time; AMCP is often blocked by a producer/GPU/thumbnail. Check casparcg-server log, restart Caspar if stuck. Optional env: HIGHASCG_AMCP_SEND_TIMEOUT_MS, HIGHASCG_AMCP_HEALTH_MS=0 (disable periodic VERSION).'
							: ''
						self.log('warn', `AMCP response timeout (${timeoutMs}ms): ${trimmed}${hint}`)
					}
					rejectP(new Error(`AMCP response timeout: ${trimmed}`))
				}, timeoutMs)

				return p
			} catch (e) {
				const arr = self.response_callback[key]
				if (arr) {
					const idx = arr.indexOf(cb)
					if (idx !== -1) arr.splice(idx, 1)
				}
				if (timeoutHandle) {
					clearTimeout(timeoutHandle)
					timeoutHandle = null
				}
				settled = true
				const err = e instanceof Error ? e : new Error(String(e))
				rejectP(err)
				throw err
			}
		}

		return { p, execute }
	},

	_sendAfter(prevPromise, cmd, responseKey) {
		if (this.isOffline) {
			return prevPromise.then(() => this._simulated.send(cmd))
		}
		const self = this._context
		if (!self.socket || !self.socket.isConnected) {
			return Promise.reject(new Error('Not connected'))
		}
		const { p, execute } = this._sendPrepare(cmd, responseKey)
		return prevPromise.then(execute)
	},

	_send(cmd, responseKey) {
		const self = this._context

		if (this.isOffline) {
			return this._simulated.send(cmd)
		}

		if (!self.socket || !self.socket.isConnected) {
			return Promise.reject(new Error('Not connected'))
		}

		const { p, execute } = this._sendPrepare(cmd, responseKey)

		self._amcpSendQueue = (self._amcpSendQueue || Promise.resolve()).then(execute).catch((err) => {
			swallow(err, { tag: 'amcp-send-queue' })
		})
		return p
	},

	_invokeTyped(methodName, params, originalCmdString, responseKey) {
		const self = this._context
		const trimmed = originalCmdString.trim()
		const key = (responseKey || trimmed.split(/\s+/)[0]).toUpperCase()
		const timeoutMs = resolveSendTimeoutMs(trimmed)

		if (this.isOffline) {
			return this._simulated.send(originalCmdString)
		}

		if (!self.socket || !self.socket.isConnected) {
			return Promise.reject(new Error('Not connected'))
		}

		if (
			self.socket.useLibraryTyped === true &&
			typeof self.socket.ccg !== 'undefined' &&
			typeof self.socket.ccg[methodName] === 'function'
		) {
			if (typeof self.log === 'function' && (amcpVerboseTrace() || !QUIET_CMDS.has(key))) {
				self.log('debug', `AMCP → ${trimmed}`)
			}
			recordAmcpHistory(self, trimmed)

			return new Promise((resolve, reject) => {
				let settled = false
				let timeoutHandle = setTimeout(() => {
					if (settled) return
					settled = true
					timeoutHandle = null
					const hint = key === 'VERSION' ? ' — Caspar did not reply in time...' : ''
					if (typeof self.log === 'function') self.log('warn', `AMCP response timeout (${timeoutMs}ms): ${trimmed}${hint}`)
					reject(new Error(`AMCP response timeout: ${trimmed}`))
				}, timeoutMs)

				self.socket.ccg[methodName](params).then(res => {
					return self.socket.normalizeResponse(res)
				}).then(norm => {
					if (settled) return
					settled = true
					if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null }
					try {
						const { fanoutSingleCommand } = require('../replication/amcp-fanout')
						fanoutSingleCommand(originalCmdString)
					} catch {
						/* replication optional */
					}
					if (!norm.ok) reject(new Error(norm.data || 'AMCP error'))
					else resolve(norm)
				}).catch(err => {
					if (settled) return
					settled = true
					if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null }
					reject(err)
				})
			})
		} else {
			return this._send(originalCmdString, responseKey)
		}
	},
}
