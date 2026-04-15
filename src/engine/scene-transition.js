/**
 * Scene / look transition — diff current vs incoming, drive program channel via AMCP.
 * @see docs/scene-system-plan.md
 */

const { getChannelMap } = require('../config/routing')
const { normalizeProgramLayerBank } = require('./program-layer-bank')
const sceneExitLayers = require('./scene-exit-layers')
const { runExitLayers } = sceneExitLayers

/** Second PGM stack for crossfading looks: scene layer N → Caspar N (bank a) or N+100 (bank b), e.g. 10 vs 110. */
const PGM_BANK_B_OFFSET = 100

/**
 * @param {number|string} sceneLayerNum - logical layer from the look (e.g. 10)
 * @param {'a'|'b'} bank - 'a' = low range (10…), 'b' = high range (110…)
 * @returns {number} physical Caspar layer
 */
function physicalProgramLayer(sceneLayerNum, bank) {
	const n = parseInt(sceneLayerNum, 10)
	if (!Number.isFinite(n)) return 10
	return bank === 'b' ? n + PGM_BANK_B_OFFSET : n
}

function persistProgramLayerBanks(self) {
	if (!self?.programLayerBankByChannel) return
	try {
		const persistence = require('../utils/persistence')
		persistence.set('programLayerBankByChannel', self.programLayerBankByChannel)
	} catch (_) {}
}

function programChannelToScreenIdx(config, channel) {
	const n = parseInt(channel, 10)
	const map = getChannelMap(config || {})
	const programs = []
	for (let i = 0; i < map.screenCount; i++) programs.push(map.programCh(i + 1))
	const idx = programs.indexOf(n)
	return idx >= 0 ? idx : 0
}

function sourceEqual(a, b) {
	if (!a && !b) return true
	if (!a || !b) return false
	const v1 = String(a.value || '')
	const v2 = String(b.value || '')
	if (v1 !== v2) return false
	const t1 = String(a.type || '').toLowerCase()
	const t2 = String(b.type || '').toLowerCase()
	if (t1 === t2) return true
	// Web UI uses "media"; persisted / other paths may use "file" for the same clip
	if ((t1 === 'media' || t1 === 'file') && (t2 === 'media' || t2 === 'file')) return true
	return false
}

function numClose(a, b, eps = 1e-5) {
	return Math.abs(Number(a) - Number(b)) < eps
}

function fillEqual(f1, f2) {
	const a = { x: 0, y: 0, scaleX: 1, scaleY: 1, ...(f1 || {}) }
	const b = { x: 0, y: 0, scaleX: 1, scaleY: 1, ...(f2 || {}) }
	return numClose(a.x, b.x) && numClose(a.y, b.y) && numClose(a.scaleX, b.scaleX) && numClose(a.scaleY, b.scaleY)
}

function jsonStable(v) {
	try {
		return JSON.stringify(v ?? null)
	} catch {
		return String(v)
	}
}

function fadeOnEndEqual(a, b) {
	const x = a && typeof a === 'object' ? a : { enabled: false, frames: 12 }
	const y = b && typeof b === 'object' ? b : { enabled: false, frames: 12 }
	return !!x.enabled === !!y.enabled && Number(x.frames ?? 12) === Number(y.frames ?? 12)
}

/**
 * Same source and same layout — no PLAY / no mixer tweens on take (see runSceneTake unchanged path).
 * Must include every layer field that runSceneTakeLbg turns into AMCP (effects, fade schedule, PIP, etc.).
 */
function layerVisuallyEqual(cur, incoming) {
	if (!cur || !incoming) return false
	if (!sourceEqual(cur.source, incoming.source)) return false
	if (!fillEqual(cur.fill, incoming.fill)) return false
	if (!numClose(cur.rotation ?? 0, incoming.rotation ?? 0)) return false
	if (!numClose(cur.opacity ?? 1, incoming.opacity ?? 1)) return false
	if (!!cur.straightAlpha !== !!incoming.straightAlpha) return false
	if ((cur.audioRoute || '1+2') !== (incoming.audioRoute || '1+2')) return false
	if (!!cur.loop !== !!incoming.loop) return false
	if ((cur.contentFit || 'native') !== (incoming.contentFit || 'native')) return false
	if (!numClose(cur.volume ?? 1, incoming.volume ?? 1)) return false
	if (!!cur.muted !== !!incoming.muted) return false
	if (!fadeOnEndEqual(cur.fadeOnEnd, incoming.fadeOnEnd)) return false
	if (jsonStable(cur.effects) !== jsonStable(incoming.effects)) return false
	if (jsonStable(cur.pipOverlay) !== jsonStable(incoming.pipOverlay)) return false
	return true
}

function layerHasContent(l) {
	return !!(l && l.source && l.source.value)
}

function diffScenes(current, incoming) {
	const currentMap = new Map()
	for (const l of current?.layers || []) {
		currentMap.set(l.layerNumber, l)
	}
	const incomingLayers = incoming?.layers || []
	const incomingNums = new Set(incomingLayers.map((l) => l.layerNumber))

	const update = []
	const enter = []
	const exit = []
	const unchanged = []

	for (const layer of incomingLayers) {
		const cur = currentMap.get(layer.layerNumber)
		if (!layerHasContent(layer)) {
			if (cur && layerHasContent(cur)) exit.push(cur)
			continue
		}
		if (!cur || !layerHasContent(cur)) {
			enter.push(layer)
		} else if (sourceEqual(cur.source, layer.source)) {
			unchanged.push(layer)
		} else {
			update.push(layer)
		}
	}

	for (const [num, cur] of currentMap) {
		if (!incomingNums.has(num) && layerHasContent(cur)) exit.push(cur)
	}

	return { update, enter, exit, unchanged }
}

function mapTween(tw) {
	const t = String(tw || 'linear').toLowerCase().replace(/-/g, '_')
	const map = {
		linear: 'linear',
		easein: 'easein',
		ease_out: 'easeout',
		easeinout: 'easeboth',
		ease_in_out: 'easeboth',
		easeout: 'easeout',
		easeboth: 'easeboth',
	}
	return map[t] || map[tw] || 'linear'
}

function normalizeTransition(t, forceCut) {
	if (forceCut) return { type: 'CUT', duration: 0, tween: 'linear' }
	const type = (t && t.type) || 'CUT'
	const duration = Math.max(0, t && t.duration != null ? Number(t.duration) : 0)
	const tween = mapTween((t && t.tween) || 'linear')
	return { type, duration, tween }
}

/**
 * AMCP mixer tweens use duration in **frames** at the channel's output rate.
 * Waits must use the same fps as Caspar (from INFO / variables), not UI config default (often 50 vs 25).
 * Mismatch → STOP/CLEAR mid-tween → cut / black / then fade up.
 * @param {object} self - module instance (variables from channel poll)
 * @param {number} channel
 * @param {number|string|undefined} clientHint - fps from POST body (scenes-editor programResolutions)
 */
function resolveChannelFramerateForMixerTween(self, channel, clientHint) {
	const ch = parseInt(channel, 10)
	const k = `channel_${ch}_framerate`
	const fromVar = parseInt(String(self?.variables?.[k] ?? ''), 10)
	if (Number.isFinite(fromVar) && fromVar > 0) return fromVar
	const n = parseInt(String(clientHint ?? ''), 10)
	if (Number.isFinite(n) && n > 0) return n
	return 50
}

function isTimelineOnlyScene(incoming) {
	const withContent = (incoming?.layers || []).filter(layerHasContent)
	if (withContent.length === 0) return false
	if (!withContent.every((l) => l.source?.type === 'timeline')) return false
	const ids = new Set(withContent.map((l) => String(l.source.value || '')))
	return ids.size === 1 && [...ids][0] !== ''
}

/**
 * All layers with content are the same timeline — uses TimelineEngine (layers 1…N on program).
 * @param {object} self - module instance (timelineEngine, amcp, config)
 */
async function runTimelineOnlyTake(self, opts) {
	const channel = parseInt(opts.channel, 10)
	if (!channel || channel < 1) throw new Error('channel required')
	const incoming = opts.incomingScene
	const current = opts.currentScene || null
	if (!incoming?.layers?.length) throw new Error('incomingScene.layers required')

	const eng = self.timelineEngine
	if (!eng) throw new Error('Timeline engine not available')

	const framerate = Math.max(1, resolveChannelFramerateForMixerTween(self, channel, opts.framerate))
	const forceCut = !!opts.forceCut
	const globalT = normalizeTransition(incoming.defaultTransition, forceCut)
	const diff = diffScenes(current, incoming)
	const currentMap = new Map((current?.layers || []).map((l) => [l.layerNumber, l]))

	const withTl = (incoming.layers || []).filter(layerHasContent).find((l) => l.source?.type === 'timeline')
	const tlId = withTl && String(withTl.source.value)
	if (!tlId || !eng.get(tlId)) throw new Error(`Timeline not found on server: ${tlId}`)

	const screenIdx = programChannelToScreenIdx(self.config, channel)
	const amcp = self.amcp

	const pbNow = eng.getPlayback()
	for (const layer of diff.exit) {
		if (layerHasContent(layer) && layer.source?.type === 'timeline' && pbNow?.timelineId === layer.source.value) {
			eng.stop(layer.source.value)
		}
	}

	const mediaExit = diff.exit.filter((l) => layerHasContent(l) && l.source?.type !== 'timeline')
	await runExitLayers(amcp, channel, mediaExit, framerate, globalT, forceCut, self)

	for (const layer of diff.update) {
		const cur = currentMap.get(layer.layerNumber)
		if (cur && layerHasContent(cur) && cur.source?.type !== 'timeline' && layer.source?.type === 'timeline') {
			await runExitLayers(amcp, channel, [cur], framerate, globalT, forceCut, self)
		}
	}

	const pb = eng.getPlayback()
	if (pb?.timelineId && pb.timelineId !== tlId) {
		try {
			eng.stop(pb.timelineId)
		} catch {}
	}

	eng.setSendTo({ preview: true, program: true, screenIdx })
	eng.setLoop(tlId, !!(withTl && withTl.loop))
	eng.play(tlId, 0)
	await amcp.mixerCommit(channel)

	return {
		ok: true,
		timeline: true,
		diff: {
			update: diff.update.length,
			enter: diff.enter.length,
			exit: diff.exit.length,
			unchanged: diff.unchanged.length,
		},
	}
}

module.exports = {
	diffScenes,
	runTimelineOnlyTake,
	runExitLayers: sceneExitLayers.runExitLayers,
	isTimelineOnlyScene,
	programChannelToScreenIdx,
	sourceEqual,
	layerVisuallyEqual,
	layerHasContent,
	normalizeTransition,
	resolveChannelFramerateForMixerTween,
	physicalProgramLayer,
	PGM_BANK_B_OFFSET,
	normalizeProgramLayerBank,
	persistProgramLayerBanks,
}

module.exports.runSceneTake = require('./scene-take').runSceneTake
