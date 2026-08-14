'use strict'

const { clipParamForPlay } = require('../caspar/amcp-utils')
const { resolveTimelineClipFrame } = require('./scene-play-seek')
const {
	buildEffectAmcpLinesPlayback,
	mixerEffectNeutralLines,
} = require('./timeline-playback-helpers')
const {
	mergedFillKeyframeTimes,
	keyframeSegmentIndex,
	msToMixerFrames,
	fillTweenForSegmentEnd,
	mapKeyframeTween,
	easingAtTime,
	shouldSendInstantKeyframeMixer,
} = require('./timeline-keyframe-mixer')

/**
 * @param {object} clip
 * @param {number} ms timeline position
 * @param {object} tl timeline model
 * @param {object} self app ctx
 */
function clipTransportMeta(clip, ms, tl, self, opts = {}) {
	const src = String(clip.source?.value || '')
	const transport = resolveTimelineClipFrame(clip, ms, tl, self, opts)
	return {
		src,
		srcQ: clipParamForPlay(src),
		isRoute: transport.isRoute,
		frame: transport.frame,
		implicitLoop: transport.implicitLoop,
		loopSpanFrames: transport.loopSpanFrames,
		inFrames: transport.inFrames,
		loopClip: !!(clip.loopAlways || clip.loop),
		loopAlways: !!clip.loopAlways,
	}
}

module.exports = {
	clipTransportMeta,

	/**
	 * Program master layout from server config (matches Device View → Audio).
	 */
	_programLayoutForPlayback() {
		const { resolveConfigProgramLayout } = require('./audio-route')
		const screenIdx = this._sendToFor(this._airTimelineId)?.screenIdx
		const mainIndex =
			screenIdx === null || screenIdx === 'all' || screenIdx === undefined
				? 0
				: Math.max(0, parseInt(String(screenIdx), 10) || 0)
		return resolveConfigProgramLayout(this.self?.config, mainIndex)
	},

	_clearLayerMixerSchedule(ch, layer) {
		const prefix = `${ch}-${layer}-`
		for (const pk of this._lastKfValues.keys()) {
			if (pk.startsWith(prefix)) this._lastKfValues.delete(pk)
		}
		for (const pk of this._lastKfSegment.keys()) {
			if (pk.startsWith(prefix)) this._lastKfSegment.delete(pk)
		}
	},

	/**
	 * One MIXER command per keyframe segment during playback (duration = end−start in frames).
	 * Scrub/force/pause: instant mixer (duration 0) at interpolated value.
	 * T173.4: collect MIXER lines into array instead of sending immediately when collectLines provided.
	 * @param {{ force?: boolean, playing?: boolean, fps?: number, scheduleLeadTween?: boolean, collectLines?: Array }} opts
	 *   collectLines: array to collect MIXER lines; if provided, lines are appended instead of sent via amcp.
	 * @returns {boolean} True if any mixer command was collected/sent (caller should COMMIT that channel on Caspar 2.5+).
	 */
	_applyClipMixer(ch, layer, clip, localMs, opts = {}) {
		const self = this.self
		if (!self?.amcp) return false
		const force = !!opts.force
		const playing = !!opts.playing && !force
		const fps = Math.max(1, opts.fps || 25)
		const collectLines = opts.collectLines
		const { w, h } = this._programResolutionForPlayback()
		const base = this._clipFillBaseNormalized(clip, w, h)

		let sent = false

		const fillAt = (t) => {
			const ms = Math.max(0, t)
			return {
				fx: this._interpProp(clip, 'fill_x', ms, base.fill_x),
				fy: this._interpProp(clip, 'fill_y', ms, base.fill_y),
				sx: this._interpProp(clip, 'scale_x', ms, base.scale_x),
				sy: this._interpProp(clip, 'scale_y', ms, base.scale_y),
			}
		}
		const fillKey = (v) => `${v.fx},${v.fy},${v.sx},${v.sy}`

		const fillTimes = mergedFillKeyframeTimes(clip)
		const fillSegIdx = keyframeSegmentIndex(fillTimes, localMs)
		const kFillSeg = `${ch}-${layer}-fill-seg`
		const kFill = `${ch}-${layer}-fill`
		const prevFillSeg = this._lastKfSegment.get(kFillSeg)
		const inAnimatedSpan =
			playing && fillTimes.length >= 2 && fillSegIdx >= 0 && fillSegIdx < fillTimes.length - 1
		const segChanged = inAnimatedSpan && prevFillSeg !== fillSegIdx

		if (segChanged) {
			const t0 = fillTimes[fillSegIdx]
			const t1 = fillTimes[fillSegIdx + 1]
			const start = fillAt(localMs > t0 + 2 ? localMs : t0)
			const end = fillAt(t1)
			const spanMs = Math.max(1, t1 - t0)
			const dur = msToMixerFrames(spanMs, fps)
			const tween = mapKeyframeTween(fillTweenForSegmentEnd(clip, t1))
			const cl = `${ch}-${layer}`

			if (collectLines) {
				// T173.4: collect FILL segment lines with DEFER for tween
				collectLines.push(`MIXER ${cl} FILL ${start.fx} ${start.fy} ${start.sx} ${start.sy} 0`)
				let p = `${end.fx} ${end.fy} ${end.sx} ${end.sy} ${dur}`
				if (tween) p += ` ${tween}`
				collectLines.push(`MIXER ${cl} FILL ${p} DEFER`)
			} else {
				// Legacy path (when collectLines not provided, e.g., scheduleLeadTween or phase 1 only)
				self.amcp.mixerFill(ch, layer, start.fx, start.fy, start.sx, start.sy, 0).catch(() => {})
				self.amcp.mixerFill(ch, layer, end.fx, end.fy, end.sx, end.sy, dur, tween, true).catch(() => {})
			}
			this._lastKfSegment.set(kFillSeg, fillSegIdx)
			this._lastKfValues.set(kFill, fillKey(end))
			sent = true
			if (typeof self.log === 'function') {
				self.log(
					'debug',
					`[Timeline] MIXER ${ch}-${layer} FILL seg ${t0}→${t1} ms dur=${dur} ${tween}`
				)
			}
		}

		const cur = fillAt(localMs)
		const curStr = fillKey(cur)
		if (
			!segChanged &&
			shouldSendInstantKeyframeMixer({
				playing,
				force,
				inTweenSpan: inAnimatedSpan,
				valueChanged: this._lastKfValues.get(kFill) !== curStr,
			})
		) {
			this._lastKfValues.set(kFill, curStr)
			if (playing && inAnimatedSpan) this._lastKfSegment.set(kFillSeg, fillSegIdx)
			else if (!playing) this._lastKfSegment.delete(kFillSeg)
			const cl = `${ch}-${layer}`
			// T173.4: instant (non-segment) FILL values still sent immediately, not collected
			self.amcp.mixerFill(ch, layer, cur.fx, cur.fy, cur.sx, cur.sy, 0).catch(() => {})
			sent = true
			if (typeof self.log === 'function') {
				self.log('debug', `[Timeline] MIXER ${ch}-${layer} FILL ${cur.fx} ${cur.fy} ${cur.sx} ${cur.sy} 0`)
			}
		}

		const opDef = clip.opacity != null ? clip.opacity : 1
		sent =
			this._applyKeyedMixerProp(ch, layer, clip, 'opacity', localMs, opDef, playing, force, fps, {
				scheduleLeadTween: !!opts.scheduleLeadTween,
				takeFade: !!opts.takeFade,
				collectLines: collectLines,
			}) || sent
		const volDef = clip.volume != null ? clip.volume : 1
		const volVal = clip.muted ? 0 : this._interpProp(clip, 'volume', localMs, volDef)
		sent =
			this._applyKeyedMixerProp(ch, layer, clip, 'volume', localMs, volVal, playing, force, fps, {
				isVolume: true,
				collectLines: collectLines,
			}) || sent

		const kFx = `${ch}-${layer}-fx`
		const fxKey =
			Array.isArray(clip.effects) && clip.effects.length > 0
				? clip.effects.map((f) => `${f.type}:${JSON.stringify(f.params || {})}`).join('|')
				: ''
		if (this._lastKfValues.get(kFx) !== fxKey) {
			this._lastKfValues.set(kFx, fxKey)
			const cl = `${ch}-${layer}`
			const lines = [...mixerEffectNeutralLines(cl)]
			if (Array.isArray(clip.effects)) {
				for (const fx of clip.effects) {
					const fxLines = buildEffectAmcpLinesPlayback(fx.type, fx.params || {}, cl)
					if (fxLines) lines.push(...fxLines)
				}
			}
			if (lines.length > 0) {
				// T173.4: effects are not segment changes, sent immediately
				for (const l of lines) self.amcp.raw(l).catch(() => {})
				sent = true
			}
		}
		return sent
	},

	/**
	 * Opacity/volume keyframes: one tweened MIXER per segment while playing.
	 * T173.4: collect MIXER lines into array instead of sending immediately.
	 * @param {{ isVolume?: boolean, scheduleLeadTween?: boolean, takeFade?: boolean, collectLines?: Array }} extra —
	 *   takeFade (WO-528): a MIX take is about to fade these layers in, so the instant OPACITY write
	 *   below is suppressed — it would land the layer at full before the fade even starts.
	 *   scheduleLeadTween:
	 *   take entry (WO-139): batch the current opacity segment as instant-start + DEFER tween so
	 *   the clip fade-in fires on the take orchestrator's single MIXER COMMIT (frame-locked with
	 *   the look crossfade) instead of an instant value that ticks animate later.
	 *   collectLines: array to collect MIXER lines (T173.4); if provided, lines are appended instead of sent.
	 * @returns {boolean} True if any lines were collected/sent (caller should mark channel dirty).
	 */
	_applyKeyedMixerProp(ch, layer, clip, prop, localMs, holdValue, playing, force, fps, extra = {}) {
		const self = this.self
		const collectLines = extra.collectLines
		const kfs = (clip.keyframes || [])
			.filter((k) => k.property === prop)
			.sort((a, b) => a.time - b.time)
		const times = kfs.map((k) => k.time)
		const segIdx = keyframeSegmentIndex(times, localMs)
		const kSeg = `${ch}-${layer}-${prop}-seg`
		const prevSeg = this._lastKfSegment.get(kSeg)
		const inSpan = playing && times.length >= 2 && segIdx >= 0 && segIdx < times.length - 1

		if (
			extra.scheduleLeadTween &&
			!extra.isVolume &&
			force &&
			times.length >= 2 &&
			segIdx >= 0 &&
			segIdx < times.length - 1
		) {
			const t0 = times[segIdx]
			const t1 = times[segIdx + 1]
			const startVal = this._interpProp(clip, prop, localMs, holdValue)
			const endVal = this._interpProp(clip, prop, t1, holdValue)
			const dur = msToMixerFrames(Math.max(1, t1 - Math.max(t0, localMs)), fps)
			const tween = mapKeyframeTween(easingAtTime(clip, prop, t1))
			const cl = `${ch}-${layer}`
			self.amcp
				.batchSendChunked(
					[`MIXER ${cl} OPACITY ${startVal} 0`, `MIXER ${cl} OPACITY ${endVal} ${dur} ${tween} DEFER`],
					{ skipMixerPreCommit: true },
				)
				.catch(() => {})
			this._lastKfSegment.set(kSeg, segIdx)
			this._lastKfValues.set(`${ch}-${layer}-${prop}`, endVal)
			return true
		}

		const segChanged = inSpan && prevSeg !== segIdx

		if (segChanged) {
			const t0 = times[segIdx]
			const t1 = times[segIdx + 1]
			const startVal = this._interpProp(clip, prop, localMs > t0 + 2 ? localMs : t0, holdValue)
			const endVal = this._interpProp(clip, prop, t1, holdValue)
			const dur = msToMixerFrames(Math.max(1, t1 - t0), fps)
			const tween = mapKeyframeTween(easingAtTime(clip, prop, t1))
			const cl = `${ch}-${layer}`
			const keyword = extra.isVolume ? 'VOLUME' : 'OPACITY'

			if (collectLines) {
				// T173.4: collect segment lines with DEFER for tween
				collectLines.push(`MIXER ${cl} ${keyword} ${startVal} 0`)
				let p = `${endVal} ${dur}`
				if (tween) p += ` ${tween}`
				collectLines.push(`MIXER ${cl} ${keyword} ${p} DEFER`)
			} else {
				// Legacy path (for scheduleLeadTween which uses its own batching)
				if (extra.isVolume) {
					self.amcp.mixerVolume(ch, layer, startVal, 0).catch(() => {})
					self.amcp.mixerVolume(ch, layer, endVal, dur, tween, true).catch(() => {})
				} else {
					self.amcp.mixerOpacity(ch, layer, startVal, 0).catch(() => {})
					self.amcp.mixerOpacity(ch, layer, endVal, dur, tween, true).catch(() => {})
				}
			}
			this._lastKfSegment.set(kSeg, segIdx)
			this._lastKfValues.set(`${ch}-${layer}-${prop}`, endVal)
			return true
		}

		const val = kfs.length ? this._interpProp(clip, prop, localMs, holdValue) : holdValue
		const kVal = `${ch}-${layer}-${prop}`
		const last = this._lastKfValues.get(kVal)
		const valueChanged = last === undefined || Math.abs(val - last) >= 1e-5
		if (
			!segChanged &&
			shouldSendInstantKeyframeMixer({
				playing,
				force,
				inTweenSpan: inSpan,
				valueChanged,
			})
		) {
			this._lastKfValues.set(kVal, val)
			if (playing && inSpan) this._lastKfSegment.set(kSeg, segIdx)
			else if (!playing) this._lastKfSegment.delete(kSeg)
			/* WO-528 — during a MIX take the orchestrator owns this layer's opacity. It presets every
			 * timeline layer to `OPACITY 0 0`, PLAYs, then fades in over the transition duration. This
			 * instant write lands BETWEEN those two, at the clip's full base value, so the fade then
			 * ramps 1 -> 1: invisible, i.e. the take cuts with the right content on screen. Proven on
			 * the wire in log/caspar_2026-08-14.log. WO-139 T139.2 only carved out the KEYFRAME case
			 * (scheduleLeadTween above); a plain clip has no opacity keyframes and fell through here.
			 *
			 * The value is still RECORDED, deliberately: the fade ends at full, so this is where the
			 * layer genuinely lands, and recording it keeps `valueChanged` false on the following ticks.
			 * Skipping the record instead would re-emit an instant full-opacity write on the very next
			 * tick and clobber the fade mid-ramp.
			 *
			 * CUT takes are NOT suppressed (`takeFade` is false for them): there is no fade, the preset
			 * is 1, and this write is what gives a clip its own base opacity. Suppressing it there is
			 * exactly the invisible-CUT regression WO-139 T139.1 had to patch. */
			if (extra.takeFade && !extra.isVolume) return false
			const cl = `${ch}-${layer}`
			const keyword = extra.isVolume ? 'VOLUME' : 'OPACITY'
			// T173.4: instant (non-segment) values still sent immediately, not collected
			if (extra.isVolume) {
				self.amcp.mixerVolume(ch, layer, val, 0).catch(() => {})
			} else {
				self.amcp.mixerOpacity(ch, layer, val, 0).catch(() => {})
			}
			return true
		}
		return false
	},
}
