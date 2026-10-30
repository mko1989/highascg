'use strict'

/**
 * `/channel/N/mixer/audio/volume` bundles linear or packed **amplitude** samples (not dBFS).
 * Map one sample to dBFS for `levels[].dBFS`. Amplitude **0** is true silence → ~−120 dBFS.
 * Do **not** use this for `/M/dBFS` floats: there **0** means **0 dBFS** (digital full scale).
 * @param {number} raw
 * @returns {number}
 */
function intMeterSampleToDbfs(raw) {
	const n = Number(raw)
	if (!Number.isFinite(n)) return -120
	// Linear amplitude 0 — no signal (not the same semantic as 0 dBFS on the float meter path).
	if (n === 0) return -120
	if (n >= -120 && n < 0) return n
	// Fixed-point dBFS (negative millibels / millidecibels)
	if (n < 0 && n >= -120000) return n / 1000
	if (n < 0 && n >= -12000) return n / 100
	if (n < 0) return Math.max(-120, n / 1000)
	// Linear amplitude 0..32767 (common packed meter) → dBFS
	if (n > 0 && n <= 65535) {
		const lin = Math.min(1, Math.max(1e-10, n / 32767))
		return 20 * Math.log10(lin)
	}
	// Large positive int32 (e.g. unsigned linear packed) — avoid falling through to -120
	if (n > 65535 && n <= 0x7fffffff) {
		const lin = Math.min(1, Math.max(1e-10, n / 2147483647))
		return 20 * Math.log10(lin)
	}
	return -120
}

/**
 * WO-830a: one OSC datagram is attacker-sized (UDP :6251 is bound on 0.0.0.0 by default). `nb_channels` and the
 * `/N/dBFS` meter index each drove an unbounded `levels.push` loop (a 10^9 value = OOM / frozen node). No real
 * Caspar channel carries more than a few dozen audio channels, so anything past this is a malformed or hostile packet.
 */
const MAX_AUDIO_CHANNELS = 64

const audioMethods = {
	/**
	 * @returns {boolean} true when a CONSUMED value (nbChannels, dBFS, peak) changed — WO-401
	 * F3-revised delta dirty-marking. Timestamps (`_lastUpdateAt`, `peakAge`) never count: on a
	 * silent channel the same dBFS repeats every tick and must not keep the channel dirty.
	 */
	_routeMixerAudio(ch, sub, vals) {
		const lm = sub.match(/^layer\/(\d+)\/volume$/)
		if (lm) return this._routeLayerAudio(ch, parseInt(lm[1], 10), vals)
		const c = this._ensureChannel(ch)
		if (sub === 'nb_channels') {
			const n = Math.min(MAX_AUDIO_CHANNELS, Math.max(0, parseInt(String(vals[0]), 10) || 0))
			const changed = c.audio.nbChannels !== n || c.audio.levels.length !== n
			c.audio.nbChannels = n
			c.audio._nbChannelsFromOsc = true
			while (c.audio.levels.length < n) {
				c.audio.levels.push({ dBFS: -120, peak: -120, peakAge: 0 })
			}
			if (c.audio.levels.length > n) c.audio.levels.length = n
			return changed
		}
		// Forks may emit bundled int meters (e.g. 16× int32) instead of per-index …/M/dBFS messages.
		if (sub === 'volume' && vals.length > 0) {
			const a = c.audio
			// Do not inflate channel count from padded volume bundles — trust nb_channels when set.
			const cap = a._nbChannelsFromOsc && a.nbChannels > 0 ? a.nbChannels : vals.length
			const n = Math.min(vals.length, cap, MAX_AUDIO_CHANNELS)
			let changed = false
			if (!a._nbChannelsFromOsc && a.nbChannels !== n) {
				a.nbChannels = n
				changed = true
			}
			const now = Date.now()
			a._lastUpdateAt = now
			for (let i = 0; i < n; i++) {
				const db = intMeterSampleToDbfs(vals[i])
				while (a.levels.length <= i) {
					a.levels.push({ dBFS: -120, peak: -120, peakAge: 0 })
					changed = true
				}
				const slot = a.levels[i]
				if (slot.dBFS !== db) changed = true
				slot.dBFS = db
				if (!Number.isFinite(slot.peak) || db > slot.peak || now - slot.peakAge > this._config.peakHoldMs) {
					if (slot.peak !== db) changed = true
					slot.peak = db
					slot.peakAge = now
				}
			}
			return changed
		}
		const dm = sub.match(/^(\d+)\/dBFS$/)
		if (dm) {
			const rawIdx = parseInt(dm[1], 10)
			const a = c.audio
			// Caspar builds differ: some use /mixer/audio/0/dBFS (0-based), some /mixer/audio/1/dBFS (1-based) for the first meter.
			if (a._meterIndexBase === undefined) {
				a._meterIndexBase = rawIdx === 0 ? 0 : 1
			}
			const idx = a._meterIndexBase === 1 ? rawIdx - 1 : rawIdx
			if (idx < 0 || idx >= MAX_AUDIO_CHANNELS || !Number.isFinite(idx)) return false
			const rawDb = Number(vals[0])
			let changed = false
			while (a.levels.length <= idx) {
				a.levels.push({ dBFS: -120, peak: -120, peakAge: 0 })
				changed = true
			}
			const slot = a.levels[idx]
			const now = Date.now()
			const db = Number.isFinite(rawDb) ? rawDb : slot.dBFS
			if (slot.dBFS !== db) changed = true
			slot.dBFS = db
			a._lastUpdateAt = now
			if (!Number.isFinite(slot.peak) || db > slot.peak || now - slot.peakAge > this._config.peakHoldMs) {
				if (slot.peak !== db) changed = true
				slot.peak = db
				slot.peakAge = now
			}
			return changed
		}
		return false
	},

	/**
	 * WO-800: `/channel/N/mixer/audio/layer/L/volume` (HighAsCG Caspar build) — int32 sample peak per audio channel
	 * of ONE stage layer, same unit as the channel `volume`. Kept outside `_channels` so the WS/`/api/state` payload
	 * is unchanged; read via {@link getLayerAudioLevels}. Never dirties the channel (returns false).
	 */
	_routeLayerAudio(ch, layer, vals) {
		if (!Number.isFinite(ch) || !Number.isFinite(layer) || vals.length === 0) return false
		if (!this._layerAudio) this._layerAudio = {}
		const byLayer = this._layerAudio[ch] || (this._layerAudio[ch] = {})
		const entry = byLayer[layer] || (byLayer[layer] = { nbChannels: 0, levels: [], _lastUpdateAt: 0 })
		const ca = this._channels[ch]?.audio
		const cap = ca?._nbChannelsFromOsc && ca.nbChannels > 0 ? ca.nbChannels : vals.length
		const n = Math.min(vals.length, cap, MAX_AUDIO_CHANNELS)
		const now = Date.now()
		entry.nbChannels = n
		entry._lastUpdateAt = now
		if (entry.levels.length > n) entry.levels.length = n
		for (let i = 0; i < n; i++) {
			const db = intMeterSampleToDbfs(vals[i])
			const slot = entry.levels[i] || (entry.levels[i] = { dBFS: -120, peak: -120, peakAge: 0 })
			slot.dBFS = db
			if (!Number.isFinite(slot.peak) || db > slot.peak || now - slot.peakAge > this._config.peakHoldMs) {
				slot.peak = db
				slot.peakAge = now
			}
		}
		return false
	},

	/**
	 * WO-800: per-layer audio levels, `{ [ch]: { [layer]: { nbChannels, levels: [{ dBFS, peak }], updatedAt } } }`.
	 * Caspar only sends a layer while it contributes audio, so entries older than `staleTimeoutMs` are dropped.
	 * @param {number} [onlyCh]
	 */
	getLayerAudioLevels(onlyCh, now = Date.now()) {
		const staleMs = Number.isFinite(this._config.staleTimeoutMs) && this._config.staleTimeoutMs > 0 ? this._config.staleTimeoutMs : 1000
		const out = {}
		for (const chKey of Object.keys(this._layerAudio || {})) {
			const byLayer = this._layerAudio[chKey]
			for (const lKey of Object.keys(byLayer)) {
				if (now - byLayer[lKey]._lastUpdateAt > staleMs) delete byLayer[lKey]
			}
			if (Object.keys(byLayer).length === 0) {
				delete this._layerAudio[chKey]
				continue
			}
			if (onlyCh != null && Number(chKey) !== Number(onlyCh)) continue
			out[chKey] = {}
			for (const [lKey, e] of Object.entries(byLayer)) {
				out[chKey][lKey] = {
					nbChannels: e.nbChannels,
					levels: e.levels.map((s) => ({ dBFS: s.dBFS, peak: s.peak })),
					updatedAt: e._lastUpdateAt,
				}
			}
		}
		return out
	},

	/** Reset mixer levels when Caspar stops sending fresh OSC (avoids frozen VU after CLEAR / lost consumer). */
	_decayStaleAudio(now = Date.now()) {
		const staleMs = this._config.staleTimeoutMs
		if (!Number.isFinite(staleMs) || staleMs <= 0) return false
		let any = false
		for (const chKey of Object.keys(this._channels)) {
			const ch = parseInt(chKey, 10)
			const a = this._channels[chKey]?.audio
			if (!a?.levels?.length) continue
			const lastAt = a._lastUpdateAt || 0
			if (lastAt && now - lastAt <= staleMs) continue
			let chStale = false
			for (const slot of a.levels) {
				if (slot.dBFS !== -120) {
					slot.dBFS = -120
					chStale = true
				}
				if (now - (slot.peakAge || 0) > this._config.peakHoldMs && slot.peak !== -120) {
					slot.peak = -120
					chStale = true
				}
			}
			if (chStale && Number.isFinite(ch)) {
				this._dirtyChannels.add(ch)
				any = true
			}
		}
		return any
	},
}

module.exports = { audioMethods }
