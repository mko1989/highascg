'use strict'

/**
 * WO-1101 — Game World client, static checks of modules/game-world/client (work/notes/game-world-contract.md §2, §3):
 *  - index.html: the import map exactly like the games' pages, the module entry, viewport meta, the server UI CSP;
 *  - no external URLs (no http(s)://, no protocol-relative links, no SVG namespace, no fonts / CSS resources), and the URL
 *    strings in the code are only /api/game/world/, /game/world/, /vendor/three/ (model / kit URLs come from the server);
 *  - every relative import resolves; the pure modules never import three or touch the DOM;
 *  - user text never goes through HTML parsing; no inline handlers / eval; 500 lines per file;
 *  - the world host only posts the contract's actions and offers no "show on a screen" control;
 *  - props.js MODEL_SIGS against the games' real model files, read as TEXT: a renamed export, option or method in a game
 *    breaks this smoke instead of silently turning every visitor into a stand-in.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const REPO = path.join(__dirname, '..', '..')
const DIR = path.join(REPO, 'modules', 'game-world', 'client')
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8')
const files = fs.readdirSync(DIR).filter((f) => fs.statSync(path.join(DIR, f)).isFile())
const OWN = files.filter((f) => f !== 'world-wire.js' && f !== 'package.json')
const jsFiles = files.filter((f) => f.endsWith('.js'))
const html = read('index.html')
const { buildContentSecurityPolicy } = require(path.join(REPO, 'src', 'server', 'security-headers.js'))
const PURE = ['visitor-logic.js', 'world-logic.js', 'world-wire.js']
const directive = (csp, name) => {
	const d = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + ' '))
	return d ? d.split(/\s+/).slice(1) : null
}

let P

before(async () => {
	P = await import(pathToFileURL(path.join(DIR, 'props.js')).href)
})

describe('WO-1101 game/world client static checks', () => {
	it('has the expected files', () => {
		for (const f of ['index.html', 'world.js', 'world.css', 'visitors.js', 'props.js', 'visitor-logic.js', 'visitor-fx.js', 'world-wire.js', 'world-landing.js', 'world-host.js', 'world-spectate.js', 'world-logic.js', 'world-dom.js'])
			assert.ok(files.includes(f), f)
	})

	it('index.html: the games\' import map, the module entry, viewport meta, the UI CSP', () => {
		const m = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)
		assert.ok(m, 'import map present')
		const map = JSON.parse(m[1])
		assert.deepEqual(map.imports, { three: '/vendor/three/build/three.module.js', 'three/addons/': '/vendor/three/examples/jsm/' })
		const rc = /<script type="importmap">([\s\S]*?)<\/script>/.exec(fs.readFileSync(path.join(REPO, 'modules', 'rc-game', 'client', 'index.html'), 'utf8'))
		assert.deepEqual(map, JSON.parse(rc[1]), 'the same import map as the RC page (one three.js for the models)')
		assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'))
		assert.match(html, /<script type="module" src="\/game\/world\/world\.js"><\/script>/)
		const vp = /<meta\s+name="viewport"\s+content="([^"]+)"/.exec(html)
		for (const part of ['width=device-width', 'initial-scale=1', 'viewport-fit=cover']) assert.ok(vp && vp[1].includes(part), part)
		const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
		assert.equal(scripts.filter((s) => !/\bsrc=/.test(s[1]) && s[2].trim()).length, 1, 'the import map is the only inline script')
		const csp = buildContentSecurityPolicy()
		assert.ok(directive(csp, 'script-src').includes("'unsafe-inline'"))
		assert.ok(directive(csp, 'connect-src').some((s) => s === "'self'" || s === 'ws:'))
		assert.doesNotMatch(html, /\sstyle\s*=/)
		assert.doesNotMatch(html, /<link[^>]+href="(?!\/game\/world\/)/, 'stylesheets are local')
	})

	it('no external URLs anywhere: no http(s)://, no // links, no SVG namespace, no fonts or CSS resources', () => {
		for (const f of files) {
			const src = read(f)
			assert.doesNotMatch(src, /https?:\/\//i, f)
			assert.doesNotMatch(src, /["'(]\/\/[a-z0-9]/i, `${f}: protocol-relative URL`)
			assert.doesNotMatch(src, /w3\.org|xmlns|createElementNS/i, `${f}: no SVG namespace`)
			if (/\.(css|html)$/.test(f)) assert.doesNotMatch(src, /@import|@font-face|url\(\s*["']?(?!data:)/i, `${f}: external CSS resource`)
			assert.doesNotMatch(src, /javascript:/i, `${f}: no javascript: URLs`)
		}
	})

	it('URL strings only /api/game/world/, /game/world/, /vendor/three/ — never AMCP or another API', () => {
		const ALLOWED = ['/api/game/world', '/game/world/', '/vendor/three/']
		for (const f of OWN) {
			const src = read(f)
			for (const m of src.matchAll(/["'`](\/[a-z][^"'`\s]*)/gi)) {
				const rel = f === 'world-dom.js' && /call\('\/(state|host)'/.test(src) && ['/state', '/host'].includes(m[1]) // API + path
				assert.ok(rel || ALLOWED.some((a) => m[1].startsWith(a)), `${f}: URL ${m[1]}`)
			}
			assert.doesNotMatch(src, /\bamcp\b|:5250|\/api\/(?!game\/world)/i, `${f}: no AMCP / other API`)
		}
		for (const f of jsFiles) {
			const src = read(f)
			for (const m of src.matchAll(/\bfetch\(\s*([^,)]+)/g)) assert.ok(/^API \+/.test(m[1]) || (f === 'world-dom.js' && m[1] === 'path'), `${f}: fetch(${m[1]})`)
			for (const m of src.matchAll(/new\s+([\w.]*WebSocket)\(\s*([^)]*)\)/g)) assert.equal(m[2], 'wsUrl(', `${f}: WebSocket(${m[2]})`) // new WebSocket(wsUrl())
			for (const m of src.matchAll(/\bimport\(\s*([^)'"][^)]*)\)/g)) assert.ok(['u', 'url', 'wUrl', 'fUrl'].includes(m[1].trim()), `${f}: dynamic import(${m[1]})`)
		}
		assert.match(read('world-dom.js'), /if \(!okPath\(path\)\) return null/, 'getJson: same-origin paths only')
		assert.match(read('world-dom.js'), /export const WS_PATH = '\/api\/game\/world\/ws'/)
		/* every computed import is checked by okModelUrl first */
		assert.match(read('props.js'), /const u = okModelUrl\(m\[k\]\) \? m\[k\] : null/)
		assert.match(read('world-host.js'), /okModelUrl\(u\)\) qrMod = await import\(u\)/)
		assert.match(read('world-spectate.js'), /if \(!okModelUrl\(wUrl\)\) throw/)
		assert.match(read('world-spectate.js'), /if \(okModelUrl\(fUrl\)\)/)
	})

	it('every module import resolves; the pure modules stay three- and DOM-free', () => {
		for (const f of jsFiles) {
			const src = read(f)
			for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
				const spec = m[1] || m[2]
				if (spec === 'three') continue
				assert.ok(spec.startsWith('./'), `${f}: relative import only (${spec})`)
				assert.ok(fs.existsSync(path.join(DIR, spec)), `${f}: ${spec} exists`)
			}
		}
		for (const f of PURE) {
			const src = read(f)
			assert.doesNotMatch(src, /from\s+['"]three/, f)
			assert.doesNotMatch(src, /\b(document|window|localStorage|fetch)\b/, f)
		}
		for (const f of ['visitors.js', 'props.js', 'visitor-fx.js']) {
			assert.doesNotMatch(read(f), /from\s+['"]three/, `${f}: three comes in as a parameter (the page's own)`)
			assert.doesNotMatch(read(f), /\b(document|window)\./, `${f}: no DOM (node smokes, any page)`)
		}
	})

	it('user text never parsed as HTML; no inline handlers, no eval; 500 lines per file', () => {
		for (const f of files) {
			const src = read(f)
			assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, f)
			assert.doesNotMatch(src, /\son[a-z]+\s*=\s*["']/i, `${f}: no inline on…= handlers`)
			assert.doesNotMatch(src, /\beval\(|new Function\(/, f)
			assert.ok(src.split('\n').length <= 500, `${f}: ${src.split('\n').length} lines`)
		}
		assert.match(read('world-dom.js'), /if \(k === 'text'\) el\.textContent = String\(v\)/)
	})

	it('the world host posts only the contract §3 actions and nothing reaches a screen', () => {
		const src = read('world-host.js') + read('world-host-game.js') + read('world-host-house.js')
		const actions = new Set([...src.matchAll(/action:\s*'([a-z]+)'/g)].map((m) => m[1]))
		const all = [...src.matchAll(/\['(enable|disable|start|stop)', '/g)].map((m) => m[1])
		for (const a of all) actions.add(a)
		const CONTRACT = ['enable', 'disable', 'start', 'stop', 'bots', 'safe', 'lights', 'wall', 'house', 'affect', 'event']
		for (const a of actions) assert.ok(CONTRACT.includes(a), `action ${a}`)
		for (const a of CONTRACT) assert.ok(actions.has(a), `missing ${a}`)
		assert.match(src, /Presenter safe/)
		assert.match(src, /Vegetable rain/)
		assert.match(src, /Spotlight bonus/)
		assert.doesNotMatch(src, /send to|show on (the )?(wall|screen)|on air|\blook\b/i, 'no "show on a screen" control')
		assert.doesNotMatch(read('world-spectate.js'), /\bbutton\b/, 'the spectator page has no buttons')
	})
})

describe('WO-1101 props.js signature table vs the games\' model files (read as text)', () => {
	const gameFile = (sig) => fs.readFileSync(path.join(REPO, 'modules', sig.game, 'client', sig.file), 'utf8')

	it('every kind of the contract has an entry; each owning file exports the function props calls', () => {
		assert.deepEqual(Object.keys(P.MODEL_SIGS).sort(), ['av', 'car', 'sling', 'soldier', 'veg'])
		for (const [kind, sig] of Object.entries({ ...P.MODEL_SIGS, avReact: P.AV_REACT })) {
			const src = gameFile(sig)
			assert.match(src, new RegExp(`export function ${sig.fn}\\(`), `${kind}: ${sig.game}/${sig.file} exports ${sig.fn}`)
		}
	})

	it('the option names props passes are the ones each model destructures', () => {
		for (const [kind, sig] of Object.entries(P.MODEL_SIGS)) {
			if (!sig.opts.length) continue
			const src = gameFile(sig)
			const m = new RegExp(`export function ${sig.fn}\\(([^)]*\\{[^}]*\\}[^)]*)\\)`).exec(src)
			assert.ok(m, `${kind}: signature of ${sig.fn}`)
			const names = [...m[1].matchAll(/([A-Za-z_]\w*)\s*(?:=|,|\})/g)].map((x) => x[1])
			for (const o of sig.opts) assert.ok(names.includes(o), `${kind}: ${sig.fn} takes { ${o} } (has ${names.join(', ')})`)
		}
		/* three-taking models: (THREE, …) in the order props calls them */
		assert.match(gameFile(P.MODEL_SIGS.veg), /export function vegMesh\(THREE, id\)/)
		assert.match(gameFile(P.MODEL_SIGS.sling), /export function createSlingshot\(THREE, \{/)
		assert.match(gameFile(P.MODEL_SIGS.av), /export function createAvatarModel\(THREE, \{/)
		assert.match(gameFile(P.AV_REACT), /export function createReactions\(THREE, model\)/)
	})

	it('the methods props calls exist on what each model returns', () => {
		for (const [kind, sig] of Object.entries({ ...P.MODEL_SIGS, avReact: P.AV_REACT })) {
			const src = gameFile(sig)
			for (const fn of sig.api) assert.match(src, new RegExp(`(?:^|[\\s{,])(?:${fn}\\s*\\(|${fn}\\s*[,:}]|${fn},?\\s*$)`, 'm'), `${kind}: .${fn}()`)
		}
		/* the size each model is built at (contract §2: toys at the scene scale, the vegetables VIS × real size) */
		assert.match(fs.readFileSync(path.join(REPO, 'modules', 'stage-salad', 'client', 'projectiles.js'), 'utf8'), /export const VIS = 1\.6/)
		assert.match(fs.readFileSync(path.join(REPO, 'modules', 'rc-game', 'client', 'car-model.js'), 'utf8'), /export const VIS_SCALE = 1\.4/)
		assert.match(read('visitor-logic.js'), /export const VEG_VIS = 1\.6/)
		const veg = fs.readFileSync(path.join(REPO, 'modules', 'stage-salad', 'client', 'veggies.js'), 'utf8')
		for (const [id, r] of Object.entries({ tomato: 0.045, potato: 0.05, carrot: 0.03, cabbage: 0.11, onion: 0.045, peas: 0.018 }))
			assert.match(veg, new RegExp(`${id}: Object\\.freeze\\(\\{ id: '${id}',[^}]*\\br: ${r},`), `veggies.js ${id} r ${r} (visitor-logic VEG_R)`)
		/* the wire flags props reads are the games' own (RC fx, Skirmish soldier flags, Salad av flags) */
		assert.match(fs.readFileSync(path.join(REPO, 'modules', 'rc-game', 'client', 'drive-rules.js'), 'utf8'), /FX = Object\.freeze\(\{ BOOST: 1, DRIFT: 2, SPIN: 4, SHIELD: 8, AIR: 16 \}\)/)
		assert.match(fs.readFileSync(path.join(REPO, 'modules', 'toy-skirmish', 'client', 'sk-const.js'), 'utf8'), /FLAG = Object\.freeze\(\{ MOVING: 1, DEAD: 2, PROTECTED: 4, SURGE: 8 \}\)/)
		assert.match(fs.readFileSync(path.join(REPO, 'modules', 'stage-salad', 'client', 'protocol.js'), 'utf8'), /AV = Object\.freeze\(\{ WALK: 1, LOST: 2, STANDIN: 4, UMBRELLA: 8 \}\)/)
	})

	it('siblingUrl stays in the model\'s folder and passes okModelUrl', () => {
		assert.equal(P.siblingUrl('/game/salad/avatar-model.js', 'avatar-react.js'), '/game/salad/avatar-react.js')
		assert.equal(P.siblingUrl('/game/salad/avatar-model.js?v=3', 'avatar-react.js'), '/game/salad/avatar-react.js')
		assert.equal(P.siblingUrl('/api/x/avatar-model.js', 'avatar-react.js'), null)
		assert.equal(P.siblingUrl(null, 'avatar-react.js'), null)
	})
})
