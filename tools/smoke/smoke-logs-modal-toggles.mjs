#!/usr/bin/env node
/**
 * DOM smoke: logs modal pane toggles (Puppeteer + harness HTML).
 * Requires: npm install (puppeteer devDependency).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'

const ROOT = path.join(fileURLToPath(new URL('.', import.meta.url)), '../..')
const HARNESS = path.join(ROOT, 'tools/smoke/fixtures/logs-modal-test.html')

function mimeFor(filePath) {
	if (filePath.endsWith('.js')) return 'application/javascript'
	if (filePath.endsWith('.css')) return 'text/css'
	if (filePath.endsWith('.html')) return 'text/html'
	if (filePath.endsWith('.svg')) return 'image/svg+xml'
	return 'application/octet-stream'
}

/**
 * @returns {Promise<{ server: import('http').Server, url: string }>}
 */
function startStaticServer() {
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			try {
				const raw = decodeURIComponent(String(req.url || '/').split('?')[0])
				const rel = raw === '/test' || raw === '/' ? 'tools/smoke/fixtures/logs-modal-test.html' : raw.replace(/^\//, '')
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

/**
 * @param {import('puppeteer').Page} page
 * @param {string} id
 */
async function paneDisplay(page, id) {
	return page.evaluate((paneId) => {
		const el = document.getElementById(paneId)
		if (!el) return { missing: true }
		return {
			hidden: el.hidden,
			display: getComputedStyle(el).display,
		}
	}, id)
}

async function main() {
	assert.ok(fs.existsSync(HARNESS), 'harness HTML missing')

	const { server, url } = await startStaticServer()
	const browser = await puppeteer.launch({
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox'],
	})

	try {
		const page = await browser.newPage()
		await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
		await page.waitForFunction(() => window.__logsModalReady === true, { timeout: 10_000 })
		await page.waitForSelector('#logs-modal', { timeout: 5000 })

		let caspar = await paneDisplay(page, 'logs-pane-caspar')
		let high = await paneDisplay(page, 'logs-pane-highascg')
		assert.equal(caspar.hidden, false)
		assert.equal(high.hidden, false)
		assert.notEqual(caspar.display, 'none')
		assert.notEqual(high.display, 'none')

		await page.click('#logs-toggle-caspar')
		caspar = await paneDisplay(page, 'logs-pane-caspar')
		assert.equal(caspar.hidden, true)
		assert.equal(caspar.display, 'none')

		await page.click('#logs-toggle-highascg')
		high = await paneDisplay(page, 'logs-pane-highascg')
		assert.equal(high.hidden, true)
		assert.equal(high.display, 'none')

		const emptyVisible = await page.evaluate(() => {
			const el = document.getElementById('logs-panes-empty')
			return el && !el.hidden && getComputedStyle(el).display !== 'none'
		})
		assert.ok(emptyVisible, 'empty state when both panes off')

		await page.click('#logs-toggle-highascg')
		high = await paneDisplay(page, 'logs-pane-highascg')
		assert.equal(high.hidden, false)
		assert.notEqual(high.display, 'none')

		const filtersHidden = await page.evaluate(() => {
			const el = document.getElementById('logs-filters')
			return el ? el.hidden : null
		})
		assert.equal(filtersHidden, false, 'filters visible when HighAsCG on')

		console.log('smoke-logs-modal-toggles: OK')
	} finally {
		await browser.close()
		server.close()
	}
}

main().catch((err) => {
	console.error('smoke-logs-modal-toggles: FAIL', err)
	process.exit(1)
})
