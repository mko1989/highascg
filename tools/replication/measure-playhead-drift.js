#!/usr/bin/env node
'use strict'

/**
 * Compare leader vs backup playhead positions (measure only — no AMCP).
 *
 * Usage:
 *   node tools/replication/measure-playhead-drift.js \
 *     --leader http://192.168.0.20:4200 --backup http://192.168.0.25:4200 \
 *     --token <replication-token> --interval 2 --samples 30
 *
 * On the leader box you can omit --backup and pass replication peer token from config;
 * the script will read /api/replication/status and poll peer playhead-export.
 */

const http = require('node:http')
const https = require('node:https')
const fs = require('node:fs')
const path = require('node:path')

function parseArgs(argv) {
	const out = { interval: 2, samples: 30 }
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i]
		if (a === '--leader') out.leader = argv[++i]
		else if (a === '--backup') out.backup = argv[++i]
		else if (a === '--token') out.token = argv[++i]
		else if (a === '--interval') out.interval = Number(argv[++i]) || 2
		else if (a === '--samples') out.samples = Number(argv[++i]) || 30
		else if (a === '--help' || a === '-h') out.help = true
	}
	return out
}

function httpJson(url, opts = {}) {
	return new Promise((resolve, reject) => {
		const u = new URL(url)
		const lib = u.protocol === 'https:' ? https : http
		const headers = { Accept: 'application/json', ...(opts.headers || {}) }
		const req = lib.request(
			{
				hostname: u.hostname,
				port: u.port || (u.protocol === 'https:' ? 443 : 80),
				path: u.pathname + u.search,
				method: opts.method || 'GET',
				headers,
				timeout: opts.timeoutMs || 8000,
			},
			(res) => {
				let body = ''
				res.on('data', (c) => (body += c))
				res.on('end', () => {
					let json = null
					try {
						json = body ? JSON.parse(body) : null
					} catch {
						/* ignore */
					}
					resolve({ status: res.statusCode || 0, json, body })
				})
			},
		)
		req.on('error', reject)
		req.on('timeout', () => req.destroy(new Error('timeout')))
		if (opts.body) req.write(opts.body)
		req.end()
	})
}

function clipBase(name) {
	const n = String(name || '').trim().toUpperCase()
	const slash = Math.max(n.lastIndexOf('/'), n.lastIndexOf('\\'))
	return slash >= 0 ? n.slice(slash + 1) : n
}

function layerDrifts(leaderLayers, followerLayers) {
	/** @type {{ layer: string, driftMs: number, leaderSec: number, followerSec: number, clip: string }[]} */
	const rows = []
	for (const [layer, le] of Object.entries(leaderLayers || {})) {
		if (le.state !== 'playing') continue
		const fe = followerLayers?.[layer]
		if (!fe || fe.state !== 'playing') continue
		if (clipBase(le.clip) && clipBase(fe.clip) && clipBase(le.clip) !== clipBase(fe.clip)) continue
		const driftMs = Math.round((le.timeSec - fe.timeSec) * 1000)
		rows.push({
			layer,
			driftMs,
			leaderSec: le.timeSec,
			followerSec: fe.timeSec,
			clip: le.clip || fe.clip || '',
		})
	}
	rows.sort((a, b) => Math.abs(b.driftMs) - Math.abs(a.driftMs))
	return rows
}

function replicationHeaders(token) {
	const t = String(token || '').trim()
	if (!t) return {}
	return { 'X-HighAsCG-Replication-Token': t }
}

async function fetchPlayheadExport(baseUrl, token) {
	const res = await httpJson(`${baseUrl.replace(/\/$/, '')}/api/replication/playhead-export`, {
		headers: replicationHeaders(token),
	})
	if (res.status !== 200 || !res.json?.channels) {
		throw new Error(`playhead-export failed ${res.status} (${baseUrl}): ${res.body?.slice(0, 200)}`)
	}
	return res.json
}

async function fetchReplicationStatus(baseUrl) {
	const res = await httpJson(`${baseUrl.replace(/\/$/, '')}/api/replication/status`)
	if (res.status !== 200) throw new Error(`status failed ${res.status}`)
	return res.json
}

async function loadTokenFromConfig() {
	const cfgPath = path.resolve(__dirname, '../../config/replication.json')
	try {
		const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
		return raw?.peer?.token || ''
	} catch {
		return ''
	}
}

function printHelp() {
	console.log(`measure-playhead-drift — compare leader vs backup OSC playheads (no AMCP)

  --leader URL     Leader HighAsCG base URL (required)
  --backup URL     Backup URL (optional; default from leader /api/replication/status)
  --token TOKEN    Replication pairing token (default: config/replication.json peer.token)
  --interval SEC   Sample interval (default 2)
  --samples N      Number of samples (default 30)
`)
}

async function main() {
	const args = parseArgs(process.argv)
	if (args.help || !args.leader) {
		printHelp()
		process.exit(args.help ? 0 : 1)
	}

	const token = args.token || (await loadTokenFromConfig())
	if (!token) {
		throw new Error(
			'replication token required: omit --token to read config/replication.json peer.token, or pass the pairing token from leader/follower replication config',
		)
	}
	let backupUrl = args.backup
	const status = await fetchReplicationStatus(args.leader)
	if (!backupUrl && status?.peer?.host) {
		backupUrl = `http://${status.peer.host}:${status.peer.port || 4200}`
	}
	if (!backupUrl) throw new Error('backup URL required (or leader must report peer.host)')

	console.log(`Leader:  ${args.leader}  role=${status.role}`)
	console.log(`Backup:  ${backupUrl}  fanout=${JSON.stringify(status.amcpFanout?.active)}`)
	console.log(`Samples: ${args.samples} every ${args.interval}s\n`)

	/** @type {number[]} */
	const maxDrifts = []

	for (let i = 0; i < args.samples; i++) {
		const t0 = Date.now()
		const [leader, backup] = await Promise.all([
			fetchPlayheadExport(args.leader, token),
			fetchPlayheadExport(backupUrl, token),
		])

		let sampleMax = 0
		const lines = []
		for (const ch of new Set([...Object.keys(leader.channels || {}), ...Object.keys(backup.channels || {})])) {
			const drifts = layerDrifts(leader.channels?.[ch]?.layers, backup.channels?.[ch]?.layers)
			for (const d of drifts) {
				if (Math.abs(d.driftMs) > Math.abs(sampleMax)) sampleMax = d.driftMs
				lines.push(
					`  ch${ch} L${d.layer} ${d.clip.slice(-40)} leader=${d.leaderSec.toFixed(2)}s backup=${d.followerSec.toFixed(2)}s drift=${d.driftMs}ms`,
				)
			}
		}
		maxDrifts.push(sampleMax)
		const elapsed = ((Date.now() - t0) / 1000).toFixed(2)
		console.log(`[${new Date().toISOString()}] sample ${i + 1}/${args.samples} maxDrift=${sampleMax}ms (${elapsed}s)`)
		if (lines.length) console.log(lines.join('\n'))
		else console.log('  (no matching playing layers)')

		if (i + 1 < args.samples) {
			await new Promise((r) => setTimeout(r, args.interval * 1000))
		}
	}

	if (maxDrifts.length >= 2) {
		const first = maxDrifts[0]
		const last = maxDrifts[maxDrifts.length - 1]
		const growth = last - first
		console.log(`\nSummary: first=${first}ms last=${last}ms growth=${growth}ms over ${args.samples} samples`)
		if (Math.abs(growth) > 500) {
			console.log('⚠ Drift is growing — check backup Caspar for duplicate AMCP (127.0.0.1 + leader IP), fps/video-mode mismatch, or ffmpeg latency warnings.')
		}
	}
}

main().catch((e) => {
	console.error(e.message || e)
	process.exit(1)
})
