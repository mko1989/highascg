'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const routes = require('../../src/api/routes-caspar-config')

describe('GET /api/caspar-config/current', () => {
	it('returns the file on disk with path and mtime', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caspar-cfg-view-'))
		const file = path.join(dir, 'casparcg.config')
		fs.writeFileSync(file, '<configuration><channels/></configuration>')
		const ctx = { config: { casparServer: { configPath: file } } }
		const r = routes.handleGet('/api/caspar-config/current', {}, ctx)
		const b = JSON.parse(r.body)
		assert.equal(r.status, 200)
		assert.equal(b.exists, true)
		assert.equal(b.path, file)
		assert.equal(b.xml, '<configuration><channels/></configuration>')
		assert.ok(b.mtimeMs > 0)
		fs.rmSync(dir, { recursive: true, force: true })
	})
	it('reports a missing file instead of failing', () => {
		const ctx = { config: { casparServer: { configPath: '/nonexistent-dir/casparcg.config' } } }
		const b = JSON.parse(routes.handleGet('/api/caspar-config/current', {}, ctx).body)
		assert.equal(b.exists, false)
		assert.equal(b.xml, '')
	})
	it('is registered in the router', () => {
		assert.match(fs.readFileSync(path.join(__dirname, '../../src/api/router.js'), 'utf8'), /\/api\/caspar-config\/current/)
	})
})
