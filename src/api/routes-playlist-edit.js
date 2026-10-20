'use strict'

/**
 * WO-603 slice 6 — the look-layer playlist editor's API (web inspector-layer-playlist.js mutations, decided in node):
 *   POST /api/playlist/edit { sceneId, layer, op, ...args } → { ok, patch, rows, showsNext, timelessSecs, patched }
 *     op = mode | add | move | remove | item | settings | timeless (engine/playlist-edit.js) | describe (rows only).
 *     The client sends the layer it holds (its edits may not be deck-synced yet) and stores `patch` on it; when the
 *     playlist changed and the look is live, the running engine's copy is patched too (web pushLivePlaylistUpdate).
 *   POST /api/playlist/edit/next { sceneId, layerNumber } → the inspector's Next ▶ on the program channel where that
 *     look is live (the web resolved the channel in the browser, inspector-layer-playlist.js:366-372).
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const liveSceneState = require('../state/live-scene-state')
const { planPlaylistEdit, showsNext, timelessSecsOf } = require('../engine/playlist-edit')
const { isTimelessPlaylistItem } = require('../engine/scene-take-lbg-playlist')
const { clipMissing } = require('../media/media-exists')
const { buildDurationIndex, mediaDurationMs, formatClipDuration } = require('../media/media-duration')
const { mediaIndexFor, patchLivePlaylist } = require('./routes-playlist-panel')

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
		return {
			id: it?.id ?? null,
			name,
			value,
			timeless,
			missing: clipMissing(value, media) === true,
			duration: timeless ? (Number(it?.duration) > 0 ? Number(it.duration) : timelessSecsOf(playlist)) : null,
			length: timeless ? '' : formatClipDuration(mediaDurationMs(value, durations)),
			loop: it?.loop === true,
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

async function handleNext(body, ctx) {
	const b = parseBody(body) || {}
	const sceneId = String(b.sceneId || '').trim()
	const layerNumber = parseInt(b.layerNumber, 10)
	if (!sceneId || !Number.isFinite(layerNumber)) return out(400, { ok: false, error: 'sceneId and layerNumber required' })
	const channel = liveProgramChannel(ctx, sceneId)
	if (channel == null) return out(409, { ok: false, error: 'This look is not on program — Next works while it plays.' })
	return require('./routes-playlist').handlePost('/api/playlist/next', { channel, layerNumber }, ctx)
}

module.exports = { describeRows, liveProgramChannel, handleEdit, handleNext }
