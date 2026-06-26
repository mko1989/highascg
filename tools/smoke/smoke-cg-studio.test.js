'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const http = require('http')
const { configure } = require('../../src/cg-studio/cg-studio-context')
const { scanAllTemplates } = require('../../src/cg-studio/template-scan')
const { exportTemplate, bakeDefaults, validateExportedHtml } = require('../../src/cg-studio/export-template')
const { getDefaultPayload } = require('../../src/cg-studio/lt-param-registry')
const { startStudioServer } = require('../../src/cg-studio/studio-server')
const { REPO_ROOT } = require('../../src/repo-paths')

const TEST_EXPORT = path.join(REPO_ROOT, 'template', 'studio', 'lt-smoke-test-export.html')

configure({
	packageDir: path.join(REPO_ROOT, 'src/cg-studio'),
	templateRoot: path.join(REPO_ROOT, 'template'),
})

describe('cg-studio', () => {
	it('scanAllTemplates finds built-in lt-classic-box', () => {
		const all = scanAllTemplates()
		const classic = all.find((t) => t.id === 'lt-classic-box' && t.category === 'lower-thirds')
		assert.ok(classic)
		assert.equal(classic.available, true)
		assert.match(classic.previewUrl, /lt-classic-box\.html/)
	})

	it('bakeDefaults applies title and primary color', () => {
		const src = fs.readFileSync(
			path.join(REPO_ROOT, 'template', 'lower-thirds', 'lt-classic-box.html'),
			'utf8',
		)
		const out = bakeDefaults(src, {
			data: { title: 'Smoke Title', subtitle: 'Smoke Sub' },
			style: { primaryColor: '#ff0000', textColor: '#00ff00' },
		})
		assert.match(out, /Smoke Title/)
		assert.match(out, /Smoke Sub/)
		assert.match(out, /--primary:\s*#ff0000/)
	})

	it('exportTemplate writes valid lt-engine HTML to template/studio/', () => {
		try {
			if (fs.existsSync(TEST_EXPORT)) fs.unlinkSync(TEST_EXPORT)
		} catch {}
		const result = exportTemplate({
			baseTemplateId: 'lt-classic-box',
			baseCategory: 'lower-thirds',
			exportId: 'lt-smoke-test-export',
			exportName: 'Smoke Test Export',
			data: { title: 'Exported', subtitle: 'From Studio' },
			style: { primaryColor: '#123456', textColor: '#ffffff', position: 'left' },
		})
		assert.equal(result.ok, true)
		assert.equal(result.casparPath, 'studio/lt-smoke-test-export')
		assert.ok(fs.existsSync(TEST_EXPORT))
		const html = fs.readFileSync(TEST_EXPORT, 'utf8')
		validateExportedHtml(html)
		assert.match(html, /Exported/)
		assert.match(html, /\.\.\/lower-thirds\/lt-engine\.js/)
		fs.unlinkSync(TEST_EXPORT)
	})

	it('getDefaultPayload includes common style keys', () => {
		const p = getDefaultPayload('lt-classic-box')
		assert.equal(p.data.title, 'Name')
		assert.equal(p.style.position, 'left')
	})

	it('studio server serves /api/health on ephemeral port', async () => {
		const server = await startStudioServer({ port: 0, bindAddress: '127.0.0.1' })
		const addr = server.server.address()
		const port = typeof addr === 'object' && addr ? addr.port : server.port
		const body = await new Promise((resolve, reject) => {
			http
				.get(`http://127.0.0.1:${port}/api/health`, (res) => {
					let data = ''
					res.on('data', (c) => {
						data += c
					})
					res.on('end', () => resolve(JSON.parse(data)))
				})
				.on('error', reject)
		})
		assert.equal(body.ok, true)
		assert.equal(body.module, 'cg-studio')
		assert.equal(body.host, 'launcher')
		await server.close()
	})
})
