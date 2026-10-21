'use strict'

/**
 * What a PGM take starts besides the Caspar transition (called by routes-scene-take.js on both program paths):
 *  - replication: stamp + WS broadcast so a hot backup mirrors the leader's transition in sync;
 *  - WO-615 T8: the look's stored fixture state (project.fixtures.looks) crossfades in over the look's transition
 *    (same frames / channel fps as the LBG mixer fade; a forced cut snaps). A re-take of the look already on air
 *    (WO-272 edit-on-PGM pushes) leaves the rig alone. Fixture trouble never fails a take.
 */

const { normalizeTransition, resolveChannelFramerateForMixerTween } = require('./scene-transition')

/** → takeUpdatedAt (ms) */
function announceProgramTakeToReplication(ctx, mainIdx, inc, forceCut) {
	if (mainIdx < 0 || !inc?.id) return Date.now()
	const rt = ctx._replication
	if (!rt || rt.roleState?.getRole() !== 'leader') return Date.now()
	const takeUpdatedAt = Date.now()
	const { announceLeaderProgramTake } = require('../replication/live-state-feed')
	announceLeaderProgramTake(rt, ctx, {
		screenIdx: mainIdx + 1,
		sceneId: String(inc.id),
		forceCut: !!forceCut,
		takeUpdatedAt,
	})
	return takeUpdatedAt
}

/** → the recall result ({ fixtures, fade_ms }) or null (no state stored / not a new look / no engine). */
function recallFixtureLook(ctx, { mainIdx, inc, forceCut, channel, previousId, framerate }) {
	const svc = ctx.fixtureService
	if (mainIdx < 0 || !inc?.id || typeof svc?.recallLook !== 'function') return null
	if (previousId != null && String(previousId) === String(inc.id)) return null
	try {
		const t = normalizeTransition(inc.defaultTransition, forceCut)
		const fps = t.duration > 0 ? resolveChannelFramerateForMixerTween(ctx, channel, framerate) : 0
		const r = svc.recallLook(String(inc.id), fps > 0 ? (t.duration / fps) * 1000 : 0)
		if (r && typeof ctx.log === 'function') {
			ctx.log('info', `[scene-take] fixtures: look ${inc.id} → ${r.fixtures} fixture(s), fade ${r.fade_ms} ms`)
		}
		return r
	} catch (e) {
		if (typeof ctx.log === 'function') ctx.log('warn', `[scene-take] fixtures recall failed: ${e?.message || e}`)
		return null
	}
}

/** @param {{ mainIdx: number, inc: object, forceCut: boolean, channel: number, previousId?: string, framerate?: number }} o */
function programTakeStarted(ctx, o) {
	recallFixtureLook(ctx, o)
	return announceProgramTakeToReplication(ctx, o.mainIdx, o.inc, o.forceCut)
}

module.exports = { programTakeStarted, recallFixtureLook, announceProgramTakeToReplication }
