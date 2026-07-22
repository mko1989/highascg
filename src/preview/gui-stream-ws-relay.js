'use strict'

/**
 * WO-319 — dedicated binary WebSocket relay for the GUI live stream.
 *
 * WHY A SEPARATE ENDPOINT: the main operator WS (src/server/ws-server.js) is a JSON-text protocol —
 * the client's onmessage converts even binary frames to UTF-8 text before JSON.parse. Video AUs are
 * binary and high-rate; mixing them into that socket would head-of-line block state updates behind
 * video bytes. So the stream gets its own upgrade path (`/ws/gui-stream`), same auth checks as the
 * main WS, no compression (perMessageDeflate would burn CPU recompressing already-compressed video).
 *
 * WIRE FORMAT (server → client), one WS binary message per access unit:
 *   bytes 0..3  u32 LE   seq
 *   byte  4     u8       flags — bit0 = keyframe
 *   bytes 5..7           reserved (0)
 *   bytes 8..   the complete Annex B access unit, ready for VideoDecoder.decode()
 * The first message after connect is JSON TEXT: { type: 'gui_stream_config', codec, fps, gop } —
 * the client configures its decoder from it before touching any binary frame.
 *
 * DELIVERY POLICY is gui-stream-gop-buffer verbatim: per-client cursor, IDR-first on join, and
 * stale-drop on backpressure — when a client's socket send buffer exceeds the high-water mark its
 * cursor is reset instead of queueing more (decode-latest-wins; the reset makes the next pump
 * deliver from the newest keyframe once the buffer drains below the mark).
 *
 * Client lifecycle drives the ingest refcount: connect → ingest.acquire() (starts NVENC + remux on
 * first client), close → ingest.release() (teardown after linger when the last one leaves).
 */

const WebSocket = require('ws')

const { createClientCursor, framesForClient, resetClientToKeyframe } = require('./gui-stream-gop-buffer')

const GUI_STREAM_WS_PATH = '/ws/gui-stream'
/** Above this many unsent bytes on a client socket, stop feeding it and reset to keyframe. Kept
 * SMALL on purpose: a live preview wants LOWEST LATENCY, and dropping frames to catch up is fine —
 * delivering every frame is NOT the goal. At ~6 Mbps, 128 KB ≈ 0.17s, so a client that falls behind
 * jumps to the newest keyframe almost immediately instead of playing out a backlog. */
const DEFAULT_HIGH_WATER_BYTES = 128 * 1024
const HEADER_BYTES = 8
const FLAG_KEYFRAME = 0x01

/**
 * Frame a single AU for the wire. Pure, exported for tests (the client parser must mirror it).
 * @param {{ seq: number, keyframe: boolean, data: Buffer }} frame
 * @returns {Buffer}
 */
function encodeWireFrame(frame) {
	const header = Buffer.alloc(HEADER_BYTES)
	header.writeUInt32LE(frame.seq >>> 0, 0)
	header.writeUInt8(frame.keyframe ? FLAG_KEYFRAME : 0, 4)
	return Buffer.concat([header, frame.data])
}

/**
 * @param {import('http').Server} httpServer
 * @param {object} ctx app context (config used by the auth helpers)
 * @param {{
 *   ingest: ReturnType<import('./gui-stream-ingest').createGuiStreamIngest>,
 *   log?: (level: string, msg: string) => void,
 *   codec?: string,
 *   channel?: number,
 *   fps?: number,
 *   gop?: number,
 *   highWaterBytes?: number,
 *   wsPath?: string,
 * }} opts
 */
function attachGuiStreamRelay(httpServer, ctx, opts) {
	const log = opts.log || (() => {})
	const ingest = opts.ingest
	const wsPath = opts.wsPath || GUI_STREAM_WS_PATH
	const highWater = opts.highWaterBytes ?? DEFAULT_HIGH_WATER_BYTES
	// Annex B with in-band SPS/PPS: the codec string is a capability hint, not a description.
	const codec = opts.codec || 'avc1.4d002a'

	const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: false })
	/** @type {Set<{ ws: import('ws'), cursor: ReturnType<typeof createClientCursor> }>} */
	const clients = new Set()

	function pumpClient(entry) {
		const { ws, cursor } = entry
		if (ws.readyState !== WebSocket.OPEN) return
		if (ws.bufferedAmount > highWater) {
			// Backpressure: never queue on top of a full buffer. The reset means that once the socket
			// drains, the client restarts at the newest keyframe — latency is capped, not accumulated.
			if (cursor.lastSentSeq != null) {
				resetClientToKeyframe(cursor)
				log('info', `[GUI stream] client lagging (${ws.bufferedAmount}b buffered) — reset to keyframe`)
			}
			return
		}
		const { frames } = framesForClient(ingest.buffer, cursor)
		for (const f of frames) ws.send(encodeWireFrame(f))
	}

	function pumpAll() {
		for (const entry of clients) pumpClient(entry)
	}
	ingest.events.on('au', pumpAll)

	wss.on('connection', (ws) => {
		const entry = { ws, cursor: createClientCursor() }
		clients.add(entry)
		// Latency: disable Nagle. Each access unit is a small message; Nagle would hold it up to
		// ~40ms waiting to coalesce — invisible on localhost, very visible over WiFi. Video wants
		// every frame out the instant it is ready.
		try {
			ws._socket?.setNoDelay?.(true)
		} catch {
			/* socket already gone */
		}
		log('info', `[GUI stream] client connected (${clients.size} watching)`)
		ws.send(
			JSON.stringify({
				type: 'gui_stream_config',
				codec,
				channel: opts.channel ?? null,
				fps: opts.fps ?? 50,
				gop: opts.gop ?? 50,
			}),
		)
		ingest
			.acquire()
			.then(() => pumpClient(entry)) // late joiner: serve the buffered GOP immediately
			.catch((e) => {
				log('warn', `[GUI stream] start failed for client: ${e?.message || e}`)
				try {
					ws.send(JSON.stringify({ type: 'gui_stream_error', error: String(e?.message || e) }))
					ws.close()
				} catch {
					/* already gone */
				}
			})
		ws.on('close', () => {
			clients.delete(entry)
			ingest.release()
			log('info', `[GUI stream] client left (${clients.size} watching)`)
		})
		ws.on('error', () => {
			/* close follows; refcount handled there */
		})
	})

	function onUpgrade(req, socket, head) {
		const p = (req.url || '').split('?')[0]
		if (p !== wsPath) return // not ours — other upgrade handlers may claim it
		try {
			const { checkWebSocketAuth, isOriginAllowed } = require('../server/auth')
			if (!isOriginAllowed(req, ctx?.config)) {
				socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
				socket.destroy()
				return
			}
			const auth = checkWebSocketAuth(req, ctx)
			if (!auth.ok) {
				socket.write(`HTTP/1.1 ${auth.status || 401} Unauthorized\r\n\r\n`)
				socket.destroy()
				return
			}
			wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
		} catch (e) {
			log('warn', `[GUI stream] upgrade error: ${e?.message || e}`)
			try {
				socket.destroy()
			} catch {
				/* already gone */
			}
		}
	}
	httpServer.on('upgrade', onUpgrade)

	return {
		wss,
		clientCount: () => clients.size,
		detach() {
			httpServer.removeListener('upgrade', onUpgrade)
			ingest.events.removeListener('au', pumpAll)
			for (const { ws } of clients) {
				try {
					ws.close()
				} catch {
					/* already gone */
				}
			}
			clients.clear()
		},
		// test hooks
		_pumpClient: pumpClient,
		_clients: clients,
	}
}

module.exports = {
	GUI_STREAM_WS_PATH,
	DEFAULT_HIGH_WATER_BYTES,
	HEADER_BYTES,
	FLAG_KEYFRAME,
	encodeWireFrame,
	attachGuiStreamRelay,
}
