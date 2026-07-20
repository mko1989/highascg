/**
 * Start / restart one input's capture producer.
 *
 * The bug this fixes: the live-audio inspector's Stop button (and the Sources > Live DeckLink
 * Stop) issues `STOP ch-layer` + `MIXER ch-layer CLEAR` on the input's own dedicated channel,
 * killing the capture producer. Nothing in the mixer or the inspector could bring that ONE input
 * back — the strip stayed visible (rows come from the channel map, not from OSC) and correctly
 * showed "no signal", but every control on it (fader, mute, Ch route buttons) acts on a dead
 * channel. The only recoveries were the whole-rig Apply in Sources > Live or a Caspar restart.
 *
 * Deliberately dependency-injected: no `api-client` / DOM import, so the offline smokes can run
 * the stop -> start round trip with plain fakes.
 */

/** Input kinds whose capture the server can (re)start on its own dedicated channel. */
export const INPUT_START_KINDS = Object.freeze(['live_audio', 'decklink'])

/** @param {string | null | undefined} kind */
export function inputStartSupported(kind) {
	return INPUT_START_KINDS.includes(String(kind || '').trim())
}

/**
 * @param {{ inputKind?: string, slot?: number | string } | null | undefined} row
 * @returns {{ kind: string, slot: number } | null}
 */
export function startRequestForRow(row) {
	if (!row || typeof row !== 'object') return null
	const kind = String(row.inputKind || '').trim()
	if (!inputStartSupported(kind)) return null
	const slot = parseInt(String(row.slot), 10)
	if (!Number.isFinite(slot) || slot < 1) return null
	return { kind, slot }
}

/**
 * Is a start control offered for this strip?
 *
 * Intentionally independent of metering: an input is startable because of what it IS, never
 * because of what it is currently sending. Gating this on the WO-284 VU state would make a
 * stopped ("no signal") input exactly the one thing the operator cannot restart.
 * @param {object | null | undefined} row
 */
export function shouldShowStartControl(row) {
	return startRequestForRow(row) !== null
}

/**
 * Start the input, then put its persisted PGM routes back on air.
 *
 * Ordering matches the sibling mixer controls (WO-284): AMCP/apply first, and nothing is
 * persisted here at all — a start re-applies routes the operator already saved, so a failed
 * start can never record a target that nothing on air matches.
 *
 * @param {{ inputKind?: string, slot?: number }} row
 * @param {{
 *   post: (path: string, body: object) => Promise<any>,
 *   targets?: Array<{ channel: number, layer: number }>,
 *   playRoute?: ((channel: number, layer: number, route: string, opts?: object) => Promise<any>) | null,
 *   route?: string | null,
 *   audioOnly?: boolean,
 * }} deps
 */
export async function runInputStart(row, deps) {
	const req = startRequestForRow(row)
	if (!req) throw new Error('This input has no restartable capture channel.')
	if (typeof deps?.post !== 'function') throw new Error('runInputStart requires a post()')

	const res = await deps.post('/api/audio/inputs/start', req)
	if (res && res.ok === false) {
		throw new Error(String(res.error || res.reason || 'Input failed to start'))
	}

	const targets = Array.isArray(deps.targets) ? deps.targets : []
	const route = String(deps.route || '').trim()
	let restored = 0
	if (typeof deps.playRoute === 'function' && route.startsWith('route://')) {
		for (const t of targets) {
			const ch = parseInt(String(t?.channel), 10)
			const ln = parseInt(String(t?.layer), 10)
			if (!Number.isFinite(ch) || ch < 1 || !Number.isFinite(ln) || ln < 1) continue
			await deps.playRoute(ch, ln, route, { audioOnly: deps.audioOnly !== false })
			restored++
		}
	}
	return { ok: true, ...req, routesRestored: restored, result: res ?? null }
}
