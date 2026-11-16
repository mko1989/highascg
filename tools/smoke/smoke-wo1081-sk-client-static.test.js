'use strict'

/**
 * WO-1081 Stage Skirmish — browser client, owner rules checked on the source text (modules/toy-skirmish/client):
 *  - no absolute URL to anywhere else (no http:// / https:// / protocol-relative //host) in any client file;
 *  - every root-relative path in the client is the game's own: /api/game/sk…, /game/sk/…, /vendor/three/…;
 *  - no innerHTML / outerHTML / insertAdjacentHTML / document.write / eval / new Function;
 *  - index.html carries exactly ONE inline script — the import map — and no inline handlers or style attributes;
 *  - the host page offers only the contract's host actions and nothing that sends the game to a screen / wall / output;
 *  - every relative import resolves (`./kit/<file>` into modules/rc-game/client, like the server's static alias), and
 *    kit files are .js / .mjs / .css only;
 *  - the pure modules (rules, grid, movement, shots, wire format, score, camera maths, socket) touch neither the DOM nor
 *    three.js (node-testable);
 *  - every client file ≤ 500 lines.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.join(__dirname, '..', '..')
const SK = path.join(REPO, 'modules', 'toy-skirmish', 'client')
const KIT = path.join(REPO, 'modules', 'rc-game', 'client')

const files = fs.readdirSync(SK).filter((f) => /\.(js|mjs|css|html|json)$/.test(f))
const read = (f) => fs.readFileSync(path.join(SK, f), 'utf8')
const code = files.filter((f) => /\.(js|mjs)$/.test(f))
/** Source without comments (so a comment may mention what the code must not do). */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')

const PURE = ['sk-const.js', 'grid.js', 'move.js', 'shots.js', 'protocol.js', 'score.js', 'cam.js', 'net.js']
const HOST_ACTIONS = ['enable', 'disable', 'arena', 'mode', 'limits', 'bots', 'start', 'stop', 'kick', 'team', 'lights', 'wall', 'botlevel', 'house'] // house: WO-1099

describe('WO-1081 Skirmish client: owner rules (source text)', () => {
	it('has the expected files', () => {
		for (const f of ['index.html', 'main.js', 'game.js', 'host.js', 'sk.css', ...PURE]) assert.ok(files.includes(f), f)
	})

	it('no URL to anywhere else', () => {
		for (const f of files) {
			const s = read(f)
			assert.doesNotMatch(s, /https?:\/\//i, `${f}: absolute http(s) URL`)
			assert.doesNotMatch(s, /wss?:\/\/[a-z0-9]/i, `${f}: absolute ws URL`)
			assert.doesNotMatch(s, /['"`(=]\s*\/\/[a-z0-9]/i, `${f}: protocol-relative URL`)
			assert.doesNotMatch(s, /@import\s+url|url\(\s*['"]?[a-z]+:/i, `${f}: external CSS resource`)
		}
	})

	it('root-relative paths are only the game API, the game files and three', () => {
		const ok = /^\/(api\/game\/sk(\/|$)|game\/sk\/|vendor\/three\/|game\/world\/)/ // WO-1101: world-join.js accepts only a /game/world/ renderer URL
		for (const f of files) {
			const s = f.endsWith('.js') ? strip(read(f)) : read(f)
			for (const m of s.matchAll(/(?:['"`]|(?:href|src)=")(\/[a-z][^'"`\s]*)/gi)) {
				const p = m[1]
				if (/^\/[a-z]+\/?$/i.test(p) && f.endsWith('.js') && !p.startsWith('/api')) continue // '/state', '/host', '/scene' under API
				assert.match(p, ok, `${f}: ${p}`)
			}
		}
		assert.match(read('dom.js'), /export const API = '\/api\/game\/sk'/)
		assert.match(read('net.js'), /WS_PATH = '\/api\/game\/sk\/ws'/)
		assert.doesNotMatch(files.map(read).join('\n'), /\/api\/(?!game\/sk)[a-z]/, 'another API')
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
		assert.deepEqual(Object.keys(map.imports).sort(), ['three', 'three/addons/'])
		for (const v of Object.values(map.imports)) assert.match(v, /^\/vendor\/three\//)
		for (const m of scripts.filter((x) => /\bsrc=/.test(x[1]))) assert.match(m[1], /src="\/game\/sk\/[\w-]+\.js"/)
		assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'inline handler')
		assert.doesNotMatch(html, /\sstyle\s*=/i, 'inline style')
		assert.doesNotMatch(html, /<style\b/i)
		for (const m of html.matchAll(/<link[^>]*href="([^"]+)"/g)) assert.match(m[1], /^\/game\/sk\/(kit\/)?[\w-]+\.css$/)
	})

	it('host page: only the contract actions, no way to put the game on a screen', () => {
		const s = strip(read('host.js'))
		const used = new Set([...s.matchAll(/action:\s*'([a-z]+)'/g)].map((m) => m[1]))
		assert.ok(used.size >= 10)
		for (const a of used) assert.ok(HOST_ACTIONS.includes(a), `unknown host action ${a}`)
		const all = code.map((f) => strip(read(f))).join('\n')
		assert.doesNotMatch(all, /send to (the )?(screen|wall|output|program)|on air|to air|caspar|amcp|\bPGM\b|\bplayout\b/i)
		assert.doesNotMatch(all, /action:\s*'(screen|output|show|air|program|send)/)
	})

	it('every relative import resolves; kit imports land in the RC client (.js / .mjs / .css)', () => {
		for (const f of code) {
			const s = read(f)
			const specs = [...s.matchAll(/(?:^|\n)\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g), ...s.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1])
			for (const spec of specs) {
				if (spec === 'three' || spec.startsWith('three/addons/')) continue
				assert.ok(spec.startsWith('./'), `${f}: bare import ${spec}`)
				let target
				if (spec.startsWith('./kit/')) {
					const rel = spec.slice(6)
					assert.match(path.extname(rel), /^\.(js|mjs|css)$/, `${f}: kit ${spec}`)
					target = path.join(KIT, rel)
				} else target = path.join(SK, spec)
				assert.ok(fs.existsSync(target), `${f}: ${spec} → ${target}`)
				if (spec.startsWith('./kit/')) {
					// a kit file must not reach the RC API at run time (the game talks to /api/game/sk only)
					const kitSrc = strip(fs.readFileSync(target, 'utf8'))
					assert.ok(!/\/api\/game\/rc|from '\.\/dom\.js'/.test(kitSrc), `${spec} is RC-bound`)
				}
			}
		}
	})

	it('pure modules use neither the DOM nor three', () => {
		for (const f of PURE) {
			const s = strip(read(f))
			assert.doesNotMatch(s, /\b(document|window|navigator|localStorage|sessionStorage|requestAnimationFrame)\b/, f)
			assert.doesNotMatch(s, /from 'three'/, f)
		}
	})

	it('every file ≤ 500 lines; a WO-1081 header in every module', () => {
		for (const f of files) assert.ok(read(f).split('\n').length <= 500, `${f} too long`)
		for (const f of code) assert.match(read(f).slice(0, 600), /WO-1081/, `${f}: header`)
	})
})
