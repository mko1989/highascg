'use strict'

/**
 * WO-1073 — an EDIT of the look that is already on air (the look editor's PGM edit, WO-1044, and the PRV edit push,
 * WO-598) re-takes only what changed. Owner 14.11: "I changed settings such as the speed of a clip and parameters of a
 * PiP border on pgm2 … each change made the clip or the border reload. I'd like whatever possible to show seamlessly."
 *
 * Only the edit paths pass `editOnAir` (routes-scene-pgm-edit-push.js / routes-scene-preview-push.js → take-look →
 * routes-scene-take.js, which honours it only while the same look is still on that channel). A normal operator take
 * never sees it and restarts its clips as before.
 *   - a layer identical to the one on air keeps playing untouched (no LOADBG / PLAY); on a banked PGM it is SWAPped to
 *     the new bank inside the PLAY batch, with its PIP overlay slots, so the stacking order never inverts;
 *   - an unchanged timeline layer is not restarted;
 *   - a reloaded layer showing the same file (speed, trim, loop, audio … changed) resumes at the playhead it has now,
 *     when Caspar reports one that is a clip position (the on-air layer runs at 1x; see editResumeSeekFrames).
 */

const { layerHasContent } = require('./scene-transition')
const { normalizeSpeed, clipSupportsSpeed } = require('../caspar/clip-speed')
const { pipOverlaysFromLayer, resolvePipOverlayCasparLayer } = require('./pip-overlay-utils')

const URL_LIKE = /^(https?|rtsp|rtmp|srt|udp|ndi|alsa|decklink|route|shm):/i

/** One media reference as the comparison sees it: project-relative ids expanded under the active show, NFC, any case (WO-1044). */
function canonValue(v, slug, config) {
	const raw = String(v ?? '').normalize('NFC').replace(/\\/g, '/').trim()
	if (!raw || URL_LIKE.test(raw) || raw.startsWith('#')) return raw
	const { expandMediaIdToMediaRoot } = require('../media/project-media-root')
	return String(slug ? expandMediaIdToMediaRoot(raw, slug, config || {}) : raw).toLowerCase()
}

function activeSlug(self) {
	try {
		return require('../media/project-media-root').getActiveProjectSlug(self?.persistence)
	} catch {
		return null
	}
}

const kind = (t) => {
	const s = String(t || '').toLowerCase()
	return s === 'file' ? 'media' : s
}

/** The layer as the edit compare sees it: no take-time seek, the file named canonically, media ≡ file. */
function normLayer(l, slug, config) {
	const { playSeekFrames: _p, ...rest } = l || {}
	return { ...rest, source: { ...(l?.source || {}), type: kind(l?.source?.type), value: canonValue(l?.source?.value, slug, config) } }
}

function stable(v) {
	if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
	if (v && typeof v === 'object') {
		return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
	}
	return JSON.stringify(v)
}

/** Same file / stream on both (canonical names). */
function sameMedia(cur, layer, self) {
	if (!layerHasContent(cur) || !layerHasContent(layer)) return false
	const slug = activeSlug(self)
	return kind(cur.source.type) === kind(layer.source.type) && canonValue(cur.source.value, slug, self?.config) === canonValue(layer.source.value, slug, self?.config)
}

/**
 * The on-air layer and the edited one are the SAME layer in every field (canonical media names) → it keeps playing.
 * Deliberately strict: any difference — fill, crop, speed, trim, audio, effects, PIP, contentZoom … — reloads it.
 * Playlists always reload (their advance machinery is per take job).
 */
function editLayerKeepsPlaying(cur, layer, self) {
	if (!layerHasContent(cur) || !layerHasContent(layer)) return false
	if (layer.sourceMode === 'list' || cur.sourceMode === 'list') return false
	const slug = activeSlug(self)
	return stable(normLayer(cur, slug, self?.config)) === stable(normLayer(layer, slug, self?.config))
}

/**
 * Where a RELOADED layer of the look on air starts: at the playhead it has now (OSC, projected to the PLAY deadline —
 * the same WO-582 lead a relative start uses), placed inside the edited layer's in / out. → frames, or null (the take's
 * own start rule applies).
 *
 * Not a clip position when the on-air layer runs at another speed (WO-973): Caspar's `file/time` is the pts of the
 * frame leaving the layer's filter graph (av_producer.cpp:1194 `frame.pts = … frame.video->pts …`), and the speed's
 * `setpts=(PTS-STARTPTS)/x+STARTPTS` re-times that pts from the first frame decoded after the last seek / loop (a
 * keyframe at or before the seek). Clip time = K + x·(time − K) with K unknown here → no resume, said in the log.
 */
function editResumeSeekFrames(self, { channel, cur, layer, clip, onAirPhys, fps, project, fit, inFrames }) {
	if (!cur || layer?.sourceMode === 'list' || cur.sourceMode === 'list') return null
	if (!sameMedia(cur, layer, self) || !clipSupportsSpeed(clip)) return null
	const tag = `[edit-on-air] ${channel}-${onAirPhys} L${layer.layerNumber}`
	const onAirSpeed = normalizeSpeed(cur.speed)
	if (onAirSpeed != null) {
		self?.log?.('info', `${tag}: on air at ${onAirSpeed}x — Caspar reports filter-output time, not a clip position → the layer's own start`)
		return null
	}
	const projected = project(self, channel, onAirPhys, fps)
	if (projected == null) {
		self?.log?.('info', `${tag}: no OSC playhead → the layer's own start`)
		return null
	}
	const f = Math.max(inFrames, fit(projected))
	self?.log?.('info', `${tag}: resumes at playhead ${projected} → SEEK ${f}`)
	return f
}

/** An unchanged timeline layer of the look on air keeps running (no restart). */
function editTimelineStays(cur, layer, self) {
	return String(cur?.source?.type || '') === 'timeline' && editLayerKeepsPlaying(cur, layer, self)
}

/**
 * WO-1073: the SWAP of kept layers (content + PIP overlay slots) to the new bank, sent INSIDE the PLAY batch: a kept
 * layer left on the old bank until the post-teardown SWAP (WO-218) sat above / below a layer the take just PLAYed on the
 * other bank — e.g. a changed L10 on 110 hid the kept PiP L11 still on 11 until the teardown. Riding the PLAY batch they
 * land on the same frame. The lines go on the first job with a PLAY; without one the WO-218 SWAP in finalize runs.
 * @returns {number} kept layers moved early
 */
function attachEditSwapsToPlayBatch({ channel, takeJobs, skipped, phys, inactiveBank }) {
	const first = (takeJobs || []).find((j) => j.playPlan)
	if (!first || !Array.isArray(skipped) || skipped.length === 0) return 0
	const lines = []
	for (const sk of skipped) {
		const toPhys = phys(sk.layerNumber, inactiveBank)
		if (sk.physicalLayerNow === toPhys) continue
		lines.push(...keptLayerSwapLines(channel, sk, toPhys))
		sk.swappedEarly = true
	}
	if (lines.length) first.swapBeforePlay = lines
	return lines.length ? skipped.filter((s) => s.swappedEarly).length : 0
}

/** SWAP of one kept layer and of the overlay slots its PIP overlays sit on (slot = f(physical layer), WO-160). */
function keptLayerSwapLines(channel, sk, toPhys) {
	const lines = [`SWAP ${channel}-${sk.physicalLayerNow} ${channel}-${toPhys} TRANSFORMS`]
	const n = pipOverlaysFromLayer(sk.incomingLayer).length
	for (let i = 0; i < n; i++) {
		const from = resolvePipOverlayCasparLayer(sk.physicalLayerNow, i)
		const to = resolvePipOverlayCasparLayer(toPhys, i)
		if (from !== to) lines.push(`SWAP ${channel}-${from} ${channel}-${to} TRANSFORMS`)
	}
	return lines
}

/** After the swap the vacated overlay slots hold what the target slots held (nothing, normally) — cleared. */
function vacatedOverlayClearLines(channel, sk) {
	const lines = []
	const n = pipOverlaysFromLayer(sk.incomingLayer).length
	for (let i = 0; i < n; i++) {
		const cl = `${channel}-${resolvePipOverlayCasparLayer(sk.physicalLayerNow, i)}`
		lines.push(`CG ${cl} CLEAR`, `MIXER ${cl} CLEAR`)
	}
	return lines
}

module.exports = {
	canonValue,
	editLayerKeepsPlaying,
	editTimelineStays,
	editResumeSeekFrames,
	attachEditSwapsToPlayBatch,
	keptLayerSwapLines,
	vacatedOverlayClearLines,
}
