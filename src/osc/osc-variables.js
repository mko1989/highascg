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
 * @param {{ variables?: Record<string, string> }} ctx
 */
function clearOscVariables(ctx) {
	const v = ctx.variables
	if (!v || typeof v !== 'object') return
	for (const k of Object.keys(v)) {
		if (_isOscVariableKey(k)) delete v[k]
	}
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
		for (const lk of Object.keys(layers)) {
			const layer = layers[lk]
			if (!layer || typeof layer !== 'object') continue
			const ln = parseInt(lk, 10)
			if (!Number.isFinite(ln)) continue
			
			const base = `${prefix}_l${ln}_`
			if (String(layer.type || '') === 'empty') {
				// Clear if empty
				state.setVariable(`${base}clip`, '')
				state.setVariable(`${base}time`, '')
				state.setVariable(`${base}remaining`, '')
				state.setVariable(`${base}progress`, '')
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
	}
}

module.exports = {
	applyOscSnapshotToVariables,
	clearOscVariables,
}
