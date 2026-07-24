'use strict'

/**
 * Offline smoke — WO-329 Part A: server-issued monotonic project rev (2026-07-24).
 *
 * The save/autosave conflict check compared client WALL-CLOCK savedAt against the stored
 * project — on a box without NTP a client ~2h off produced endless bogus 409s ("payload is
 * older than the stored project", todos22 line 15). Both sides now carry a server-issued
 * monotonic `rev`; wall clock is display metadata only. Legacy payloads without a rev keep
 * the old savedAt compare as a grace path.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
	projectRevOf,
	isProjectSaveNewerOrEqual,
	validateIncomingProject,
} = require('../../src/engine/project-scenes-persist')

const scenes = (ids) => ({ scenes: ids.map((id) => ({ id })) })

describe('projectRevOf', () => {
	it('accepts positive integers, rejects garbage', () => {
		assert.equal(projectRevOf({ rev: 7 }), 7)
		assert.equal(projectRevOf({ rev: '12' }), 12)
		assert.equal(projectRevOf({ rev: 3.9 }), 3)
		assert.equal(projectRevOf({ rev: 0 }), null)
		assert.equal(projectRevOf({ rev: -1 }), null)
		assert.equal(projectRevOf({}), null)
		assert.equal(projectRevOf(null), null)
	})
})

describe('rev-based compare (clock-skew immune)', () => {
	const base = { savedAt: '2026-07-24T10:00:00.000Z' }

	it('rev beats wall clock: older savedAt but equal/newer rev is accepted', () => {
		// The exact todos22 failure: box clock 2h ahead of client — savedAt says stale, rev says fine.
		const stored = { ...base, rev: 5, savedAt: '2026-07-24T12:00:00.000Z' }
		assert.equal(isProjectSaveNewerOrEqual({ rev: 5, savedAt: '2026-07-24T10:00:01.000Z' }, stored), true)
		assert.equal(isProjectSaveNewerOrEqual({ rev: 6, savedAt: '2026-07-24T09:00:00.000Z' }, stored), true)
	})

	it('a genuinely stale rev is rejected regardless of a fresh wall clock', () => {
		const stored = { ...base, rev: 5 }
		assert.equal(isProjectSaveNewerOrEqual({ rev: 4, savedAt: '2027-01-01T00:00:00.000Z' }, stored), false)
	})

	it('legacy grace: either side missing a rev falls back to savedAt', () => {
		const stored = { savedAt: '2026-07-24T12:00:00.000Z' }
		assert.equal(isProjectSaveNewerOrEqual({ savedAt: '2026-07-24T11:00:00.000Z' }, stored), false, 'legacy stale stays rejected')
		assert.equal(isProjectSaveNewerOrEqual({ savedAt: '2026-07-24T13:00:00.000Z' }, stored), true)
		assert.equal(isProjectSaveNewerOrEqual({ rev: 9, savedAt: '2026-07-24T13:00:00.000Z' }, stored), true, 'rev on one side only → savedAt path')
		assert.equal(isProjectSaveNewerOrEqual({ rev: 1 }, null), true, 'no stored project → accept')
	})
})

describe('validateIncomingProject rev integration', () => {
	it('reports stale_rev (with both revs) when the rev compare rejects', () => {
		const stored = { rev: 8, savedAt: '2026-07-24T10:00:00.000Z', scenes: scenes(['a', 'b']) }
		const res = validateIncomingProject({ rev: 7, savedAt: '2026-07-24T11:00:00.000Z', scenes: scenes(['a', 'b']) }, stored)
		assert.equal(res.ok, false)
		assert.equal(res.reason, 'stale_rev')
		assert.equal(res.details.storedRev, 8)
		assert.equal(res.details.incomingRev, 7)
	})

	it('keeps stale_saved_at for legacy payloads', () => {
		const stored = { savedAt: '2026-07-24T12:00:00.000Z', scenes: scenes(['a', 'b']) }
		const res = validateIncomingProject({ savedAt: '2026-07-24T11:00:00.000Z', scenes: scenes(['a', 'b']) }, stored)
		assert.equal(res.ok, false)
		assert.equal(res.reason, 'stale_saved_at')
	})

	it('anti-resurrection guards are untouched: empty_over_nonempty still fires with a valid rev', () => {
		const stored = { rev: 3, savedAt: '2026-07-24T10:00:00.000Z', scenes: scenes(['a', 'b', 'c']) }
		const res = validateIncomingProject({ rev: 3, savedAt: '2026-07-24T11:00:00.000Z', scenes: scenes([]) }, stored)
		assert.equal(res.ok, false)
		assert.equal(res.reason, 'empty_over_nonempty')
	})

	it('unrelated_scene_set still fires with a newer rev', () => {
		const stored = { rev: 3, savedAt: '2026-07-24T10:00:00.000Z', scenes: scenes(['a', 'b', 'c']) }
		const res = validateIncomingProject({ rev: 4, savedAt: '2026-07-24T11:00:00.000Z', scenes: scenes(['x', 'y', 'z']) }, stored)
		assert.equal(res.ok, false)
		assert.equal(res.reason, 'unrelated_scene_set')
	})
})

describe('WO-329 wiring source guards', () => {
	const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')

	it('deck-sync persists must NOT bump the rev (would strand HTTP clients)', () => {
		assert.match(read('src/engine/project-scenes-persist.js'), /pushVolumes: false, bumpRev: false/)
	})

	it('save/autosave responses carry the new rev and the client adopts it', () => {
		const handlers = read('src/api/routes-data-project-handlers.js')
		assert.match(handlers, /rev: persisted\.rev/)
		assert.match(handlers, /rev: result\.rev/)
		assert.match(read('client/app.js'), /projectState\.setRev\(res\.rev\)/)
		assert.match(read('client/components/header-bar.js'), /projectState\.setRev\(res\.rev\)/)
	})

	it('client export echoes the adopted rev; import captures it', () => {
		const ps = read('client/lib/project-state.js')
		assert.match(ps, /this\.rev != null \? \{ rev: this\.rev \}/)
		assert.match(ps, /this\.setRev\(data\.rev\)/)
	})

	it('save broadcasts the STAMPED project so other clients learn the new rev', () => {
		assert.match(read('src/api/routes-data-project-handlers.js'), /scheduleProjectSyncBroadcast\(ctx, persisted\.project\)/)
	})
})
