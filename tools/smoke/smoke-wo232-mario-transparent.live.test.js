'use strict'

/**
 * WO-232 live spike: does the vendored Mario canvas game (template/mario/index.html) actually
 * render with a transparent background once patched?
 *
 * This launches a real headless Chrome via `puppeteer` (bundled Chromium — a production
 * dependency here, see package.json), navigates to the page over file://, lets the game boot
 * and draw a couple of frames, then screenshots with omitBackground:true and decodes the PNG
 * (via `pngjs`, also a direct dependency) to inspect raw pixel alpha. Pixels are read from the
 * *screenshot bytes*, not via in-page canvas.getImageData() — loading sprites over file:// taints
 * the canvas for cross-origin reads (SecurityError on getImageData), but the compositor
 * screenshot itself is unaffected by that taint, so this is the reliable way to check alpha here.
 *
 * This test does NOT talk to CasparCG/AMCP — the CEF interactive bridge is a separate, already
 * proven path (see tools/smoke/smoke-cef-cdp-input.live.test.js and
 * template/cef_input_test.html); this test only proves the page itself paints transparent.
 *
 * Named *.live.test.js on purpose: launches a real browser process, so it is excluded from
 * tools/ci/run-offline-tests.js. Run manually:
 *   node --test tools/smoke/smoke-wo232-mario-transparent.live.test.js
 *
 * If headless Chrome cannot launch in this environment (no sandbox, missing libs, no GPU/display
 * for --headless=new, etc.) the test skips itself with a diagnostic instead of failing the gate —
 * see the static fallback smoke at tools/smoke/smoke-wo232-mario-static.test.js for the
 * always-runs offline check (file/marker presence, no http(s) refs).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../../src/repo-paths')

const PAGE_PATH = path.join(REPO_ROOT, 'template', 'mario', 'index.html')
const PAGE_URL = 'file://' + PAGE_PATH

/**
 * Sum the alpha channel over a rect of a decoded PNG. Coordinates/size are clamped to the
 * image bounds.
 * @param {{width:number,height:number,data:Buffer}} png - pngjs-decoded RGBA image
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {number}
 */
function sumAlpha(png, x, y, w, h) {
	let sum = 0
	const x1 = Math.min(png.width, x + w)
	const y1 = Math.min(png.height, y + h)
	for (let py = y; py < y1; py++) {
		for (let px = x; px < x1; px++) {
			const idx = (png.width * py + px) << 2
			sum += png.data[idx + 3]
		}
	}
	return sum
}

test('WO-232: vendored Mario page renders with a transparent background', async (t) => {
	if (!fs.existsSync(PAGE_PATH)) {
		t.skip(`missing ${PAGE_PATH} — vendor step (T232.1) not done`)
		return
	}

	let puppeteer
	let PNG
	try {
		puppeteer = require('puppeteer')
		;({ PNG } = require('pngjs'))
	} catch (e) {
		t.skip(`puppeteer/pngjs not installed/resolvable (${e?.message || e})`)
		return
	}

	let browser
	try {
		browser = await puppeteer.launch({
			headless: true,
			args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
		})
	} catch (e) {
		t.skip(`headless Chrome failed to launch in this environment (${e?.message || e})`)
		return
	}

	try {
		const page = await browser.newPage()
		await page.setViewport({ width: 800, height: 760 })

		const consoleErrors = []
		page.on('pageerror', (err) => consoleErrors.push(String(err)))

		await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 15_000 })
		// Let the game boot (resource loader + a couple of rAF frames) before sampling pixels.
		await new Promise((r) => setTimeout(r, 2000))

		// Chrome's autoplay policy rejects the game's background-music Audio.play() call because
		// headless puppeteer never "interacts" with the document — this is a benign, expected
		// browser-policy rejection unrelated to the WO-232 transparency patch (it happens on the
		// unmodified upstream game too), so it's the only pageerror we tolerate here.
		const unexpectedErrors = consoleErrors.filter((e) => !/NotAllowedError/.test(e))
		assert.deepEqual(unexpectedErrors, [], `page threw unexpected errors: ${unexpectedErrors.join(' | ')}`)

		/* eslint-disable no-undef */
		// runs in the puppeteer browser page, not node
		const hasCanvas = await page.evaluate(() => !!document.querySelector('canvas'))
		/* eslint-enable no-undef */
		assert.ok(hasCanvas, 'game should have created a <canvas>')

		// Screenshot the whole page with omitBackground so any opaque body/html/canvas fill would
		// show up as a fully-opaque region instead of transparent.
		const shot = await page.screenshot({ omitBackground: true })
		assert.ok(Buffer.isBuffer(shot) && shot.length > 0, 'screenshot should produce PNG bytes')

		const png = PNG.sync.read(shot)
		assert.ok(png.width > 0 && png.height > 0, 'decoded screenshot should have dimensions')

		// Top-left corner of the page (sky area, WO-232 fillRect removed) — should be fully
		// transparent since nothing in the page paints an opaque background there.
		const topAlphaSum = sumAlpha(png, 0, 0, 10, 10)
		assert.equal(topAlphaSum, 0, `top-left 10x10 region should be fully transparent (alpha sum=${topAlphaSum})`)

		// A lower band where ground/scenery/canvas content should have painted opaque pixels once
		// the level has loaded — proves we didn't just make the whole page blank.
		const bottomAlphaSum = sumAlpha(png, 0, Math.max(0, png.height - 140), Math.min(200, png.width), 40)
		assert.ok(bottomAlphaSum > 0, `expected some opaque ground/scenery pixels lower on the page (alpha sum=${bottomAlphaSum})`)

		t.diagnostic(
			`png ${png.width}x${png.height}, top-left alpha sum=${topAlphaSum}, lower-band alpha sum=${bottomAlphaSum}, screenshot bytes=${shot.length}`,
		)
	} finally {
		await browser.close().catch(() => {})
	}
})
