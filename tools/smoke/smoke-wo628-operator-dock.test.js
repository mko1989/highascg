'use strict'

/**
 * WO-628 — the Godot client's bottom-centre dock: GET /api/system/dock lists the pinned tools + every other installed
 * app; POST /api/system/dock/launch launches one, or focuses its window when it already runs. No WO-283 kiosk
 * machinery (no session, no ABOVE promotion) — the client is an ordinary window.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { PINNED, SELF_ACTION, dockModel, launchOrFocus } = require('../../src/system/operator-dock')
const routes = require('../../src/api/routes-operator-dock')

function deps(over = {}) {
	const calls = { activate: [], spawn: [] }
	return {
		calls,
		isHelperAction: (a) => a === 'firefox' || a.startsWith('app:'),
		findGuiWindowIds: async () => [],
		activate: async (id) => calls.activate.push(id),
		spawnGuiDetached: (a) => (calls.spawn.push(a), `/usr/bin/${a}`),
		searchByName: async () => ['77'],
		...over,
	}
}

describe('WO-628 dock model', () => {
	it('pins the five curated tools in header order', () => {
		const m = dockModel([])
		assert.deepEqual(
			m.pinned.map((p) => p.action),
			PINNED.map(([a]) => a)
		)
		assert.equal(m.pinned[0].name, 'Web browser')
	})

	it('"more" = installed apps that are not already pinned, by name', () => {
		const m = dockModel([
			{ action: 'app:xterm', name: 'XTerm' },
			{ action: 'app:firefox-esr', name: 'Firefox ESR', pinnedAction: 'firefox' },
			{ action: 'app:org.gnome.FileRoller', name: 'File Roller', comment: 'Archives' },
			null,
		])
		assert.deepEqual(
			m.apps.map((a) => a.name),
			['File Roller', 'XTerm']
		)
		assert.equal(m.apps[0].comment, 'Archives')
		assert.deepEqual(dockModel(undefined).apps, [])
	})
})

describe('WO-628 launch or focus', () => {
	it('refuses anything outside the catalog gate', async () => {
		const d = deps()
		const r = await launchOrFocus('rm -rf /', {}, d)
		assert.equal(r.status, 400)
		assert.equal((await launchOrFocus('', {}, d)).status, 400)
		assert.deepEqual(d.calls.spawn, [])
	})

	it('launches when no window is mapped', async () => {
		const d = deps()
		const r = await launchOrFocus('app:xterm', {}, d)
		assert.equal(r.status, 200)
		assert.equal(r.body.launched, true)
		assert.deepEqual(d.calls.spawn, ['app:xterm'])
		assert.deepEqual(d.calls.activate, [])
	})

	it('focuses the running window instead of a second launch', async () => {
		const d = deps({ findGuiWindowIds: async () => [{ id: '42', name: 'Mozilla Firefox' }] })
		const r = await launchOrFocus('firefox', {}, d)
		assert.equal(r.body.focused, true)
		assert.deepEqual(d.calls.activate, ['42'])
		assert.deepEqual(d.calls.spawn, [])
	})

	it('a profile-lock dialog counts as running (brought forward, never a second Firefox)', async () => {
		const d = deps({ findGuiWindowIds: async () => [{ id: '9', name: 'Close Firefox' }] })
		await launchOrFocus('firefox', {}, d)
		assert.deepEqual(d.calls.activate, ['9'])
		assert.deepEqual(d.calls.spawn, [])
	})

	it('no display / xdotool → still launches', async () => {
		const d = deps({
			findGuiWindowIds: async () => {
				throw new Error('no xdotool')
			},
		})
		assert.equal((await launchOrFocus('firefox', {}, d)).body.launched, true)
	})

	it('a spawn failure is a 500 with the reason', async () => {
		const d = deps({
			spawnGuiDetached: () => {
				throw new Error('not installed')
			},
		})
		const r = await launchOrFocus('app:xterm', {}, d)
		assert.equal(r.status, 500)
		assert.match(r.body.error, /not installed/)
	})

	it('"highascg" brings the operator window back; 404 when it is not found', async () => {
		const d = deps()
		assert.equal((await launchOrFocus(SELF_ACTION, {}, d)).status, 200)
		assert.deepEqual(d.calls.activate, ['77'])
		assert.equal((await launchOrFocus(SELF_ACTION, {}, deps({ searchByName: async () => [] }))).status, 404)
	})
})

describe('WO-628 routes', () => {
	it('GET returns pinned + apps + running', async () => {
		const r = await routes.handleGet({ listApps: () => [], findGuiWindowIds: async () => [] })
		const body = JSON.parse(r.body)
		assert.equal(r.status, 200)
		assert.ok(Array.isArray(body.pinned) && Array.isArray(body.apps))
		assert.deepEqual(body.running, [])
	})

	it('running = pinned tools with a window (a profile-lock dialog counts); lookup errors = not running', async () => {
		const wins = {
			firefox: [{ id: '5', name: 'Close Firefox' }],
			'file-manager': [{ id: '6', name: 'media — Thunar' }],
		}
		const { getDock } = require('../../src/system/operator-dock')
		const d = await getDock({
			listApps: () => [],
			findGuiWindowIds: async (a) => {
				if (a === 'nvidia-settings') throw new Error('no display')
				return wins[a] || []
			},
		})
		assert.deepEqual(d.running, ['firefox', 'file-manager'])
	})

	it('POST is wired into the router', () => {
		const src = require('node:fs').readFileSync(require.resolve('../../src/api/router.js'), 'utf8')
		assert.match(src, /routes\.get\('\/api\/system\/dock'/)
		assert.match(src, /routes\.post\('\/api\/system\/dock\/launch'/)
	})

	/* WO-1077: a dock click that does nothing must leave a trace on both sides */
	it('WO-1077: refused launches are logged; the client logs the press and acts on it', async () => {
		const fs = require('node:fs')
		const path = require('node:path')
		const root = path.join(__dirname, '..', '..')
		const lines = []
		const r = await launchOrFocus('app:not-installed', { log: (lvl, m) => lines.push(`${lvl} ${m}`) }, { isHelperAction: () => false })
		assert.equal(r.status, 400)
		assert.deepEqual(lines, ['warn [dock] app:not-installed: refused — unknown app'])
		const route = fs.readFileSync(path.join(root, 'src', 'api', 'routes-operator-dock.js'), 'utf8')
		assert.match(route, /if \(!pw\.ok\) \{[\s\S]*ctx\.log\('warn', `\[dock\] \$\{[^`]*refused/)
		const gd = fs.readFileSync(path.join(root, 'godot', 'client', 'app', 'operator_dock.gd'), 'utf8')
		const fn = gd.slice(gd.indexOf('func launch(action: String, b: Button)'))
		assert.ok(fn.indexOf('print("[client] dock %s pressed" % action)') < fn.indexOf('await NuclearGate.post'), 'press logged before the request')
		assert.match(gd, /b\.action_mode = BaseButton\.ACTION_MODE_BUTTON_PRESS/)
	})

	/* WO-1079: a node restart SIGKILLs the unit's cgroup (KillMode=mixed) — no dock app may live in it */
	it('WO-1079: every dock app starts in a user scope, not only Zoom and the file manager', () => {
		const fs = require('node:fs')
		const src = fs.readFileSync(require.resolve('../../src/api/system-hardware-gui.js'), 'utf8')
		const body = src.slice(src.indexOf('function spawnGuiDetached('), src.indexOf('const proc = spawn(bin, args, {'))
		assert.match(body, /const launched = bin\n\t\{\n\t\tconst cmd = require\('\.\.\/zoom\/zoom-launch-env'\)\.userScopeArgv\(bin, args\)/)
		assert.doesNotMatch(body, /if \(action === 'file-manager' \|\|/, 'the scope is not conditional on the app')
		const { userScopeArgv } = require('../../src/zoom/zoom-launch-env')
		const ff = '/usr/local/lib/highascg/highascg-launch-operator-firefox.sh'
		assert.deepEqual(userScopeArgv(ff, ['about:blank'], { exists: () => true, uid: 1000 }), {
			bin: '/usr/bin/systemd-run',
			args: ['--user', '--scope', '--collect', '--quiet', '--', ff, 'about:blank'],
			scoped: true,
		})
	})
})
