'use strict'

const os = require('os')
const { JSON_HEADERS, jsonBody } = require('./response')
const { getReplicationConfig } = require('../config/replication-config')
const { getReplicationRuntime } = require('../replication/replication-service')

function replicationTokenOk(ctx, req, body) {
	const repl = getReplicationConfig(ctx.config)
	const hdr = req?.headers?.['x-highascg-replication-token']
	const fromHdr = Array.isArray(hdr) ? hdr[0] : hdr
	const token = String(fromHdr || body?.token || '').trim()
	return !!(repl.peer.token && token === repl.peer.token)
}

function replicationPeerAuthOk(ctx, req, body, opts = {}) {
	if (replicationTokenOk(ctx, req, body)) return { ok: true, method: 'token' }
	const { verifyReplicationRepairRequest } = require('../replication/replication-handshake')
	const repair = verifyReplicationRepairRequest(ctx, body, req, opts)
	if (repair.ok) return repair
	return { ok: false, error: repair.error || 'unauthorized' }
}

function rejectIfLeader(ctx) {
	const rt = getReplicationRuntime(ctx)
	if (rt?.roleState?.getRole() === 'leader') {
		return { status: 409, headers: JSON_HEADERS, body: jsonBody({ error: 'leader cannot accept replication push' }) }
	}
	return null
}

function rejectIfNotLeader(ctx) {
	const rt = getReplicationRuntime(ctx)
	if (rt?.roleState?.getRole() !== 'leader') {
		return { status: 409, headers: JSON_HEADERS, body: jsonBody({ error: 'leader export only' }) }
	}
	return null
}

function localPrimaryIp() {
	for (const list of Object.values(os.networkInterfaces())) {
		if (!list) continue
		for (const iface of list) {
			if (iface && !iface.internal && iface.family === 'IPv4') return iface.address
		}
	}
	return ''
}

module.exports = {
	replicationTokenOk,
	replicationPeerAuthOk,
	rejectIfLeader,
	rejectIfNotLeader,
	localPrimaryIp,
}
