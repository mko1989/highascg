/**
 * WO-319 — browser side of the GUI live stream: dedicated binary WS → WebCodecs VideoDecoder →
 * latest-frame holder for canvas draws.
 *
 * Mirrors the server contract in src/preview/gui-stream-ws-relay.js:
 *  - First message is JSON text: { type: 'gui_stream_config', codec, channel, fps, gop }.
 *  - Every binary message is ONE H.264 access unit: 8-byte header (u32 LE seq, u8 flags bit0 =
 *    keyframe, 3 reserved) + Annex B payload, ready for VideoDecoder.decode().
 *  - The server guarantees IDR-first on join and stale-drop on backpressure; the client still
 *    guards (never feed a delta before the first key) because a decoder error mid-stream would
 *    otherwise wedge until reconnect.
 *
 * DECODE-LATEST-WINS: only the newest decoded VideoFrame is kept (the previous one is closed the
 * moment its successor arrives). Consumers draw it with drawImage and MUST NOT close() it — this
 * module owns the frame lifecycle.
 *
 * Lifecycle is refcounted like the server ingest: acquire() on first consumer opens the socket
 * (which starts the NVENC consumer server-side), release() by the last closes it. Errors and
 * server absence degrade silently — consumers fall back to the JPEG snapshot path.
 */

const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 30000
const HEADER_BYTES = 8
const FLAG_KEYFRAME = 0x01

const state = {
	refs: 0,
	/** @type {WebSocket|null} */
	ws: null,
	/** @type {VideoDecoder|null} */
	decoder: null,
	config: null, // gui_stream_config payload
	/** @type {VideoFrame|null} */
	frame: null,
	frameCount: 0,
	seenKey: false,
	reconnectMs: RECONNECT_MIN_MS,
	reconnectTimer: null,
	lastError: null,
	listeners: new Set(),
}

export function guiStreamSupported() {
	return typeof WebSocket !== 'undefined' && typeof VideoDecoder !== 'undefined'
}

/** The channel the stream carries (from the server config), or null before connect. */
export function guiStreamChannel() {
	return state.config?.channel ?? null
}

/** Newest decoded frame — valid until the next one arrives. Never close() it. */
export function guiStreamFrame() {
	return state.frame
}

export function guiStreamStats() {
	return {
		refs: state.refs,
		connected: !!state.ws && state.ws.readyState === 1,
		frames: state.frameCount,
		lastError: state.lastError,
	}
}

/** @param {(frame: VideoFrame) => void} fn called on every decoded frame (schedule a repaint) */
export function subscribeGuiStreamFrames(fn) {
	state.listeners.add(fn)
	return () => state.listeners.delete(fn)
}

function emitFrame(frame) {
	for (const fn of state.listeners) {
		try {
			fn(frame)
		} catch {
			/* a bad listener must not break the frame path */
		}
	}
}

function dropFrame() {
	if (state.frame) {
		try {
			state.frame.close()
		} catch {
			/* already closed */
		}
		state.frame = null
	}
}

function makeDecoder(cfg) {
	const decoder = new VideoDecoder({
		output: (frame) => {
			dropFrame()
			state.frame = frame
			state.frameCount++
			emitFrame(frame)
		},
		error: (e) => {
			// A decode error mid-stream (lost reference, bad AU) — reconnect; the server resends
			// from the latest keyframe, which is exactly the recovery we need.
			state.lastError = `decoder: ${e?.message || e}`
			scheduleReconnect()
		},
	})
	// No description → Annex B mode with in-band SPS/PPS, which is what the stream carries.
	decoder.configure({ codec: cfg.codec || 'avc1.4d002a', optimizeForLatency: true })
	return decoder
}

function handleBinary(buf) {
	if (!state.decoder || state.decoder.state !== 'configured') return
	const view = new DataView(buf)
	if (buf.byteLength <= HEADER_BYTES) return
	const seq = view.getUint32(0, true)
	const key = (view.getUint8(4) & FLAG_KEYFRAME) !== 0
	if (!state.seenKey) {
		if (!key) return // never feed a delta before the first key
		state.seenKey = true
	}
	const fps = state.config?.fps || 50
	try {
		state.decoder.decode(
			new EncodedVideoChunk({
				type: key ? 'key' : 'delta',
				timestamp: Math.round(seq * (1e6 / fps)),
				data: new Uint8Array(buf, HEADER_BYTES),
			}),
		)
	} catch (e) {
		state.lastError = `decode: ${e?.message || e}`
		scheduleReconnect()
	}
}

function wsUrl() {
	const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
	return `${proto}//${location.host}/ws/gui-stream`
}

function teardownSocket() {
	if (state.reconnectTimer) {
		clearTimeout(state.reconnectTimer)
		state.reconnectTimer = null
	}
	if (state.ws) {
		state.ws.onopen = state.ws.onmessage = state.ws.onclose = state.ws.onerror = null
		try {
			state.ws.close()
		} catch {
			/* already closed */
		}
		state.ws = null
	}
	if (state.decoder) {
		try {
			state.decoder.close()
		} catch {
			/* already closed */
		}
		state.decoder = null
	}
	state.seenKey = false
}

function scheduleReconnect() {
	teardownSocket()
	if (state.refs <= 0) return
	if (state.reconnectTimer) return
	state.reconnectTimer = setTimeout(() => {
		state.reconnectTimer = null
		if (state.refs > 0) connect()
	}, state.reconnectMs)
	state.reconnectMs = Math.min(state.reconnectMs * 2, RECONNECT_MAX_MS)
}

function connect() {
	if (!guiStreamSupported()) return
	let ws
	try {
		ws = new WebSocket(wsUrl())
	} catch (e) {
		state.lastError = `ws: ${e?.message || e}`
		scheduleReconnect()
		return
	}
	ws.binaryType = 'arraybuffer'
	state.ws = ws
	ws.onopen = () => {
		state.reconnectMs = RECONNECT_MIN_MS
	}
	ws.onmessage = (ev) => {
		if (typeof ev.data === 'string') {
			let msg
			try {
				msg = JSON.parse(ev.data)
			} catch {
				return
			}
			if (msg.type === 'gui_stream_config') {
				state.config = msg
				if (state.decoder) {
					try {
						state.decoder.close()
					} catch {
						/* already closed */
					}
				}
				state.seenKey = false
				try {
					state.decoder = makeDecoder(msg)
				} catch (e) {
					state.lastError = `configure: ${e?.message || e}`
					state.decoder = null
				}
			} else if (msg.type === 'gui_stream_error') {
				state.lastError = msg.error || 'server error'
			}
			return
		}
		if (ev.data instanceof ArrayBuffer) handleBinary(ev.data)
	}
	ws.onclose = () => {
		if (state.refs > 0) scheduleReconnect()
	}
	ws.onerror = () => {
		/* onclose follows */
	}
}

export function acquireGuiStream() {
	state.refs++
	if (state.refs === 1 && !state.ws) connect()
	return state.refs
}

export function releaseGuiStream() {
	state.refs = Math.max(0, state.refs - 1)
	if (state.refs === 0) {
		teardownSocket()
		dropFrame()
		state.config = null
	}
	return state.refs
}
