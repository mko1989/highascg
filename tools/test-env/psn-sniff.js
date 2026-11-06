#!/usr/bin/env node
'use strict'

/**
 * WO-978 — PSN sniffer: what a lighting desk receives from the box. Joins the PSN group (236.10.10.10:56565) on every
 * IPv4 interface (or `--iface <ip>`), decodes DATA + INFO packets with src/fixtures/psn.js and prints, once a second,
 * one line per tracker: id, name, position, speed, status, the DATA rate it arrives at and the sender's address.
 *
 *   node tools/test-env/psn-sniff.js [--secs N] [--iface 10.0.0.13] [--json]
 *
 * Multicast loopback is per interface: HighAsCG's PSN output (project fixtures.output.psn.iface) reaches a socket on
 * this box only through an interface the socket joined on — joining all of them sees it whichever NIC sends.
 * Exit 0 when at least one tracker arrived, 1 when nothing did (handy in scripts: `--secs 3`).
 */

const dgram = require('dgram')
const os = require('os')
const path = require('path')
const { PSN_GROUP, PSN_PORT, decode } = require(path.join(__dirname, '..', '..', 'src', 'fixtures', 'psn'))

/** Collects decoded packets → per-tracker state + rate over the last window. `now` in ms. */
function createCollector(now = Date.now) {
	const trackers = new Map() // id → { id, name, pos, speed, status, from, stamps: [ms…] }
	let systemName = null
	let packets = 0
	let bad = 0
	const get = (id) => {
		if (!trackers.has(id)) trackers.set(id, { id, name: null, pos: null, speed: null, status: null, from: null, stamps: [] })
		return trackers.get(id)
	}
	function feed(buf, from = null) {
		let d
		try {
			d = decode(buf)
		} catch {
			bad++
			return null
		}
		if (d.id !== 0x6755 && d.id !== 0x6756) {
			bad++
			return null
		}
		packets++
		const t = now()
		if (d.id === 0x6756 && d.systemName) systemName = d.systemName
		for (const [k, o] of Object.entries(d.trackers)) {
			const r = get(Number(k))
			r.from = from
			if (d.id === 0x6756) {
				if (o.name != null) r.name = o.name
				continue
			}
			if (o.pos) r.pos = o.pos
			if (o.speed) r.speed = o.speed
			if (o.status != null) r.status = o.status
			r.stamps.push(t)
		}
		return d
	}
	/** Trackers with their DATA rate (Hz) over the last `windowMs`. */
	function snapshot(windowMs = 1000) {
		const t = now()
		const list = []
		for (const r of trackers.values()) {
			r.stamps = r.stamps.filter((s) => t - s <= windowMs)
			list.push({ id: r.id, name: r.name, pos: r.pos, speed: r.speed, status: r.status, from: r.from,
				hz: Math.round((r.stamps.length * 1000) / windowMs) })
		}
		return { system: systemName, packets, bad, trackers: list.sort((a, b) => a.id - b.id) }
	}
	return { feed, snapshot }
}

const f2 = (v) => (v == null ? '-' : v.map((x) => x.toFixed(2).padStart(7)).join(' '))

/** One snapshot tracker → a printable line. */
function formatTracker(r) {
	const sp = r.speed ? Math.hypot(...r.speed).toFixed(2) : '-'
	return `#${String(r.id).padEnd(3)} ${String(r.name ?? '?').padEnd(14)} pos ${f2(r.pos)}  speed ${f2(r.speed)} |${sp}| m/s` +
		`  status ${r.status ?? '-'}  ${String(r.hz).padStart(3)} Hz  from ${r.from ?? '?'}`
}

function ipv4Addresses() {
	const out = []
	for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4') out.push(a.address)
	return out
}

function main(argv) {
	const arg = (k) => {
		const i = argv.indexOf(k)
		return i >= 0 ? argv[i + 1] : null
	}
	const secs = Number(arg('--secs')) || 0
	const json = argv.includes('--json')
	const only = arg('--iface')
	const col = createCollector()
	const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
	sock.on('error', (e) => {
		console.error(`psn-sniff: ${e.message}${e.code === 'EADDRINUSE' ? ' (another program owns UDP 56565 without SO_REUSEADDR)' : ''}`)
		process.exit(2)
	})
	sock.on('message', (buf, rinfo) => col.feed(buf, rinfo.address))
	sock.bind(PSN_PORT, () => {
		const joined = []
		for (const ip of only ? [only] : ipv4Addresses()) {
			try {
				sock.addMembership(PSN_GROUP, ip)
				joined.push(ip)
			} catch (e) {
				console.error(`psn-sniff: join on ${ip} failed: ${e.message}`)
			}
		}
		if (!json) console.log(`psn-sniff: ${PSN_GROUP}:${PSN_PORT} joined on ${joined.join(', ') || 'nothing'}${secs ? `, ${secs} s` : ', Ctrl-C to stop'}`)
	})
	let seen = false
	const t = setInterval(() => {
		const s = col.snapshot()
		if (s.trackers.some((r) => r.hz > 0)) seen = true
		if (json) return console.log(JSON.stringify({ at: new Date().toISOString(), ...s }))
		const head = `${new Date().toISOString().slice(11, 19)}  ${s.system ?? '(no INFO yet)'}  ${s.packets} packets${s.bad ? `, ${s.bad} bad` : ''}`
		console.log([head, ...(s.trackers.length ? s.trackers.map((r) => '  ' + formatTracker(r)) : ['  (no trackers)'])].join('\n'))
	}, 1000)
	if (secs > 0)
		setTimeout(() => {
			clearInterval(t)
			sock.close()
			process.exit(seen ? 0 : 1)
		}, secs * 1000 + 100)
}

if (require.main === module) main(process.argv.slice(2))

module.exports = { createCollector, formatTracker }
