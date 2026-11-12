'use strict'

/**
 * WO-1044 — POST /api/scene/preview-push { sceneId, mainIdx?, target: 'pgm' }: the look editor with its screen's PGM edit
 * UNLOCKED pushes its edits straight to air (owner 12.11: "the lock is for looks programming in the live tab, so i can
 * edit the look that is currently on pgm" — PixelHue's per-screen pgmEdit lock, done HighAsCG's way).
 *
 * The same decision as the PRV push (routes-scene-preview-push.js decidePreviewPush), made against what is LIVE on the
 * screen's program channel instead of what is staged on PRV — the web's WO-272 "edit live on PGM" mode, server-side:
 *   - only the look that IS on air on that screen is pushed (409 `not_on_air` otherwise): an edit never puts a look on
 *     air it was not on;
 *   - geometry / opacity / crop / effects → the PGM MIXER nudge (/api/preview/mixer-nudge `target: 'pgm'`, bank-aware,
 *     staleness-guarded against the live map), then the live entry is updated in place (its take time kept);
 *   - anything else (clip, loop, trim, audio, PIP, layers added / removed) → a cut take of the look on PGM with PRV left
 *     alone (`previewExchange: false`: no pgm→prv flip-flop of the outgoing look — it is the same look);
 *   - a look edited down to no sources is refused: blanking a screen is a take, not an edit.
 */

const { JSON_HEADERS, jsonBody } = require('./response')

function out(status, payload) {
	return { status, headers: JSON_HEADERS, body: jsonBody(payload) }
}

function parseRes(res) {
	try {
		return typeof res?.body === 'string' ? JSON.parse(res.body) : res?.body || {}
	} catch {
		return {}
	}
}

/**
 * @param {{ b: object, ctx: object, deps: object, scene: object, sceneId: string, map: object, mainIdx: number }} a
 * deps (tests): getStaged, nudge, takeLook, registerLive, canonMedia — as handlePreviewPush's
 */
async function pushEditToPgm({ b, ctx, deps, scene, sceneId, map, mainIdx }) {
	const { decidePreviewPush, removedEffectTypes } = require('./routes-scene-preview-push')
	const pgmCh = Number(map.programChannels?.[mainIdx] ?? map.playbackChannels?.[mainIdx])
	if (!(Number.isFinite(pgmCh) && pgmCh > 0)) return out(400, { ok: false, error: `no program channel for main ${mainIdx}` })
	const getLive = deps.getStaged || ((ch) => require('../state/live-scene-state').getChannel(ch))
	const live = getLive(pgmCh)
	if (String(live?.sceneId || '') !== sceneId) {
		return out(409, { ok: false, mode: 'not_on_air', mainIdx, programChannel: pgmCh, liveSceneId: live?.sceneId ?? null,
			error: 'This look is not on PGM any more — edits go to PRV' })
	}
	if (!(scene.layers || []).some((l) => l?.source?.value)) {
		return out(409, { ok: false, mode: 'none', mainIdx, programChannel: pgmCh, error: 'A look on air keeps at least one source — take another look to clear the screen' })
	}
	// the live entry and the deck may name the same file differently (`clip.mp4` / `projects/<slug>/clip.mp4`): compared
	// raw, an untouched clip read as new content and the first edit cut-restarted it ON AIR (found live 12.11)
	const canon = deps.canonMedia || ((sc) => canonMedia(sc, ctx))
	const decided = await decidePreviewPush({ ...live, scene: canon(live.scene) }, canon(scene), sceneId)
	if (decided === 'nudge') {
		const nudge = deps.nudge || ((nb) => require('./routes-preview-nudge').handlePreviewMixerNudge(nb, ctx))
		const res = map.programResolutions?.[mainIdx] || {}
		const nr = await nudge({
			sceneId,
			mainIndex: mainIdx,
			target: 'pgm',
			layers: (scene.layers || []).filter((l) => l?.source?.value),
			allEffects: true,
			resetEffects: removedEffectTypes(live.scene, scene),
			...(Number(res.w) > 0 && Number(res.h) > 0 ? { composeCanvas: { w: Number(res.w), h: Number(res.h) } } : {}),
		})
		const parsed = parseRes(nr)
		if (nr?.status === 200 && parsed.ok === true) {
			const register = deps.registerLive || (() => registerLive(ctx, scene, map, mainIdx, pgmCh, live))
			await register()
			return out(200, { ok: true, mode: 'nudge', target: 'pgm', mainIdx, programChannel: pgmCh, lines: parsed.lines ?? null })
		}
		/* the look left air between our read and the take chain → never re-take it onto PGM */
		if (parsed.staged === false) return out(409, { ok: false, mode: 'not_on_air', mainIdx, programChannel: pgmCh, error: 'This look left PGM — edits go to PRV' })
	}
	const takeLook = deps.takeLook || ((tb) => require('./routes-scene-take-look').handleTakeLook(tb, ctx))
	const tr = await takeLook({ sceneId, mainIdx, target: 'program', forceCut: true, previewExchange: false })
	const parsed = parseRes(tr)
	return out(tr?.status || 500, { ...parsed, ok: tr?.status === 200 && parsed.ok !== false, mode: 'take', target: 'pgm', mainIdx, programChannel: pgmCh })
}

const URL_LIKE = /^(https?|rtsp|rtmp|srt|udp|ndi|alsa|decklink|route|shm):/i

/** One media reference as the comparison sees it: project-relative ids expanded under the active show, NFC, any case. */
function canonValue(v, slug, config) {
	const raw = String(v ?? '').normalize('NFC').replace(/\\/g, '/').trim()
	if (!raw || URL_LIKE.test(raw) || raw.startsWith('#')) return raw
	const { expandMediaIdToMediaRoot } = require('../media/project-media-root')
	return String(slug ? expandMediaIdToMediaRoot(raw, slug, config || {}) : raw).toLowerCase()
}

/** `scene` with every layer's source value in canonical form (a copy; only for the content compare). */
function canonMedia(scene, ctx) {
	const { getActiveProjectSlug } = require('../media/project-media-root')
	const slug = getActiveProjectSlug(ctx?.persistence)
	return {
		...scene,
		layers: (scene?.layers || []).map((l) =>
			l?.source?.value ? { ...l, source: { ...l.source, value: canonValue(l.source.value, slug, ctx?.config) } } : l),
	}
}

/** After a PGM nudge the live map describes the edited look — the take time (updatedAt: clip clocks, timers) is kept. */
async function registerLive(ctx, scene, map, mainIdx, pgmCh, live) {
	const { buildServerIncomingScene } = require('../engine/scene-take-payload')
	const { stripEphemeralTakeFields } = require('./routes-scene-shared')
	const pgmOnly = !(Number(map.previewChannels?.[mainIdx]) > 0 && Number(map.previewChannels[mainIdx]) !== pgmCh)
	const incoming = await buildServerIncomingScene(scene, { mainIdx, channelMap: map, pgmOnly })
	// the take's globalBorder slot rides the live entry (routes-scene-global-border.js) — an edit does not change it
	const next = { ...stripEphemeralTakeFields(incoming), ...(live?.scene?.globalBorder !== undefined ? { globalBorder: live.scene.globalBorder } : {}) }
	await require('../state/live-scene-state').setChannel(pgmCh, { ...live, sceneId: String(scene.id), scene: next })
}

module.exports = { pushEditToPgm, canonValue }
