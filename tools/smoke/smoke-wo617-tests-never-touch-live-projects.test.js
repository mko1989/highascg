'use strict'

/**
 * WO-617 (2026-10-17): every offline-suite run rewrote the LIVE projects/untitled.json (and pushed it
 * to the bridge volume) — smoke-new-project ran the real New-project persist path against
 * <repo>/projects. Under the test runner the projects root is now a private temp dir and volume
 * sync is off; this guards that, end to end, through the real persistProject.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const { projectsRoot, volumeSyncAllowed, LIVE_PROJECTS_DIR } = require('../../src/engine/projects-root')
const projectStore = require('../../src/engine/project-store')

test('under node --test the projects root is a temp dir, not <repo>/projects', () => {
	assert.ok(process.env.NODE_TEST_CONTEXT, 'runner sets NODE_TEST_CONTEXT')
	assert.notEqual(projectsRoot(), LIVE_PROJECTS_DIR)
	assert.equal(projectStore.projectsDir(), projectsRoot(), 'project-store uses it')
	assert.equal(volumeSyncAllowed(), false, 'bridge/USB pushes are off')
})

test('persistProject from a test leaves the live untitled.json untouched', () => {
	const live = path.join(LIVE_PROJECTS_DIR, 'untitled.json')
	const before = fs.existsSync(live) ? fs.statSync(live).mtimeMs : null
	const { persistProject } = require('../../src/engine/project-scenes')
	const store = {}
	const persistence = { get: (k) => store[k] ?? null, set: (k, v) => { store[k] = v } }
	persistProject({ persistence, config: {}, log: () => {} }, { version: 2, name: 'Untitled', scenes: { scenes: [] } }, { writeAutosave: true })
	assert.ok(fs.existsSync(path.join(projectsRoot(), 'untitled.json')), 'written to the temp root')
	const after = fs.existsSync(live) ? fs.statSync(live).mtimeMs : null
	assert.equal(after, before, 'live projects/untitled.json not modified')
})
