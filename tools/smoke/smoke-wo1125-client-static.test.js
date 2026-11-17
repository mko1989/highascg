'use strict'

/**
 * WO-1125 — static rules of the self-service client side (source text): every game page links the kit's ctl-panel.css
 * and mounts the session panel in its lobby; the panel / spec / world-link files obey the games' URL rules (no world API
 * URL in a game file: the one world request lives in game-world/client/game-link.js); protocol decodes `ctl`; the
 * landing is the world picture behind collapsible cards; line limits.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const MOD = path.join(__dirname, '..', '..', 'modules')
const read = (g, f) => fs.readFileSync(path.join(MOD, g, 'client', f), 'utf8')
const GAMES = [['rc-game', 'rc', ''], ['toy-skirmish', 'sk', 'kit/'], ['stage-salad', 'salad', 'kit/']]

describe('WO-1125 game pages', () => {
	for (const [g, id, kit] of GAMES) {
		it(`${g}: css link, session panel mounted in the lobby slot, ctl decoded and routed, World link in the toolbar`, () => {
			assert.match(read(g, 'index.html'), new RegExp(`<link rel="stylesheet" href="/game/${id}/${kit}ctl-panel\\.css" />`))
			const game = read(g, 'game.js')
			assert.match(game, /createSessionPanel\(G, G\.lobby\.slot\)/)
			assert.match(game, /if \(!spectator\) toolbar\.push\(\{ el: worldLinkEl\(\) \}\)/)
			assert.match(read(g, 'lobby.js'), /slot: sessionSlot/)
			assert.match(read(g, 'protocol.js'), /case 'ctl':/)
			const sess = read(g, 'session.js')
			assert.match(sess, /G\.sess\?\.update\(state\)/)
			assert.match(sess, /case 'ctl':\s*\n\s*G\.sess\?\.refuse\(m\)/)
			const panel = read(g, 'session-panel.js')
			assert.match(panel, new RegExp(`from '\\./${kit}ctl-panel\\.js'`))
			assert.match(panel, new RegExp(`from '\\./${kit}world-link\\.js'`))
		})
		it(`${g}: the spec is pure (no imports, no DOM, no URL) and reads state.self`, () => {
			const s = read(g, 'session-spec.js').replace(/\/\*[\s\S]*?\*\//g, '')
			assert.doesNotMatch(s, /^\s*import\s|\bdocument\b|\bwindow\b|\/api\/|\/game\//m)
			assert.match(s, /st\?\.self === true/)
		})
	}
	it('kit files: no game API, no world API URL, world helper reached by a computed import only', () => {
		const panel = read('rc-game', 'ctl-panel.js')
		assert.doesNotMatch(panel, /\bdocument\b|\bwindow\b|\/api\/|from '\.\/dom\.js'/)
		const link = read('rc-game', 'world-link.js').replace(/\/\*[\s\S]*?\*\//g, '')
		assert.doesNotMatch(link, /\/api\/|from '\.\/dom\.js'|\bfetch\(/)
		assert.match(link, /const HELPER = '\/game\/world\/game-link\.js'/)
		assert.match(link, /const u = HELPER\n\t\tasked = import\(u\)/)
		assert.match(read('game-world', 'game-link.js'), /getState/)
	})
	it('no user text through HTML parsing in the new files', () => {
		for (const [g] of GAMES) for (const f of ['session-panel.js', 'session-spec.js']) assert.doesNotMatch(read(g, f), /innerHTML|insertAdjacentHTML/)
		assert.doesNotMatch(read('rc-game', 'ctl-panel.js'), /innerHTML|insertAdjacentHTML/)
	})
	it('every touched file keeps the 500-line limit', () => {
		for (const [g] of GAMES) for (const f of ['game.js', 'session.js', 'lobby.js', 'protocol.js', 'net.js', 'session-panel.js', 'session-spec.js'])
			assert.ok(read(g, f).split('\n').length <= 500, `${g}/${f}`)
		for (const f of ['world-landing.js', 'world.css', 'game-link.js']) assert.ok(read('game-world', f).split('\n').length <= 500, f)
	})
})

describe('WO-1125 world landing', () => {
	const landing = read('game-world', 'world-landing.js')
	it('background = world-spectate behind the cards; failure keeps the cards; collapsible; closed card text', () => {
		assert.match(landing, /import\('\.\/world-spectate\.js'\)/)
		assert.match(landing, /catch \{[\s\S]*canvas\.hidden = true/)
		assert.match(landing, /'Closed by the host'/)
		assert.match(landing, /text: 'Games'/)
		assert.match(landing, /collapse\(true\)/)
	})
	it('spectate / host modes untouched in world.js', () => {
		const w = read('game-world', 'world.js')
		assert.match(w, /else if \(mode === 'spectate'\) await \(await import\('\.\/world-spectate\.js'\)\)\.startSpectate\(root\)/)
		assert.match(w, /startHost\(root\)/)
	})
})
