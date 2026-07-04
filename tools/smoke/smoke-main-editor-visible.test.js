'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
	ensureMainEditorVisibleForScreenCount,
	isLegacyMainEditorVisible,
	LEGACY_MAIN_EDITOR_VISIBLE,
} = require('../../client/lib/scene-state-persistence-logic')

test('legacy mainEditorVisible expands when screen count > 1', () => {
	const state = { mainEditorVisible: [...LEGACY_MAIN_EDITOR_VISIBLE] }
	const changed = ensureMainEditorVisibleForScreenCount(state, 2)
	assert.equal(changed, true)
	assert.deepEqual(state.mainEditorVisible, [true, true, false, false])
	assert.equal(state.mainEditorVisibilityMigrated, true)
})

test('user-hidden column is not reopened after migration', () => {
	const state = {
		mainEditorVisible: [true, false, false, false],
		mainEditorVisibilityMigrated: true,
		mainEditorVisibleScreenCount: 2,
	}
	const changed = ensureMainEditorVisibleForScreenCount(state, 2)
	assert.equal(changed, false)
	assert.deepEqual(state.mainEditorVisible, [true, false, false, false])
})

test('new main bus reveals column when screen count grows', () => {
	const state = {
		mainEditorVisible: [true, true, false, false],
		mainEditorVisibilityMigrated: true,
		mainEditorVisibleScreenCount: 2,
	}
	const changed = ensureMainEditorVisibleForScreenCount(state, 3)
	assert.equal(changed, true)
	assert.equal(state.mainEditorVisible[2], true)
})

test('isLegacyMainEditorVisible detects old default', () => {
	assert.equal(isLegacyMainEditorVisible([true, false, false, false]), true)
	assert.equal(isLegacyMainEditorVisible([true, true, false, false]), false)
})
