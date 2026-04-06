/** OSC from WS `{ type: 'osc', data }`. Pass `{ wsClient }` to share {@link WsClient}. */
import { getWsUrl } from './ws-client.js'
function mergeChannel(a, b) {
	if (!b) return a
	if (!a) return b
	const o = { ...a, ...b }
	if (b.layers || a.layers) {
		o.layers = { ...(a.layers || {}) }
		for (const k of Object.keys(b.layers || {})) o.layers[k] = { ...(a.layers && a.layers[k] ? a.layers[k] : {}), ...b.layers[k] }
	}
	return o
}
function safe(f) {
	try {
		f()
	} catch (e) {
		console.error('[OscClient]', e)
	}
}
export class OscClient {
	constructor(o = {}) {
		this._ws = o.wsClient || null
		this._url = o.url || getWsUrl()
		this._ri = o.reconnectInterval ?? 3000
		this._max = o.maxReconnectAttempts ?? 80
		this._n = 0
		this._ch = {}
		this._audio = new Map()
		this._layer = new Map()
		this._prof = new Map()
		/** @type {Set<() => void>} — run after every OSC merge (for PGM stack polling). */
		this._afterIngest = new Set()
		this._un = []
		this._sock = null
		this._tm = null
		if (this._ws) {
			this._un.push(this._ws.on('osc', (d) => this._ingest(d)))
			this._un.push(
				this._ws.on('state', (data) => {
					if (data?.osc?.channels && !Object.keys(this._ch).length) {
						this._ch = { ...data.osc.channels }
						this._run()
					}
				}),
			)
		} else this._own()
	}

	_ingest(d) {
		if (!d || typeof d !== 'object') return
		if (d.delta && d.channels) {
			for (const k of Object.keys(d.channels)) this._ch[k] = mergeChannel(this._ch[k], d.channels[k])
		} else if (d.channels) this._ch = { ...d.channels }
		this._run()
	}

	_run() {
		for (const [k, set] of this._audio) {
			const c = this._ch[k] || this._ch[String(k)]
			if (!c?.audio) continue
			const cn = parseInt(k, 10)
			for (const fn of set) safe(() => fn(c.audio, cn))
		}
		for (const [key, set] of this._layer) {
			const [cs, ls] = key.split('-')
			const c = this._ch[cs] || this._ch[String(cs)]
			const ln = parseInt(ls, 10)
			const ly = c?.layers?.[ls] ?? c?.layers?.[ln]
			if (!ly) continue
			const cn = parseInt(cs, 10)
			for (const fn of set) safe(() => fn(ly, cn, ln))
		}
		for (const [k, set] of this._prof) {
			const c = this._ch[k] || this._ch[String(k)]
			if (!c?.profiler) continue
			const cn = parseInt(k, 10)
			for (const fn of set) safe(() => fn(c.profiler, cn))
		}
		for (const fn of this._afterIngest) safe(() => fn())
	}

	/** Subscribe to every OSC state merge (after channels updated). Use to poll `channels[ch].layers`. */
	onAfterIngest(cb) {
		if (typeof cb !== 'function') return () => {}
		this._afterIngest.add(cb)
		return () => this._afterIngest.delete(cb)
	}

	_own() {
		try {
			this._sock = new WebSocket(this._url)
		} catch {
			return this._retry()
		}
		this._sock.onopen = () => {
			this._n = 0
		}
		this._sock.onmessage = (ev) => {
			try {
				const m = JSON.parse(ev.data)
				if (m.type === 'osc') this._ingest(m.data)
				if (m.type === 'state' && m.data?.osc?.channels && !Object.keys(this._ch).length) {
					this._ch = { ...m.data.osc.channels }
					this._run()
				}
			} catch {}
		}
		this._sock.onclose = () => {
			this._sock = null
			this._retry()
		}
	}

	_retry() {
		if (this._ws || this._max <= 0 || this._n >= this._max) return
		this._n++
		if (this._tm) clearTimeout(this._tm)
		this._tm = setTimeout(() => this._own(), this._ri)
	}

	onAudioLevels(ch, cb) {
		const k = String(ch)
		if (!this._audio.has(k)) this._audio.set(k, new Set())
		this._audio.get(k).add(cb)
		return () => this._audio.get(k)?.delete(cb)
	}

	onLayerState(ch, layer, cb) {
		const k = `${ch}-${layer}`
		if (!this._layer.has(k)) this._layer.set(k, new Set())
		this._layer.get(k).add(cb)
		return () => this._layer.get(k)?.delete(cb)
	}

	onProfiler(ch, cb) {
		const k = String(ch)
		if (!this._prof.has(k)) this._prof.set(k, new Set())
		this._prof.get(k).add(cb)
		return () => this._prof.get(k)?.delete(cb)
	}

	get channels() {
		return this._ch
	}

	close() {
		this._un.forEach((u) => u())
		this._un = []
		this._afterIngest.clear()
		this._max = 0
		if (this._tm) clearTimeout(this._tm)
		this._tm = null
		if (this._sock) {
			try {
				this._sock.close()
			} catch (_) {}
			this._sock = null
		}
	}
}
