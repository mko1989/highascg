'use strict'

const { getChannelMap } = require('../config/routing')
const { param } = require('../caspar/amcp-utils')
const liveSceneState = require('../state/live-scene-state')
const {
	normalizeTransition,
	resolveChannelFramerateForMixerTween,
} = require('./scene-transition')
const { clearSceneProgramLookStackLayers } = require('./scene-exit-layers')
const { timelineCasparLayer } = require('./timeline-playback-helpers')

function transitionIsCut(globalT) {
	return globalT.duration <= 0 || String(globalT.type || '').toUpperCase() === 'CUT'
}

function waitMs(ms) {
	return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

/**
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {number} channel
 * @param {number[]} layerNums
 * @param {number} durationFrames
 * @param {string} [tween]
 */
async function fadePhysicalLayersOut(amcp, channel, layerNums, durationFrames, tween) {
	if (!amcp || !layerNums.length || durationFrames <= 0) return
	const lines = []
	for (const L of layerNums) {
		const cl = `${channel}-${L}`
		let p = `0 ${durationFrames}`
		if (tween) p += ` ${param(tween)}`
		lines.push(`MIXER ${cl} OPACITY ${p} DEFER`)
	}
	await amcp.batchSendChunked(lines, { skipMixerPreCommit: true })
	await amcp.mixerCommit(channel)
}

/**
 * Fade timeline layers in from 0→1 over durationFrames.
 * Sets initial opacity to 0 then schedules a deferred tween to 1.
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {number} channel
 * @param {number[]} layerNums
 * @param {number} durationFrames
 * @param {string} [tween]
 */
async function fadePhysicalLayersIn(amcp, channel, layerNums, durationFrames, tween) {
	if (!amcp || !layerNums.length || durationFrames <= 0) return
	const lines = []
	for (const L of layerNums) {
		const cl = `${channel}-${L}`
		// Set initial opacity to 0 (instant)
		lines.push(`MIXER ${cl} OPACITY 0 0`)
	}
	for (const L of layerNums) {
		const cl = `${channel}-${L}`
		let p = `1 ${durationFrames}`
		if (tween) p += ` ${param(tween)}`
		lines.push(`MIXER ${cl} OPACITY ${p} DEFER`)
	}
	await amcp.batchSendChunked(lines, { skipMixerPreCommit: true })
	await amcp.mixerCommit(channel)
}

/**
 * Collect physical CasparCG layer numbers used by a timeline.
 * @param {object} tl timeline model
 * @returns {number[]}
 */
function collectTimelinePhysicalLayers(tl) {
	if (!tl?.layers?.length) return []
	return tl.layers.map((_, i) => timelineCasparLayer(i))
}

/**
 * Physical layers whose active clip at `pos` still has an opacity keyframe segment ahead —
 * the clip's own fade animates MIXER OPACITY there, so the layer-level take fade must skip them.
 * @param {import('./timeline-engine').TimelineEngine} eng
 * @param {object} tl timeline model
 * @param {number} pos playhead ms
 * @returns {Set<number>}
 */
function collectClipOpacityFadeLayers(eng, tl, pos) {
	const set = new Set()
	if (!tl?.layers?.length) return set
	for (let i = 0; i < tl.layers.length; i++) {
		const clip = typeof eng?._clipAt === 'function' ? eng._clipAt(tl.layers[i], pos) : null
		if (!clip) continue
		const kfs = (clip.keyframes || [])
			.filter((k) => k.property === 'opacity')
			.sort((a, b) => a.time - b.time)
		const times = kfs.map((k) => k.time)
		if (times.length >= 2 && pos - clip.startTime < times[times.length - 1]) {
			/* WO-519: excluding a layer here hands its opacity entirely to the clip's own keyframe
			 * tween — and a MIX take has already preset the layer to 0 (T139.1). If that tween never
			 * reaches a visible value, the layer stays at 0 and PLAYS INVISIBLY: content running,
			 * nothing on screen. Owner: *"either some of the layers play or nothing at all"* — some
			 * clips keyframed gives "some", all keyframed gives "nothing".
			 *
			 * The original test looked only at keyframe TIMES, never their values, so a fade-OUT clip
			 * (1 → 0) or any track that is 0 from the take position onward was excluded exactly like a
			 * proper fade-in. Only step aside when the clip will actually light the layer up.
			 *
			 * Deliberately fail BRIGHT. Re-including a layer that also tweens its own opacity risks
			 * the double-write WO-139 T139.2 fixed (both writing MIXER OPACITY, last writer wins) —
			 * a cosmetic glitch. Leaving it out costs a missing layer on air. Those are not
			 * comparable, so uncertainty resolves toward visible. */
			const rel = pos - clip.startTime
			const reachesVisible = kfs.some((k) => k.time >= rel && Number(k.value) > 0)
			if (reachesVisible) set.add(timelineCasparLayer(i))
		}
	}
	return set
}

/**
 * @param {object} ctx
 * @param {import('./timeline-engine').TimelineEngine} eng
 * @param {string} tlId
 * @param {object} body
 */
async function runTimelineDirectTake(ctx, eng, tlId, body) {
	const map = getChannelMap(ctx?.config || {})
	const screenCount = map?.screenCount || 1
	const targetIdxs =
		body.screenIdx === null || body.screenIdx === 'all'
			? Array.from({ length: screenCount }, (_, i) => i)
			: [Math.max(0, parseInt(body.screenIdx, 10) || 0)]

	const tl = eng.get(tlId)
	if (!tl) throw new Error('Timeline not found')

	const pb = eng.getPlayback(tlId)
	const pos = pb?.position ?? 0
	const fps = Math.max(1, parseInt(String(body.framerate ?? tl.fps ?? 25), 10) || 25)
	const globalT = normalizeTransition(
		{
			type: body.transition || 'MIX',
			duration: body.duration != null ? Number(body.duration) : 0,
			tween: body.tween || 'linear',
		},
		false,
	)
	const forceCut = transitionIsCut(globalT)
	const amcp = ctx.amcp
	if (!amcp) throw new Error('Caspar not connected')

	const screenIdx =
		body.screenIdx === null || body.screenIdx === 'all'
			? null
			: Number.isFinite(Number(body.screenIdx))
				? Number(body.screenIdx)
				: 0

	eng.setSendTo({ preview: false, program: true, screenIdx }, tlId, { skipAmcpApply: true })
	eng.setLoop(tlId, !!pb?.loop)

	eng._prevKey = new Map()
	eng._lastKfValues.clear()
	eng._lastKfSegment.clear()

	const tlPhysicalLayers = collectTimelinePhysicalLayers(tl)
	// Layers whose active clip animates its own opacity via keyframes: the clip's scheduled
	// lead tween owns MIXER OPACITY there — the layer-level take fade must not overwrite it.
	const clipFadeLayers = collectClipOpacityFadeLayers(eng, tl, pos)

	// Preset opacity BEFORE PLAY so new content cannot flash full-bright for one AMCP
	// round-trip (WO-139 flash race). MIX: start at 0 and fade in. CUT: force 1 so a stale
	// 0 left by an earlier fade-out cannot make the take invisible.
	const presetOpacity = forceCut ? 1 : 0
	for (const sIdx of targetIdxs) {
		const programCh = map?.programCh?.(sIdx + 1) ?? 1
		const lines = tlPhysicalLayers.map((L) => `MIXER ${programCh}-${L} OPACITY ${presetOpacity} 0`)
		if (lines.length) await amcp.batchSendChunked(lines, { skipMixerPreCommit: true })
	}

	// Timeline on PGM first; clip lead-opacity tweens are batched DEFERred (not committed yet).
	// `takeFade` (WO-528): on the MIX path the layer fade below owns opacity, so the engine's own
	// per-clip instant OPACITY must be suppressed — otherwise it lands the layer at full between
	// the preset-to-0 above and the fade, and the fade then ramps 1 -> 1, which is a CUT. On the
	// CUT path there IS no fade, the preset is 1, and the engine's instant value is what gives a
	// clip its own base opacity — so it must still be sent (WO-139 T139.1's invisible-CUT trap).
	await eng.playForTake(tlId, pos, { takeFade: !forceCut })

	const fadeWaits = []
	for (const sIdx of targetIdxs) {
		const programCh = map?.programCh?.(sIdx + 1) ?? 1
		const fr = Math.max(1, resolveChannelFramerateForMixerTween(ctx, programCh, fps))

		if (forceCut) {
			// Fire the clip lead tweens scheduled by playForTake (no layer crossfade on CUT).
			await amcp.mixerCommit(programCh).catch(() => {})
			continue
		}

		// One batch + one COMMIT per channel: timeline fade-in and look fade-out start on the
		// same frame, together with the clip lead tweens scheduled by playForTake (WO-139).
		const lines = []
		for (const L of tlPhysicalLayers) {
			if (clipFadeLayers.has(L)) continue
			let p = `1 ${globalT.duration}`
			if (globalT.tween) p += ` ${param(globalT.tween)}`
			lines.push(`MIXER ${programCh}-${L} OPACITY ${p} DEFER`)
		}
		// Mix, not double-ramp: the timeline band (210+) sits ABOVE the look, so fading ONLY the
		// timeline in over the look held at full opacity is a clean dissolve. Ramping the look out at
		// the same time made both semi-transparent mid-transition — a ~50% luminance dip + double-
		// exposure ("not a smooth mix"). The look is hard-cleared AFTER the fade (below), so holding it
		// at full costs nothing at the end.
		if (lines.length) await amcp.batchSendChunked(lines, { skipMixerPreCommit: true })
		if (lines.length || clipFadeLayers.size) {
			await amcp.mixerCommit(programCh)
			// 3-frame margin so Node timer jitter cannot tear down a layer mid-tween.
			fadeWaits.push(waitMs(((globalT.duration + 3) / fr) * 1000))
		}
	}

	if (fadeWaits.length) await Promise.all(fadeWaits)

	for (const sIdx of targetIdxs) {
		const programCh = map?.programCh?.(sIdx + 1) ?? 1
		const previewCh = map?.previewCh?.(sIdx + 1) ?? 2
		await clearSceneProgramLookStackLayers(amcp, programCh, ctx)
		await clearSceneProgramLookStackLayers(amcp, previewCh, ctx)
		await amcp.mixerCommit(programCh).catch(() => {})
		await amcp.mixerCommit(previewCh).catch(() => {})
		liveSceneState.clearChannel(programCh)
	}

	liveSceneState.broadcastSceneLive(ctx)
	return { ok: true, transition: globalT, forceCut }
}

/**
 * Start a timeline layer from a scene take without the full-bright pop (WO-152 B152.1).
 *
 * With a fade (fadeDur > 0): preset the timeline's physical layers to opacity 0 BEFORE
 * PLAY (same flash-race fix as runTimelineDirectTake, WO-139), start playback, and return
 * the physical layer numbers the CALLER must fade in inside its own frame-locked
 * crossfade batch. Layers whose active clip animates opacity via keyframes are excluded —
 * the clip's own fade owns MIXER OPACITY there.
 * With a cut (fadeDur <= 0): plain play(), nothing to fade (pop is expected on CUT).
 *
 * @param {{ timelineEngine?: object }} self
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {number} channel program channel
 * @param {{ source?: { value?: string }, loop?: boolean }} layer scene layer (source.type 'timeline')
 * @param {{ fadeDur: number, screenIdx: number|null, startAtCurrentPosition?: boolean }} opts
 * @returns {Promise<number[]>} physical layers to fade in (empty on the cut path)
 */
async function startSceneTimelineLayer(self, amcp, channel, layer, opts) {
	const eng = self?.timelineEngine
	const tlId = layer?.source?.value
	if (!eng || !tlId) return []
	/* WO-549: `restrictToPreview` exists for routes-scene-take.js's pgm/prv preview-exchange call —
	 * its whole job is putting the PREVIOUS look on the preview bus for operator reference, and it
	 * must never touch program. Without this, a timeline in that previous look claimed BOTH the
	 * program and preview channel of its screen (the normal, correct behavior for an actual take),
	 * so re-displaying the OLD look's timeline on preview also silently re-took it onto program —
	 * "going back to another look results in retaking the timeline look instead of playing the new
	 * one." The real PGM take (a separate, concurrent call — see WO-546) is unaffected: it never
	 * sets this flag, so a timeline that IS the real incoming content still gets the normal
	 * preview+program routing every other caller relies on. */
	eng.setSendTo({ preview: true, program: !opts.restrictToPreview, screenIdx: opts.screenIdx }, tlId)
	eng.setLoop(tlId, !!layer.loop)
	const pb = opts.startAtCurrentPosition ? eng.getPlayback?.(tlId) : null
	const startPos = pb?.position ?? 0
	/* WO-537: both callers ask for `startAtCurrentPosition: false`, i.e. start at 0 — and until now
	 * `play()` silently ignored that whenever the timeline happened to be paused, because its
	 * resume shortcut discards `fromMs` by design. Any operator who had scrubbed the timeline in its
	 * own editor therefore got the look's timeline layer resuming from wherever they left it. That
	 * is the "playing the same timeline from a look does not work properly" half of the report; the
	 * Take button was unaffected because `playForTake` never resumes. */
	const restart = !opts.startAtCurrentPosition
	if (!(opts.fadeDur > 0)) {
		eng.play(tlId, startPos, { restart })
		return []
	}
	const tl = eng.get(tlId)
	const physLayers = collectTimelinePhysicalLayers(tl)
	if (physLayers.length && amcp) {
		await amcp
			.batchSendChunked(
				physLayers.map((L) => `MIXER ${channel}-${L} OPACITY 0 0`),
				{ skipMixerPreCommit: true },
			)
			.catch(() => {})
	}
	// WO-528: the caller fades these in, so the engine must not write an instant full-opacity value
	// between the preset above and that fade — same fault as the Take path, and the reason a timeline
	// inside a look "flashes ... and gets back to the look".
	eng.play(tlId, startPos, { takeFade: true, restart })
	const kfLayers = collectClipOpacityFadeLayers(eng, tl, startPos)
	return physLayers.filter((L) => !kfLayers.has(L))
}

module.exports = {
	runTimelineDirectTake,
	fadePhysicalLayersOut,
	fadePhysicalLayersIn,
	transitionIsCut,
	collectTimelinePhysicalLayers,
	collectClipOpacityFadeLayers,
	startSceneTimelineLayer,
}
