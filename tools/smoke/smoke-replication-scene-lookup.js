'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { findSceneInProject } = require('../../src/replication/project-scene-lookup')

test('findSceneInProject resolves scene from scenes envelope array', () => {
	const project = {
		scenes: {
			scenes: [
				{ id: 'look-a', name: 'A' },
				{ id: 'look-b', name: 'B' },
			],
		},
	}
	assert.equal(findSceneInProject(project, 'look-b')?.name, 'B')
	assert.equal(findSceneInProject(project, 'missing'), null)
})

test('findSceneInProject supports legacy map keyed by id', () => {
	const project = { scenes: { 'look-x': { id: 'look-x', name: 'X' } } }
	assert.equal(findSceneInProject(project, 'look-x')?.name, 'X')
})
