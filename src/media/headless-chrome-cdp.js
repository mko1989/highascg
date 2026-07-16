'use strict'

/**
 * WO-248 — headless Chrome-for-Testing launch + CDP page helpers, replacing
 * puppeteer for the thumbnail renderers and DOM smokes. Reuses the WO-247
 * generic raw-CDP session client (`connectCdp` in `../system/cef-cdp-client`)
 * for the page-level WebSocket; this module only adds what puppeteer used to
 * hide: spawning the Chrome process, resolving its DevTools port, creating a
 * page target (via the `/json/new` HTTP endpoint rather than
 * Target.createTarget/attachToTarget — simpler, no session-multiplexing
 * needed since each page gets its own top-level CDP WebSocket), navigation +
 * a load wait, and the Emulation/Page.captureScreenshot sequence for
 * transparent/clipped screenshots.
 */

const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { connectCdp } = require('../system/cef-cdp-client')

const DEFAULT_LAUNCH_TIMEOUT_MS = 15000
const DEFAULT_NAV_TIMEOUT_MS = 30000

/**
 * @param {string} dirName e.g. "linux-149.0.7827.22"
 * @returns {number[]}
 */
function versionParts(dirName) {
	const m = String(dirName || '').match(/^linux-(\d+(?:\.\d+)*)/)
	if (!m) return [-1]
	return m[1].split('.').map((n) => parseInt(n, 10) || 0)
}

/**
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function compareVersionParts(a, b) {
	const len = Math.max(a.length, b.length)
	for (let i = 0; i < len; i++) {
		const d = (a[i] || 0) - (b[i] || 0)
		if (d !== 0) return d
	}
	return 0
}

/**
 * @param {string} name
 * @param {string[]} pathDirs
 * @returns {string|null}
 */
function findOnPath(name, pathDirs) {
	for (const dir of pathDirs) {
		if (!dir) continue
		const candidate = path.join(dir, name)
		try {
			fs.accessSync(candidate, fs.constants.X_OK)
			if (fs.statSync(candidate).isFile()) return candidate
		} catch (_) {
			/* not here */
		}
	}
	return null
}

/**
 * Resolve a Chrome/Chromium binary to launch headless, in priority order:
 * `HIGHASCG_CHROME_BIN` env → newest `~/.cache/puppeteer/chrome/linux-*`
 * Chrome-for-Testing build → `chromium`/`chromium-browser`/`google-chrome`
 * on PATH. Throws a listing error if none are found.
 * `cacheRoot`/`pathDirs`/`env` are injectable for offline smoke testing with
 * fixture dirs — real callers should omit them and get the real env/paths.
 * @param {{ env?: NodeJS.ProcessEnv, cacheRoot?: string, pathDirs?: string[] }} [opts]
 * @returns {string}
 */
function resolveChromeBinary(opts = {}) {
	const env = opts.env || process.env
	const cacheRoot = opts.cacheRoot || path.join(os.homedir(), '.cache', 'puppeteer', 'chrome')
	const pathDirs = opts.pathDirs || (env.PATH || '').split(path.delimiter)

	const envBin = env.HIGHASCG_CHROME_BIN
	if (envBin) {
		if (!fs.existsSync(envBin)) {
			throw new Error(`HIGHASCG_CHROME_BIN is set to "${envBin}" but that path does not exist`)
		}
		return envBin
	}

	if (fs.existsSync(cacheRoot)) {
		const dirs = fs
			.readdirSync(cacheRoot, { withFileTypes: true })
			.filter((ent) => ent.isDirectory() && /^linux-\d/.test(ent.name))
			.map((ent) => ent.name)
			.sort((a, b) => compareVersionParts(versionParts(b), versionParts(a)))
		for (const dir of dirs) {
			const bin = path.join(cacheRoot, dir, 'chrome-linux64', 'chrome')
			if (fs.existsSync(bin)) return bin
		}
	}

	for (const name of ['chromium', 'chromium-browser', 'google-chrome']) {
		const found = findOnPath(name, pathDirs)
		if (found) return found
	}

	throw new Error(
		'No Chrome binary found. Set HIGHASCG_CHROME_BIN, install a Chrome-for-Testing build under ' +
			'~/.cache/puppeteer/chrome/linux-<version>/chrome-linux64/chrome, or install chromium, ' +
			'chromium-browser, or google-chrome on PATH.',
	)
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Spawn headless Chrome with an ephemeral remote-debugging port and a scratch
 * user-data-dir. Resolves once "DevTools listening on ws://..." appears on
 * stderr; rejects (and kills the process) on timeout or early exit.
 * @param {{ binary?: string, launchTimeoutMs?: number }} [opts]
 * @returns {Promise<{ browserWs: string, httpPort: number, kill: () => void }>}
 */
function launchHeadlessChrome(opts = {}) {
	const binary = opts.binary || resolveChromeBinary()
	const timeoutMs = opts.launchTimeoutMs || DEFAULT_LAUNCH_TIMEOUT_MS
	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'highascg-headless-chrome-'))

	const args = [
		'--headless=new',
		'--remote-debugging-port=0',
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-gpu',
		'--hide-scrollbars',
		'--no-sandbox',
		'--disable-setuid-sandbox',
		`--user-data-dir=${userDataDir}`,
		'about:blank',
	]

	return new Promise((resolve, reject) => {
		const proc = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] })
		let stderrBuf = ''
		let settled = false

		function cleanupDir() {
			try {
				fs.rmSync(userDataDir, { recursive: true, force: true })
			} catch (_) {}
		}

		function kill() {
			try {
				proc.kill('SIGKILL')
			} catch (_) {}
			cleanupDir()
		}

		const timer = setTimeout(() => {
			if (settled) return
			settled = true
			kill()
			reject(new Error(`headless Chrome did not report a DevTools port within ${timeoutMs}ms`))
		}, timeoutMs)

		proc.on('error', (err) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			cleanupDir()
			reject(err instanceof Error ? err : new Error(String(err)))
		})

		proc.on('exit', (code) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			cleanupDir()
			reject(new Error(`headless Chrome exited (code ${code}) before reporting a DevTools port: ${stderrBuf.slice(-500)}`))
		})

		proc.stderr.on('data', (chunk) => {
			stderrBuf += String(chunk)
			const m = stderrBuf.match(/DevTools listening on (ws:\/\/\S+)/)
			if (m && !settled) {
				settled = true
				clearTimeout(timer)
				const browserWs = m[1]
				const portMatch = browserWs.match(/^ws:\/\/[^/]+:(\d+)\//)
				const httpPort = portMatch ? parseInt(portMatch[1], 10) : 0
				resolve({ browserWs, httpPort, kill })
			}
		})
	})
}

/**
 * Poll `document.readyState` to completion, then a short settle poll on
 * `performance` resource-entry count (a networkidle0-ish proxy — this
 * client has no event subscription, only command/response, so we can't
 * listen for `Page.loadEventFired`/`Network.*` directly).
 * @param {import('../system/cef-cdp-client').CdpSession} session
 * @param {number} timeoutMs
 */
async function waitForLoad(session, timeoutMs) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		const r = await session.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })
		if (r?.result?.value === 'complete') break
		await sleep(50)
	}
	let lastCount = -1
	let stableTicks = 0
	while (Date.now() < deadline && stableTicks < 2) {
		const r = await session.send('Runtime.evaluate', {
			expression: 'performance.getEntriesByType("resource").length',
			returnByValue: true,
		})
		const count = r?.result?.value ?? 0
		stableTicks = count === lastCount ? stableTicks + 1 : 0
		lastCount = count
		await sleep(100)
	}
}

/**
 * Open a new page target on a running headless-Chrome instance (via the
 * `/json/new` HTTP endpoint) and wrap it with the small subset of the
 * puppeteer `Page` API the thumbnail renderers and DOM smokes use.
 * @param {number} httpPort from `launchHeadlessChrome()`
 * @param {{ width?: number, height?: number, deviceScaleFactor?: number }} [opts]
 */
async function openPage(httpPort, opts = {}) {
	const width = opts.width || 1920
	const height = opts.height || 1080
	const deviceScaleFactor = opts.deviceScaleFactor || 1

	const res = await fetch(`http://127.0.0.1:${httpPort}/json/new?about:blank`, { method: 'PUT' })
	if (!res.ok) throw new Error(`CDP /json/new HTTP ${res.status}`)
	const target = await res.json()
	const session = await connectCdp(target.webSocketDebuggerUrl)

	await session.send('Page.enable')
	await session.send('Emulation.setDeviceMetricsOverride', {
		width,
		height,
		deviceScaleFactor,
		mobile: false,
	})

	const page = {
		/**
		 * @param {string} url
		 * @param {{ timeoutMs?: number }} [navOpts]
		 */
		async navigate(url, navOpts = {}) {
			await session.send('Page.navigate', { url })
			await waitForLoad(session, navOpts.timeoutMs || DEFAULT_NAV_TIMEOUT_MS)
		},
		/**
		 * Puppeteer-style `page.evaluate(fn, ...args)`: stringifies the
		 * function, JSON-encodes each arg, and runs it in-page as an IIFE.
		 * @param {Function|string} fn
		 * @param {...any} args
		 */
		async evaluate(fn, ...args) {
			const body = typeof fn === 'function' ? fn.toString() : String(fn)
			const argList = args.map((a) => JSON.stringify(a)).join(',')
			const expression = `(${body})(${argList})`
			const result = await session.send('Runtime.evaluate', {
				expression,
				returnByValue: true,
				awaitPromise: true,
			})
			if (result?.exceptionDetails) {
				const desc =
					result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate exception'
				throw new Error(desc)
			}
			return result?.result?.value
		},
		/**
		 * @param {string} selector
		 * @returns {Promise<{x:number,y:number,width:number,height:number}|null>}
		 */
		elementClip(selector) {
			return page.evaluate((sel) => {
				const el = document.querySelector(sel)
				if (!el) return null
				const r = el.getBoundingClientRect()
				return { x: r.x, y: r.y, width: r.width, height: r.height }
			}, selector)
		},
		/**
		 * @param {boolean} omit
		 */
		async setOmitBackground(omit) {
			await session.send('Emulation.setDefaultBackgroundColorOverride', omit ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {})
		},
		/**
		 * @param {{ clip?: {x:number,y:number,width:number,height:number}, omitBackground?: boolean }} [shotOpts]
		 * @returns {Promise<Buffer>}
		 */
		async screenshot(shotOpts = {}) {
			await page.setOmitBackground(!!shotOpts.omitBackground)
			const params = { format: 'png' }
			if (shotOpts.clip) {
				params.clip = {
					x: shotOpts.clip.x,
					y: shotOpts.clip.y,
					width: shotOpts.clip.width,
					height: shotOpts.clip.height,
					scale: 1,
				}
			}
			const { data } = await session.send('Page.captureScreenshot', params)
			return Buffer.from(data, 'base64')
		},
		/**
		 * @param {string} selector
		 * @param {{ timeoutMs?: number }} [waitOpts]
		 */
		async waitForSelector(selector, waitOpts = {}) {
			const deadline = Date.now() + (waitOpts.timeoutMs || DEFAULT_NAV_TIMEOUT_MS)
			while (Date.now() < deadline) {
				const found = await page.evaluate((sel) => !!document.querySelector(sel), selector)
				if (found) return
				await sleep(50)
			}
			throw new Error(`waitForSelector timeout: ${selector}`)
		},
		/**
		 * @param {() => boolean} fn
		 * @param {{ timeoutMs?: number }} [waitOpts]
		 */
		async waitForFunction(fn, waitOpts = {}) {
			const deadline = Date.now() + (waitOpts.timeoutMs || DEFAULT_NAV_TIMEOUT_MS)
			while (Date.now() < deadline) {
				const ok = await page.evaluate(fn)
				if (ok) return
				await sleep(50)
			}
			throw new Error('waitForFunction timeout')
		},
		/**
		 * @param {string} selector
		 */
		async click(selector) {
			await page.evaluate((sel) => {
				const el = document.querySelector(sel)
				if (!el) throw new Error(`click: no element for ${sel}`)
				el.click()
			}, selector)
		},
		/**
		 * @param {string} selector
		 * @param {string} text
		 */
		async type(selector, text) {
			await page.evaluate(
				(sel, value) => {
					const el = document.querySelector(sel)
					if (!el) throw new Error(`type: no element for ${sel}`)
					el.focus()
					el.value = value
					el.dispatchEvent(new Event('input', { bubbles: true }))
					el.dispatchEvent(new Event('change', { bubbles: true }))
				},
				selector,
				text,
			)
		},
		async close() {
			session.close()
			try {
				await fetch(`http://127.0.0.1:${httpPort}/json/close/${target.id}`)
			} catch (_) {}
		},
	}
	return page
}

module.exports = {
	resolveChromeBinary,
	launchHeadlessChrome,
	openPage,
}
