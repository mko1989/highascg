'use strict'

/**
 * WO-1074 — RC car game, browser client: static checks of game/rc/.
 *  - index.html: import map for three, viewport meta, no external URLs, no inline handlers, the import map is the only
 *    inline script and the server's UI CSP (src/server/security-headers.js) allows it;
 *  - every module import resolves (three from /vendor/three/ → node_modules/three);
 *  - owner rule (14.11): the game never puts anything on a screen by itself — the client calls no URL outside
 *    /api/game/rc/ and /vendor/three/ (no AMCP, no looks, no other API), and the host panel offers no "send to screen";
 *  - every file stays under the 500-line limit.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.join(__dirname, '..', '..')
const RC = path.join(REPO, 'game', 'rc')
const read = (f) => fs.readFileSync(path.join(RC, f), 'utf8')
const files = fs.readdirSync(RC).filter((f) => fs.statSync(path.join(RC, f)).isFile())
const jsFiles = files.filter((f) => f.endsWith('.js'))
const html = read('index.html')
const { buildContentSecurityPolicy } = require(path.join(REPO, 'src', 'server', 'security-headers.js'))

function directive(csp, name) {
	const d = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + ' '))
	return d ? d.split(/\s+/).slice(1) : null
}

describe('WO-1074 game/rc static checks', () => {
	it('has the expected files', () => {
		for (const f of ['index.html', 'main.js', 'game.js', 'host.js', 'physics.js', 'track-math.js', 'net.js', 'README.md', 'rc.css']) {
			assert.ok(files.includes(f), f)
		}
	})

	it('index.html: import map for three, module entry, viewport meta', () => {
		const m = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)
		assert.ok(m, 'import map present')
		const map = JSON.parse(m[1])
		assert.equal(map.imports.three, '/vendor/three/build/three.module.js')
		assert.equal(map.imports['three/addons/'], '/vendor/three/examples/jsm/')
		assert.ok(fs.existsSync(path.join(REPO, 'node_modules', 'three', 'build', 'three.module.js')))
		assert.ok(fs.existsSync(path.join(REPO, 'node_modules', 'three', 'examples', 'jsm', 'loaders', 'GLTFLoader.js')))
		assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'), 'import map before the first module')
		assert.match(html, /<script type="module" src="\/game\/rc\/main\.js"><\/script>/)
		const vp = /<meta\s+name="viewport"\s+content="([^"]+)"/.exec(html)
		assert.ok(vp, 'viewport meta')
		for (const part of ['width=device-width', 'initial-scale=1', 'user-scalable=no', 'viewport-fit=cover']) assert.ok(vp[1].includes(part), part)
	})

	it('complies with the server UI CSP: the import map is the only inline script, no inline handlers', () => {
		const csp = buildContentSecurityPolicy()
		const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
		const inline = scripts.filter((s) => !/\bsrc=/.test(s[1]) && s[2].trim())
		assert.equal(inline.length, 1)
		assert.match(inline[0][1], /type="importmap"/)
		const scriptSrc = directive(csp, 'script-src')
		assert.ok(scriptSrc.includes("'self'"))
		assert.ok(scriptSrc.includes("'unsafe-inline'"), 'the inline import map needs unsafe-inline (the main UI relies on it too)')
		assert.ok(directive(csp, 'connect-src').some((s) => s === "'self'" || s === 'ws:'), 'WebSocket to the box allowed')
		for (const f of files.filter((x) => /\.(html|js)$/.test(x))) {
			const src = read(f)
			assert.doesNotMatch(src, /\son[a-z]+\s*=\s*["']/i, `${f}: no inline on…= handler attributes`)
			assert.doesNotMatch(src, /javascript:/i, `${f}: no javascript: URLs`)
		}
		assert.doesNotMatch(html, /\sstyle\s*=/, 'no inline style attributes')
		assert.doesNotMatch(html, /<link[^>]+href="(?!\/game\/rc\/)/, 'stylesheets are local')
	})

	it('no external URLs anywhere (the venue may be offline): no http(s)://, no // CDN links, no web fonts', () => {
		for (const f of files) {
			if (f === 'README.md') continue
			const src = read(f)
			assert.doesNotMatch(src, /https?:\/\//i, f)
			assert.doesNotMatch(src, /["'(]\/\/[a-z0-9]/i, `${f}: protocol-relative URL`)
			assert.doesNotMatch(src, /@import|@font-face|url\(\s*["']?(?!data:)/i, `${f}: external CSS resource`)
		}
	})

	it('every module import resolves', () => {
		for (const f of jsFiles) {
			const src = read(f)
			for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
				const spec = m[1] || m[2]
				if (spec === 'three') continue
				if (spec.startsWith('three/addons/')) {
					const p = path.join(REPO, 'node_modules', 'three', 'examples', 'jsm', spec.slice('three/addons/'.length))
					assert.ok(fs.existsSync(p), `${f}: ${spec}`)
					continue
				}
				assert.ok(spec.startsWith('./'), `${f}: relative import only (${spec})`)
				assert.ok(fs.existsSync(path.join(RC, spec)), `${f}: ${spec} exists`)
			}
		}
		/* pure modules never import three or touch the DOM (they run in node) */
		for (const f of ['physics.js', 'track-math.js', 'lap-logic.js', 'interp.js', 'protocol.js', 'net.js', 'standings.js', 'cameras.js']) {
			const src = read(f)
			assert.doesNotMatch(src, /from\s+['"]three/, f)
			assert.doesNotMatch(src, /\b(document|window|localStorage)\./, f)
		}
	})

	it('owner rule: the client reaches only /api/game/rc/* and /vendor/three/* — never AMCP, looks or other APIs', () => {
		const ALLOWED = ['/api/game/rc', '/vendor/three/', '/game/rc/']
		for (const f of files) {
			if (f === 'README.md') continue
			const src = read(f)
			for (const m of src.matchAll(/["'`](\/[a-z][^"'`\s]*)/gi)) {
				const url = m[1]
				if (!/^\/(api|vendor|game)\b/.test(url)) continue
				assert.ok(
					ALLOWED.some((a) => url.startsWith(a)),
					`${f}: URL ${url} is outside /api/game/rc/ and /vendor/three/`
				)
			}
			assert.doesNotMatch(src, /\bamcp\b|:5250|\/api\/(?!game\/rc)/i, `${f}: no AMCP / other API`)
		}
		/* fetch() only via the API constant, WebSocket only to WS_PATH */
		for (const f of jsFiles) {
			const src = read(f)
			for (const m of src.matchAll(/\bfetch\(\s*([^,)]+)/g)) assert.match(m[1], /^API \+/, `${f}: fetch(${m[1]})`)
			for (const m of src.matchAll(/new\s+([\w.]*WebSocket)\(\s*([^)]*)\)/g)) assert.equal(m[2], 'this.env.url', `${f}: WebSocket(${m[2]})`)
		}
		assert.match(read('dom.js'), /export const API = '\/api\/game\/rc'/)
		assert.match(read('net.js'), /export const WS_PATH = '\/api\/game\/rc\/ws'/)
		/* the host panel offers no screen / wall / output control */
		const host = read('host.js')
		assert.doesNotMatch(host, /action:\s*'(?!enable'|disable'|track'|start'|stop'|laps'|kick')/, 'only the contract host actions')
		assert.doesNotMatch(host, /send to|show on (the )?(wall|screen)|take|on air|look/i, 'no "show on a screen" control')
	})

	it('every file stays under 500 lines', () => {
		for (const f of files) {
			const n = read(f).split('\n').length
			assert.ok(n <= 500, `${f}: ${n} lines`)
		}
	})
})
