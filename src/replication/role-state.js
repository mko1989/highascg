'use strict'

const EventEmitter = require('events')

/** @typedef {'standalone'|'leader'|'follower'} ReplicationRole */

class RoleState extends EventEmitter {
	constructor() {
		super()
		/** @type {ReplicationRole} */
		this._effectiveRole = 'standalone'
		/** @type {'auto'|'leader'|'follower'} */
		this._configuredRole = 'auto'
		this._operatorWsClients = 0
		this._replicationEnabled = false
		/** @type {ReplicationRole|null} */
		this._forcedRole = null
	}

	/**
	 * @param {object} opts
	 * @param {boolean} opts.enabled
	 * @param {'auto'|'leader'|'follower'} opts.role
	 * @param {ReplicationRole|null} [opts.forcedRole]
	 */
	configure(opts) {
		this._replicationEnabled = !!opts.enabled
		this._configuredRole = opts.role || 'auto'
		this._forcedRole = opts.forcedRole || null
		this._recompute()
	}

	/** @param {number} count */
	setOperatorWsClientCount(count) {
		const n = Math.max(0, count | 0)
		if (n === this._operatorWsClients) return
		this._operatorWsClients = n
		this._recompute()
	}

	_recompute() {
		const prev = this._effectiveRole
		let next /** @type {ReplicationRole} */ = 'standalone'

		if (!this._replicationEnabled) {
			next = 'standalone'
		} else if (this._configuredRole === 'leader' || this._forcedRole === 'leader') {
			next = 'leader'
		} else if (this._configuredRole === 'follower' || this._forcedRole === 'follower') {
			next = 'follower'
		} else if (this._operatorWsClients >= 1) {
			next = 'leader'
		} else {
			next = 'follower'
		}

		this._effectiveRole = next
		if (next !== prev) this.emit('roleChange', next, prev)
	}

	/** @returns {ReplicationRole} */
	getRole() {
		return this._effectiveRole
	}

	getOperatorWsClientCount() {
		return this._operatorWsClients
	}

	/** @param {ReplicationRole} role */
	forceRole(role) {
		this._forcedRole = role
		this._recompute()
	}

	clearForcedRole() {
		this._forcedRole = null
		this._recompute()
	}
}

module.exports = { RoleState }
