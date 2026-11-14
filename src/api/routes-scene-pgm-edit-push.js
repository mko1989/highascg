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
 *   - WO-1073: PIP overlays only → the same nudge + the overlay CG lines on the program channel, on the slots of the
 *     ACTIVE bank read inside the take chain (routes-scene-preview-pip.js pushPgmPipOverlays) — no clip reloads, and a
 *     border / glow / shadow of the same type and side is CG UPDATEd in place (no template reload);
 *   - anything else (clip, loop, trim, speed, audio, layers added / removed) → a cut take of the look on PGM with PRV
 *     left alone (`previewExchange: false`: no pgm→prv flip-flop of the outgoing look — it is the same look) and
 *     `editOnAir` (WO-1073): only the changed layers reload, at their current playhead; the take refuses (409) when
 *     the look left air before its turn in the take chain;
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
	if (decided === 'nudge' || decided === 'overlay') {
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
		let pip = null
		if (nr?.status === 200 && parsed.ok === true && decided === 'overlay') {
			const canvas = Number(res.w) > 0 && Number(res.h) > 0 ? { w: Number(res.w), h: Number(res.h) } : null
			const pushPip = deps.pushPip || ((a) => require('./routes-scene-preview-pip').pushPgmPipOverlays(ctx, a))
			pip = await pushPip({ sceneId, scene, live, pgmCh, canvas })
		}
		if (nr?.status === 200 && parsed.ok === true && (pip == null || pip.ok)) {
			const register = deps.registerLive || (() => registerLive(ctx, scene, map, mainIdx, pgmCh, live))
			await register()
			return out(200, { ok: true, mode: decided, target: 'pgm', mainIdx, programChannel: pgmCh, lines: parsed.lines ?? null, ...(pip ? { pipLines: pip.lines } : {}) })
		}
		/* the look left air between our read and the take chain → never re-take it onto PGM */
		if (parsed.staged === false || pip) return out(409, { ok: false, mode: 'not_on_air', mainIdx, programChannel: pgmCh, error: 'This look left PGM — edits go to PRV' })
	}
	const takeLook = deps.takeLook || ((tb) => require('./routes-scene-take-look').handleTakeLook(tb, ctx))
	const tr = await takeLook({ sceneId, mainIdx, target: 'program', forceCut: true, previewExchange: false, editOnAir: true })
	const parsed = parseRes(tr)
	const left = tr?.status === 409 && /not_on_air/.test(String(parsed.error || '')) // WO-1073: refused inside the take chain
	return out(tr?.status || 500, { ...parsed, ok: tr?.status === 200 && parsed.ok !== false, mode: left ? 'not_on_air' : 'take', target: 'pgm', mainIdx, programChannel: pgmCh })
}

/** One media reference as the comparison sees it (moved to the engine for the WO-1073 edit take, same rule). */
const { canonValue } = require('../engine/scene-take-edit-on-air')

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
