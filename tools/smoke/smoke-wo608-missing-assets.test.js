'use strict'

/**
 * WO-608 — GET /api/project/missing-assets (web project-media-reconcile.js on the node): project refs against the
 * server catalogs, ignoring case and extension (Caspar CLS / TLS ids), suffix / basename matches, templates.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const A = require('../../src/api/routes-project-assets')

const scene = (...sources) => ({ layers: sources.map((source) => ({ source })) })
const media = [
	{ id: 'projects', isDir: true },
	{ id: 'projects/airport/1. Główne Tło.mov' },
	{ id: 'projects/npcc/BAZA 2.mp4' },
	'loose.png',
]
const templates = [{ id: 'LOWER-THIRDS/LT-CLASSIC-BOX' }, { id: 'BLACK' }]

test('Caspar-style upper-case extension-less refs match the catalog file', async () => {
	const r = await A.report({ scenes: [scene({ type: 'media', value: 'PROJECTS/AIRPORT/1. GŁÓWNE TŁO' })] }, media, templates)
	assert.equal(r.isClean, true)
	assert.deepEqual(r.usedMedia, ['PROJECTS/AIRPORT/1. GŁÓWNE TŁO'])
})

test('missing clips and templates are reported; streams, placeholders and live inputs are not refs', async () => {
	const project = {
		scenes: [
			scene(
				{ type: 'media', value: 'projects/npcc/BAZA 2.mp4' },
				{ type: 'media', value: 'gone/clip.mov' },
				{ type: 'template', value: 'lower-thirds/lt-classic-box.html' },
				{ type: 'template', value: 'NOPE' },
				{ type: 'media', value: 'https://example.com/a.mp4' },
				{ type: 'placeholder', value: 'X' },
				{ type: 'live', value: 'decklink 1' },
			),
		],
		timelines: [{ layers: [{ clips: [{ source: { type: 'media', value: 'BAZA 2' } }] }] }],
	}
	const r = await A.report(project, media, templates)
	assert.equal(r.isClean, false)
	assert.deepEqual(r.missingMedia, ['gone/clip.mov'])
	assert.deepEqual(r.missingTemplates, ['NOPE'])
	assert.equal(r.usedMedia.length, 3)
})

test('folders never satisfy a clip ref; an empty project is clean', async () => {
	assert.equal(A.mediaExists('projects', new Set()), false)
	const r = await A.report({ scenes: [scene({ type: 'media', value: 'projects' })] }, media, templates)
	assert.deepEqual(r.missingMedia, ['projects'])
	assert.equal((await A.report(null, media, templates)).isClean, true)
})
