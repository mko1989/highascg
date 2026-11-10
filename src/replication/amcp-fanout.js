'use strict'

const { getReplicationConfig } = require('../config/replication-config')

/** @type {import('./replication-service').ReplicationRuntime|null} */
let _runtime = null
/** @type {object|null} */
let _ctx = null
/** WO-670 P4a: the cluster master's per-destination fan-out (src/cluster/cluster-fanout.js) sees every payload too. */
let _clusterSink = null

function setClusterFanoutSink(fn) {
	_clusterSink = typeof fn === 'function' ? fn : null
}

/**
 * WO-1029 B1: program channel → the name of the cluster master that forwards it to this server right now ('' = this
 * server drives it). Set by routes-cluster.js from the master's fan-out report (cluster-fanout-report.js): only fresh,
 * positive evidence from the current master blocks a channel; no report, a stale one, or a channel it does not list
 * leaves the channel to this server (owner: "local screen destinations must always be driveable from the local box").
 */
let _clusterAirCheck = null

/**
 * WO-1029 phase 2a: the check may also answer `{ code: 'REMOTE_SCREEN', drivenBy, owners }` — a non-master's copy channel
 * of a screen cabled only on other servers (destination-ownership.js): refused like a held one, with its own code.
 */
function setClusterAirCheck(fn) {
	_clusterAirCheck = typeof fn === 'function' ? fn : null
}

/** → '' | the driver's name | { code, drivenBy, owners } */
function clusterDrivenBy(channel) {
	try {
		const v = _clusterAirCheck?.(channel)
		if (v && typeof v === 'object') return v.drivenBy ? v : ''
		return String(v || '')
	} catch {
		return ''
	}
}

/** WO-1029 2a: told about every program-affecting line this server sends itself (the owner's press notice). */
let _clusterLocalPress = null

function setClusterLocalPress(fn) {
	_clusterLocalPress = typeof fn === 'function' ? fn : null
}

function localPress(channel) {
	try {
		_clusterLocalPress?.(channel)
	} catch {
		/* a notice never blocks a press */
	}
}

function toCluster(payload) {
	if (!_clusterSink) return
	try {
		_clusterSink(payload)
	} catch {
		/* the cluster never breaks a local take */
	}
}

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
 * WO-1029 B2: a line that only asks (INFO, `MIXER 1-10 OPACITY` with no value, `CG 1-20 INFO`) changes nothing on air,
 * so it is never held: Caspar answers it (it was answered with an invented `202 OK`, WO-1028 #6).
 */
function isAmcpQueryLine(cmd) {
	const s = String(cmd || '').trim()
	if (/^(?:INFO|VERSION|CINF|CLS|TLS|FLS|DIAG)\b/i.test(s)) return true
	if (/^CG\s+\d+(?:-\d+)?\s+INFO\b/i.test(s)) return true
	const m = s.match(/^MIXER\s+\d+(?:-\d+)?\s+(\S+)\s*$/i)
	return !!m && !/^(?:CLEAR|COMMIT)$/i.test(m[1])
}

/**
 * Who drives this channel instead of this server → `{ channel, screen, drivenBy }`, or null when this server drives it.
 * Only program channels are ever held (PRV belongs to this server's operator).
 * @param {object} ctx
 * @param {number} channel
 */
function airHeldBy(ctx, channel) {
	const ch = parseInt(String(channel), 10)
	if (!Number.isFinite(ch) || ch < 1) return null
	const v = isAmcpFanoutReceiveBox(ctx) ? 'the hot-backup leader' : clusterDrivenBy(ch)
	if (!v) return null // the usual case: decided before the channel map is built (every AMCP line asks)
	const { getChannelMap } = require('../config/routing')
	const idx = (getChannelMap(ctx?.config || {}).programChannels || []).findIndex((c) => Number(c) === ch)
	if (idx < 0) return null
	if (typeof v === 'string') return { channel: ch, screen: idx + 1, drivenBy: v }
	return { channel: ch, screen: idx + 1, drivenBy: String(v.drivenBy), code: String(v.code || 'AIR_HELD'), owners: Array.isArray(v.owners) ? v.owners : [] }
}

/** One AMCP line → `{ channel, screen, drivenBy }` when it must not be sent here, else null. */
function airHeldForLine(ctx, cmd) {
	// WO-1026: ADD / REMOVE are this server's own consumers (stream, record, shm, a screen) — never air content, and the
	// leader never sends them (shouldFanOutCommand). Dropped here, a follower's stream and recording never started.
	if (/^(?:ADD|REMOVE)\s/i.test(String(cmd || '').trim())) return null
	if (isAmcpQueryLine(cmd)) return null
	const ch = parseAmcpCommandChannel(cmd)
	if (ch == null) return null
	const held = airHeldBy(ctx, ch)
	if (!held) localPress(ch) // WO-1029 2a: it goes out here — the master hears that this owner pressed (debounced)
	return held
}

/**
 * @param {object} ctx
 * @param {string} cmd
 * @returns {boolean}
 */
function shouldBlockLocalPgmAmcpCommand(ctx, cmd) {
	return !!airHeldForLine(ctx, cmd)
}

/** WO-1029 B4: a batch decided per line → `{ send, refused: [{ line, channel, screen, drivenBy }] }`. */
function partitionAirHeld(ctx, lines) {
	const send = []
	const refused = []
	for (const line of lines) {
		const held = airHeldForLine(ctx, line)
		if (held) refused.push({ line: String(line), ...held })
		else send.push(line)
	}
	return { send, refused }
}

/**
 * True when another server drives this program channel (see airHeldBy).
 * @param {object} ctx
 * @param {number} channel — Caspar channel number
 * @param {{ previewOnly?: boolean }} [opts]
 * @returns {boolean}
 */
function shouldFollowerSkipLocalPgmAmcp(ctx, channel, opts = {}) {
	if (opts.previewOnly) return false
	return !!airHeldBy(ctx, channel)
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
	toCluster(cmd)
	fanoutAmcpPayload(cmd)
}

/**
 * @param {string} batchPayload — full BEGIN…COMMIT wire payload
 */
function fanoutBatchPayload(batchPayload) {
	toCluster(batchPayload)
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
	airHeldBy,
	airHeldForLine,
	partitionAirHeld,
	parseAmcpCommandChannel,
	shouldFanOutCommand,
	fanoutSingleCommand,
	fanoutBatchPayload,
	fanoutAmcpPayload,
	setClusterFanoutSink,
	setClusterAirCheck,
	setClusterLocalPress,
	DEFAULT_ALLOW,
	DEFAULT_DENY,
}
