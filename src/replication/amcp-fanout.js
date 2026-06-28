'use strict'

const { getReplicationConfig } = require('../config/replication-config')

/** @type {import('./replication-service').ReplicationRuntime|null} */
let _runtime = null
/** @type {object|null} */
let _ctx = null

const DEFAULT_ALLOW = new Set([
	'PLAY',
	'LOADBG',
	'LOAD',
	'STOP',
	'CLEAR',
	'PAUSE',
	'RESUME',
	'SWAP',
	'MIXER',
	'CG',
	'CALL',
])

const DEFAULT_DENY = new Set([
	'INFO',
	'CLS',
	'TLS',
	'THUMBNAIL',
	'VERSION',
	'DIAG',
	'CINF',
	'FLS',
	'BYE',
	'ADD',
	'REMOVE',
	'BEGIN',
	'COMMIT',
	'DISCARD',
	'PRINT',
])

/**
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 */
function bindAmcpFanout(ctx, runtime) {
	_ctx = ctx
	_runtime = runtime
}

function unbindAmcpFanout() {
	_ctx = null
	_runtime = null
}

/**
 * @param {object} [config]
 * @returns {boolean}
 */
function isAmcpFanoutMirrorActive(config) {
	const repl = getReplicationConfig(config || _ctx?.config)
	if (!repl.enabled || repl.followerMode !== 'mirror') return false
	if (String(repl.mirrorTransport || 'live-state') !== 'amcp-fanout') return false
	if (repl.amcpFanout?.enabled === false) return false
	const rt = _runtime
	if (!rt || rt.roleState?.getRole() !== 'leader') return false
	return !!(repl.peerCaspar?.host && repl.peerCaspar?.port)
}

/**
 * Config-only check (no leader role / TCP bind). Use on promote when follower becomes leader.
 * @param {object} [config]
 * @returns {boolean}
 */
function isAmcpFanoutMirrorConfigured(config) {
	const repl = getReplicationConfig(config || _ctx?.config)
	if (!repl.enabled || repl.followerMode !== 'mirror') return false
	if (String(repl.mirrorTransport || 'live-state') !== 'amcp-fanout') return false
	if (repl.amcpFanout?.enabled === false) return false
	return !!(repl.peerCaspar?.host && repl.peerCaspar?.port)
}

/**
 * @param {string} cmd
 * @returns {boolean}
 */
function shouldFanOutCommand(cmd) {
	const trimmed = String(cmd || '').trim()
	if (!trimmed) return false
	const first = (trimmed.match(/^(\S+)/) || [])[1]?.toUpperCase()
	if (!first) return false
	if (DEFAULT_DENY.has(first)) return false
	return DEFAULT_ALLOW.has(first)
}

/**
 * @param {string|string[]} payload — single line or BEGIN…COMMIT block (with trailing CRLF ok)
 */
function fanoutAmcpPayload(payload) {
	if (!isAmcpFanoutMirrorActive()) return
	const peer = _runtime?.peerCasparConnection
	if (!peer?.isConnected) {
		if (_runtime) _runtime.amcpFanoutSkippedNotConnected = (_runtime.amcpFanoutSkippedNotConnected || 0) + 1
		return
	}
	if (typeof payload === 'string') {
		const line = payload.trim()
		if (!shouldFanOutCommand(line)) return
		peer.enqueueSend(line)
		return
	}
	if (!Array.isArray(payload) || payload.length === 0) return
	const lines = payload.map((l) => String(l).trim()).filter(Boolean)
	if (lines.length === 0) return
	for (const line of lines) {
		if (!shouldFanOutCommand(line)) return
	}
	peer.enqueueBatchLines(lines)
}

/**
 * @param {string} cmd
 */
function fanoutSingleCommand(cmd) {
	fanoutAmcpPayload(cmd)
}

/**
 * @param {string} batchPayload — full BEGIN…COMMIT wire payload
 */
function fanoutBatchPayload(batchPayload) {
	if (!isAmcpFanoutMirrorActive()) return
	const peer = _runtime?.peerCasparConnection
	if (!peer?.isConnected) {
		if (_runtime) _runtime.amcpFanoutSkippedNotConnected = (_runtime.amcpFanoutSkippedNotConnected || 0) + 1
		return
	}
	const body = String(batchPayload || '')
	const inner = body
		.split(/\r\n/)
		.map((l) => l.trim())
		.filter((l) => l && l.toUpperCase() !== 'BEGIN' && l.toUpperCase() !== 'COMMIT')
	if (inner.length === 0) return
	for (const line of inner) {
		if (!shouldFanOutCommand(line)) return
	}
	peer.enqueueRawPayload(body.endsWith('\r\n') ? body : `${body}\r\n`)
}

module.exports = {
	bindAmcpFanout,
	unbindAmcpFanout,
	isAmcpFanoutMirrorActive,
	isAmcpFanoutMirrorConfigured,
	shouldFanOutCommand,
	fanoutSingleCommand,
	fanoutBatchPayload,
	fanoutAmcpPayload,
	DEFAULT_ALLOW,
	DEFAULT_DENY,
}
