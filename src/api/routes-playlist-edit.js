'use strict'

/**
 * WO-603 slice 6 — the look-layer playlist editor's API (web inspector-layer-playlist.js mutations, decided in node):
 *   POST /api/playlist/edit { sceneId, layer, op, ...args } → { ok, patch, rows, showsNext, timelessSecs, patched }
 *     op = mode | add | add_empty (WO-768) | move | remove | item | settings | timeless (engine/playlist-edit.js) | describe (rows only).
 *     The client sends the layer it holds (its edits may not be deck-synced yet) and stores `patch` on it; when the
 *     playlist changed and the look is live, the running engine's copy is patched too (web pushLivePlaylistUpdate).
 *   POST /api/playlist/edit/next { sceneId, layerNumber } → the inspector's Next ▶ on the program channel where that
 *     look is live (the web resolved the channel in the browser, inspector-layer-playlist.js:366-372).
 *     WO-766 (owner 25.10: "it doesnt let me change the item on the list when its not on program. ridicules, thats
 *     what the preview is for"): not on program → step_preview (the start item moves, a PRV recall re-stages it).
 *   POST /api/playlist/edit/pick { sceneId, layerNumber, index } → the row picked in the inspector: goto on program,
 *     else set_start (re-stages PRV, and the take starts there — WO-347 / WO-581).
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const liveSceneState = require('../state/live-scene-state')
const { planPlaylistEdit, showsNext, timelessSecsOf } = require('../engine/playlist-edit')
const { isTimelessPlaylistItem } = require('../engine/scene-take-lbg-playlist')
const { clipMissing } = require('../media/media-exists')
const { buildDurationIndex, mediaDurationMs, formatClipDuration } = require('../media/media-duration')
const { mediaIndexFor, patchLivePlaylist } = require('./routes-playlist-panel')
const { defaultFadeFrames } = require('../engine/playlist-fade-out')
const { isEmptyPlaylistItem, EMPTY_LABEL } = require('../engine/playlist-empty')

const out = (status, body) => ({ status, headers: JSON_HEADERS, body: jsonBody(body) })

/** Media rows with their known lengths: CLS + disk rows, CINF-parsed, plus any cached ffprobe (no new probing). */
function durationIndexFor(ctx) {
	try {
		const { parseCinfMedia } = require('../media/cinf-parse')
		const rows = require('./media-catalog')
			.getRawMediaCatalog(ctx)
			.map((m) => ({ ...m, ...parseCinfMedia(m.cinf || (ctx.mediaDetails || {})[m.id] || ''), ...((ctx._mediaProbeCache || {})[m.id] || {}) }))
		return buildDurationIndex(rows)
	} catch {
		return buildDurationIndex([])
	}
}

/** Editor rows: what the inspector shows per item (web rows: name, ⚠, duration field or clip length, loop). */
function describeRows(playlist, ctx) {
	const media = mediaIndexFor(ctx)
	const durations = durationIndexFor(ctx)
	return (playlist || []).map((it) => {
		const value = String(it?.value || '')
		const name = String(it?.label || value).replace(/\\/g, '/').split('/').filter(Boolean).pop() || value
		const timeless = isTimelessPlaylistItem(it)
		const empty = isEmptyPlaylistItem(it) // WO-768
		return {
			id: it?.id ?? null,
			name: empty ? EMPTY_LABEL : name,
			value,
			timeless,
			empty,
			missing: !empty && clipMissing(value, media) === true,
			duration: timeless ? (Number(it?.duration) > 0 ? Number(it.duration) : timelessSecsOf(playlist)) : null,
			length: timeless ? '' : formatClipDuration(mediaDurationMs(value, durations)),
			loop: it?.loop === true,
			fadeOut: it?.fadeOut === true && !timeless,
		}
	})
}

async function handleEdit(body, ctx) {
	const b = parseBody(body) || {}
	const layer = b.layer && typeof b.layer === 'object' ? b.layer : null
	if (!layer) return out(400, { ok: false, error: 'layer required' })
	const op = String(b.op || '')
	const sceneId = String(b.sceneId || '').trim()
	let patch = {}
	let changed = false
	let touched
	if (op !== 'describe') {
		const plan = planPlaylistEdit(layer, op, b)
		if (plan.error) return out(400, { ok: false, error: plan.error })
		patch = plan.patch
		changed = plan.playlistChanged
		touched = plan.touched
	}
	const next = { ...layer, ...patch }
	const layerNumber = parseInt(layer.layerNumber, 10)
	const patched = changed && sceneId && Number.isFinite(layerNumber) ? await patchLivePlaylist(ctx, sceneId, layerNumber, next.playlist) : 0
	return out(200, {
		ok: true,
		patch,
		rows: describeRows(next.playlist, ctx),
		showsNext: showsNext(next),
		timelessSecs: timelessSecsOf(next.playlist),
		fadeFramesDefault: defaultFadeFrames(programFps(ctx, sceneId)),
		currentIndex: sceneId && Number.isFinite(layerNumber) ? currentIndex(ctx, sceneId, layerNumber) : 0,
		patched,
		...(touched !== undefined ? { touched } : {}),
	})
}

/** The program channel where `sceneId` is live (never a PRV recall — playlists run on program, WO-355 / WO-581). */
function liveProgramChannel(ctx, sceneId) {
	let isPrv = () => false
	try {
		const { isPreviewCasparChannel } = require('../engine/caspar-channel-clear')
		isPrv = (ch) => isPreviewCasparChannel(ctx.config, ch)
	} catch {
		/* no config — treat every channel as program */
	}
	for (const [chKey, entry] of Object.entries(liveSceneState.getAll() || {})) {
		const ch = parseInt(chKey, 10)
		if (entry?.scene && String(entry.scene.id) === sceneId && !isPrv(ch)) return ch
	}
	return null
}

/** The frame rate the look plays at: its program channel, else the first program channel (Caspar's own rate). */
function programFps(ctx, sceneId) {
	const { resolveChannelFramerateForMixerTween } = require('../engine/scene-transition')
	let ch = liveProgramChannel(ctx, sceneId)
	if (ch == null) {
		try {
			ch = ctx.state?.getState?.()?.channelMap?.programChannels?.[0] ?? 1
		} catch {
			ch = 1
		}
	}
	return resolveChannelFramerateForMixerTween(ctx, ch)
}

/** The item the inspector marks: playing on program, else the start item (what PRV shows and a take starts on). */
function currentIndex(ctx, sceneId, layerNumber) {
	const ch = liveProgramChannel(ctx, sceneId)
	if (ch != null) return (ctx.playlistActiveIndices || {})[require('../engine/scene-take-lbg-playlist').playlistRuntimeKey(ch, sceneId, layerNumber)] ?? 0
	return (ctx.playlistStartIndices || {})[`${sceneId}-${layerNumber}`] ?? 0
}

const control = (body, ctx) => require('./routes-playlist').handlePost('/api/playlist/control', body, ctx)

async function handleNext(body, ctx) {
	const b = parseBody(body) || {}
	const sceneId = String(b.sceneId || '').trim()
	const layerNumber = parseInt(b.layerNumber, 10)
	if (!sceneId || !Number.isFinite(layerNumber)) return out(400, { ok: false, error: 'sceneId and layerNumber required' })
	const channel = liveProgramChannel(ctx, sceneId)
	if (channel == null) return control({ action: 'step_preview', sceneId, layerNumber, direction: 'next' }, ctx)
	return require('./routes-playlist').handlePost('/api/playlist/next', { channel, layerNumber }, ctx)
}

async function handlePick(body, ctx) {
	const b = parseBody(body) || {}
	const sceneId = String(b.sceneId || '').trim()
	const layerNumber = parseInt(b.layerNumber, 10)
	const index = parseInt(b.index, 10)
	if (!sceneId || !Number.isFinite(layerNumber) || !(index >= 0)) return out(400, { ok: false, error: 'sceneId, layerNumber and index required' })
	const channel = liveProgramChannel(ctx, sceneId)
	if (channel == null) return control({ action: 'set_start', sceneId, layerNumber, index }, ctx)
	return control({ action: 'goto', channel, layerNumber, index }, ctx)
}

module.exports = { describeRows, liveProgramChannel, handleEdit, handleNext, handlePick }
