'use strict'

/**
 * WO-1105 — Settings ▸ Games, the pieces under the pane: the join address (several interfaces → the operator picks; a
 * VPN- or loopback-only box is warned about), the QR matrix (the games' own encoder, hex rows that decode back to the
 * very modules the encoder made — the same rows the join_qr template and the Godot dialog draw), and the persisted
 * `games` settings through POST /api/settings — the hand-listed newConfig (WO-619 / WO-1093 trap) — surviving a
 * "restart" (a fresh ConfigManager reading the saved modular config directory).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')

const J = require('../../src/games/games-join')
const Q = require('../../src/games/games-qr')
const GS = require('../../src/games/games-settings')
const { handlePost } = require('../../src/api/settings-post')
const { ConfigManager } = require('../../src/config/config-manager')
const defaults = require('../../src/config/defaults')

const ROOT = path.join(__dirname, '../..')
const NETS = {
	lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
	tailscale0: [{ address: '100.101.245.97', family: 'IPv4', internal: false }],
	eno1: [{ address: '192.168.0.15', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }],
	wlan0: [{ address: '10.0.0.7', family: 'IPv4', internal: false }],
}

test('listAddresses: every IPv4 with its interface and kind, LAN first (by address), then VPN, then loopback', () => {
	assert.deepEqual(J.listAddresses(NETS), [
		{ ip: '10.0.0.7', iface: 'wlan0', kind: 'lan' },
		{ ip: '192.168.0.15', iface: 'eno1', kind: 'lan' },
		{ ip: '100.101.245.97', iface: 'tailscale0', kind: 'vpn' },
		{ ip: '127.0.0.1', iface: 'lo', kind: 'loopback' },
	])
	assert.equal(J.kindOf('10.8.0.2', 'wg0', false), 'vpn', 'a WireGuard interface is a VPN whatever its address')
})

test('pickAddress: automatic = the games’ own first choice; an IP or an interface name; a gone one falls back, said', () => {
	const a = J.listAddresses(NETS)
	assert.deepEqual(J.pickAddress(a, ''), { ip: '10.0.0.7', iface: 'wlan0', kind: 'lan', auto: true, warning: '' })
	// the games: getLanIPv4Addresses() sorted, 100.64/10 last → the same first address
	const games = ['10.0.0.7', '100.101.245.97', '192.168.0.15'].sort((x, y) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(x) - /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(y))
	assert.equal(games[0], J.pickAddress(a, '').ip)
	assert.equal(J.pickAddress(a, '192.168.0.15').ip, '192.168.0.15')
	assert.equal(J.pickAddress(a, 'eno1').ip, '192.168.0.15', 'by interface name')
	const gone = J.pickAddress(a, '192.168.9.9')
	assert.equal(gone.ip, '10.0.0.7')
	assert.equal(gone.auto, true)
	assert.match(gone.warning, /192\.168\.9\.9 is not on this box/)
	const vpnOnly = J.pickAddress(J.listAddresses({ lo: NETS.lo, tailscale0: NETS.tailscale0 }), '')
	assert.equal(vpnOnly.ip, '100.101.245.97')
	assert.match(vpnOnly.warning, /VPN address: only phones on that VPN can join/)
	const none = J.pickAddress(J.listAddresses({ lo: NETS.lo }), '')
	assert.equal(none.ip, null)
	assert.match(none.warning, /No network address/)
	assert.match(J.pickAddress(J.listAddresses({ lo: NETS.lo }), '127.0.0.1').warning, /Only this box/)
	assert.equal(J.joinUrl('192.168.0.15', 4200, '/game/world/'), 'http://192.168.0.15:4200/game/world/')
	assert.equal(J.joinUrl(null, 4200, '/game/world/'), null)
})

test('qrRows: the games’ encoder (same file as the RC kit), hex rows decode back to its modules exactly', async () => {
	const a = fs.readFileSync(path.join(ROOT, 'src/games/vendor/qrcode-generator.mjs'))
	const b = fs.readFileSync(path.join(ROOT, 'modules/rc-game/client/vendor/qrcode-generator.mjs'))
	assert.ok(a.equals(b), 'the core copy is the vendored file, unchanged')
	const text = 'http://192.168.0.15:4200/game/world/'
	const q = await Q.qrRows(text)
	assert.equal(q.text, text)
	assert.equal(q.n, 29, 'version 3 at error correction M')
	assert.equal(q.rows.length, q.n)
	assert.ok(q.rows.every((r) => r.length === Math.ceil(q.n / 4) && /^[0-9a-f]+$/.test(r)))
	const qrcode = (await import(pathToFileURL(path.join(ROOT, 'modules/rc-game/client/vendor/qrcode-generator.mjs')).href)).default
	const ref = qrcode(0, 'M')
	ref.addData(text, 'Byte')
	ref.make()
	const m = Q.rowsToMatrix(q.n, q.rows)
	for (let r = 0; r < q.n; r++) for (let c = 0; c < q.n; c++) assert.equal(m[r][c], ref.isDark(r, c), `module ${r},${c}`)
	assert.equal(await Q.qrRows(''), null)
	assert.equal(await Q.qrRows(text), q, 'cached')
})

test('join_qr template: draws the same bits (top bit first) and only a complete payload', () => {
	const src = fs.readFileSync(path.join(ROOT, 'template/join_qr.html'), 'utf8')
	assert.match(src, /var d = parseInt\(h\.charAt\(col >> 2\), 16\) \|\| 0/)
	assert.match(src, /if \(\(d >> \(3 - \(col & 3\)\)\) & 1\) g\.fillRect/)
	assert.match(src, /if \(n < 21 \|\| n > 177 \|\| !Array\.isArray\(o\.rows\) \|\| o\.rows\.length !== n\) return/)
	assert.match(src, /background: transparent/, 'transparent around the card')
	assert.ok(!/<script src=/.test(src), 'no external script: the matrix comes in the CG data')
})

test('games settings: normalized (unknown keys, bad ids and values dropped), merged per game and key', () => {
	assert.deepEqual(GS.normalizeGamesSettings(undefined), { joinAddress: '', autoOpen: false, defaults: {} })
	assert.deepEqual(GS.normalizeGamesSettings({ joinAddress: ' eno1 ', autoOpen: 'yes', junk: 1,
		defaults: { rc: { bots: 3, botLevel: 'hard', main: '5', affect: 'soft', x: 1 }, 'Bad Id': { bots: 1 }, sk: { bots: -1, botLevel: 'mad', main: null } } }),
	{ joinAddress: 'eno1', autoOpen: false, defaults: { rc: { bots: 3, botLevel: 'hard', main: 5, affect: 'soft' }, sk: {} } })
	assert.equal(GS.normalizeGamesSettings({ joinAddress: 'a b;rm' }).joinAddress, '', 'never a shell-ish string')
	assert.equal(GS.normalizeGamesSettings({ defaults: { rc: { bots: 99 } } }).defaults.rc.bots, 32)
	const cur = { joinAddress: '', autoOpen: false, defaults: { rc: { bots: 2, main: 4 } } }
	assert.deepEqual(GS.mergeGamesSettings(cur, { defaults: { rc: { botLevel: 'easy' }, salad: { main: 120 } } }).defaults,
		{ rc: { bots: 2, main: 4, botLevel: 'easy' }, salad: { main: 120 } })
	assert.deepEqual(GS.mergeGamesSettings(cur, { defaults: { rc: { main: null } } }).defaults.rc, { bots: 2 }, 'null resets to the game’s own')
	assert.deepEqual(defaults.games, { joinAddress: '', autoOpen: false, defaults: {} }, 'factory default: automatic, never auto-open')
})

test('POST /api/settings {games}: in the hand-listed newConfig, saved to the config dir, read back after a restart', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1105-cfg-'))
	try {
		fs.writeFileSync(path.join(dir, 'general.json'), '{}')
		const quiet = { info() {}, warn() {}, error() {}, debug() {} }
		const cm = new ConfigManager(dir, quiet)
		cm.load()
		const ctx = { config: { streaming: {}, ...cm.get() }, configManager: cm, log: () => {} } // streaming: as WO-1093's smoke (the live config always has it)
		const games = { joinAddress: '192.168.0.15', autoOpen: true, defaults: { rc: { bots: 3, botLevel: 'hard', main: 5 }, world: {} } }
		const res = await handlePost('/api/settings', JSON.stringify({ games }), ctx)
		assert.equal(res.status, 200, String(res.body))
		await ConfigManager._saveChain
		assert.deepEqual(ctx.config.games, { joinAddress: '192.168.0.15', autoOpen: true, defaults: { rc: { bots: 3, botLevel: 'hard', main: 5 }, world: {} } })
		// an unrelated section saved later (the web modal re-posts everything) keeps the games section
		const res2 = await handlePost('/api/settings', JSON.stringify({ startup: { mode: 'gui' } }), ctx)
		assert.equal(res2.status, 200)
		await ConfigManager._saveChain
		const cm2 = new ConfigManager(dir, quiet) // the node restart
		cm2.load()
		assert.deepEqual(cm2.get().games, ctx.config.games, 'the games section survives a restart')
		assert.equal(cm2.get().startup.mode, 'gui')
		const got = await require('../../src/api/settings-get').handleGet('/api/settings', { config: cm2.get() })
		assert.deepEqual(JSON.parse(got.body).games, ctx.config.games, 'GET /api/settings carries it (the Godot Settings autoload reads it there)')
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})
