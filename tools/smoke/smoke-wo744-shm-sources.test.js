'use strict'

/**
 * WO-744 — shm rings other processes write become Live-tab sources: GET /api/shm/sources lists valid rings whose writer
 * is alive and is not Caspar, and a layer value `shm://<name>` reaches Caspar as `SHM NAME <name>` (WO-742 producer)
 * through every clip path (LOADBG / PLAY serialization, the raw-send rule, the media-id resolver).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { handle, listShmSources } = require('../../src/api/routes-shm-sources')
const { buildClipCommandPlan, serializeClipCommandPlan } = require('../../src/caspar/amcp-command-plan')
const { resolveClipForAmcpLoad } = require('../../src/media/caspar-cls-id')

/** A ring header (caspar/modules/shm/hshm_abi.h) — only the fields the listing reads. */
function ring(dir, name, { pid = process.pid, w = 1280, h = 720, fps = 50, latest = 0x101n, beat = process.hrtime.bigint(), magic = 'HASCGSHM' } = {}) {
	const b = Buffer.alloc(4096)
	b.write(magic, 0, 'latin1')
	b.writeUInt32LE(1, 8)
	b.writeUInt32LE(w, 16)
	b.writeUInt32LE(h, 20)
	b.writeUInt32LE(fps, 32)
	b.writeUInt32LE(1, 36)
	b.writeBigUInt64LE(BigInt(pid), 88)
	b.writeBigUInt64LE(latest, 96)
	b.writeBigUInt64LE(beat, 104)
	fs.writeFileSync(path.join(dir, `highascg-${name}`), b)
}

describe('WO-744 shm sources', () => {
	it('lists live non-Caspar writers, with signal from the heartbeat', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo744-'))
		try {
			const now = process.hrtime.bigint()
			ring(dir, 'vj', { beat: now })
			ring(dir, 'stale', { beat: now - 2000000000n })
			ring(dir, 'caspar-out', { pid: 424242 })
			ring(dir, 'dead', { pid: 2147483646 })
			ring(dir, 'junk', { magic: 'NOTARING' })
			ring(dir, 'bad.name')
			fs.writeFileSync(path.join(dir, 'other-file'), 'x')
			const fsImpl = { ...fs, readFileSync: (f, enc) => (f === '/proc/424242/comm' ? 'casparcg\n' : fs.readFileSync(f, enc)) }
			const list = listShmSources({ dir, fsImpl, nowNs: now + 1000n })
			assert.deepEqual(list.map((s) => [s.name, s.signal]), [['stale', false], ['vj', true]])
			const vj = list.find((s) => s.name === 'vj')
			assert.deepEqual({ ...vj, writer: typeof vj.writer }, {
				name: 'vj', value: 'shm://vj', width: 1280, height: 720, fps: 50, pid: process.pid, writer: 'string', signal: true,
			})
			assert.deepEqual(listShmSources({ dir: path.join(dir, 'missing') }), [], 'no /dev/shm → no sources')
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})

	it('serves GET /api/shm/sources and nothing else', () => {
		const r = handle('GET', '/api/shm/sources', {}, { dir: '/nonexistent-wo744' })
		assert.equal(r.status, 200)
		assert.deepEqual(JSON.parse(r.body), { ok: true, sources: [] })
		assert.equal(handle('POST', '/api/shm/sources', {}), null)
		assert.equal(handle('GET', '/api/shm/other', {}), null)
	})

	it('a shm:// layer reaches Caspar as SHM NAME <name>', () => {
		const ser = (verb, clip, opts = {}) => serializeClipCommandPlan(buildClipCommandPlan(verb, 1, 20, clip, opts))
		assert.equal(ser('PLAY', 'shm://vj'), 'PLAY 1-20 SHM NAME vj')
		assert.equal(ser('LOADBG', 'shm://vj', { transition: 'MIX', duration: 25, tween: 'linear' }), 'LOADBG 1-20 SHM NAME vj MIX 25 linear')
		assert.equal(ser('PLAY', 'shm://bad name'), 'PLAY 1-20 "shm://bad name"', 'not a plain name: quoted, Caspar refuses it')
		assert.equal(resolveClipForAmcpLoad('shm://vj', {}), 'shm://vj', 'the media resolver keeps it (no SHM:/VJ)')
		const basic = fs.readFileSync(path.join(__dirname, '../../src/caspar/amcp-basic.js'), 'utf8')
		assert.match(basic, /if \(clip\.startsWith\('shm:\/\/'\)\) return true/, 'sent raw, like ndi:// and route://')
		const dispatch = fs.readFileSync(path.join(__dirname, '../../src/api/router-dispatch.js'), 'utf8')
		assert.match(dispatch, /const shm = shmSources\.handle\(method, p, ctx\)/, 'the route is dispatched')
		const fill = fs.readFileSync(path.join(__dirname, '../../src/engine/scene-native-fill.js'), 'utf8')
		assert.match(fill, /if \(\/\^shm:\\\/\\\/\/i\.test\(String\(clipValue\)\.trim\(\)\)\) return null/, 'no CINF for a ring (it went out as CINF SHM:/NAME)')
	})
})
