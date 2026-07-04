'use strict'

const crypto = require('crypto')

/** @type {import('./replication-service').ReplicationRuntime|null} */
let _runtime = null
/** @type {object|null} */
let _ctx = null

function hashConfig(cfg) {
	try {
		return crypto.createHash('sha256').update(JSON.stringify(cfg?.replication || {})).digest('hex').slice(0, 16)
	} catch {
		return 'unknown'
	}
}

/**
 * @param {object} ctx
 */
function getReplicationRuntime(ctx) {
	return ctx?._replication || _runtime
}

function getReplicationCtx() {
	return _ctx
}

function getReplicationRuntimeRef() {
	return _runtime
}

/**
 * @param {import('./replication-service').ReplicationRuntime|null} runtime
 * @param {object|null} ctx
 */
function setReplicationRuntime(runtime, ctx = null) {
	_runtime = runtime
	if (ctx !== null) _ctx = ctx
}

function clearReplicationRuntime() {
	_runtime = null
	_ctx = null
}

module.exports = {
	hashConfig,
	getReplicationRuntime,
	getReplicationCtx,
	getReplicationRuntimeRef,
	setReplicationRuntime,
	clearReplicationRuntime,
}
