'use strict'

/**
 * WO-453 — simulator parity: AmcpSimulated answers real shapes and the sim OSC
 * feeder drives the production OscState pipeline.
 *
 * Guards the three legs that made `--no-caspar` a dead shell before WO-453:
 *  1. query commands return populated, correctly-shaped data (INFO list lines,
 *     INFO CONFIG XML from the config generator, INFO <ch> stage XML, CLS lines),
 *  2. playout commands mutate SimPlaybackState (play/pause freeze/stop/loop),
 *  3. sim-osc-feeder reports that state through OscState.handleOscMessage — incl.
 *     the LOADBG AUTO handoff playlist advance keys off.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { AmcpClient } = require('../../src/caspar/amcp-client')
const { startSimOscFeeder } = require('../../src/caspar/sim-osc-feeder')

const ROOT = path.resolve(__dirname, '..', '..')

function makeOfflineAmcp() {
	// screen_count/mode present so the config generator emits a real channel plan —
	// the sim derives INFO/INFO CONFIG from the same generator a live Apply uses.
	const config = { offline_mode: true, amcp_batch: false, screen_count: 1, casparServer: { screen_count: 1, screen_1_mode: '1080p5000' } }
	const ctx = { socket: { isConnected: false }, config, response_callback: {} }
	return new AmcpClient(ctx)
}

describe('WO-453 sim parity', () => {
	it('INFO returns one status line per generated-config channel; INFO CONFIG returns generator XML', async () => {
		const amcp = makeOfflineAmcp()
		const info = await amcp._send('INFO', 'INFO')
		assert.ok(Array.isArray(info.data) && info.data.length >= 1, 'INFO must list channels')
		assert.match(info.data[0], /^1 \S+ PLAYING$/)
		const cfg = await amcp.query.infoConfig()
		assert.match(String(cfg.data), /<configuration>/, 'INFO CONFIG must be the generator XML')
		// Channel blocks only exist once outputs are cabled (generator rule); with a plan
		// present the INFO list must mirror it, without one the sim falls back to 1 channel.
		const planned = (String(cfg.data).match(/<video-mode>/g) || []).length
		assert.equal(info.data.length, planned > 0 ? planned : 1, 'INFO channel count must mirror the generated plan (or the 1-channel fallback)')
	})

	it('empty/whitespace command does not throw (stub crashed on it)', async () => {
		const amcp = makeOfflineAmcp()
		const res = await amcp._send('   ', 'X')
		assert.equal(res.ok, true)
	})

	it('PLAY→INFO <ch> stage XML; PAUSE freezes elapsed; STOP empties; CALL LOOP flips loop', async () => {
		const amcp = makeOfflineAmcp()
		const sim = amcp._simulated
		await amcp._send('PLAY 1-10 "SOMECLIP" LOOP', 'PLAY')
		const xml = String((await amcp._send('INFO 1', 'INFO')).data)
		assert.match(xml, /<layer_10>/)
		assert.match(xml, /<name>SOMECLIP<\/name>/)
		assert.match(xml, /<loop>true<\/loop>/)
		assert.match(xml, /<producer>ffmpeg<\/producer>/)

		await amcp._send('PAUSE 1-10', 'PAUSE')
		const cell = sim.state.channels.get(1).get(10)
		const e1 = sim.state.elapsedOf(cell)
		await new Promise((r) => setTimeout(r, 60))
		assert.equal(sim.state.elapsedOf(cell), e1, 'paused elapsed must freeze')

		await amcp._send('CALL 1-10 LOOP 0', 'CALL')
		assert.equal(cell.fg.loop, false)
		await amcp._send('STOP 1-10', 'STOP')
		assert.equal(cell.fg, null)
	})

	it('CLS/CINF read the real media scan shape; DATA round-trips', async () => {
		const amcp = makeOfflineAmcp()
		const cls = await amcp._send('CLS', 'CLS')
		assert.ok(Array.isArray(cls.data), 'CLS must be a line array')
		for (const line of cls.data.slice(0, 3)) {
			assert.match(line, /^"[^"]+" (MOVIE|STILL|AUDIO) \d+ \d{14} \d+ 1\/25$/, `CLS line shape: ${line}`)
		}
		await amcp._send('DATA STORE "wo453key" "payload"', 'DATA')
		const got = await amcp._send('DATA RETRIEVE "wo453key"', 'DATA')
		assert.equal(got.data, 'payload')
		const list = await amcp._send('DATA LIST', 'DATA')
		assert.ok(list.data.includes('wo453key'))
	})

	it('sim-osc-feeder: PLAY reaches OscState addresses; natural end promotes LOADBG AUTO (playlist handoff)', async () => {
		process.env.HIGHASCG_SIM_CLIP_SEC = '0.4'
		try {
			const amcp = makeOfflineAmcp()
			/** @type {Array<{address: string, args: unknown[]}>} */
			const seen = []
			const appCtx = {
				amcp,
				oscState: { handleOscMessage: (p) => seen.push(p) },
				log: () => {},
			}
			await amcp._send('PLAY 1-10 "FIRST"', 'PLAY')
			await amcp._send('LOADBG 1-10 "SECOND" AUTO', 'LOADBG')
			const stop = startSimOscFeeder(appCtx)
			try {
				await new Promise((r) => setTimeout(r, 250))
				const nameMsgs = seen.filter((p) => p.address === '/channel/1/stage/layer/10/foreground/file/name')
				assert.ok(nameMsgs.some((p) => p.args[0] === 'FIRST'), 'feeder must report the playing clip')
				const timeMsg = seen.find((p) => p.address === '/channel/1/stage/layer/10/foreground/file/time')
				assert.ok(timeMsg && timeMsg.args.length === 2, 'file/time carries [elapsed, duration]')
				await new Promise((r) => setTimeout(r, 600))
				const names = seen.filter((p) => p.address === '/channel/1/stage/layer/10/foreground/file/name').map((p) => p.args[0])
				assert.ok(names.includes('SECOND'), 'AUTO background must promote at natural end (advance detection keys off the name change)')
			} finally {
				stop()
			}
		} finally {
			delete process.env.HIGHASCG_SIM_CLIP_SEC
		}
	})

	it('source guards: index.js constructs ConnectionManager unconditionally and forces offline under --no-caspar', () => {
		const src = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8')
		assert.match(src, /if \(cli\.noCaspar\) process\.env\.HIGHASCG_OFFLINE_MODE = '1'/, '--no-caspar must force offline_mode')
		assert.ok(!/if \(!cli\.noCaspar\) \{\s*\n\s*const hMs/.test(src), 'ConnectionManager construction must not be gated on --no-caspar')
		assert.match(src, /startSimOscFeeder/, 'sim OSC feeder must be wired')
		const qc = fs.readFileSync(path.join(ROOT, 'src/utils/query-cycle.js'), 'utf8')
		assert.match(qc, /ctx\.amcp\?\.isOffline/, 'query cycle must run offline')
	})
})
