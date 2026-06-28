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
 * Hot backup uses AMCP fan-out transport (independent of whether peerCaspar.host is set on this box).
 * @param {object} [config]
 * @returns {boolean}
 */
function isAmcpFanoutTransportMode(config) {
	const repl = getReplicationConfig(config || _ctx?.config)
	if (!repl.enabled || repl.followerMode !== 'mirror') return false
	if (String(repl.mirrorTransport || 'live-state') !== 'amcp-fanout') return false
	if (repl.amcpFanout?.enabled === false) return false
	return true
}

/**
 * @param {object} [config]
 * @returns {boolean}
 */
function isAmcpFanoutMirrorActive(config) {
	if (!isAmcpFanoutTransportMode(config)) return false
	const rt = _runtime
	if (!rt || rt.roleState?.getRole() !== 'leader') return false
	const repl = getReplicationConfig(config || _ctx?.config)
	return !!(repl.peerCaspar?.host && repl.peerCaspar?.port)
}

/**
 * Leader has peer Caspar endpoint configured for fan-out (config-only; no TCP bind).
 * @param {object} [config]
 * @returns {boolean}
 */
function isAmcpFanoutMirrorConfigured(config) {
	if (!isAmcpFanoutTransportMode(config)) return false
	const repl = getReplicationConfig(config || _ctx?.config)
	return !!(repl.peerCaspar?.host && repl.peerCaspar?.port)
}

/**
 * True when semantic live-state mirror (re-take) must not run — AMCP fan-out owns air sync.
 * @param {object} [config]
 * @returns {boolean}
 */
function shouldSkipSemanticLiveMirror(config) {
	return isAmcpFanoutTransportMode(config)
}

/**
 * @param {string} host
 * @returns {boolean}
 */
function isLoopbackHost(host) {
	const h = String(host || '')
		.trim()
		.toLowerCase()
	return h === '127.0.0.1' || h === 'localhost' || h === '::1'
}

/**
 * True when this machine is the fan-out target (backup), not the driver (leader).
 * Handles misconfigured replication.json (leader role file on backup box) by checking peerCaspar host.
 * @param {object} [ctx]
 * @returns {boolean}
 */
function isAmcpFanoutReceiveBox(ctx) {
	if (!isAmcpFanoutTransportMode(ctx?.config)) return false
	const repl = getReplicationConfig(ctx?.config)
	const peerCasparHost = String(repl.peerCaspar?.host || '').trim()
	if (peerCasparHost) {
		try {
			const { getCasparEndpointForPeer } = require('./caspar-endpoint')
			const localCaspar = getCasparEndpointForPeer(ctx?.config || {})
			const localHost = String(localCaspar.host || '').trim().toLowerCase()
			const peerHost = peerCasparHost.toLowerCase()
			if (isLoopbackHost(peerHost) || (localHost && peerHost === localHost)) {
				return true
			}
		} catch {
			/* optional */
		}
	}
	if (isAmcpFanoutMirrorActive(ctx?.config)) return false
	if (repl.role === 'follower') return true
	const rt = ctx?._replication
	if (rt?.roleState?.getRole() === 'follower') return true
	return false
}

/**
 * @param {object} ctx
 * @param {number} channel
 * @returns {boolean}
 */
function isProgramOutputChannel(ctx, channel) {
	const ch = parseInt(String(channel), 10)
	if (!Number.isFinite(ch) || ch < 1) return false
	const { getChannelMap } = require('../config/routing')
	const map = getChannelMap(ctx?.config || {})
	return (map.programChannels || []).some((c) => Number(c) === ch)
}

/**
 * @param {string} cmd
 * @returns {number|null}
 */
function parseAmcpCommandChannel(cmd) {
	const s = String(cmd || '').trim()
	if (!s) return null
	const m = s.match(
		/^(?:MIXER|CG|PLAY|STOP|LOADBG|LOAD|PAUSE|RESUME|CLEAR|SWAP|CALL|ADD|REMOVE)\s+(\d+)(?:-|\s)/i,
	)
	if (m) {
		const ch = parseInt(m[1], 10)
		return Number.isFinite(ch) && ch >= 1 ? ch : null
	}
	const clearCh = s.match(/^CLEAR\s+(\d+)\s*$/i)
	if (clearCh) {
		const ch = parseInt(clearCh[1], 10)
		return Number.isFinite(ch) && ch >= 1 ? ch : null
	}
	return null
}

/**
 * @param {object} ctx
 * @param {string} cmd
 * @returns {boolean}
 */
function shouldBlockLocalPgmAmcpCommand(ctx, cmd) {
	const ch = parseAmcpCommandChannel(cmd)
	if (ch == null) return false
	return shouldFollowerSkipLocalPgmAmcp(ctx, ch, { previewOnly: false })
}

/**
 * Follower with AMCP fan-out: PGM air is driven only by leader fan-out, not local takes.
 * @param {object} ctx
 * @param {number} channel — Caspar channel number
 * @param {{ previewOnly?: boolean }} [opts]
 * @returns {boolean}
 */
function shouldFollowerSkipLocalPgmAmcp(ctx, channel, opts = {}) {
	if (opts.previewOnly) return false
	if (!isAmcpFanoutReceiveBox(ctx)) return false
	return isProgramOutputChannel(ctx, channel)
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
	isAmcpFanoutTransportMode,
	isAmcpFanoutMirrorActive,
	isAmcpFanoutMirrorConfigured,
	isAmcpFanoutReceiveBox,
	shouldSkipSemanticLiveMirror,
	shouldFollowerSkipLocalPgmAmcp,
	shouldBlockLocalPgmAmcpCommand,
	parseAmcpCommandChannel,
	shouldFanOutCommand,
	fanoutSingleCommand,
	fanoutBatchPayload,
	fanoutAmcpPayload,
	DEFAULT_ALLOW,
	DEFAULT_DENY,
}
