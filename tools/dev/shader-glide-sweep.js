'use strict'

/**
 * WO-580 phase B — the glide over the shader library in a real WebGL2 (headless Chrome, SwiftShader): per exported
 * shader page, up to 32 eligible float literals per pass get a literal-only CG update through window.update, then a
 * second one on the same literals (a drag). A variant that fails to compile logs "Fragment Shader compilation failed"
 * (the player then falls back to the hard path) — the sweep counts those. Needs chrome-headless-shell in
 * ~/.cache/puppeteer (CHROME= overrides).
 *   node tools/dev/shader-glide-sweep.js template/shaders/sh-*.html
 */
const { spawn } = require('child_process')
const path = require('path')
const H =
	process.env.CHROME ||
	process.env.HOME +
		'/.cache/puppeteer/chrome-headless-shell/linux-150.0.7871.24/chrome-headless-shell-linux64/chrome-headless-shell'
const port = 9333 + Math.floor(Math.random() * 500)
const p = spawn(
	H,
	[
		'--no-sandbox',
		'--allow-file-access-from-files',
		'--use-angle=swiftshader',
		'--enable-unsafe-swiftshader',
		'--window-size=320,180',
		`--remote-debugging-port=${port}`,
		'about:blank',
	],
	{ stdio: 'ignore' }
)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const EDIT = `(() => {
 const L = window.__SHADERFX_LIVE__, cfg = window.__SHADERFX_CONFIG__
 if (!L) return 'NOLIVE'
 const out = []
 for (const key of ['common', 'image', 'bufferA', 'bufferB', 'bufferC', 'bufferD']) {
  const src = key === 'common' ? cfg.common : cfg.passes && cfg.passes[key] && cfg.passes[key].source
  if (!src) continue
  const { m, lits } = L.parse(src)
  const el = lits.filter((l) => L.eligible(m, l)).slice(0, 32)
  if (!el.length) continue
  let s = src
  for (const l of [...el].reverse()) s = s.slice(0, l.at) + (l.v * FACTOR + 0.01).toFixed(4) + s.slice(l.at + l.len)
  window.update(JSON.stringify(key === 'common' ? { common: s } : { passes: { [key]: { source: s } } }))
  out.push(key + ':' + el.length)
 }
 return out.join(' ') || 'none'
})()`
;(async () => {
	let tabs
	for (let i = 0; i < 50 && !tabs; i++) {
		await sleep(200)
		try {
			tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
		} catch {}
	}
	const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl)
	await new Promise((r) => (ws.onopen = r))
	let id = 0
	const pend = new Map()
	let errs = []
	ws.onmessage = (m) => {
		const d = JSON.parse(m.data)
		if (d.id && pend.has(d.id)) {
			pend.get(d.id)(d.result)
			pend.delete(d.id)
		}
		if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error')
			errs.push(
				d.params.args
					.map((a) => a.value || '')
					.join(' ')
					.slice(0, 160)
			)
		if (d.method === 'Runtime.exceptionThrown') errs.push('EXC ' + d.params.exceptionDetails.text)
	}
	const call = (method, params = {}) =>
		new Promise((r) => {
			const i = ++id
			pend.set(i, r)
			ws.send(JSON.stringify({ id: i, method, params }))
		})
	await call('Runtime.enable')
	const ev = async (e) => (await call('Runtime.evaluate', { expression: e })).result?.value
	for (const f of process.argv.slice(2)) {
		errs = []
		await call('Page.navigate', { url: 'file://' + path.resolve(f) })
		await sleep(3000)
		const base = errs.filter((e) => /compilation failed|Failed to compile/.test(e)).length
		errs = []
		const r1 = await ev(EDIT.replace('FACTOR', '1.1'))
		await sleep(300)
		await ev(EDIT.replace('FACTOR', '1.2')) // the drag: same literals, new values
		await sleep(400)
		const fails = errs.filter((e) => /Fragment Shader compilation failed/.test(e))
		if (fails.length) console.log('   ', fails[0].replace(/\s+/g, ' ').slice(0, 300))
		const other = errs.filter(
			(e) => !/compilation failed|Failed to compile|^\s*$|#version|WebSocket/.test(e) && !e.startsWith('precision')
		)
		console.log(
			`${f.split('/').pop()}\tbase=${base}\tedit=${r1}\tglideFails=${fails.length}\t${other.slice(0, 2).join(' || ')}`
		)
	}
	ws.close()
	p.kill()
	process.exit(0)
})()
