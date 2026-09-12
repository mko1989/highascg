/**
 * WO-572 Part C — audio-only looks: a look flagged `audioOnlyLook: true` plays audio (a single
 * clip, or a playlist) on a fixed physical layer (AUDIO_ONLY_LOOK_LAYER, see look-layer-ranges.js)
 * that the normal look take/diff/exit machinery never touches — taking or stopping one never
 * enters buildTakeJobs, never diffs against the channel's live video look, and clearing a normal
 * look (clearSceneProgramLookStackLayers) already ignores this layer by construction
 * (isLookPhysicalLayer excludes it).
 *
 * Only the look's FIRST layer plays; a video/CG/etc layer added to an audio-only look is ignored
 * (deliberately not validated away — keeps the take path simple; the deck/editor UI is expected
 * to steer operators toward a single audio layer).
 *
 * Playlist advance is a self-contained duration timer (item.duration seconds, default 5), NOT the
 * OSC-driven engine normal look playlists use (scene-take-lbg-playlist.js) — that engine computes
 * its physical layer via the bank-offset formula (physicalProgramLayer), which would map layer 200
 * on bank B to 300, colliding with the PIP overlay band (260–979). Staying off that machinery
 * entirely avoids the collision without needing to special-case it. Preview shows item 0 only,
 * with no advance timer — the same "staged, static" convention normal look playlists use on PRV.
 *
 * Every PLAY on the fixed layer (initial take, playlist advance, or one audio-only look replacing
 * another on the same screen) carries a MIX transition — same {type:'MIX', duration:12} default
 * normal look playlists fall back to (scene-take-lbg-playlist.js) — so switching background audio
 * never hard-cuts, whether that's the first item starting from silence or one track replacing
 * another mid-show.
 */

'use strict'

const { AUDIO_ONLY_LOOK_LAYER } = require('./look-layer-ranges')
const { resolveSceneClipForAmcp } = require('./scene-take-lbg-helpers')

/** Default crossfade for every audio-only PLAY — mirrors the normal playlist engine's default. */
const AUDIO_ONLY_TRANSITION = { transition: 'MIX', duration: 12 }

/** @param {object} scene @returns {boolean} */
function isAudioOnlyLook(scene) {
	return !!scene?.audioOnlyLook
}

/** @param {object} scene @returns {object|null} */
function resolveAudioOnlyLookLayer(scene) {
	const layers = Array.isArray(scene?.layers) ? scene.layers : []
	return layers[0] || null
}

/** Per-channel advance timers — isolated from every other engine timer bag. @type {Map<number, NodeJS.Timeout>} */
const _advanceTimers = new Map()

function _clearAdvanceTimer(channel) {
	const t = _advanceTimers.get(Number(channel))
	if (t) {
		clearTimeout(t)
		_advanceTimers.delete(Number(channel))
	}
}

/**
 * @param {{ amcp: object, channel: number, scene: object, self?: object, preview?: boolean }} opts
 */
async function takeAudioOnlyLook({ amcp, channel, scene, self, preview = false }) {
	const ch = Number(channel)
	_clearAdvanceTimer(ch)
	const layer = resolveAudioOnlyLookLayer(scene)
	if (!layer) {
		await stopAudioOnlyLook({ amcp, channel: ch })
		return
	}

	const isPlaylist = layer.sourceMode === 'list' && Array.isArray(layer.playlist) && layer.playlist.length > 0
	if (!isPlaylist) {
		const raw = layer.source?.value
		if (!raw) {
			await stopAudioOnlyLook({ amcp, channel: ch })
			return
		}
		const clip = resolveSceneClipForAmcp(raw, self)
		await amcp.play(ch, AUDIO_ONLY_LOOK_LAYER, clip, { ...AUDIO_ONLY_TRANSITION, loop: !!layer.loop })
		return
	}

	const playIndex = async (idx) => {
		const item = layer.playlist[idx % layer.playlist.length]
		const raw = item?.value
		if (!raw) return
		const clip = resolveSceneClipForAmcp(raw, self)
		await amcp.play(ch, AUDIO_ONLY_LOOK_LAYER, clip, { ...AUDIO_ONLY_TRANSITION })
		if (preview) return
		const rawDuration = Number(item.duration)
		const durationMs = (Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 5) * 1000
		const t = setTimeout(() => {
			playIndex(idx + 1).catch((err) => {
				if (typeof self?.log === 'function') {
					self.log('warn', `[audio-only-look] advance failed ch${ch}: ${err?.message || err}`)
				}
			})
		}, durationMs)
		_advanceTimers.set(ch, t)
	}
	await playIndex(0)
}

/**
 * @param {{ amcp: object, channel: number }} opts
 */
async function stopAudioOnlyLook({ amcp, channel }) {
	const ch = Number(channel)
	_clearAdvanceTimer(ch)
	await amcp.stop(ch, AUDIO_ONLY_LOOK_LAYER).catch(() => {})
	await amcp.clear(ch, AUDIO_ONLY_LOOK_LAYER).catch(() => {})
}

module.exports = {
	AUDIO_ONLY_LOOK_LAYER,
	AUDIO_ONLY_TRANSITION,
	isAudioOnlyLook,
	resolveAudioOnlyLookLayer,
	takeAudioOnlyLook,
	stopAudioOnlyLook,
}
