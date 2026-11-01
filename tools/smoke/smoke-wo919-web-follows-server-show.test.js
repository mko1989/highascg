'use strict'

/**
 * WO-919 — the web client follows the server's active show (Godot does since WO-918 F27): autosaves say which show
 * they edit (`editingSlug`), a 409 `not_active` or a `project.activated` for another slug pulls the active show, and
 * the tab's own Load is not mistaken for a switch.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function stubProjectState(slug) {
	return {
		slug,
		imported: null,
		getProjectSlug() {
			return this.slug
		},
		setProjectSlug(s) {
			this.slug = s
		},
		importProject(p) {
			this.imported = p
			if (p.slug) this.slug = p.slug
		},
	}
}

test('autosaveBody / activatedElsewhere', async () => {
	globalThis.window ??= { dispatchEvent() {}, location: { origin: 'http://127.0.0.1:4200' } }
	const m = await import('../../client/lib/project-follow-server.js')
	const ps = stubProjectState('show_a')
	assert.deepEqual(m.autosaveBody({ name: 'A' }, ps), { project: { name: 'A' }, editingSlug: 'show_a' })
	assert.deepEqual(m.autosaveBody({ name: 'A' }, stubProjectState('')), { project: { name: 'A' } }, 'no slug yet: legacy body')
	assert.equal(m.activatedElsewhere({ slug: 'show_b' }, ps), true)
	assert.equal(m.activatedElsewhere({ slug: 'show_a' }, ps), false, 'its own Load')
	assert.equal(m.activatedElsewhere({ slug: 'show_b' }, stubProjectState('')), false, 'a tab that never knew its show')
})

test('followServerProject imports the active show silently and names it', async () => {
	globalThis.CustomEvent ??= class CustomEvent {
		constructor(type, init) {
			this.type = type
			this.detail = init?.detail
		}
	}
	const events = []
	globalThis.window = { dispatchEvent: (e) => events.push(e.type), location: { origin: 'http://127.0.0.1:4200' } }
	const toasts = []
	globalThis.document = {
		getElementById: () => ({ appendChild: (el) => toasts.push(el.textContent), style: {} }),
		createElement: () => ({ style: {}, remove() {}, addEventListener() {}, setAttribute() {} }),
		body: { appendChild() {} },
	}
	const { api } = await import('../../client/lib/api-client.js')
	const real = api.get
	api.get = async (p) => (p === '/api/project' ? { version: 2, name: 'Show B', slug: 'show_b', rev: 7 } : null)
	try {
		const m = await import('../../client/lib/project-follow-server.js')
		const ps = stubProjectState('show_a')
		assert.equal(await m.followServerProject({ projectState: ps }), true)
		assert.equal(ps.slug, 'show_b')
		assert.equal(ps.imported.name, 'Show B')
		assert.ok(events.includes('project-loaded'))
		assert.match(toasts.join('|'), /switched to "Show B"/)
	} finally {
		api.get = real
	}
})

test('wiring: autosave carries editingSlug and follows not_active; ws follows project.activated; own Load sets the slug first', () => {
	const app = read('client/app.js')
	assert.match(app, /api\.post\('\/api\/project\/autosave', autosaveBody\(project, projectState\)\)/)
	assert.match(app, /e\?\.reason === 'not_active'\) \{\n[^\n]*\n\t+void followServerProject\(/)
	const ws = read('client/lib/app-ws-handlers.js')
	assert.match(ws, /data\.path === 'project\.activated' && activatedElsewhere\(data\.value, projectState\)/)
	const modal = read('client/components/load-project-modal.js')
	assert.ok(modal.indexOf('projectState.setProjectSlug(entry.id)') < modal.indexOf("{ slug: entry.id, applyHardware: false }"))
})
