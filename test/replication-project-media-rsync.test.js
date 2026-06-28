'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { buildProjectMediaRsyncPlan } = require('../src/replication/sync-project-media-rsync')

test('buildProjectMediaRsyncPlan includes project folder and resolved refs', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hacg-rsync-'))
	const mediaBase = path.join(tmp, 'media')
	const slug = 'evening_news'
	const projectDir = path.join(mediaBase, 'projects', slug)
	fs.mkdirSync(projectDir, { recursive: true })
	const clip = path.join(projectDir, 'open.mxf')
	fs.writeFileSync(clip, 'fake')

	const project = {
		name: 'Evening News',
		slug,
		scenes: {
			scenes: [
				{
					layers: [{ source: { type: 'media', value: 'open.mxf' } }],
				},
			],
		},
	}

	const ctx = {
		config: { local_media_path: mediaBase, projectScopedMedia: { enabled: true } },
		persistence: { get: () => slug },
	}

	const plan = buildProjectMediaRsyncPlan(ctx, project)
	assert.equal(plan.slug, slug)
	assert.ok(plan.relPaths.includes(`media/projects/${slug}/`))
	assert.ok(plan.relPaths.includes(`media/projects/${slug}/open.mxf`))
})
