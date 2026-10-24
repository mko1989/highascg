'use strict'

/**
 * WO-744 (WO-738 step 3) — shared-memory rings another process writes on this box (the Godot VJ writer, WO-743; later a
 * window grabber), offered as Live-tab sources:
 *   GET /api/shm/sources → { ok, sources: [{ name, value: 'shm://<name>', width, height, fps, pid, writer, signal }] }
 * A ring counts when its header is valid, its writer process is alive and is not Caspar (Caspar's own WO-594 consumer
 * outputs are not sources). A look layer with the value `shm://<name>` plays as `PLAY <ch>-<layer> SHM NAME <name>`
 * (src/caspar/amcp-command-plan.js), which needs the WO-742 Caspar shm producer.
 * Detachable: this file and its two marked lines in router-dispatch.js (WO-744 "How to remove").
 */

const fs = require('fs')
const path = require('path')
const { JSON_HEADERS, jsonBody } = require('./response')

const DIR = '/dev/shm'
const PREFIX = 'highascg-'
const NAME_RE = /^[A-Za-z0-9_-]+$/ // the rule Caspar's producer and HshmSink enforce
const SIGNAL_LOST_NS = 500000000n // hshm_abi.h: no publish for > 500 ms
const HEADER_BYTES = 128

/** Header fields of one ring (caspar/modules/shm/hshm_abi.h), or null when it is not a valid v1 ring. */
function readHeader(file, fsImpl = fs) {
	let fd
	try {
		fd = fsImpl.openSync(file, 'r')
		const b = Buffer.alloc(HEADER_BYTES)
		if (fsImpl.readSync(fd, b, 0, HEADER_BYTES, 0) !== HEADER_BYTES) return null
		if (b.toString('latin1', 0, 8) !== 'HASCGSHM' || b.readUInt32LE(8) !== 1) return null
		const fpsDen = b.readUInt32LE(36) || 1
		return {
			width: b.readUInt32LE(16),
			height: b.readUInt32LE(20),
			fps: Math.round((b.readUInt32LE(32) / fpsDen) * 100) / 100,
			pid: Number(b.readBigUInt64LE(88)),
			latest: b.readBigUInt64LE(96),
			heartbeatNs: b.readBigUInt64LE(104),
		}
	} catch {
		return null
	} finally {
		if (fd !== undefined) fsImpl.closeSync(fd)
	}
}

/** The writer's process name, or null when it is gone. */
function processName(pid, fsImpl = fs) {
	if (!(pid > 0)) return null
	try {
		return fsImpl.readFileSync(`/proc/${pid}/comm`, 'utf8').trim()
	} catch {
		return null
	}
}

function listShmSources({ dir = DIR, fsImpl = fs, nowNs = process.hrtime.bigint() } = {}) {
	let names
	try {
		names = fsImpl.readdirSync(dir)
	} catch {
		return []
	}
	const out = []
	for (const f of names.sort()) {
		if (!f.startsWith(PREFIX)) continue
		const name = f.slice(PREFIX.length)
		if (!NAME_RE.test(name)) continue
		const h = readHeader(path.join(dir, f), fsImpl)
		if (!h) continue
		const writer = processName(h.pid, fsImpl)
		if (!writer || /^casparcg/i.test(writer)) continue
		const signal = h.latest !== 0n && h.heartbeatNs > 0n && nowNs - h.heartbeatNs < SIGNAL_LOST_NS
		out.push({ name, value: `shm://${name}`, width: h.width, height: h.height, fps: h.fps, pid: h.pid, writer, signal })
	}
	return out
}

function handle(method, p, ctx, deps = {}) {
	if (method !== 'GET' || p !== '/api/shm/sources') return null
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, sources: listShmSources(deps) }) }
}

module.exports = { handle, listShmSources, readHeader }
