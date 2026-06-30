'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { projectSlugFromName } = require('../../src/engine/project-store')

describe('project-store slug', () => {
	it('normalizes names to stable slugs', () => {
		assert.equal(projectSlugFromName('My Show 2026'), 'my_show_2026')
		assert.equal(projectSlugFromName(''), 'untitled')
		assert.equal(projectSlugFromName('   '), 'untitled')
	})

	it('maps different titles to different slugs', () => {
		assert.notEqual(projectSlugFromName('Show A'), projectSlugFromName('Show B'))
	})

	it('legacy autosave is ignored when slug does not match', () => {
		const { readLegacyAutosaveIfMatches, readAutosaveFile } = require('../../src/engine/project-store')
		assert.equal(readLegacyAutosaveIfMatches('nonexistent_slug_xyz'), null)
		assert.equal(readAutosaveFile('nonexistent_slug_xyz'), null)
	})
})
