'use strict'

const dgram = require('dgram')
const { portKeyFromPacket, parseArtDmx, readByte } = require('./artnet-packet')
const { PATCH_CHANNEL_COUNT } = require('./artnet-constants')

function bindUdpSocket(receiver) {
	try {
		const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
		socket.on('error', (e) => {
			receiver.log('error', `[ArtNet] UDP socket error: ${e.message}`)
		})
		socket.on('close', () => {
			if (receiver._socket === socket) {
				receiver._socket = null
				receiver.log('warn', '[ArtNet] UDP socket closed — will re-bind on next reconfigure if listen is enabled')
			}
		})
		socket.on('message', (msg, rinfo) => onUdpMessage(receiver, msg, rinfo))
		socket.on('listening', () => {
			const addr = socket.address()
			receiver.log(
				'info',
				`[ArtNet] UDP listening on ${addr.address}:${addr.port} ` +
					`screen=${receiver._targetScreenIndex + 1} globalBorders[${receiver._targetScreenIndex}] ` +
					`universe=${receiver._inputUniverse} startCh=${receiver._startChannel} (key=0x${receiver._portKey.toString(16)}) ` +
					`→ Caspar PGM ch${receiver._resolveProgramChannel()}`,
			)
		})
		socket.bind(receiver._inputPort, '0.0.0.0')
		receiver._socket = socket
	} catch (e) {
		receiver.log('error', `[ArtNet] Failed to start UDP receiver: ${e.message}`)
	}
}

function ensureSocketListening(receiver) {
	if (receiver._socket) return
	if (!receiver._targetConfigured) return
	if (!receiver._isMasterDmxEnabled()) return
	bindUdpSocket(receiver)
}

function onUdpMessage(receiver, msg, _rinfo) {
	try {
		receiver._bumpStat('udp')
		receiver._maybeLogStats()

		if (!receiver._targetConfigured) {
			receiver._bumpStat('noTarget')
			receiver._throttledDropLog(
				'no-target',
				'[ArtNet] Dropping ArtDMX: no globalBorders slot (targetConfigured=false). Save a global border on the configured screen.',
			)
			return
		}

		const data = parseArtDmx(msg)
		if (!data) {
			receiver._bumpStat('parseFail')
			return
		}
		receiver._bumpStat('artdmx')

		const pktKey = portKeyFromPacket(msg)
		if (pktKey !== receiver._portKey) {
			receiver._bumpStat('wrongUniverse')
			const subuni = pktKey != null ? pktKey >> 8 : -1
			const net = pktKey != null ? pktKey & 0xff : -1
			receiver._throttledDropLog(
				'wrong-universe',
				`[ArtNet] Dropping ArtDMX on net=${net} universe=${subuni & 0x0f} subnet=${(subuni >> 4) & 0x0f} ` +
					`(want key=0x${receiver._portKey.toString(16)} net=${receiver._inputNet} universe=${receiver._inputUniverse})`,
			)
			return
		}
		receiver._bumpStat('matched')

		if (receiver._logIntervalMs > 0) {
			const now = Date.now()
			if (!receiver._lastPatchLogMs || now - receiver._lastPatchLogMs >= receiver._logIntervalMs) {
				receiver._lastPatchLogMs = now
				const start = receiver._startChannel - 1
				const vals = []
				for (let i = 0; i < PATCH_CHANNEL_COUNT; i++) vals.push(readByte(data, start + i))
				receiver.log(
					'info',
					`[ArtNet] universe=${receiver._inputUniverse} ch${receiver._startChannel}-${receiver._startChannel + PATCH_CHANNEL_COUNT - 1}: ${vals.join(',')}`,
				)
			}
		}

		if (!receiver._effectiveListen()) {
			receiver._bumpStat('listenOff')
			return
		}
		receiver.handleData(data)
	} catch (e) {
		receiver._bumpStat('errors')
		receiver.log('error', `[ArtNet] Message handler error: ${e?.message || e}`)
		if (e?.stack) receiver.log('error', e.stack)
	}
}

module.exports = {
	bindUdpSocket,
	ensureSocketListening,
	onUdpMessage,
}
