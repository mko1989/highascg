'use strict'

const fs = require('fs')
const path = require('path')
const { resolveCgTemplateName, extractTemplateCgData } = require('../engine/scene-template-cg')
const { launchHeadlessChrome, openPage } = require('./headless-chrome-cdp')

const LT_DIR = path.join(__dirname, '..', '..', 'template', 'lower-thirds')
const STUDIO_LT_DIR = path.join(__dirname, '..', '..', 'template', 'studio')
const REPO_TEMPLATE = path.join(__dirname, '..', '..', 'template')

const VIEWPORT_W = 1920
const VIEWPORT_H = 1080

/**
 * @param {string} dir
 * @param {string} name
 * @returns {string|null}
 */
function findCaseInsensitiveEntry(dir, name) {
	if (!fs.existsSync(dir)) return null
	const target = String(name || '').toLowerCase()
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		if (ent.name.toLowerCase() === target) return path.join(dir, ent.name)
	}
	return null
}

/**
 * @param {string} cgName
 * @returns {string|null}
 */
function resolveGenericTemplateHtmlPath(cgName) {
	const parts = String(cgName || '')
		.split('/')
		.filter(Boolean)
	if (!parts.length) return null
	let dir = REPO_TEMPLATE
	for (let i = 0; i < parts.length - 1; i++) {
		const next = findCaseInsensitiveEntry(dir, parts[i])
		if (!next) return null
		dir = next
	}
	const leaf = parts[parts.length - 1]
	const withHtml = leaf.endsWith('.html') ? leaf : `${leaf}.html`
	const file = findCaseInsensitiveEntry(dir, withHtml)
	return file && fs.statSync(file).isFile() ? file : null
}

/**
 * Derive lt-* id from TLS / source value.
 * @param {string} raw
 * @returns {string}
 */
function deriveLtTemplateId(raw) {
	const v = String(raw || '').trim()
	if (!v) return ''
	const m = v.match(/lt-[a-z0-9-]+/i)
	if (m) return m[0].toLowerCase()
	return ''
}

function resolveLtHtmlPath(ltId) {
	const safeId = String(ltId || '').replace(/\.html$/, '')
	if (!/^lt-[a-z0-9-]+$/.test(safeId)) return null
	const studio = path.join(STUDIO_LT_DIR, `${safeId}.html`)
	if (fs.existsSync(studio)) return studio
	const builtin = path.join(LT_DIR, `${safeId}.html`)
	if (fs.existsSync(builtin)) return builtin
	return null
}

/**
 * @param {{ templateId?: string, sourceValue?: string }} req
 * @returns {string|null}
 */
function resolveCgTemplateHtmlPath(req) {
	const sourceValue = String(req?.sourceValue || req?.templateId || '').trim()
	const ltId = deriveLtTemplateId(sourceValue) || deriveLtTemplateId(req?.templateId)
	if (ltId) {
		const ltPath = resolveLtHtmlPath(ltId)
		if (ltPath) return ltPath
	}
	const cgName = resolveCgTemplateName(sourceValue)
	if (!cgName) return null
	return resolveGenericTemplateHtmlPath(cgName)
}

/**
 * @param {object} req
 * @returns {string}
 */
function resolveCgDataJson(req) {
	if (req?.cgData != null) {
		if (typeof req.cgData === 'string') return req.cgData
		try {
			return JSON.stringify(req.cgData)
		} catch {
			return '{}'
		}
	}
	const fakeLayer = { cgData: req?.cgData, source: { value: req?.sourceValue, data: req?.cgData } }
	const cgName = resolveCgTemplateName(req?.sourceValue || req?.templateId)
	return extractTemplateCgData(fakeLayer, cgName)
}

/** @type {Promise<{ browserWs: string, httpPort: number, kill: () => void }>|null} */
let chromePromise = null

/**
 * @returns {Promise<{ browserWs: string, httpPort: number, kill: () => void }>}
 */
async function getChrome() {
	if (!chromePromise) {
		chromePromise = launchHeadlessChrome()
	}
	return chromePromise
}

/**
 * Wait until CG play-in animation has finished (avoids thin mid-animation strips).
 * @param {object} page headless-chrome-cdp page wrapper
 * @param {number} speed
 */
async function waitForCgThumbSettle(page, speed) {
	const pace = Number.isFinite(speed) && speed > 0 ? speed : 1
	const minAnimMs = Math.min(4500, Math.max(200, Math.round(2400 / pace)))
	await new Promise((r) => setTimeout(r, minAnimMs))
	/* eslint-disable no-undef */
	// runs in the headless Chrome page, not node
	await page.evaluate(async () => {
		const deadline = Date.now() + 1500
		while (Date.now() < deadline) {
			const tl = window.gsap?.globalTimeline
			if (!tl?.isActive?.()) return
			await new Promise((r) => setTimeout(r, 40))
		}
	})
	/* eslint-enable no-undef */
	await new Promise((r) => setTimeout(r, 80))
}

/**
 * Mark the best visible template element and return whether it is viewport-sized.
 * @param {object} page headless-chrome-cdp page wrapper
 * @returns {Promise<'element'|'clip'|'viewport'>}
 */
async function markCgThumbCaptureTarget(page) {
	/* eslint-disable no-undef */
	// runs in the headless Chrome page, not node
	return page.evaluate(() => {
		document.querySelectorAll('[data-cg-thumb-target]').forEach((el) => el.removeAttribute('data-cg-thumb-target'))
		const vw = window.innerWidth
		const vh = window.innerHeight
		const viewportArea = vw * vh

		function isVisible(el) {
			const r = el.getBoundingClientRect()
			if (r.width < 12 || r.height < 12) return false
			const st = getComputedStyle(el)
			if (parseFloat(st.opacity) < 0.85) return false
			if (st.display === 'none' || st.visibility === 'hidden') return false
			return true
		}

		const selectors = [
			'main .graphic',
			'.graphic',
			'main',
			'[class*="lt-"]',
			'body > main',
			'body > div:first-of-type',
		]
		let target = null
		let targetArea = 0
		for (const sel of selectors) {
			for (const el of document.querySelectorAll(sel)) {
				if (!isVisible(el)) continue
				const r = el.getBoundingClientRect()
				const area = r.width * r.height
				if (area > targetArea && area <= viewportArea * 0.92) {
					target = el
					targetArea = area
				}
			}
		}

		if (target && targetArea <= viewportArea * 0.85) {
			target.setAttribute('data-cg-thumb-target', 'element')
			return 'element'
		}

		let minX = Infinity
		let minY = Infinity
		let maxX = -Infinity
		let maxY = -Infinity
		for (const el of document.querySelectorAll('body *')) {
			if (el === document.body || el === document.documentElement) continue
			if (!isVisible(el)) continue
			const r = el.getBoundingClientRect()
			if (r.width < 8 || r.height < 8) continue
			minX = Math.min(minX, r.x)
			minY = Math.min(minY, r.y)
			maxX = Math.max(maxX, r.x + r.width)
			maxY = Math.max(maxY, r.y + r.height)
		}

		if (Number.isFinite(minX) && maxX > minX && maxY > minY) {
			const padX = Math.max(8, (maxX - minX) * 0.04)
			const padY = Math.max(8, (maxY - minY) * 0.04)
			const x0 = Math.max(0, Math.floor(minX - padX))
			const y0 = Math.max(0, Math.floor(minY - padY))
			const x1 = Math.min(vw, Math.ceil(maxX + padX))
			const y1 = Math.min(vh, Math.ceil(maxY + padY))
			const clip = {
				x: x0,
				y: y0,
				width: Math.max(1, x1 - x0),
				height: Math.max(1, y1 - y0),
			}
			document.body.setAttribute(
				'data-cg-thumb-clip',
				JSON.stringify(clip),
			)
			return 'clip'
		}

		document.body.setAttribute('data-cg-thumb-target', 'viewport')
		return 'viewport'
	})
	/* eslint-enable no-undef */
}

/**
 * @param {object} page headless-chrome-cdp page wrapper
 * @returns {Promise<Buffer>}
 */
async function captureCgThumbPng(page) {
	const mode = await markCgThumbCaptureTarget(page)
	if (mode === 'element') {
		const clip = await page.elementClip('[data-cg-thumb-target="element"]')
		if (clip && clip.width > 0 && clip.height > 0) {
			return page.screenshot({ omitBackground: true, clip })
		}
	}

	if (mode === 'clip') {
		/* eslint-disable no-undef */
		// runs in the headless Chrome page, not node
		const clipRaw = await page.evaluate(() => document.body.getAttribute('data-cg-thumb-clip'))
		/* eslint-enable no-undef */
		if (clipRaw) {
			try {
				const clip = JSON.parse(clipRaw)
				if (clip.width > 0 && clip.height > 0) {
					return page.screenshot({ omitBackground: true, clip })
				}
			} catch {
				/* fall through */
			}
		}
	}

	return page.screenshot({ omitBackground: true })
}

/* WO-344: shader templates are one full-viewport canvas, so the DOM-rect targeting above always
 * lands on 'viewport' — but the actual CONTENT often covers a fraction of it (borders + alpha
 * void in the deck thumb). Detect the pixel-content box (ffmpeg cropdetect on the flattened
 * frame) and crop with 4% padding. Full-ish frames (≥85%) and degenerate detections pass
 * through untouched; any failure returns the original PNG. */
const SHADER_TEMPLATE_RE = /(^|\/|\\)shaders\//i
function isShaderThumbReq(req) {
	return SHADER_TEMPLATE_RE.test(String(req?.sourceValue || req?.templateId || ''))
}

async function contentCropPng(png) {
	const os = require('os')
	const fsn = require('fs')
	const pathn = require('path')
	const { execFile } = require('child_process')
	const run = (args) =>
		new Promise((resolve, reject) =>
			execFile('ffmpeg', args, { timeout: 15000 }, (e, so, se) => (e ? reject(new Error(se || e.message)) : resolve(se || so))),
		)
	const dir = fsn.mkdtempSync(pathn.join(os.tmpdir(), 'cgthumb-'))
	const inP = pathn.join(dir, 'in.png')
	const outP = pathn.join(dir, 'out.png')
	try {
		fsn.writeFileSync(inP, png)
		// -loop + 3 frames: cropdetect emits nothing on a single still frame.
		const det = await run(['-hide_banner', '-loop', '1', '-i', inP, '-vf', 'cropdetect=limit=24:round=2:reset=0', '-frames:v', '3', '-f', 'null', '-'])
		const m = [...det.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].pop()
		const dm = det.match(/, (\d+)x(\d+)[, ]/)
		if (!m || !dm) return png
		let [w, h, x, y] = m.slice(1).map(Number)
		const FW = Number(dm[1])
		const FH = Number(dm[2])
		if (!FW || !FH || !w || !h) return png
		if (w < 64 || h < 36) return png // likely a black/empty frame — keep the original
		if (w * h >= FW * FH * 0.85) return png
		const padX = Math.round(w * 0.04)
		const padY = Math.round(h * 0.04)
		x = Math.max(0, x - padX)
		y = Math.max(0, y - padY)
		w = Math.min(FW - x, w + 2 * padX)
		h = Math.min(FH - y, h + 2 * padY)
		await run(['-hide_banner', '-y', '-i', inP, '-vf', `crop=${w}:${h}:${x}:${y}`, outP])
		return fsn.readFileSync(outP)
	} catch {
		return png
	} finally {
		try {
			fsn.rmSync(dir, { recursive: true, force: true })
		} catch {
			/* tmp cleanup best-effort */
		}
	}
}

/**
 * @param {{ templateId?: string, sourceValue?: string, cgData?: object, width?: number, height?: number }} req
 * @returns {Promise<Buffer>}
 */
async function renderCgLookThumbPng(req) {
	const htmlPath = resolveCgTemplateHtmlPath(req)
	if (!htmlPath) {
		throw new Error(`No HTML template file for ${req?.sourceValue || req?.templateId || 'unknown'}`)
	}

	let cgPayload
	try {
		cgPayload = JSON.parse(resolveCgDataJson(req))
	} catch {
		cgPayload = {}
	}

	const chrome = await getChrome()
	const page = await openPage(chrome.httpPort, { width: VIEWPORT_W, height: VIEWPORT_H, deviceScaleFactor: 1 })
	try {
		/* WO-344: shader templates render via the SERVER url — the file:// route produced black
		 * frames in this pipeline while the http route captures reliably (proven path); it also
		 * gives the page same-origin access to the live audio_fft WS feed, so audio-reactive
		 * shaders thumb with real content. */
		const shaderReq = isShaderThumbReq(req)
		const navUrl = shaderReq
			? `http://127.0.0.1:4200/templates/shaders/${String(req?.sourceValue || req?.templateId || '').replace(/^.*shaders\//i, '').replace(/\.html?$/i, '').toLowerCase()}.html`
			: `file://${htmlPath}`
		await page.navigate(navUrl, { timeoutMs: 30000 })

		/* eslint-disable no-undef */
		// runs in the headless Chrome page, not node
		await page.evaluate((payload) => {
			if (typeof window.update === 'function') {
				window.update(payload)
			}
			if (typeof window.play === 'function') {
				window.play()
			}
		}, cgPayload)
		/* eslint-enable no-undef */

		const speedRaw = cgPayload?.style?.speed
		const speed = Number.isFinite(Number(speedRaw)) && Number(speedRaw) > 0 ? Number(speedRaw) : 1
		await waitForCgThumbSettle(page, speed)

		if (shaderReq) {
			// WO-344: full-viewport capture with default background (the omit-background +
			// DOM-target path is meaningless for a single fullscreen canvas), then
			// pixel-content crop (borders + alpha void otherwise).
			const png = await page.screenshot({})
			return contentCropPng(png)
		}
		return await captureCgThumbPng(page)
	} finally {
		await page.close().catch(() => {})
	}
}

module.exports = {
	deriveLtTemplateId,
	resolveCgTemplateHtmlPath,
	renderCgLookThumbPng,
	waitForCgThumbSettle,
	captureCgThumbPng,
}
