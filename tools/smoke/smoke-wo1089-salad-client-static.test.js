'use strict'

/**
 * WO-1089 Stage Salad — browser client, owner rules checked on the source text (modules/stage-salad/client; contract
 * work/notes/stage-salad-contract.md §0 / §2):
 *  - no absolute URL to anywhere else (no http:// / https:// / ws:// / protocol-relative //host) in any client file;
 *  - every root-relative path is the game's own: /api/game/salad…, /game/salad/…, /vendor/three/…;
 *  - no innerHTML / outerHTML / insertAdjacentHTML / document.write / eval / new Function; no audio / font / image files
 *    or `new Audio` / fetch of an asset (WebAudio blips only);
 *  - index.html carries exactly ONE inline script — the import map (three → /vendor/three/) — and no inline handlers;
 *  - the host page offers only the contract's host actions (incl. the presenter-safe pause) and nothing that sends the
 *    game to a screen; the spectator note is there;
 *  - every relative import resolves (`./kit/<file>` into modules/rc-game/client); the five shared modules are imported,
 *    not copied;
 *  - the pure modules touch neither the DOM nor three.js; every file ≤ 500 lines with a WO-1089 header.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.join(__dirname, '..', '..')
const DIR = path.join(REPO, 'modules', 'stage-salad', 'client')
const KIT = path.join(REPO, 'modules', 'rc-game', 'client')

const files = fs.readdirSync(DIR).filter((f) => /\.(js|mjs|css|html|json)$/.test(f))
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8')
const code = files.filter((f) => /\.(js|mjs)$/.test(f))
/** Source without comments (so a comment may mention what the code must not do). */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')

const SHARED = ['veggies.js', 'flight.js', 'venue.js', 'avatar-body.js', 'aim.js']
const PURE = ['protocol.js', 'net.js', 'aim-input.js', 'shots.js', 'cam.js', 'avatar-spec.js', ...SHARED]
const HOST_ACTIONS = ['enable', 'disable', 'start', 'stop', 'round', 'bots', 'botlevel', 'teams', 'target', 'safe', 'kick', 'lights', 'wall']

describe('WO-1089 Salad client: owner rules (source text)', () => {
	it('has the expected files', () => {
		for (const f of ['index.html', 'main.js', 'game.js', 'loop.js', 'session.js', 'host.js', 'lobby.js', 'hud.js', 'input.js', 'audio.js', 'dev-hook.js', 'salad.css', 'salad-hud.css', 'slingshot-model.js', 'veg-models.js', 'avatar-model.js', 'avatar-react.js', 'projectiles.js', ...PURE])
			assert.ok(files.includes(f), f)
	})

	it('no URL to anywhere else, no asset files', () => {
		for (const f of files) {
			const s = read(f)
			assert.doesNotMatch(s, /https?:\/\//i, `${f}: absolute http(s) URL`)
			assert.doesNotMatch(s, /wss?:\/\/[a-z0-9]/i, `${f}: absolute ws URL`)
			assert.doesNotMatch(s, /['"`(=]\s*\/\/[a-z0-9]/i, `${f}: protocol-relative URL`)
			assert.doesNotMatch(s, /@import\s+url|url\(|@font-face/i, `${f}: external CSS resource`)
			assert.doesNotMatch(s, /\.(mp3|ogg|wav|m4a|woff2?|ttf|otf|png|jpe?g|gif|webp|svg)\b['"`]/i, `${f}: asset file`)
		}
		for (const f of code) assert.doesNotMatch(strip(read(f)), /new Audio\s*\(|new Image\s*\(/, f)
		const all = fs.readdirSync(DIR)
		for (const f of all) assert.match(f, /\.(js|mjs|css|html|json)$/, `unexpected file ${f}`)
	})

	it('root-relative paths are only the game API, the game files and three', () => {
		const ok = /^\/(api\/game\/salad(\/|$)|game\/salad\/|vendor\/three\/)/
		for (const f of files) {
			const s = f.endsWith('.js') ? strip(read(f)) : read(f)
			for (const m of s.matchAll(/(?:['"`]|(?:href|src)=")(\/[a-z][^'"`\s]*)/gi)) {
				const p = m[1]
				if (/^\/[a-z]+\/?$/i.test(p) && f.endsWith('.js') && !p.startsWith('/api')) continue // '/state', '/host', '/scene' under API
				assert.match(p, ok, `${f}: ${p}`)
			}
		}
		assert.match(read('dom.js'), /export const API = '\/api\/game\/salad'/)
		assert.match(read('net.js'), /WS_PATH = '\/api\/game\/salad\/ws'/)
		assert.doesNotMatch(files.map(read).join('\n'), /\/api\/(?!game\/salad)[a-z]/, 'another API')
	})

	it('no HTML injection sinks', () => {
		for (const f of code) {
			const s = strip(read(f))
			assert.doesNotMatch(s, /\.(innerHTML|outerHTML)\b|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\s*\(/, f)
		}
	})

	it('index.html: one inline script (the import map), no inline handlers / styles', () => {
		const html = read('index.html')
		const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
		const inline = scripts.filter((m) => !/\bsrc=/.test(m[1]))
		assert.equal(inline.length, 1)
		assert.match(inline[0][1], /type="importmap"/)
		const map = JSON.parse(inline[0][2])
		assert.deepEqual(map.imports, { three: '/vendor/three/build/three.module.js', 'three/addons/': '/vendor/three/examples/jsm/' })
		const ext = scripts.filter((x) => /\bsrc=/.test(x[1]))
		assert.equal(ext.length, 1)
		assert.match(ext[0][1], /src="\/game\/salad\/main\.js"/)
		assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'inline handler')
		assert.doesNotMatch(html, /\sstyle\s*=/i, 'inline style')
		assert.doesNotMatch(html, /<style\b/i)
		for (const m of html.matchAll(/<link[^>]*href="([^"]+)"/g)) assert.match(m[1], /^\/game\/salad\/(kit\/)?[\w-]+\.css$/)
		for (const id of ['view', 'hud', 'lobby', 'loading', 'host', 'screen', 'rotate']) assert.match(html, new RegExp(`id="${id}"`), id)
	})

	it('host page: only the contract actions (with the presenter-safe pause), no way to put the game on a screen', () => {
		const s = strip(read('host.js'))
		const used = new Set([...s.matchAll(/action:\s*'([a-z]+)'/g)].map((m) => m[1]))
		for (const a of used) assert.ok(HOST_ACTIONS.includes(a), `unknown host action ${a}`)
		for (const a of HOST_ACTIONS) assert.ok(used.has(a), `host action ${a} missing`)
		assert.match(s, /Pause — presenter safe/)
		assert.match(read('salad.css'), /\.salad-safe-btn\s*\{[^}]*min-height:\s*\d{2}px/, 'the pause button is big')
		assert.match(s, /Spectator page: \/game\/salad\/\?spectate=1 — an ordinary web page; the game never shows anything on a screen by itself/)
		const all = code.map((f) => strip(read(f))).join('\n')
		assert.doesNotMatch(all, /send to (the )?(screen|wall|output|program)|on air|to air|caspar|amcp|\bPGM\b|\bplayout\b/i)
		assert.doesNotMatch(all, /action:\s*'(screen|output|show|air|program|send)/)
	})

	it('every relative import resolves; kit imports land in the RC client; the shared modules are imported', () => {
		const imported = new Set()
		for (const f of code) {
			const s = read(f)
			const specs = [...s.matchAll(/(?:^|\n)\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g), ...s.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1])
			for (const spec of specs) {
				if (spec === 'three' || spec.startsWith('three/addons/')) continue
				assert.ok(spec.startsWith('./'), `${f}: bare import ${spec}`)
				imported.add(spec.slice(2))
				let target
				if (spec.startsWith('./kit/')) {
					const rel = spec.slice(6)
					assert.match(path.extname(rel), /^\.(js|mjs|css)$/, `${f}: kit ${spec}`)
					target = path.join(KIT, rel)
					const kitSrc = strip(fs.readFileSync(target, 'utf8'))
					assert.ok(!/\/api\/game\/rc|from '\.\/dom\.js'/.test(kitSrc), `${spec} is RC-bound`)
				} else target = path.join(DIR, spec)
				assert.ok(fs.existsSync(target), `${f}: ${spec} → ${target}`)
			}
		}
		for (const f of SHARED) assert.ok(imported.has(f), `${f} not imported`)
		for (const f of code.filter((x) => !SHARED.includes(x))) {
			assert.doesNotMatch(read(f), /export const VEGGIES\s*=|export function stepFlight\b|export function buildVenue\b|export const MESH\s*=/, `${f} copies a shared module`)
		}
	})

	it('pure modules use neither the DOM nor three', () => {
		for (const f of PURE) {
			const s = strip(read(f))
			assert.doesNotMatch(s, /\b(document|window|navigator|localStorage|sessionStorage|requestAnimationFrame)\b/, f)
			assert.doesNotMatch(s, /from 'three'/, f)
		}
	})

	it('user text only through textContent: names land via h(…, { text }) / setText, never in markup', () => {
		const all = code.map((f) => strip(read(f))).join('\n')
		assert.doesNotMatch(all, /\.name\b[^\n]*\+\s*['"`]</, 'a name glued into markup')
		assert.doesNotMatch(all, /createContextualFragment|DOMParser|srcdoc/)
	})

	it('every file ≤ 500 lines; a WO-1089 header in every own module', () => {
		for (const f of files) assert.ok(read(f).split('\n').length <= 500, `${f} too long`)
		for (const f of code) assert.match(read(f).slice(0, 700), /WO-1089/, `${f}: header`)
	})
})
