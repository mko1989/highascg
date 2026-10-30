#!/usr/bin/env node
'use strict'

/**
 * WO-857 — receive-only CITP discovery listener for the MagicQ selection test. Joins the CITP multicast groups
 * (239.224.0.180 and the old 224.0.0.180, UDP 4809) and prints every datagram it hears: source, the CITP header fields
 * (cookie, version, layer, content code) and a hex + ASCII dump. It never sends anything, so nothing reaches MagicQ or any
 * network. Question it answers: does MagicQ announce itself (PINF PLoc) and with which TCP port / name?
 *
 *   node tools/lighting/citp-listen.js [--seconds=300] [--port=4809] [--no-join] [--out=<file>]
 *
 * --no-join + --port is for testing the listener itself on 127.0.0.1 unicast.
 */

const dgram = require('dgram')
const fs = require('fs')
const os = require('os')

const arg = (k, d) => {
	const hit = process.argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`))
	return !hit ? d : hit.includes('=') ? hit.split('=').slice(1).join('=') : '1'
}
const port = Number(arg('port', '4809'))
const seconds = Number(arg('seconds', '300'))
const groups = ['239.224.0.180', '224.0.0.180']
const out = arg('out', '') ? fs.createWriteStream(arg('out', ''), { flags: 'a' }) : null
const say = (s) => {
	console.log(s)
	if (out) out.write(s + '\n')
}

/** One CITP datagram → "CITP v1.0 layer=PINF code=PLoc size=…" (the header is 20 bytes: cookie, version, request index, size, parts, layer). */
function describe(buf) {
	if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'CITP') return 'not CITP'
	const layer = buf.toString('latin1', 16, 20)
	const code = buf.length >= 24 ? buf.toString('latin1', 20, 24) : ''
	return `CITP v${buf[4]}.${buf[5]} layer=${layer} code=${code} size=${buf.readUInt32LE(8)} parts=${buf.readUInt16LE(12)}/${buf.readUInt16LE(14)}`
}

function dump(buf) {
	const lines = []
	for (let i = 0; i < buf.length; i += 16) {
		const row = buf.subarray(i, i + 16)
		const hex = [...row].map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47)
		lines.push(`  ${i.toString(16).padStart(4, '0')}  ${hex}  ${[...row].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')}`)
	}
	return lines.join('\n')
}

const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
sock.on('error', (e) => {
	console.error('citp-listen: ' + e.message)
	process.exit(1)
})
sock.on('message', (msg, r) => {
	say(`${new Date().toISOString()} ${r.address}:${r.port} ${msg.length} bytes  ${describe(msg)}\n${dump(msg)}`)
})
sock.bind(port, () => {
	if (!arg('no-join', '')) {
		const addrs = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4').map((i) => i.address)
		let joined = 0
		for (const g of groups) {
			for (const a of addrs) {
				try {
					sock.addMembership(g, a)
					joined++
				} catch (_) {
					/* interface cannot join */
				}
			}
		}
		say(`citp-listen: joined ${groups.join(', ')} on ${joined} interface address(es) (${addrs.join(', ')}), UDP ${port}, ${seconds} s. Receive only.`)
	} else {
		say(`citp-listen: unicast test mode on 127.0.0.1:${port}`)
	}
	setTimeout(() => {
		say('citp-listen: done')
		sock.close()
		out?.end()
	}, seconds * 1000)
})
