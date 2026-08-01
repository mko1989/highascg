/**
 * Companion-style `variables` keys from Caspar OSC aggregate (bridge / GET /api/variables).
 * Naming: `playback_ch{N}_lay{L}_*`, `osc_ch{N}_audio_c{M}_dBFS` (1-based), legacy `_L` / `_R`, `profiler_ch{N}_healthy`.
 */

'use strict'

function _isOscVariableKey(k) {
	return k.startsWith('osc_')
}

/**
 * Remove OSC-derived keys so stale layers/channels disappear after snapshot shrink.
 * @param {{ variables?: Record<string, string>, _oscVarsSeenLayers?: Record<string, Set<number>> }} ctx
 */
function clearOscVariables(ctx) {
	const v = ctx.variables
	if (v && typeof v === 'object') {
		for (const k of Object.keys(v)) {
			if (_isOscVariableKey(k)) delete v[k]
		}
	}
	// WO-239: reset per-layer tracking too, so a restart doesn't inherit a stale "seen" set
	// (see applyOscSnapshotToVariables — that set drives clearing of pruned-layer variables).
	ctx._oscVarsSeenLayers = {}
	// WO-401 F7: the key cache holds only derived strings (safe to rebuild), but the cleared-slot
	// tracker must reset — the variables were just deleted, so the first post-restart tick has to
	// write them fresh.
	ctx._oscVarsKeyCache = {}
	ctx._oscVarsAudioClearedNb = {}
}

/**
 * WO-401 F7: applyOscSnapshotToVariables runs 20×/s × 8 channels × (18 audio + 4-per-layer)
 * setVariable calls — each used to build its key string from a template literal per call
 * (~4.5k short-lived strings/s), and the 16-slot "clear the unused meters" sweeps re-ran every
 * tick as pure no-ops (setVariable dedupes, but only after paying the key allocation). Keys are
 * derived-only, so caching them per channel/layer changes no behavior.
 */
function _channelVarKeys(ctx, chNum) {
	if (!ctx._oscVarsKeyCache || typeof ctx._oscVarsKeyCache !== 'object') ctx._oscVarsKeyCache = {}
	let k = ctx._oscVarsKeyCache[chNum]
	if (!k) {
		const prefix = `osc_ch${chNum}`
		k = ctx._oscVarsKeyCache[chNum] = {
			healthy: `${prefix}_healthy`,
			L: `${prefix}_audio_L`,
			R: `${prefix}_audio_R`,
			dbfs: Array.from({ length: 16 }, (_, i) => `${prefix}_audio_c${i + 1}_dBFS`),
			layers: {},
		}
	}
	return k
}

function _layerVarKeys(chKeys, chNum, ln) {
	let lk = chKeys.layers[ln]
	if (!lk) {
		const base = `osc_ch${chNum}_l${ln}_`
		lk = chKeys.layers[ln] = {
			clip: `${base}clip`,
			time: `${base}time`,
			remaining: `${base}remaining`,
			progress: `${base}progress`,
		}
	}
	return lk
}

/**
 * Clear the 4 per-layer variables (used both for the explicit `type === 'empty'` case and for
 * layers that vanished from the snapshot entirely — see WO-239 root-cause note below).
 * @param {object} state
 * @param {{ clip: string, time: string, remaining: string, progress: string }} lk — cached key set from {@link _layerVarKeys}
 */
function _clearLayerVariables(state, lk) {
	state.setVariable(lk.clip, '')
	state.setVariable(lk.time, '')
	state.setVariable(lk.remaining, '')
	state.setVariable(lk.progress, '')
}

/**
 * @param {number | null | undefined} n
 * @param {number} [digits]
 */
function _fmt(n, digits = 2) {
	if (!Number.isFinite(n)) return ''
	const p = Math.pow(10, digits)
	return String(Math.round(n * p) / p)
}

/**
 * @param {object} ctx
 * @param {{ channels?: Record<string, unknown>, updatedAt?: number } | null} snapshot — full {@link OscState#getSnapshot}
 */
/**
 * @param {object} ctx
 * @param {{ channels?: Record<string, unknown>, updatedAt?: number } | null} snapshot — full {@link OscState#getSnapshot}
 */
function applyOscSnapshotToVariables(ctx, snapshot) {
	if (!snapshot || !snapshot.channels || typeof snapshot.channels !== 'object') return
	const state = ctx.state
	// WO-239 root cause: osc-state.js `_pruneStaleLayers` (layerStaleTimeoutMs, default 10s) deletes
	// a layer from `channels[ch].layers` once Caspar stops emitting OSC for it (CLEAR / stage
	// teardown — there is no final "empty" producer message, see that function's own comment). This
	// function used to only ever walk `Object.keys(layers)` of the *current* snapshot, so a pruned
	// layer's `osc_chN_lL_clip/time/remaining/progress` variables were simply left at their last
	// value forever (frozen stale clip name/timer in companion/UI). Before WO-235, `layer.type`
	// never resolved (stayed null forever), so the `type === 'empty'` gate below cleared every
	// layer's variables on *every* tick, masking this gap entirely — WO-235 fixing the type
	// derivation is what makes real content populate variables correctly, which is exactly what
	// exposes this pre-existing hole as visibly "frozen" once a clip stops. Fix: track which layer
	// keys we saw last time per channel and explicitly clear any that disappeared.
	if (!ctx._oscVarsSeenLayers || typeof ctx._oscVarsSeenLayers !== 'object') ctx._oscVarsSeenLayers = {}
	const seenLayers = ctx._oscVarsSeenLayers
	if (!ctx._oscVarsAudioClearedNb || typeof ctx._oscVarsAudioClearedNb !== 'object') ctx._oscVarsAudioClearedNb = {}
	const clearedNb = ctx._oscVarsAudioClearedNb

	for (const ck of Object.keys(snapshot.channels)) {
		const ch = snapshot.channels[ck]
		if (!ch || typeof ch !== 'object') continue
		const chNum = parseInt(ck, 10)
		if (!Number.isFinite(chNum)) continue
		const keys = _channelVarKeys(ctx, chNum)

		if (ch.profiler && typeof ch.profiler === 'object') {
			const h = ch.profiler.healthy
			state.setVariable(keys.healthy, h === true ? 'true' : h === false ? 'false' : '')
		}

		const audio = ch.audio
		if (audio && Array.isArray(audio.levels) && audio.levels.length > 0) {
			const nb = Math.max(0, audio.nbChannels || audio.levels.length)
			for (let i = 0; i < nb && i < 16; i++) {
				const slot = audio.levels[i]
				const db = slot && Number.isFinite(slot.dBFS) ? _fmt(slot.dBFS, 1) : ''
				state.setVariable(keys.dbfs[i], db)
			}
			// WO-401 F7: the slots above `nb` only need clearing when `nb` shrinks — not every tick.
			if (clearedNb[chNum] !== nb) {
				for (let i = nb; i < 16; i++) state.setVariable(keys.dbfs[i], '')
				clearedNb[chNum] = nb
			}
			const L = audio.levels[0]
			const R = audio.levels[1]
			state.setVariable(keys.L, L && Number.isFinite(L.dBFS) ? _fmt(L.dBFS, 1) : '')
			state.setVariable(
				keys.R,
				R && Number.isFinite(R.dBFS) ? _fmt(R.dBFS, 1) : L && Number.isFinite(L.dBFS) ? _fmt(L.dBFS, 1) : ''
			)
		} else if (clearedNb[chNum] !== 0) {
			for (let i = 0; i < 16; i++) state.setVariable(keys.dbfs[i], '')
			state.setVariable(keys.L, '')
			state.setVariable(keys.R, '')
			clearedNb[chNum] = 0
		}

		const layers = ch.layers || {}
		const currentLayerNums = new Set()
		for (const lk of Object.keys(layers)) {
			const layer = layers[lk]
			if (!layer || typeof layer !== 'object') continue
			const ln = parseInt(lk, 10)
			if (!Number.isFinite(ln)) continue
			currentLayerNums.add(ln)

			const lkeys = _layerVarKeys(keys, chNum, ln)
			if (String(layer.type || '') === 'empty') {
				_clearLayerVariables(state, lkeys)
				continue
			}

			const f = layer.file || {}
			const name = f.name != null ? String(f.name) : f.path != null ? String(f.path) : ''
			const tpl = layer.template && layer.template.path ? String(layer.template.path) : ''

			state.setVariable(lkeys.clip, name || tpl || '')
			state.setVariable(lkeys.time, Number.isFinite(f.elapsed) ? _fmt(f.elapsed, 2) : '')
			state.setVariable(lkeys.remaining, Number.isFinite(f.remaining) ? _fmt(f.remaining, 2) : '')

			let progress = ''
			if (Number.isFinite(f.progress)) {
				const pct = Math.min(100, Math.max(0, f.progress * 100))
				progress = _fmt(pct, 1)
			} else if (Number.isFinite(f.frameElapsed) && Number.isFinite(f.frameTotal) && f.frameTotal > 0) {
				const pct = Math.min(100, Math.max(0, (f.frameElapsed / f.frameTotal) * 100))
				progress = _fmt(pct, 1)
			}
			state.setVariable(lkeys.progress, progress)
		}

		// WO-239 fix: clear variables for any layer we saw on a previous emit for this channel but
		// that is no longer in the snapshot (pruned by osc-state.js `_pruneStaleLayers` — CLEAR /
		// stage teardown with no final "empty" message). Without this, those 4 variables freeze at
		// their last value forever instead of going blank.
		const prevLayers = seenLayers[chNum]
		if (prevLayers) {
			for (const prevLn of prevLayers) {
				if (currentLayerNums.has(prevLn)) continue
				_clearLayerVariables(state, _layerVarKeys(keys, chNum, prevLn))
			}
		}
		seenLayers[chNum] = currentLayerNums
	}
}

module.exports = {
	applyOscSnapshotToVariables,
	clearOscVariables,
}
