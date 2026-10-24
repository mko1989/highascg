'use strict'

/**
 * WO-744 — end to end on the operator path: a ring writer → GET /api/shm/sources lists it → a look whose layer is
 * `shm://<name>` is TAKEN on a sandbox HighAsCG server driving a throwaway real Caspar (WO-742 producer built in) →
 * the Caspar channel's WO-594 shm consumer shows the writer's pixels. Nothing touches the box's own server or Caspar:
 * own Xvfb display, AMCP port, scratch root (tools/e2e/sandbox-server.js), every child killed by PID.
 *   node tools/e2e/shm-source-take.js <path/to/casparcg>          exit 0 = pass
 */

const { spawn, execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { startSandbox } = require('./sandbox-server')

const ROOT = path.resolve(__dirname, '../..')
const BIN = process.argv[2]
const AMCP_PORT = Number(process.env.WO744_AMCP_PORT || 5297)
const IN = `wo744-in-${process.pid}`
const OUT = `wo744-out-${process.pid}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
	if (!BIN) throw new Error('usage: node tools/e2e/shm-source-take.js <path/to/casparcg>')
	const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wo744-'))
	const kids = []
	const run = (cmd, args, opts = {}) => {
		const c = spawn(cmd, args, { stdio: ['ignore', opts.out ?? 'ignore', opts.out ?? 'ignore'], ...opts })
		kids.push(c)
		return c
	}
	let sb
	try {
		const pattern = path.join(work, 'hshm_pattern')
		execFileSync('c++', ['-std=c++17', '-O2', path.join(ROOT, 'caspar/modules/shm/tests/hshm_pattern.cpp'), '-o', pattern, '-lrt'])
		const px = (name, ...xy) => execFileSync(pattern, ['read', name, ...xy.map(String)], { encoding: 'utf8' })
		run(pattern, ['write', IN, '640', '360', '60'])

		const caspar = path.join(work, 'caspar')
		for (const d of ['media', 'log', 'data', 'template']) fs.mkdirSync(path.join(caspar, d), { recursive: true })
		fs.writeFileSync(path.join(caspar, 'casparcg.config'), `<configuration>
    <paths><media-path>media/</media-path><log-path>log/</log-path><data-path>data/</data-path><template-path>template/</template-path></paths>
    <channels><channel><video-mode>720p5000</video-mode><consumers><shm><name>${OUT}</name></shm></consumers></channel></channels>
    <controllers><tcp><port>${AMCP_PORT}</port><protocol>AMCP</protocol></tcp></controllers>
    <html><cache-path>${caspar}/cef-cache</cache-path></html>
    <amcp><media-server><host>127.0.0.1</host><port>9</port></media-server></amcp>
</configuration>\n`)
		// media-server → a dead port: the default (localhost:8000) is the box's own media scanner, which the sandbox
		// server's library scan would otherwise query through this Caspar.
		const disp = `:${200 + (process.pid % 300)}`
		run('Xvfb', [disp, '-screen', '0', '1280x720x24', '-nolisten', 'tcp'])
		await sleep(1000)
		const casparLog = fs.openSync(path.join(work, 'caspar.out'), 'a')
		run(BIN, [path.join(caspar, 'casparcg.config')], { cwd: caspar, env: { ...process.env, DISPLAY: disp }, out: casparLog })

		sb = await startSandbox({ root: path.join(work, 'sandbox'), media: false, caspar: { host: '127.0.0.1', port: AMCP_PORT } })
		const j = async (p, body) => {
			const r = await fetch(sb.url + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
			return { status: r.status, body: await r.json().catch(() => null) }
		}

		const list = (await j('/api/shm/sources')).body
		const src = (list?.sources || []).find((s) => s.name === IN)
		if (!src || !src.signal || src.width !== 640) throw new Error(`/api/shm/sources: ${JSON.stringify(list)}`)
		console.log(`/api/shm/sources → ${JSON.stringify(src)}`)

		const scene = {
			id: 'wo744_look',
			name: 'WO-744',
			layers: [{ layerNumber: 10, source: { type: 'shm', value: src.value, label: src.name }, fill: { x: 0, y: 0, scaleX: 1, scaleY: 1 }, opacity: 1 }],
		}
		let take
		for (let i = 0; i < 30; i++) { // the sandbox connects to Caspar a moment after it answers HTTP
			take = await j('/api/scene/take', { channel: 1, incomingScene: scene, transition: { type: 'CUT', duration: 0 } })
			if (take.status !== 503) break
			await sleep(500)
		}
		console.log(`take → ${take.status} ${JSON.stringify(take.body).slice(0, 200)}`)
		if (take.status !== 200) throw new Error('take refused')
		await sleep(1500)
		const out = px(OUT, 320, 360, 960, 360)
		console.log(out.trim())
		if (!/^320,360 10 80 f0 ff$/m.test(out)) throw new Error('the writer\'s pixels are not on the channel')
		if (!/^960,360 00 00 00 00$/m.test(out)) throw new Error('transparency lost')
		console.log('PASS')
	} finally {
		if (sb) await sb.stop()
		for (const c of kids.reverse()) if (c.exitCode === null) c.kill('SIGTERM')
		await sleep(500)
		for (const f of [IN, OUT]) fs.rmSync(`/dev/shm/highascg-${f}`, { force: true })
		if (process.env.WO744_KEEP) console.log('kept', work)
		else fs.rmSync(work, { recursive: true, force: true })
	}
}

main().catch((e) => {
	console.error('FAIL:', e.message)
	process.exit(1)
})
