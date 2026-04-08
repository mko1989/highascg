'use strict'

const dgram = require('dgram')

/**
 * Try binding UDP on `address:port` the same way preview bridges do (exclusive listener).
 * Resolves `true` if the port was free (socket is closed before return).
 * @param {number} port
 * @param {string} [address='127.0.0.1']
 * @returns {Promise<boolean>}
 */
function probeUdpPortFree(port, address = '127.0.0.1') {
	return new Promise((resolve) => {
		const s = dgram.createSocket('udp4')
		const done = (free) => {
			try {
				s.close()
			} catch {
				/* ignore */
			}
			resolve(free)
		}
		s.on('error', () => done(false))
		try {
			s.bind({ port, address, exclusive: true }, () => done(true))
		} catch {
			try {
				s.bind(port, address, () => done(true))
			} catch {
				done(false)
			}
		}
	})
}

/** PGM / preview / multiview destination ports for a given streaming base. */
function streamingUdpPortsForBase(basePort) {
	return [basePort + 1, basePort + 2, basePort + 5]
}

/**
 * @param {number} basePort
 * @param {string} [address]
 * @returns {Promise<number[]>} Ports that could not be bound (busy).
 */
async function listBusyStreamingPorts(basePort, address = '127.0.0.1') {
	const busy = []
	for (const p of streamingUdpPortsForBase(basePort)) {
		if (!(await probeUdpPortFree(p, address))) busy.push(p)
	}
	return busy
}

/**
 * If configured UDP ports are taken (e.g. stale Caspar STREAM on 10001–10003), scan upward
 * for a base where base+1, base+2, base+5 are all bindable.
 *
 * @param {number} wantBase - `streaming.basePort` from config
 * @param {{ autoRelocate?: boolean, maxScan?: number, log?: (level: string, msg: string) => void }} [opts]
 * @returns {Promise<{ basePort: number, adjusted: boolean, busyAtConfigured: number[] }>}
 */
async function resolveFreeStreamingBasePort(wantBase, opts = {}) {
	const autoRelocate = opts.autoRelocate !== false
	const maxScan = Math.max(1, opts.maxScan ?? 500)
	const log = opts.log || (() => {})

	const want = Number(wantBase)
	if (!Number.isFinite(want) || want < 0 || want > 65520) {
		throw new Error(`streaming.basePort invalid: ${wantBase}`)
	}

	let busyAtConfigured = await listBusyStreamingPorts(want)
	if (busyAtConfigured.length === 0) {
		return { basePort: want, adjusted: false, busyAtConfigured: [] }
	}

	const msgBusy = `UDP preview ports busy (cannot bind 127.0.0.1): ${busyAtConfigured.join(', ')} — often stale Caspar STREAM listeners; check: ss -ulpn | grep ${busyAtConfigured[0]}`
	const hintStale =
		' If Caspar was restarted without clearing STREAM channels, restart Caspar (AMCP RESTART) or remove STREAM consumers so UDP listeners release.'

	if (!autoRelocate) {
		log('error', `[Streaming] ${msgBusy}${hintStale}`)
		throw new Error(
			`Streaming: ${msgBusy} Set streaming.autoRelocateBasePort true or raise streaming.basePort (e.g. 10010).`
		)
	}

	log('warn', `[Streaming] ${msgBusy}${hintStale}`)
	log('info', `[Streaming] Scanning for a free UDP block (base+1, base+2, base+5) starting at base ${want + 1}…`)

	for (let b = want + 1; b < want + maxScan; b++) {
		const busy = await listBusyStreamingPorts(b)
		if (busy.length === 0) {
			log(
				'warn',
				`[Streaming] Relocated streaming basePort ${want} → ${b} (configured ports were in use). Update highascg.config.json if you want this permanent.`
			)
			return { basePort: b, adjusted: true, busyAtConfigured }
		}
	}

	log('error', `[Streaming] No free UDP block in ${maxScan} steps after base ${want}`)
	throw new Error(
		`Streaming: could not find three free UDP ports (base+1, base+2, base+5) within ${maxScan} attempts after base ${want}. Free stale Caspar STREAM bindings or set streaming.basePort manually.`
	)
}

module.exports = {
	probeUdpPortFree,
	streamingUdpPortsForBase,
	listBusyStreamingPorts,
	resolveFreeStreamingBasePort,
}
