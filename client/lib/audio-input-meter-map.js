/**
 * WO-284 — level → meter mapping for input strips.
 *
 * Pure math + pure predicates only (no DOM, no timers, no imports): the mixer meter loop calls
 * these once per fill per frame, and the offline smokes call them with plain fixtures.
 *
 * The distinction this module exists for: an input that is PRESENT AND QUIET must not look like
 * an input that is sending NOTHING AT ALL. DeckLink 4 with a powered-off camera has no producer
 * on its capture layer, so it reports `no-data` ("no signal"); a connected but silent desk feed
 * reports `silent`. Both draw an empty bar, so the state is what the strip styles on.
 */

/** Bottom of the meter scale — matches the existing mixer meter geometry ((dBFS + 60) / 60). */
export const METER_FLOOR_DBFS = -60

/** Above this the meter turns red. */
export const METER_CLIP_DBFS = -1

/** @type {{ NO_DATA: 'no-data', SILENT: 'silent', SIGNAL: 'signal' }} */
export const METER_STATE = Object.freeze({
	NO_DATA: 'no-data',
	SILENT: 'silent',
	SIGNAL: 'signal',
})

/**
 * Does this input channel have audio DATA at all (as opposed to being quiet)?
 *
 * Cheap on purpose — property reads against the already-received OSC snapshot, no allocation
 * beyond the `Object.keys` fallback which only runs when a numeric layer lookup misses.
 *
 * @param {{
 *   channelState?: object | null,
 *   inputLayer?: number | null,
 *   dbfs?: number | null,
 * }} ctx
 * @returns {boolean}
 */
export function inputHasAudioData({ channelState, inputLayer, dbfs } = {}) {
	// No OSC channel record at all and no fallback variable reading → the box has never heard
	// from this channel. That is "no signal", not "silence".
	const hasChannel = !!channelState && typeof channelState === 'object'
	if (!hasChannel && !Number.isFinite(dbfs)) return false

	// A capture channel whose producer layer is empty/absent is dead (unplugged camera, capture
	// never started). Caspar keeps emitting the channel bus, so the level alone cannot tell us.
	const layers = hasChannel && channelState.layers && typeof channelState.layers === 'object' ? channelState.layers : null
	// Only judge by the producer layer when OSC is actually reporting layers for this channel.
	// A build/consumer that never emits /channel/N/stage/layer/... must not make every input
	// read as dead — in that case the level alone decides.
	if (layers && Number.isFinite(inputLayer) && Object.keys(layers).length > 0) {
		const row = layers[inputLayer] ?? layers[String(inputLayer)] ?? null
		if (!row || typeof row !== 'object') return false
		const type = String(row.type || '').trim().toLowerCase()
		const file = row.file && typeof row.file === 'object' ? row.file : null
		const named = String(file?.name || file?.path || row.producer || '').trim()
		if ((type === '' || type === 'empty') && named === '') return false
	}

	if (Number.isFinite(dbfs)) return true

	// Channel is alive and its producer is up, but no meter sample has landed yet.
	const levels = channelState?.audio?.levels
	return Array.isArray(levels) && levels.some((l) => Number.isFinite(l?.dBFS))
}

/**
 * Map one metering sample to the meter's visual state.
 *
 * @param {{ dbfs?: number | null, hasData?: boolean, muted?: boolean }} sample
 *   `hasData` defaults to "the level is a finite number"; pass `false` explicitly to force the
 *   no-signal state even when a level was read (dead producer on a live channel).
 * @returns {{ state: string, aim: number, clip: boolean, dbfs: number | null }}
 */
export function mapLevelToMeter(sample = {}) {
	const raw = sample.dbfs
	const dbfs = Number.isFinite(raw) ? Number(raw) : null
	const hasData = sample.hasData === undefined ? dbfs != null : !!sample.hasData

	if (!hasData) return { state: METER_STATE.NO_DATA, aim: 0, clip: false, dbfs }

	// Muted is a deliberate operator choice on a live input: it reads as silent, not as dead.
	if (sample.muted || dbfs == null || dbfs <= METER_FLOOR_DBFS) {
		return { state: METER_STATE.SILENT, aim: 0, clip: false, dbfs }
	}

	const aim = Math.max(0, Math.min(1, (dbfs - METER_FLOOR_DBFS) / -METER_FLOOR_DBFS))
	return { state: METER_STATE.SIGNAL, aim, clip: dbfs > METER_CLIP_DBFS, dbfs }
}
