'use strict'

/**
 * WO-311 — autosave must not recreate a project the factory reset trashed.
 *
 * Reconstructed from disk timestamps 2026-07-21: a factory reset at 11:47:28 correctly trashed
 * projects/tra.json (intact copy in projects/_trash/tra-1784634439668/). At 11:47:31 a background
 * autosave from the still-open browser recreated projects/tra.json as an empty shell. 5d01bca
 * stopped the autosave destroying the hardwareConfig slice; the resurrection itself remained,
 * because any autosave whose slug had no stored file silently created one.
 *
 * The distinction that makes this safe: "no stored file" alone cannot tell a DELETED project from
 * a BRAND-NEW one that has never been saved. The trash directory is the record of deliberate
 * deletion, so that — not the mere absence of a file — is what blocks the write.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const projectStore = require('../../src/engine/project-store')

/** The real trash layout: projects/_trash/<slug>-<epoch-ms>/<slug>.json */
function makeTrash(projectsDir, slug, stamp = 1784634439668) {
	const dir = path.join(projectsDir, '_trash', `${slug}-${stamp}`)
	fs.mkdirSync(dir, { recursive: true })
	fs.writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify({ name: slug }), 'utf8')
	return dir
}

function withTempProjectsDir(fn) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo311-'))
	const realDir = projectStore.projectsDir()
	try {
		return fn(tmp, realDir)
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
}

test('a slug with a trash entry is reported retired — the resurrection signal', () => {
	withTempProjectsDir(() => {
		const real = projectStore.projectsDir()
		const slug = `wo311_probe_${Date.now()}`
		assert.equal(projectStore.wasProjectSlugRetired(slug), false, 'unknown slug is not retired')

		const dir = makeTrash(real, slug)
		try {
			assert.equal(projectStore.wasProjectSlugRetired(slug), true, 'a trashed slug must be recognised')
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})
})

test('a brand-new project that was simply never saved is NOT treated as retired', () => {
	// This is the case that must keep working — the reason "no stored file" alone is not enough.
	assert.equal(projectStore.wasProjectSlugRetired(`never_existed_${Date.now()}`), false)
})

test('a different project whose name merely starts with the same text is not confused for it', () => {
	const real = projectStore.projectsDir()
	const slug = `wo311_pre_${Date.now()}`
	const dir = makeTrash(real, `${slug}_extra`)
	try {
		assert.equal(
			projectStore.wasProjectSlugRetired(slug),
			false,
			'"tra" must not match the trash entry of "tra_backup"',
		)
		assert.equal(projectStore.wasProjectSlugRetired(`${slug}_extra`), true)
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('the trash entry must carry a timestamp suffix — a bare directory is not a retirement record', () => {
	const real = projectStore.projectsDir()
	const slug = `wo311_bare_${Date.now()}`
	const dir = path.join(real, '_trash', slug)
	fs.mkdirSync(dir, { recursive: true })
	try {
		assert.equal(projectStore.wasProjectSlugRetired(slug), false, 'only <slug>-<epoch> counts')
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('regex metacharacters in a slug cannot widen the match', () => {
	// projectSlugFromName strips these today, but the helper must not depend on that.
	assert.equal(projectStore.wasProjectSlugRetired('a.c'), false)
	assert.equal(projectStore.wasProjectSlugRetired('.*'), false)
})

test('empty / nonsense slugs are refused rather than matching anything', () => {
	for (const bad of ['', '   ', null, undefined]) {
		assert.equal(projectStore.wasProjectSlugRetired(bad), false)
	}
})

test('server: the autosave route refuses a retired slug with 410 project_gone', () => {
	const src = fs.readFileSync(
		path.join(__dirname, '../../src/api/routes-data-project-handlers.js'),
		'utf8',
	)
	assert.match(
		src,
		/!existing && projectStore\.wasProjectSlugRetired\(slug\)/,
		'the guard must require BOTH no stored file AND a retirement record',
	)
	assert.match(src, /status: 410/, 'a distinct status the client can act on')
	assert.match(src, /reason: 'project_gone'/)

	// It must sit BEFORE the write — scoped to the autosave handler, since persistProject is
	// also called by other routes earlier in this file.
	const start = src.indexOf("if (path === '/api/project/autosave')")
	assert.ok(start > 0, 'autosave handler not found')
	const rest = src.slice(start)
	const end = rest.indexOf("if (path === '/api/project/", 1)
	const block = end > 0 ? rest.slice(0, end) : rest

	const guardAt = block.indexOf('wasProjectSlugRetired')
	const writeAt = block.indexOf('persistProject(ctx, project')
	assert.ok(guardAt > 0, 'the guard must live inside the autosave handler')
	assert.ok(writeAt > 0, 'the autosave handler must still write')
	assert.ok(guardAt < writeAt, 'the refusal must short-circuit before persistProject writes the file')
})

test('client: a 410 latches autosave OFF instead of retrying the resurrection', () => {
	const sync = fs.readFileSync(path.join(__dirname, '../../client/lib/server-project-sync.js'), 'utf8')
	assert.match(sync, /projectGone/, 'a latch must exist')
	assert.match(
		sync,
		/return synced && !offlineMode && !projectGone/,
		'the latch must actually gate outbound pushes',
	)

	const app = fs.readFileSync(path.join(__dirname, '../../client/app.js'), 'utf8')
	assert.match(app, /markProjectGoneOnServer\(\)/, 'the 410 handler must set the latch')
	assert.match(app, /status === 410 \|\| e\?\.reason === 'project_gone'/, 'must detect the 410')
	// api-client attaches `status`/`reason` but never `body` — depending on e.body would silently
	// never fire, which is how this guard would rot without being noticed.
	assert.doesNotMatch(app, /e\?\.body\?\.slug/, 'e.body is never populated by api-client')
})

test('client: the operator is told, with the action that recovers their work', () => {
	const header = fs.readFileSync(path.join(__dirname, '../../client/components/header-bar.js'), 'utf8')
	assert.match(header, /project-gone-on-server/, 'the terminal state needs its own message')
	assert.match(header, /Save As/, 'the message must name the action that keeps their copy')
})
