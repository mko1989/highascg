'use strict'

/**
 * WO-1012 stage C — two-way Zoom audio on a PRIVATE PipeWire daemon.
 *
 * This box runs no sound server on purpose (WO-773: Caspar owns ALSA, DM3 is single-open, no pulse/pipewire/wireplumber
 * daemons). So this does not use a system server: it starts its own `pipewire` (socket `highascg-pw` + a pulse socket
 * `native`, both in $XDG_RUNTIME_DIR/highascg-zoom-audio, never the default `pipewire-0` / `pulse/native`) with no
 * ALSA device monitor, so no hardware node is ever opened. Objects (all static in the generated config):
 *   highascg_zoom_in        Audio/Sink    "HighAsCG Zoom In"   — Zoom's speaker
 *   highascg_zoom_out       Audio/Source  "HighAsCG Zoom Out"  — Zoom's microphone (loopback playback side)
 *   highascg_zoom_out_feed  Audio/Sink    the loopback's capture side the return feed is written into
 * There is no session manager, so a 2 s link tick plays the policy: Zoom's play stream → zoom_in, zoom_out → Zoom's
 * record stream, and our two bridges.
 *   Zoom → HighAsCG: pw-cat records zoom_in's monitor → ffmpeg → mpegts udp://127.0.0.1:52233 (Caspar PLAYs it as audio).
 *   HighAsCG → Zoom: a Caspar STREAM consumer on the chosen feed's channel → raw s16le udp :52232 → pw-cat → zoom_out_feed.
 * Mix-minus: a feed whose channel (or a route:// source of it) plays the Zoom-in URL is refused / removed (echo loop).
 *
 * createZoomAudio(deps) takes injectable exec / spawn / fs / dgram / timers / amcp / feeds for the smoke test.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const dgram = require('dgram')
const { spawn: nodeSpawn, execFile } = require('child_process')
const { promisify } = require('util')
const { loopScreens } = require('../config/screen-channels')
const { getChannelMap } = require('../config/routing-map')
const { amcpInfoText } = require('../streaming/caspar-ffmpeg-setup')
const { buildConf, SINK_IN, SRC_OUT, TAP, FEEDER } = require('./zoom-audio-conf')
const { wantedLinks, portConfigs, portConfigPod } = require('./zoom-audio-links')
const { userScopeArgv } = require('./zoom-launch-env')

const IN_UDP_PORT = 52233
const OUT_UDP_PORT = 52232
const IN_URL = `udp://127.0.0.1:${IN_UDP_PORT}`
const CONSUMER_INDEX = 9277
const LINK_MS = 2000
const addCmd = (ch) =>
	`ADD ${ch}-${CONSUMER_INDEX} STREAM udp://127.0.0.1:${OUT_UDP_PORT}?pkt_size=1316 -vn -codec:a pcm_s16le -ar 48000 -filter:a pan=stereo|c0=c0|c1=c1 -format s16le`
const removeCmd = (ch) => `REMOVE ${ch}-${CONSUMER_INDEX}`

/** Pure: the feeds the return can take — each screen's program and preview channel. */
function defaultFeeds(config) {
	const out = []
	try {
		const map = getChannelMap(config || {})
		for (const d of loopScreens(map).map((i) => i + 1)) {
			// WO-1029 C1b: only the screens on this server feed the return (a hole has no channel here)
			const pg = map.programCh(d)
			if (Number.isInteger(pg) && pg >= 1) out.push({ id: `pgm:${d}`, label: `Screen ${d} program (ch ${pg})`, channel: pg })
			const pv = map.previewCh(d)
			if (Number.isInteger(pv) && pv >= 1) out.push({ id: `prv:${d}`, label: `Screen ${d} preview (ch ${pv})`, channel: pv })
		}
	} catch {
		/* no channel map yet */
	}
	return out
}

function createZoomAudio(deps = {}) {
	const uid = deps.uid ?? (process.getuid ? process.getuid() : 1000)
	const base = deps.runtimeBase || process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`
	const dir = deps.dir || path.join(base, 'highascg-zoom-audio')
	const stateFile = deps.stateFile || path.join(os.homedir(), '.highascg', 'zoom-audio.json')
	const execp = deps.exec || promisify(execFile)
	const spawn = deps.spawn || nodeSpawn
	const fsx = deps.fs || fs
	const makeSocket = deps.createSocket || (() => dgram.createSocket('udp4'))
	const timers = deps.timers || { setInterval, clearInterval }
	const getAmcp = deps.getAmcp || (() => null)
	const getConfig = deps.getConfig || (() => ({}))
	const feedsOf = deps.feeds || defaultFeeds
	const log = deps.log || (() => {})
	const hasBin = deps.hasBin || ((b) => ['/usr/bin', '/usr/local/bin'].some((d) => fsx.existsSync(path.join(d, b))))
	const env = { ...process.env, XDG_RUNTIME_DIR: base, PIPEWIRE_RUNTIME_DIR: dir, PIPEWIRE_REMOTE: 'highascg-pw', PULSE_RUNTIME_PATH: dir }

	let persisted = { enabled: false, feed: '' }
	try {
		persisted = { ...persisted, ...JSON.parse(fsx.readFileSync(stateFile, 'utf8')) }
	} catch {
		/* first run */
	}
	let feedChannel = null // channel the Caspar consumer sits on
	let lastError = ''
	let note = ''
	let linkTimer = null
	let daemonChild = null
	const bridges = { tap: null, feeder: null, sock: null }
	let restored = false

	const save = () => {
		try {
			fsx.mkdirSync(path.dirname(stateFile), { recursive: true })
			fsx.writeFileSync(stateFile, JSON.stringify({ enabled: persisted.enabled, feed: persisted.feed }))
		} catch (e) {
			log('warn', `[zoom-audio] state not saved: ${e.message}`)
		}
	}

	const pw = (bin, args, timeout = 5000) => execp(bin, args, { env, timeout, killSignal: 'SIGKILL', maxBuffer: 8 << 20 })

	/** The graph as {nodes, ports, links} from pw-dump, or null when the private daemon is not answering. */
	async function dump() {
		try {
			const { stdout } = await pw('pw-dump', [])
			const objs = JSON.parse(stdout)
			const pick = (t) => objs.filter((o) => o.type === t)
			return { nodes: pick('PipeWire:Interface:Node'), ports: pick('PipeWire:Interface:Port'), links: pick('PipeWire:Interface:Link') }
		} catch {
			return null
		}
	}
	const hasNode = (g, name) => !!g?.nodes.some((n) => n.info?.props?.['node.name'] === name)

	async function startDaemon() {
		if (await dump()) return true
		fsx.mkdirSync(dir, { recursive: true, mode: 0o700 })
		const conf = path.join(dir, 'pipewire.conf')
		fsx.writeFileSync(conf, buildConf())
		// In its own user scope, like Zoom itself: the unit is KillMode=mixed, so a node restart SIGKILLed this daemon
		// under a Zoom that had streams on it, and Zoom's audio layer then deadlocked its GUI thread for good (10.11,
		// live, gdb: main thread waiting on play_webrtc → pa_threaded_mainloop_wait). The next node adopts it (dump()).
		const cmd = userScopeArgv('pipewire', ['-c', conf], { exists: fsx.existsSync, uid })
		const denv = cmd.scoped ? { ...env, DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uid}/bus` } : env
		daemonChild = spawn(cmd.bin, cmd.args, { env: denv, detached: true, stdio: 'ignore' })
		daemonChild.unref?.()
		daemonChild.on?.('error', (e) => (lastError = `pipewire: ${e.message}`))
		for (let i = 0; i < 20; i++) {
			if (await dump()) return true
			await new Promise((r) => setTimeout(r, 150))
		}
		lastError = lastError || 'private PipeWire daemon did not come up'
		return false
	}

	function stopDaemon() {
		try {
			const pid = parseInt(String(fsx.readFileSync(path.join(dir, 'pid'), 'utf8')).trim(), 10)
			if (pid > 1 && String(fsx.readFileSync(`/proc/${pid}/comm`, 'utf8')).trim() === 'pipewire') process.kill(pid, 'SIGTERM')
		} catch {
			/* not running */
		}
		try {
			daemonChild?.kill?.('SIGTERM')
		} catch {
			/* gone */
		}
		daemonChild = null
	}

	function spawnTap() {
		if (bridges.tap) return
		const rec = spawn('pw-cat', ['--record', '--raw', '--format', 's16', '--rate', '48000', '--channels', '2', '-P', `node.name=${TAP}`, '-P', 'node.autoconnect=false', '-'], { env, stdio: ['ignore', 'pipe', 'ignore'] })
		const ff = spawn('ffmpeg', ['-v', 'error', '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', 'pipe:0', '-c:a', 'mp2', '-b:a', '192k', '-f', 'mpegts', `${IN_URL}?pkt_size=1316`], { env, stdio: ['pipe', 'ignore', 'ignore'] })
		rec.stdout.pipe(ff.stdin)
		ff.stdin.on?.('error', () => {})
		const drop = () => {
			if (bridges.tap?.rec === rec) bridges.tap = null
		}
		rec.on('exit', () => {
			drop()
			try { ff.kill('SIGTERM') } catch { /* gone */ }
		})
		ff.on('exit', () => {
			drop()
			try { rec.kill('SIGTERM') } catch { /* gone */ }
		})
		bridges.tap = { rec, ff }
	}

	function spawnFeeder() {
		if (bridges.feeder) return
		const play = spawn('pw-cat', ['--playback', '--raw', '--format', 's16', '--rate', '48000', '--channels', '2', '-P', `node.name=${FEEDER}`, '-P', 'node.autoconnect=false', '-'], { env, stdio: ['pipe', 'ignore', 'ignore'] })
		const sock = makeSocket()
		sock.on('message', (buf) => {
			try { play.stdin.write(buf) } catch { /* pw-cat gone */ }
		})
		sock.on('error', (e) => (lastError = `return udp: ${e.message}`))
		sock.bind(OUT_UDP_PORT, '127.0.0.1')
		play.stdin.on?.('error', () => {})
		play.on('exit', () => {
			if (bridges.feeder?.play === play) stopFeeder()
		})
		bridges.feeder = { play }
		bridges.sock = sock
	}

	function stopFeeder() {
		try { bridges.sock?.close() } catch { /* closed */ }
		try { bridges.feeder?.play.kill('SIGTERM') } catch { /* gone */ }
		bridges.feeder = null
		bridges.sock = null
	}
	function stopTap() {
		try { bridges.tap?.rec.kill('SIGTERM') } catch { /* gone */ }
		try { bridges.tap?.ff.kill('SIGTERM') } catch { /* gone */ }
		bridges.tap = null
	}

	/** The no-session-manager policy: add the links wantedLinks() says are missing (pw-link by port id). */
	async function linkTick() {
		let g = await dump()
		if (!g) {
			// the daemon is gone (killed, crashed): bring it back, it was never restarted before (10.11, live)
			if (!persisted.enabled || !(await startDaemon())) return
			log('warn', '[zoom-audio] private PipeWire daemon was gone, started again')
			spawnTap()
			g = await dump()
			if (!g) return
		}
		const cfgs = portConfigs(g)
		for (const c of cfgs) await pw('pw-cli', ['s', String(c.id), 'PortConfig', portConfigPod(c)]).catch((e) => log('warn', `[zoom-audio] PortConfig ${c.id}: ${e.message}`))
		if (cfgs.length) g = (await dump()) || g
		for (const [o, i] of wantedLinks(g)) {
			await pw('pw-link', [String(o), String(i)]).catch((e) => log('warn', `[zoom-audio] pw-link ${o} ${i}: ${e.message}`))
		}
	}

	/** True when `channel` (or a route:// source of it, two levels) plays the Zoom-in URL — the echo loop. */
	async function feedHasZoomIn(amcp, channel, depth = 2, seen = new Set()) {
		if (seen.has(channel)) return false
		seen.add(channel)
		let text
		try {
			text = amcpInfoText(await amcp.info(channel))
		} catch {
			return false
		}
		if (text.includes(`:${IN_UDP_PORT}`)) return true
		if (depth <= 0) return false
		for (const m of text.matchAll(/route:\/\/(\d+)/g)) {
			if (await feedHasZoomIn(amcp, parseInt(m[1], 10), depth - 1, seen)) return true
		}
		return false
	}

	async function removeConsumer(amcp, ch) {
		if (!amcp?.isConnected || ch == null) return
		try {
			const text = amcpInfoText(await amcp.info(ch))
			if (text.includes(`port_${CONSUMER_INDEX}`) || text.includes(`:${OUT_UDP_PORT}`)) await amcp.raw(removeCmd(ch))
		} catch {
			/* channel gone */
		}
	}

	/** Make Caspar match persisted.feed: consumer on the feed's channel, never on a channel carrying the Zoom input. */
	async function syncFeed() {
		const amcp = getAmcp()
		const want = feedsOf(getConfig()).find((f) => f.id === persisted.feed)
		const wantCh = want ? want.channel : null
		if (feedChannel != null && feedChannel !== wantCh) {
			await removeConsumer(amcp, feedChannel)
			feedChannel = null
		}
		if (!persisted.enabled || !want) {
			stopFeeder()
			note = persisted.enabled && persisted.feed ? 'Return feed not found in the current channel map' : note
			return
		}
		if (!amcp?.isConnected) {
			note = 'Caspar not connected — the return feed attaches once it is'
			return
		}
		if (await feedHasZoomIn(amcp, wantCh)) {
			await removeConsumer(amcp, wantCh)
			feedChannel = null
			stopFeeder()
			note = `Mix-minus: ${want.label} plays the Zoom input (${IN_URL}), so sending it back would echo. Return muted; pick a feed without it.`
			return
		}
		spawnFeeder()
		const text = amcpInfoText(await amcp.info(wantCh).catch(() => ''))
		if (!text.includes(`port_${CONSUMER_INDEX}`)) await amcp.raw(addCmd(wantCh))
		feedChannel = wantCh
		note = `Return = ${want.label}. Keep the Zoom input (${IN_URL}) off this feed (mix-minus).`
	}

	async function status() {
		const g = await dump()
		const feeds = feedsOf(getConfig()).map(({ id, label }) => ({ id, label }))
		const available = hasBin('pipewire') && hasBin('pw-cat') && hasBin('pw-dump') && hasBin('pw-link')
		if (g && persisted.enabled && persisted.feed) await syncFeed().catch((e) => (lastError = String(e.message || e)))
		return {
			ok: true,
			available,
			enabled: persisted.enabled,
			in: { sink: SINK_IN, present: hasNode(g, SINK_IN), url: IN_URL },
			out: { source: SRC_OUT, present: hasNode(g, SRC_OUT), feed: persisted.feed },
			feeds,
			note: available ? note : 'PipeWire tools are not installed (pipewire-bin: pipewire, pw-cat, pw-dump, pw-link)',
			error: lastError,
			env: zoomEnv(),
		}
	}

	/** Env lines for the Zoom launch: its own pulse socket, sink and source (empty while disabled). */
	function zoomEnv() {
		if (!persisted.enabled) return {}
		return { PULSE_SERVER: `unix:${path.join(dir, 'native')}`, PULSE_SINK: SINK_IN, PULSE_SOURCE: SRC_OUT }
	}

	async function apply(body = {}) {
		lastError = ''
		if (typeof body.feed === 'string') {
			const f = body.feed.trim()
			if (f && !feedsOf(getConfig()).some((x) => x.id === f)) throw new Error(`unknown feed "${f}"`)
			persisted.feed = f
		}
		if (typeof body.enabled === 'boolean') persisted.enabled = body.enabled
		if (persisted.enabled) {
			if (!(await startDaemon())) {
				persisted.enabled = false
				save()
				return status()
			}
			spawnTap()
			if (!linkTimer) {
				linkTimer = timers.setInterval(() => linkTick().catch(() => {}), LINK_MS)
				linkTimer.unref?.()
			}
			await linkTick()
			await syncFeed().catch((e) => (lastError = String(e.message || e)))
			if (!persisted.feed) stopFeeder()
		} else {
			if (linkTimer) timers.clearInterval(linkTimer)
			linkTimer = null
			await removeConsumer(getAmcp(), feedChannel).catch(() => {})
			feedChannel = null
			stopFeeder()
			stopTap()
			stopDaemon()
			note = ''
		}
		save()
		return status()
	}

	/** First call after a node start: bring back what the operator left enabled. */
	async function restore() {
		if (restored) return
		restored = true
		if (persisted.enabled) await apply({}).catch((e) => log('warn', `[zoom-audio] restore: ${e.message}`))
	}

	return { status, apply, restore, zoomEnv, IN_URL }
}

let instance = null
function getZoomAudio(ctx) {
	if (!instance) {
		instance = createZoomAudio({
			getAmcp: () => ctx?.amcp,
			getConfig: () => ctx?.config,
			log: (l, m) => ctx?.log?.(l, m),
		})
	}
	return instance
}

module.exports = { createZoomAudio, getZoomAudio, defaultFeeds }
