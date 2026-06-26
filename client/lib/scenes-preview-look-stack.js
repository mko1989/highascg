/**
 * Look-stack layer constants + helpers shared by PRV preview push and clear paths.
 */

/** Must match server `TIMELINE_LAYER_BASE` — timeline clips use Caspar layers 200+. */
export const TIMELINE_LAYER_BASE = 200
export const TIMELINE_LAYER_CLEAR_COUNT = 32

/** Scene content on PRV uses the same layer numbers as PGM (L9 = black CG; main clips on 10, 20, 30…; PIP/CG in the band above each). */
export const PREVIEW_SCENE_LAYER_MIN = 10

/** @param {object} [stateStore] @param {number} previewCh @returns {Set<number>} */
export function allMatrixLayersOnPreviewChannel(stateStore, previewCh) {
	const out = new Set()
	const st = stateStore?.getState?.() || {}
	const matrix = st?.playback?.matrix || st?.playbackMatrix || {}
	if (!matrix || typeof matrix !== 'object') return out
	for (const key of Object.keys(matrix)) {
		const m = String(key).match(/^(\d+)-(\d+)$/)
		if (!m) continue
		const ch = Number(m[1])
		const ln = Number(m[2])
		if (ch !== Number(previewCh)) continue
		if (!Number.isFinite(ln) || ln < PREVIEW_SCENE_LAYER_MIN || ln >= 10000) continue
		out.add(ln)
	}
	return out
}

/** Common look-stack decade slots (PIP HTML may use base+1… — matrix sweep catches orphans). */
export function defaultLookDecadeLayersForSweep() {
	const out = new Set()
	for (let L = 10; L <= 900; L += 10) out.add(L)
	return out
}

/**
 * Layer numbers to clear on PGM before a direct take (PGM-only — no PRV bus).
 * Merges matrix occupancy + previous live look snapshot so orphan layers do not stack.
 * @param {object} stateStore
 * @param {object} sceneState
 * @param {number} programCh
 * @param {number} mainIdx
 * @returns {Set<number>}
 */
export function layersToClearBeforePgmTake(stateStore, sceneState, programCh, mainIdx) {
	const occupied = new Set()
	for (const n of allMatrixLayersOnPreviewChannel(stateStore, programCh)) occupied.add(n)
	const prevSnap = sceneState.getLiveSceneSnapshot?.(mainIdx)
	if (prevSnap?.layers) {
		for (const l of prevSnap.layers) {
			const ln = Number(l.layerNumber)
			if (Number.isFinite(ln) && ln >= PREVIEW_SCENE_LAYER_MIN && ln < 10000) occupied.add(ln)
		}
	}
	const stLive = stateStore?.getState?.()?.scene?.live?.[String(programCh)]?.scene
	if (stLive?.layers) {
		for (const l of stLive.layers) {
			const ln = Number(l.layerNumber)
			if (Number.isFinite(ln) && ln >= PREVIEW_SCENE_LAYER_MIN && ln < 10000) occupied.add(ln)
		}
	}
	return occupied
}

/**
 * @param {number} channel
 * @param {Iterable<number>} layerNums
 * @param {(ch: number, ln: number, nextLn: number) => string[]} [pipRemoveLines]
 * @returns {string[]}
 */
export function buildClearLookStackLayerCommands(channel, layerNums, pipRemoveLines) {
	const ch = Number(channel)
	if (!Number.isFinite(ch) || ch <= 0) return []
	const queue = []
	for (const ln of [...layerNums].sort((a, b) => a - b)) {
		const dl = `${ch}-${ln}`
		queue.push(`STOP ${dl}`, `MIXER ${dl} CLEAR`)
		if (pipRemoveLines) queue.push(...pipRemoveLines(ch, ln, 10000))
	}
	if (queue.length) queue.push(`MIXER ${ch} COMMIT`)
	return queue
}

/**
 * Read currently occupied look-stack layers from live state for a given PRV channel.
 * @param {object} stateStore
 * @param {number} previewCh
 * @returns {Set<number>}
 */
export function getOccupiedPreviewLookLayersFromState(stateStore, previewCh) {
	const out = new Set()
	const st = stateStore?.getState?.() || {}
	const matrix = st?.playback?.matrix || st?.playbackMatrix || {}
	if (!matrix || typeof matrix !== 'object') return out
	for (const cell of Object.values(matrix)) {
		if (!cell || typeof cell !== 'object') continue
		if (cell.playing === false) continue
		const ch = Number(cell.channel)
		const ln = Number(cell.layer)
		if (!Number.isFinite(ch) || !Number.isFinite(ln)) continue
		if (ch !== Number(previewCh)) continue
		if (ln < PREVIEW_SCENE_LAYER_MIN || ln >= 10000) continue
		out.add(ln)
	}
	return out
}

/**
 * Whether this main has a separate preview bus (not PGM-only / mirrored PGM).
 * Matches {@link createScenesPreviewRuntime} `clearPreviewBusForMain` separate-PRV check.
 * @param {object} cm - channelMap from state
 * @param {number} mIdx
 * @returns {boolean}
 */
export function isPreviewBusAvailable(cm, mIdx) {
	if (cm?.previewEnabledByMain?.[mIdx] === false) return false
	const pgm = Number(cm?.programChannels?.[mIdx] ?? cm?.playbackChannels?.[mIdx])
	const prv = Number(cm?.previewChannels?.[mIdx])
	if (!Number.isFinite(prv) || prv <= 0) return false
	if (!Number.isFinite(pgm) || pgm <= 0) return true
	return prv !== pgm
}

function previewChannelForMain(cm, mIdx) {
	if (!isPreviewBusAvailable(cm, mIdx)) return null
	const prv = Number(cm?.previewChannels?.[mIdx])
	return Number.isFinite(prv) && prv > 0 ? prv : null
}

/**
 * Caspar channel used for look-stack preview AMCP (L10+, PIPs, etc.).
 * On PGM-only outputs returns null unless {@link sceneState.editOnPgm} is enabled.
 * @param {object} sceneState
 * @param {() => object} getChannelMap
 * @param {number} mIdx
 * @param {boolean} forcePrvBus
 * @returns {number|null}
 */
export function resolvePreviewAmcpChannel(sceneState, getChannelMap, mIdx, forcePrvBus) {
	const cm = getChannelMap()
	if (!isPreviewBusAvailable(cm, mIdx)) return null
	if (forcePrvBus) {
		return previewChannelForMain(cm, mIdx)
	}
	if (sceneState.editOnPgm) {
		const pgm = Number(cm.programChannels?.[mIdx] ?? cm.playbackChannels?.[mIdx])
		return Number.isFinite(pgm) && pgm > 0 ? pgm : null
	}
	return previewChannelForMain(cm, mIdx)
}
