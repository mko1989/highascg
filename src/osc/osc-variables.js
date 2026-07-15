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
}

/**
 * Clear the 4 per-layer variables (used both for the explicit `type === 'empty'` case and for
 * layers that vanished from the snapshot entirely — see WO-239 root-cause note below).
 * @param {object} state
 * @param {string} base
 */
function _clearLayerVariables(state, base) {
	state.setVariable(`${base}clip`, '')
	state.setVariable(`${base}time`, '')
	state.setVariable(`${base}remaining`, '')
	state.setVariable(`${base}progress`, '')
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

	for (const ck of Object.keys(snapshot.channels)) {
		const ch = snapshot.channels[ck]
		if (!ch || typeof ch !== 'object') continue
		const chNum = parseInt(ck, 10)
		if (!Number.isFinite(chNum)) continue
		const prefix = `osc_ch${chNum}`

		if (ch.profiler && typeof ch.profiler === 'object') {
			const h = ch.profiler.healthy
			state.setVariable(`${prefix}_healthy`, h === true ? 'true' : h === false ? 'false' : '')
		}

		const audio = ch.audio
		if (audio && Array.isArray(audio.levels) && audio.levels.length > 0) {
			const nb = Math.max(0, audio.nbChannels || audio.levels.length)
			for (let i = 0; i < nb; i++) {
				const slot = audio.levels[i]
				const db = slot && Number.isFinite(slot.dBFS) ? _fmt(slot.dBFS, 1) : ''
				state.setVariable(`${prefix}_audio_c${i + 1}_dBFS`, db)
			}
			for (let i = nb + 1; i <= 16; i++) {
				state.setVariable(`${prefix}_audio_c${i}_dBFS`, '')
			}
			const L = audio.levels[0]
			const R = audio.levels[1]
			state.setVariable(`${prefix}_audio_L`, L && Number.isFinite(L.dBFS) ? _fmt(L.dBFS, 1) : '')
			state.setVariable(
				`${prefix}_audio_R`,
				R && Number.isFinite(R.dBFS) ? _fmt(R.dBFS, 1) : L && Number.isFinite(L.dBFS) ? _fmt(L.dBFS, 1) : ''
			)
		} else {
			for (let i = 1; i <= 16; i++) {
				state.setVariable(`${prefix}_audio_c${i}_dBFS`, '')
			}
			state.setVariable(`${prefix}_audio_L`, '')
			state.setVariable(`${prefix}_audio_R`, '')
		}

		const layers = ch.layers || {}
		const currentLayerNums = new Set()
		for (const lk of Object.keys(layers)) {
			const layer = layers[lk]
			if (!layer || typeof layer !== 'object') continue
			const ln = parseInt(lk, 10)
			if (!Number.isFinite(ln)) continue
			currentLayerNums.add(ln)

			const base = `${prefix}_l${ln}_`
			if (String(layer.type || '') === 'empty') {
				_clearLayerVariables(state, base)
				continue
			}

			const f = layer.file || {}
			const name = f.name != null ? String(f.name) : f.path != null ? String(f.path) : ''
			const tpl = layer.template && layer.template.path ? String(layer.template.path) : ''
			
			state.setVariable(`${base}clip`, name || tpl || '')
			state.setVariable(`${base}time`, Number.isFinite(f.elapsed) ? _fmt(f.elapsed, 2) : '')
			state.setVariable(`${base}remaining`, Number.isFinite(f.remaining) ? _fmt(f.remaining, 2) : '')
			
			let progress = ''
			if (Number.isFinite(f.progress)) {
				const pct = Math.min(100, Math.max(0, f.progress * 100))
				progress = _fmt(pct, 1)
			} else if (Number.isFinite(f.frameElapsed) && Number.isFinite(f.frameTotal) && f.frameTotal > 0) {
				const pct = Math.min(100, Math.max(0, (f.frameElapsed / f.frameTotal) * 100))
				progress = _fmt(pct, 1)
			}
			state.setVariable(`${base}progress`, progress)
		}

		// WO-239 fix: clear variables for any layer we saw on a previous emit for this channel but
		// that is no longer in the snapshot (pruned by osc-state.js `_pruneStaleLayers` — CLEAR /
		// stage teardown with no final "empty" message). Without this, those 4 variables freeze at
		// their last value forever instead of going blank.
		const prevLayers = seenLayers[chNum]
		if (prevLayers) {
			for (const prevLn of prevLayers) {
				if (currentLayerNums.has(prevLn)) continue
				_clearLayerVariables(state, `${prefix}_l${prevLn}_`)
			}
		}
		seenLayers[chNum] = currentLayerNums
	}
}

module.exports = {
	applyOscSnapshotToVariables,
	clearOscVariables,
}
