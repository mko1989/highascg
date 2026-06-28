#!/usr/bin/env node
'use strict'

/**
 * Compare Caspar AMCP INFO + casparcg.config between leader and backup.
 * Usage: node tools/replication/compare-caspar-parity.js [--leader-host 127.0.0.1] [--backup-host 192.168.0.25]
 */

const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const { parseString } = require('xml2js')

function parseArgs(argv) {
	const out = { leaderHost: '127.0.0.1', backupHost: '192.168.0.25', port: 5250, channel: 1 }
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i]
		if (a === '--leader-host') out.leaderHost = argv[++i]
		else if (a === '--backup-host') out.backupHost = argv[++i]
		else if (a === '--port') out.port = parseInt(argv[++i], 10) || 5250
		else if (a === '--channel') out.channel = parseInt(argv[++i], 10) || 1
	}
	return out
}

function amcpQuery(host, port, command, timeoutMs = 5000) {
	return new Promise((resolve, reject) => {
		const socket = net.connect({ host, port })
		let buf = ''
		const done = (err, val) => {
			clearTimeout(timer)
			try {
				socket.destroy()
			} catch {
				/* ignore */
			}
			if (err) reject(err)
			else resolve(val)
		}
		const timer = setTimeout(() => done(new Error(`AMCP timeout ${host}:${port} ${command}`)), timeoutMs)
		socket.on('error', (e) => done(e))
		socket.on('data', (chunk) => {
			buf += chunk.toString('utf8')
			if (buf.includes('</channel>') || buf.includes('</configuration>')) done(null, buf)
		})
		socket.on('close', () => {
			if (buf) done(null, buf)
		})
		socket.write(`${command}\r\n`)
	})
}

function parseXml(xml) {
	return new Promise((resolve, reject) => {
		parseString(xml, { explicitArray: false, mergeAttrs: true }, (err, res) => {
			if (err) reject(err)
			else resolve(res)
		})
	})
}

function xmlBody(raw) {
	const idx = raw.indexOf('<?xml')
	return idx >= 0 ? raw.slice(idx) : raw
}

function pickLayerPlayhead(parsed, layerNum) {
	const stage = parsed?.channel?.stage?.layer || {}
	const key = `layer_${layerNum}`
	const layer = stage[key]
	if (!layer?.foreground) return null
	const fg = layer.foreground
	if (fg.producer === 'empty') return { layer: layerNum, producer: 'empty' }
	const file = fg.file || {}
	const streams = file.streams?.file || {}
	const stream0 = streams.streams_0 || streams['streams_0'] || {}
	const clipFps = stream0.fps
	const time = file.time
	const clip = file.name || file.path || ''
	let timeSec = NaN
	let durationSec = NaN
	if (Array.isArray(time)) {
		timeSec = parseFloat(time[0])
		durationSec = parseFloat(time[1])
	} else if (time != null) {
		timeSec = parseFloat(time)
	}
	return {
		layer: layerNum,
		producer: fg.producer,
		clip,
		timeSec,
		durationSec,
		clipFps: clipFps != null ? String(clipFps) : '',
		paused: String(fg.paused) === 'true',
	}
}

async function fetchChannelInfo(host, port, channel) {
	const raw = await amcpQuery(host, port, `INFO ${channel}`)
	const parsed = await parseXml(xmlBody(raw))
	const fr = parsed?.channel?.framerate
	const framerate = Array.isArray(fr) ? fr[0] : fr
	const format = parsed?.channel?.format
	const layers = [10, 110].map((n) => pickLayerPlayhead(parsed, n)).filter(Boolean)
	return { host, framerate: String(framerate || ''), format: String(format || ''), layers, rawLen: raw.length }
}

function summarizeConfigFile(configPath) {
	const xml = fs.readFileSync(configPath, 'utf8')
	const channels = []
	const re = /<!-- HighAsCG: Caspar channel (\d+):[^>]*-->\s*<channel>([\s\S]*?)<\/channel>/g
	let m
	while ((m = re.exec(xml))) {
		const block = m[2]
		const videoMode = (block.match(/<video-mode>([^<]+)<\/video-mode>/) || [])[1] || '?'
		const consumers = (block.match(/<consumers>([\s\S]*?)<\/consumers>/) || [])[1] || ''
		const consumerTypes = [...consumers.matchAll(/<([a-z0-9-]+)>/g)]
			.map((x) => x[1])
			.filter((t) => !['consumers', 'x', 'y', 'width', 'height'].includes(t))
		channels.push({ channel: parseInt(m[1], 10), videoMode, consumers: [...new Set(consumerTypes)] })
	}
	if (!channels.length) {
		const count = (xml.match(/<channel>/g) || []).length
		channels.push({ channel: '?', videoMode: 'parse-fallback', consumers: [`${count} channel blocks`] })
	}
	return { configPath, bytes: xml.length, md5: require('crypto').createHash('md5').update(xml).digest('hex'), channels }
}

async function main() {
	const args = parseArgs(process.argv)
	const leaderCfg = summarizeConfigFile(path.resolve(__dirname, '../../config/casparcg.config'))
	const backupCfgPath = '/home/casparcg/highascg/config/casparcg.config'

	console.log('=== casparcg.config summary ===\n')
	console.log('LEADER (.20 local):')
	printConfigSummary(leaderCfg)
	console.log('\nBACKUP (.25):')
	let backupCfg
	try {
		const { execSync } = require('node:child_process')
		const remote = execSync(
			`ssh -o BatchMode=yes 192.168.0.25 'cat /home/casparcg/highascg/config/casparcg.config'`,
			{ encoding: 'utf8', maxBuffer: 2_000_000 },
		)
		const tmp = path.join(require('os').tmpdir(), 'casparcg-backup.config')
		fs.writeFileSync(tmp, remote)
		backupCfg = summarizeConfigFile(tmp)
	} catch (e) {
		console.log('  (ssh failed:', e.message, ')')
		backupCfg = { configPath: backupCfgPath, channels: [] }
	}
	printConfigSummary(backupCfg)

	console.log('\n=== AMCP INFO', args.channel, '(idle or live) ===\n')
	const [leaderInfo, backupInfo] = await Promise.all([
		fetchChannelInfo(args.leaderHost, args.port, args.channel),
		fetchChannelInfo(args.backupHost, args.port, args.channel),
	])
	printInfo('LEADER', leaderInfo)
	printInfo('BACKUP', backupInfo)

	const l10 = leaderInfo.layers.find((x) => x.layer === 10)
	const b10 = backupInfo.layers.find((x) => x.layer === 10)
	if (l10?.timeSec != null && b10?.timeSec != null && l10.producer !== 'empty') {
		const driftMs = Math.round((l10.timeSec - b10.timeSec) * 1000)
		console.log(`\nL10 drift (leader − backup): ${driftMs}ms`)
		if (l10.timeSec > 0) {
			const ratio = ((b10.timeSec / l10.timeSec) * 100).toFixed(1)
			console.log(`L10 backup/leader time ratio: ${ratio}%`)
		}
	}

	const cfgDiffs = diffConfigs(leaderCfg, backupCfg)
	if (cfgDiffs.length) {
		console.log('\n=== Config differences (per channel) ===')
		for (const d of cfgDiffs) console.log(' ', d)
	} else {
		console.log('\n(no structured channel diffs parsed)')
	}
}

function printConfigSummary(cfg) {
	console.log(`  path: ${cfg.configPath}`)
	console.log(`  bytes: ${cfg.bytes}  md5: ${cfg.md5}`)
	for (const ch of cfg.channels) {
		console.log(`  ch${ch.channel}: video-mode=${ch.videoMode}  consumers=[${ch.consumers.join(', ')}]`)
	}
}

function printInfo(label, info) {
	console.log(`${label} ${info.host}:`)
	console.log(`  format=${info.format}  framerate=${info.framerate}`)
	for (const ly of info.layers) {
		if (ly.producer === 'empty') {
			console.log(`  L${ly.layer}: empty`)
			continue
		}
		console.log(
			`  L${ly.layer}: ${ly.clip} time=${ly.timeSec}/${ly.durationSec}s clipFps=${ly.clipFps} producer=${ly.producer} paused=${ly.paused}`,
		)
	}
}

function diffConfigs(a, b) {
	const diffs = []
	const am = new Map(a.channels.map((c) => [c.channel, c]))
	const bm = new Map(b.channels.map((c) => [c.channel, c]))
	const keys = new Set([...am.keys(), ...bm.keys()])
	for (const k of [...keys].sort((x, y) => Number(x) - Number(y))) {
		const ac = am.get(k)
		const bc = bm.get(k)
		if (!ac) {
			diffs.push(`ch${k}: only on backup`)
			continue
		}
		if (!bc) {
			diffs.push(`ch${k}: only on leader`)
			continue
		}
		if (ac.videoMode !== bc.videoMode) diffs.push(`ch${k}: video-mode ${ac.videoMode} vs ${bc.videoMode}`)
		const acs = ac.consumers.join(',')
		const bcs = bc.consumers.join(',')
		if (acs !== bcs) diffs.push(`ch${k}: consumers [${acs}] vs [${bcs}]`)
	}
	if (a.md5 !== b.md5) diffs.push(`config md5: ${a.md5} vs ${b.md5}`)
	return diffs
}

main().catch((e) => {
	console.error(e.message || e)
	process.exit(1)
})
