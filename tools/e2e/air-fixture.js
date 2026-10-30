'use strict'

/**
 * WO-836 part 3 — a THROWAWAY real CasparCG for the release suite's "on air" checks (PRINT). Its own Xvfb display, its own
 * AMCP port, its own scratch folders; two channels (1 = PGM, 2 = PRV, the order the sandbox's seeded PGM/PRV screen maps to),
 * no screen / audio consumers. Never the box's Caspar on :5250: the port is refused, every child is killed by PID.
 *
 *   const air = await startAir({ root, mediaDir })   // → { host, port, mode, width, height, stop() }
 *
 * The Caspar media folder IS `mediaDir` (the sandbox's), so the clips the GUI drags in are the ones Caspar plays, and
 * `PRINT` lands its PNG there (tools/test-agent/lib/amcp.js knows how to pick it up).
 */

const { spawn } = require('child_process')
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 720p keeps the software-GL cost down; the sandbox destination (see airSandboxConfig) is declared to match. */
const MODE = { name: '720p2500', width: 1280, height: 720, fps: 25 }

function findCaspar() {
	return [process.env.CASPAR_BIN, path.join(REPO_ROOT, 'bin/casparcg')].find((c) => c && fs.existsSync(c))
}

function freePort() {
	return new Promise((resolve, reject) => {
		const s = net.createServer()
		s.once('error', reject)
		s.listen(0, '127.0.0.1', () => {
			const { port } = s.address()
			s.close(() => resolve(port))
		})
	})
}

function canConnect(port) {
	return new Promise((resolve) => {
		const s = net.connect(port, '127.0.0.1')
		s.once('connect', () => (s.destroy(), resolve(true)))
		s.once('error', () => resolve(false))
	})
}

/** Config overrides that make the sandbox's channel map match the throwaway Caspar (one PGM/PRV screen, MODE). */
function airSandboxConfig(root) {
	return {
		casparServer: { configPath: path.join(root, 'casparcg.config'), screen_count: 1, screen_1_mode: MODE.name },
		screenDestinations: { version: 1, destinations: [{ id: 'dst_air_pgm1', label: 'PGM/PRV 1', mainScreenIndex: 0, mode: 'pgm_prv',
			videoMode: MODE.name, width: MODE.width, height: MODE.height, fps: MODE.fps, caspar: { bus: 'pgm' } }] },
	}
}

async function startAir({ root, mediaDir, log = () => {} }) {
	const bin = findCaspar()
	if (!bin) throw new Error('casparcg binary not found (set CASPAR_BIN=/path/casparcg)')
	const port = await freePort()
	if (port === 5250) throw new Error('refusing the live AMCP port')
	const work = path.join(root, 'air')
	for (const d of ['log', 'data', 'template', 'cef-cache']) fs.mkdirSync(path.join(work, d), { recursive: true })
	fs.mkdirSync(mediaDir, { recursive: true })
	const channel = (n) => `        <channel>
            <video-mode>${MODE.name}</video-mode>
            <consumers/>
        </channel><!-- ${n} -->`
	fs.writeFileSync(path.join(work, 'casparcg.config'), `<configuration>
    <paths><media-path>${mediaDir}/</media-path><log-path>${work}/log/</log-path><data-path>${work}/data/</data-path><template-path>${work}/template/</template-path></paths>
    <log-level>info</log-level>
    <channels>
${channel('PGM')}
${channel('PRV')}
    </channels>
    <controllers><tcp><port>${port}</port><protocol>AMCP</protocol></tcp></controllers>
    <html><cache-path>${work}/cef-cache</cache-path></html>
    <amcp><media-server><host>127.0.0.1</host><port>9</port></media-server></amcp>
</configuration>\n`)
	const kids = []
	const spawnKid = (cmd, args, opts = {}) => {
		const c = spawn(cmd, args, { stdio: ['ignore', opts.out ?? 'ignore', opts.out ?? 'ignore'], ...opts })
		kids.push(c)
		return c
	}
	const display = `:${400 + (process.pid % 300)}`
	spawnKid('Xvfb', [display, '-screen', '0', '1280x720x24', '-nolisten', 'tcp'])
	await sleep(1000)
	const out = fs.openSync(path.join(work, 'caspar.out'), 'a')
	const env = { ...process.env, DISPLAY: display, XAUTHORITY: '/nonexistent', LD_LIBRARY_PATH: path.join(REPO_ROOT, 'lib') }
	delete env.LD_PRELOAD
	const caspar = spawnKid(bin, [path.join(work, 'casparcg.config')], { cwd: work, env, out })
	const stop = async () => {
		for (const c of kids.reverse()) if (c.exitCode === null) c.kill('SIGTERM')
		await sleep(600)
		for (const c of kids) if (c.exitCode === null) c.kill('SIGKILL')
	}
	const until = Date.now() + 40000
	while (Date.now() < until && caspar.exitCode === null && !(await canConnect(port))) await sleep(400)
	if (caspar.exitCode !== null || !(await canConnect(port))) {
		await stop()
		const tail = fs.readFileSync(path.join(work, 'caspar.out'), 'utf8').trim().split('\n').slice(-10).join('\n')
		throw new Error(`throwaway Caspar did not come up on :${port} (exit ${caspar.exitCode})\n${tail}`)
	}
	log(`throwaway Caspar :${port} (pid ${caspar.pid}, ${MODE.name} x2, Xvfb ${display}, media ${mediaDir})`)
	return { host: '127.0.0.1', port, mode: MODE.name, width: MODE.width, height: MODE.height, pid: caspar.pid, stop, tmp: os.tmpdir() }
}

module.exports = { startAir, airSandboxConfig, MODE }
