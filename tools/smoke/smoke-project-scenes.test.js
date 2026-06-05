'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	isLikelyStaleProjectReplace,
	validateIncomingProject,
	sceneIdSet,
	pickNewerFullProject,
} = require('../../src/engine/project-scenes')

function projectWithIds(ids, savedAt = '2026-05-30T10:00:00.000Z') {
	return {
		version: 2,
		savedAt,
		scenes: {
			scenes: ids.map((id) => ({ id, name: id, layers: [] })),
		},
	}
}

describe('project-scenes stale replace detection', () => {
	it('sceneIdSet collects look ids', () => {
		assert.deepEqual([...sceneIdSet(projectWithIds(['a', 'b']))].sort(), ['a', 'b'])
	})

	it('flags zero-overlap show swap', () => {
		const existing = projectWithIds(['0', '1', '2', '3'])
		const incoming = projectWithIds(['Loop', 'GLOWNA', 'INTRO'])
		assert.equal(isLikelyStaleProjectReplace(incoming, existing), true)
	})

	it('allows autosave when most looks overlap', () => {
		const existing = projectWithIds(['0', '1', '2', '3'])
		const incoming = projectWithIds(['0', '1', '2', '3', '4'], '2026-05-30T10:01:00.000Z')
		const check = validateIncomingProject(incoming, existing)
		assert.equal(check.ok, true)
	})

	it('rejects autosave that would wipe all looks', () => {
		const existing = projectWithIds(['0', '1', '2'], '2026-05-30T10:00:00.000Z')
		const incoming = projectWithIds([], '2026-05-30T10:01:00.000Z')
		const check = validateIncomingProject(incoming, existing)
		assert.equal(check.ok, false)
		assert.equal(check.reason, 'empty_over_nonempty')
	})

	it('rejects autosave with unrelated looks even when savedAt is newer', () => {
		const existing = projectWithIds(['0', '1', '2', '3'], '2026-05-30T10:00:00.000Z')
		const incoming = projectWithIds(['Loop', 'GLOWNA'], '2026-05-30T10:01:00.000Z')
		const check = validateIncomingProject(incoming, existing)
		assert.equal(check.ok, false)
		assert.equal(check.reason, 'unrelated_scene_set')
	})

	it('allows manual save replace when force flag set', () => {
		const existing = projectWithIds(['0', '1', '2', '3'])
		const incoming = projectWithIds(['Loop', 'GLOWNA'], '2026-05-30T10:01:00.000Z')
		const check = validateIncomingProject(incoming, existing, { allowReplace: true })
		assert.equal(check.ok, true)
	})
})

describe('pickNewerFullProject', () => {
	it('prefers persisted project when autosave is newer but empty', () => {
		const persist = projectWithIds(['a', 'b'], '2026-05-30T09:00:00.000Z')
		const emptyAutosave = projectWithIds([], '2026-05-30T12:00:00.000Z')
		assert.equal(pickNewerFullProject(persist, emptyAutosave), persist)
	})
})
