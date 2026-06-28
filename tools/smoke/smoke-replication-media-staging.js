'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { rebuildProjectMediaStaging, installTemplatesFromStaging } = require('../../src/replication/sync-project-media')
const { resolveTemplateFile } = require('../../src/replication/template-resolve')
const { REPO_ROOT } = require('../../src/repo-paths')

test('resolveTemplateFile finds lower-thirds template', () => {
	const p = resolveTemplateFile('lt-minimal-fade')
	assert.ok(p && p.endsWith('lt-minimal-fade.html'))
	assert.ok(fs.existsSync(p))
})

test('rebuildProjectMediaStaging links referenced media and templates', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repl-media-'))
	const mediaBase = path.join(tmp, 'media')
	fs.mkdirSync(mediaBase, { recursive: true })
	const clip = path.join(mediaBase, 'clip1.mxf')
	fs.writeFileSync(clip, 'x')

	const project = {
		scenes: {
			s1: {
				layers: [
					{ source: { type: 'media', value: 'clip1.mxf' } },
					{ source: { type: 'template', value: 'lt-minimal-fade' } },
				],
			},
		},
	}

	const { staging, linkedMedia, linkedTemplates } = rebuildProjectMediaStaging(project, mediaBase)
	assert.equal(linkedMedia, 1)
	assert.equal(linkedTemplates, 1)
	assert.ok(fs.existsSync(path.join(staging, 'media', 'clip1.mxf')))
	assert.ok(fs.existsSync(path.join(staging, 'templates', 'lower-thirds', 'lt-minimal-fade.html')))

	fs.rmSync(tmp, { recursive: true, force: true })
})
