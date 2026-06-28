#!/usr/bin/env node
'use strict'

/** Live AMCP INFO drift poll — raw Caspar <file><time>, not OSC. */

const net = require('node:net')
const { parseString } = require('xml2js')

const LEADER = process.env.LEADER_HOST || '127.0.0.1'
const BACKUP = process.env.BACKUP_HOST || '192.168.0.25'
const PORT = 5250
const CHANNEL = 1
const LAYER = 10
const INTERVAL_SEC = 2
const SAMPLES = 32

function amcp(host, command, timeoutMs = 5000) {
	return new Promise((resolve, reject) => {
		const socket = net.connect({ host, port: PORT })
		let buf = ''
		const finish = (err, val) => {
			clearTimeout(t)
			try {
				socket.destroy()
			} catch {
				/* ignore */
			}
			err ? reject(err) : resolve(val)
		}
		const t = setTimeout(() => finish(new Error(`timeout ${host} ${command}`)), timeoutMs)
		socket.on('error', finish)
		socket.on('data', (c) => {
			buf += c.toString('utf8')
			if (buf.includes('</channel>') || buf.includes('</configuration>')) finish(null, buf)
			else if (/^2\d{2} /m.test(buf) && !command.startsWith('INFO')) finish(null, buf)
		})
		socket.write(`${command}\r\n`)
	})
}

function parseLayerTime(raw) {
	const xml = raw.includes('<?xml') ? raw.slice(raw.indexOf('<?xml')) : raw
	return new Promise((resolve) => {
		parseString(xml, { explicitArray: false }, (err, parsed) => {
			if (err) return resolve(null)
			const layer = parsed?.channel?.stage?.layer?.[`layer_${LAYER}`]
			const fg = layer?.foreground
			if (!fg || fg.producer === 'empty') return resolve(null)
			const time = fg.file?.time
			let timeSec = NaN
			let durationSec = NaN
			if (Array.isArray(time)) {
				timeSec = parseFloat(time[0])
				durationSec = parseFloat(time[1])
			} else if (time != null) timeSec = parseFloat(time)
			const clip = fg.file?.name || ''
			const streams = fg.file?.streams?.file?.streams_0?.fps
			const clipFps = Array.isArray(streams) ? streams[0] : streams
			resolve({ timeSec, durationSec, clip, clipFps: clipFps != null ? String(clipFps) : '' })
		})
	})
}

async function playFromStart(host) {
	await amcp(host, `LOADBG ${CHANNEL}-${LAYER} 3825579625-preview.mp4 SEEK 0`)
	await amcp(host, `PLAY ${CHANNEL}-${LAYER}`)
}

async function sample(host) {
	const raw = await amcp(host, `INFO ${CHANNEL}`)
	return parseLayerTime(raw)
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms))
}

async function main() {
	console.log(`Restarting PLAY ${CHANNEL}-${LAYER} SEEK 0 on both boxes...`)
	await Promise.all([playFromStart(LEADER), playFromStart(BACKUP)])
	await sleep(500)

	console.log(`Polling INFO ${CHANNEL} L${LAYER} every ${INTERVAL_SEC}s (${SAMPLES} samples)\n`)
	const drifts = []

	for (let i = 0; i < SAMPLES; i++) {
		const [l, b] = await Promise.all([sample(LEADER), sample(BACKUP)])
		if (!l || !b) {
			console.log(`[${i + 1}] no playing layer (leader=${!!l} backup=${!!b})`)
		} else {
			const driftMs = Math.round((l.timeSec - b.timeSec) * 1000)
			drifts.push(driftMs)
			const ratio = l.timeSec > 0.1 ? ((b.timeSec / l.timeSec) * 100).toFixed(1) : '—'
			console.log(
				`[${i + 1}/${SAMPLES}] leader=${l.timeSec.toFixed(2)}s backup=${b.timeSec.toFixed(2)}s drift=${driftMs}ms ratio=${ratio}% clipFps L=${l.clipFps} B=${b.clipFps}`,
			)
		}
		if (i + 1 < SAMPLES) await sleep(INTERVAL_SEC * 1000)
	}

	if (drifts.length >= 2) {
		const first = drifts[0]
		const last = drifts[drifts.length - 1]
		console.log(`\nSummary: first=${first}ms last=${last}ms growth=${last - first}ms`)
	}
}

main().catch((e) => {
	console.error(e.message || e)
	process.exit(1)
})
