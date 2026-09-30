/**
 * WO-586 — render shader-store configs through the REAL exported template (player.js +
 * ShaderToyLite.js, `?shaderThumb=1` synthetic spectrum) in headless Chrome, before they are
 * saved to the library. Records GLSL/JS errors (console.error trap) and pixel stats of two frames
 * 1 s apart; writes each frame-2 screenshot next to the rendered page for eyeballing.
 *
 * Usage: node tools/shaders/validate-shader-configs.js <configDir> <out.json> [id,id,...]
 * Env:   RENDER_DIR (default: <os tmp>/highascg-shader-validate), NOTHUMB=1 (silent audio)
 */

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { PNG } = require('pngjs')
const { normalizeShaderConfig } = require('../../src/shaderfx/shader-store')
const { buildShaderTemplateHtml } = require('../../src/shaderfx/shader-template-export')
const { launchHeadlessChrome, openPage } = require('../../src/media/headless-chrome-cdp')

const REPO = path.resolve(__dirname, '../..')
const RENDER = process.env.RENDER_DIR || path.join(os.tmpdir(), 'highascg-shader-validate')

/* Injected first in <head> so it sees ShaderToyLite's compile errors (console.error) too. */
const TRAP =
	'<script>window.__errs=[];(function(){const e=console.error.bind(console);' +
	"console.error=function(){window.__errs.push([].map.call(arguments,String).join(' ').slice(0,600));" +
	"e.apply(null,arguments)};window.addEventListener('error',ev=>window.__errs.push('onerror: '+ev.message))})()</script>"

/** @param {Buffer} buf PNG */
function frameStats(buf) {
	const png = PNG.sync.read(buf)
	let n = 0
	let sum = 0
	let sum2 = 0
	let lit = 0
	for (let i = 0; i < png.data.length; i += 16) {
		const l = (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3
		n++
		sum += l
		sum2 += l * l
		if (l > 12) lit++
	}
	const mean = sum / n
	return {
		mean: +mean.toFixed(1),
		sd: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(1),
		lit: +(lit / n).toFixed(3),
	}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
	const [cfgDir, outJson, only] = process.argv.slice(2)
	if (!cfgDir || !outJson) throw new Error('usage: validate-shader-configs.js <configDir> <out.json> [ids]')
	fs.mkdirSync(RENDER, { recursive: true })
	for (const f of ['ShaderToyLite.js', 'player.js', 'player-camera.js'])
		fs.copyFileSync(path.join(REPO, 'template/shaders', f), path.join(RENDER, f))

	const ids = only ? new Set(only.split(',')) : null
	const files = fs.readdirSync(cfgDir).filter((f) => f.endsWith('.json') && !f.startsWith('_'))
	const query = process.env.NOTHUMB ? '' : '?shaderThumb=1'
	const results = {}
	let chrome = await launchHeadlessChrome({})
	try {
		for (const f of files) {
			const id = f.replace(/\.json$/, '')
			if (ids && !ids.has(id)) continue
			const t0 = Date.now()
			try {
				const page = await openPage(chrome.httpPort, { width: 320, height: 180, commandTimeoutMs: 30000 })
				const cfg = normalizeShaderConfig(JSON.parse(fs.readFileSync(path.join(cfgDir, f), 'utf8')))
				const html = buildShaderTemplateHtml(cfg).replace('<head>', '<head>' + TRAP)
				fs.writeFileSync(path.join(RENDER, id + '.html'), html)
				await page.navigate('file://' + path.join(RENDER, id + '.html') + query, { timeoutMs: 20000 })
				await sleep(1500)
				const a = frameStats(await page.screenshot())
				await sleep(1000)
				const shot = await page.screenshot()
				fs.writeFileSync(path.join(RENDER, id + '.png'), shot)
				const errs = await page.evaluate('() => window.__errs') // string: runs in-page, not in node
				results[id] = { errs, a, b: frameStats(shot), ms: Date.now() - t0 }
				await page.close()
			} catch (e) {
				results[id] = { errs: ['HARNESS: ' + e.message], ms: Date.now() - t0 }
				// A hung renderer (heavy raymarcher on SwiftShader) poisons every later page — start clean.
				chrome.kill()
				chrome = await launchHeadlessChrome({})
			}
			const r = results[id]
			const tag = r.errs.length ? 'ERR ' : 'ok  '
			console.log(`${tag} ${id} ${JSON.stringify(r.b || '')} ${r.ms}ms ${r.errs.length ? r.errs[0].slice(0, 160) : ''}`)
		}
	} finally {
		chrome.kill()
	}
	fs.writeFileSync(outJson, JSON.stringify(results, null, 1))
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
