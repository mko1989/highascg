#!/usr/bin/env node
/**
 * DOM smoke: settings modal nuclear tab password input (headless Chrome via
 * raw CDP + harness HTML). WO-248 — migrated off puppeteer onto
 * `src/media/headless-chrome-cdp.js` (cached Chrome-for-Testing binary or
 * HIGHASCG_CHROME_BIN / chromium on PATH).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { launchHeadlessChrome, openPage } = require('../../src/media/headless-chrome-cdp.js')

const ROOT = path.join(fileURLToPath(new URL('.', import.meta.url)), '../..')
const HARNESS = path.join(ROOT, 'tools/smoke/fixtures/settings-nuclear-test.html')

function mimeFor(filePath) {
	if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) return 'application/javascript'
	if (filePath.endsWith('.css')) return 'text/css'
	if (filePath.endsWith('.html')) return 'text/html'
	if (filePath.endsWith('.json')) return 'application/json'
	if (filePath.endsWith('.svg')) return 'image/svg+xml'
	return 'application/octet-stream'
}

function startStaticServer() {
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			try {
				const raw = decodeURIComponent(String(req.url || '/').split('?')[0])
				const rel = raw === '/test' || raw === '/' ? 'tools/smoke/fixtures/settings-nuclear-test.html' : raw.replace(/^\//, '')
				const filePath = path.normalize(path.join(ROOT, rel))
				if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
					res.writeHead(404)
					res.end('Not found')
					return
				}
				res.writeHead(200, { 'Content-Type': mimeFor(filePath) })
				fs.createReadStream(filePath).pipe(res)
			} catch (e) {
				res.writeHead(500)
				res.end(String(e?.message || e))
			}
		})
		server.on('error', reject)
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address()
			const port = typeof addr === 'object' && addr ? addr.port : 0
			resolve({ server, url: `http://127.0.0.1:${port}/test` })
		})
	})
}

async function fieldState(page, id) {
	return page.evaluate((fieldId) => {
		const el = document.getElementById(fieldId)
		if (!el) return { missing: true }
		const group = el.closest('.settings-group')
		return {
			value: el.value,
			type: el.type,
			groupDisplay: group ? getComputedStyle(group).display : null,
		}
	}, id)
}

async function main() {
	assert.ok(fs.existsSync(HARNESS), 'harness HTML missing')

	const { server, url } = await startStaticServer()
	const chrome = await launchHeadlessChrome()

	try {
		const page = await openPage(chrome.httpPort)
		await page.navigate(url, { timeoutMs: 30_000 })
		await page.waitForFunction(() => window.__settingsNuclearReady === true, { timeoutMs: 15_000 })

		let nuclear = await fieldState(page, 'set-nuclear-password')
		assert.notEqual(nuclear.missing, true)
		assert.equal(nuclear.type, 'password')
		assert.equal(nuclear.groupDisplay, 'none', 'nuclear password hidden when protection off')
		assert.equal(await page.evaluate(() => !!document.getElementById('set-nuclear-action-password')), false, 'no separate action password field')

		await page.click('#set-nuclear-require-pass')
		nuclear = await fieldState(page, 'set-nuclear-password')
		assert.notEqual(nuclear.groupDisplay, 'none', 'nuclear password visible when protection on')

		await page.type('#set-nuclear-password', 'nuclear-secret')
		const values = await page.evaluate(() => ({
			password: document.getElementById('set-nuclear-password')?.value || '',
			viaHelper: typeof window.__getNuclearPassword === 'function' ? window.__getNuclearPassword() : '',
			required: !!document.getElementById('set-nuclear-require-pass')?.checked,
		}))
		assert.equal(values.required, true)
		assert.equal(values.password, 'nuclear-secret')
		assert.equal(values.viaHelper, 'nuclear-secret', 'shared helper reads same field')

		await page.click('#set-nuclear-require-pass')
		nuclear = await fieldState(page, 'set-nuclear-password-fields')
		assert.equal(nuclear.groupDisplay, 'none', 'nuclear password hidden again when protection off')

		console.log('smoke-settings-nuclear-password-dom: OK')
		await page.close().catch(() => {})
	} finally {
		chrome.kill()
		server.close()
	}
}

main().catch((err) => {
	console.error('smoke-settings-nuclear-password-dom: FAIL', err)
	process.exit(1)
})
