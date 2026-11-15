#!/usr/bin/env node
'use strict'

/**
 * WO-1081 — Stage Skirmish dev server (work/notes/skirmish-game-contract.md §10): the game without the live server.
 * A stand-alone HTTP server on 127.0.0.1 ONLY (default port 4310) that mounts only the toy-skirmish module (its
 * routes, static files incl. the /game/sk/kit/ alias to the rc-game client and /vendor/three/, and its socket) through
 * a small fake module host. No API password, no Caspar, no OSC, no Art-Net socket, no shm lease, no write outside
 * ~/.highascg/cache/rc-game (the RC scene baker's shared cache).
 *
 * The scene: the active project is read ONCE per 30 s with a read-only `GET http://127.0.0.1:4200/api/project` (the live
 * server's own copy; never a project file read here — the core's project loader can migrate / re-point files) and the
 * MVR store read-only; when either is unavailable (or with --empty) the RC baker's default empty hall is used.
 * A session is enabled at start; then --arena / --mode / --bots are applied as host actions once the arenas exist.
 *
 *   node tools/dev/skirmish-dev-server.js [--port 4310] [--arena <id>] [--mode dm|tdm] [--bots n] [--fake-lights] [--empty]
 *
 *   --fake-lights  a synthetic rig of moving heads over every arena (a slow sweeping pattern, cycling colours) instead
 *                  of the real follow service; without it the game has no lights (state.lights false).
 * LED walls: the project's screens are listed in the scene JSON (so the client can place them) but no pictures are
 * sent (no video feed here). Host actions: POST /api/game/sk/host (no auth). Stop with Ctrl-C / SIGTERM.
 */

const http = require('http')
const path = require('path')
const { URL } = require('url')

const ROOT = path.join(__dirname, '..', '..')
const MOD = path.join(ROOT, 'modules', 'toy-skirmish')

function args(argv) {
	const o = { port: 4310, arena: null, mode: null, bots: null, fakeLights: false, empty: false }
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		if (a === '--port') o.port = Number(argv[++i])
		else if (a === '--arena') o.arena = String(argv[++i])
		else if (a === '--mode') o.mode = String(argv[++i])
		else if (a === '--bots') o.bots = Number(argv[++i])
		else if (a === '--fake-lights') o.fakeLights = true
		else if (a === '--empty') o.empty = true
		else if (a === '--help' || a === '-h') o.help = true
		else throw new Error(`unknown flag ${a}`)
	}
	if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) throw new Error('--port 1–65535')
	return o
}

const log = (level, msg) => console.log(`${new Date().toISOString().slice(11, 23)} ${level} ${msg}`)

/** Read-only GET of the live server's active project (null when it does not answer). */
function fetchProject() {
	return new Promise((resolve) => {
		const req = http.get({ host: '127.0.0.1', port: 4200, path: '/api/project', timeout: 3000 }, (res) => {
			const chunks = []
			res.on('data', (c) => chunks.push(c))
			res.on('end', () => {
				try {
					const j = JSON.parse(Buffer.concat(chunks).toString('utf8'))
					resolve(res.statusCode === 200 && j && typeof j === 'object' ? j.project || j : null)
				} catch {
					resolve(null)
				}
			})
		})
		req.on('timeout', () => req.destroy())
		req.on('error', () => resolve(null))
	})
}

/** A synthetic moving head (as the RC lights smoke): Base → Yoke (pan) → Head (tilt) → Beam (−Y). */
const I12 = (o = [0, 0, 0]) => [1, 0, 0, 0, 1, 0, 0, 0, 1, ...o]
const RIG = { nodes: [
	{ id: 'Base', parent: -1, kind: 'Geometry', xf: I12() },
	{ id: 'Yoke', parent: 0, kind: 'Axis', axis: 'pan', xf: I12([0, -0.1, 0]) },
	{ id: 'Head', parent: 1, kind: 'Axis', axis: 'tilt', xf: I12([0, -0.35, 0]) },
	{ id: 'Beam', parent: 2, kind: 'Beam', xf: I12([0, -0.1, 0]), beam: { beamType: 'Spot', beamAngle: 18 } },
] }

/** Fake follow service: 4 heads 3 m above each arena's corners-ish + a sweeping pattern; patch follows the scene. */
function fakeLights(sceneOf) {
	let fixtures = []
	let forRev = null
	const list = () => {
		const s = sceneOf()
		if (!s || s.rev === forRev) return fixtures
		forRev = s.rev
		fixtures = []
		for (const a of s.arenas || []) {
			const [x0, z0, x1, z1] = a.rect
			for (const [fx, fz] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
				const gx = x0 + (x1 - x0) * fx, gz = z0 + (z1 - z0) * fz, gy = a.y + 3
				const n = fixtures.length
				fixtures.push({ id: `fake-${n}`, name: `Fake head ${n + 1}`, typeId: '0000000fa4e0', mode: 'fake', enabled: true,
					pose: { x: gx, y: -gz, z: gy, hang: 'truss', yaw: 0, pitch: 0, roll: 0 } })
			}
		}
		return fixtures
	}
	return {
		fixtures: list,
		visual: () => {
			const t = Date.now() / 1000
			return { fixtures: list().map((f, n) => {
				const ph = t * 0.4 + n * 0.9
				const hue = (t * 0.05 + n * 0.13) % 1
				const c = [0, 1, 2].map((k) => Math.max(0, Math.min(1, Math.abs(((hue * 6 + k * 2) % 6) - 3) - 1)))
				return { id: f.id, axes: { Yoke: Math.round(Math.sin(ph) * 60), Head: Math.round(25 + Math.sin(ph * 1.3) * 20) },
					beams: { Beam: { i: 0.6 + 0.4 * Math.sin(ph * 0.7) ** 2, c, zoom: 18 } } }
			}) }
		},
		rigOf: () => RIG,
		typeName: () => 'Fake spot',
	}
}

async function main() {
	const o = args(process.argv.slice(2))
	if (o.help) return console.log('node tools/dev/skirmish-dev-server.js [--port 4310] [--arena id] [--mode dm|tdm] [--bots n] [--fake-lights] [--empty]')
	const requireCore = (id) => require(id.startsWith('src/') ? path.join(ROOT, id) : require.resolve(id, { paths: [ROOT] }))
	const host = Object.freeze({ name: 'toy-skirmish', version: 'dev', moduleDir: MOD, coreRoot: ROOT, coreVersion: 'dev', requireCore,
		log: (level, msg) => log(level, `[module:toy-skirmish] ${msg}`) })
	const desc = require(path.join(MOD, 'register.js'))(host)
	const { createSkGame, useSkGame } = require(path.join(MOD, 'server', 'sk-game.js'))
	const { screensFrom } = require(path.join(ROOT, 'modules', 'rc-game', 'server', 'rc-video.js'))
	const { RouteRegistry } = require(path.join(ROOT, 'src', 'api', 'route-registry.js'))
	const { parseQueryString } = require(path.join(ROOT, 'src', 'api', 'response.js'))

	let project = o.empty ? null : await fetchProject()
	log('info', project ? `project "${project.name}" (read-only from :4200)` : 'no project: the default empty hall')
	const refresh = o.empty ? null : setInterval(async () => (project = (await fetchProject()) || project), 30000)
	let served = null
	const lightsDeps = o.fakeLights ? fakeLights(() => served) : null
	const game = createSkGame({
		port: () => o.port, lanIps: () => ['127.0.0.1'], log,
		bakerDeps: { loadProject: () => project },
		lightsDeps,
		videoDeps: { screens: () => screensFrom(project?.previs?.stage?.objects), feed: () => null, lease: () => {}, roles: () => [] },
	})
	useSkGame(game)
	const routes = new RouteRegistry()
	desc.registerRoutes(routes)
	const ctx = { config: {}, log }

	const server = http.createServer((req, res) => {
		const u = new URL(req.url, 'http://127.0.0.1')
		const chunks = []
		req.on('data', (c) => chunks.push(c))
		req.on('end', async () => {
			let out
			try {
				if (u.pathname === '/') out = { status: 302, headers: { Location: '/game/sk/' }, body: '' }
				else if (u.pathname.startsWith('/api/')) {
					out = await routes.dispatch(req.method, u.pathname, Buffer.concat(chunks).toString('utf8'), ctx, req, parseQueryString(u.search.slice(1)))
				} else out = await desc.handleStatic({ method: req.method, path: u.pathname, search: u.search, req })
			} catch (e) {
				out = { status: 500, headers: { 'Content-Type': 'text/plain' }, body: String(e?.stack || e) }
			}
			if (!out) out = { status: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Not found' }
			res.writeHead(out.status, out.headers || {})
			res.end(req.method === 'HEAD' ? undefined : out.body)
		})
	})
	const ws = desc.onHttpServer(server, ctx)
	server.listen(o.port, '127.0.0.1', async () => {
		console.log(`skirmish dev server on http://127.0.0.1:${o.port}/game/sk/`)
		game.host({ action: 'enable' })
		try {
			served = (await game.scene()).json
			log('info', `scene ${served.rev}: arenas ${served.arenas.map((a) => a.id).join(', ') || 'none'}`)
			for (const a of [o.arena && { action: 'arena', id: o.arena }, o.mode && { action: 'mode', mode: o.mode },
				Number.isInteger(o.bots) && { action: 'bots', n: o.bots }].filter(Boolean)) {
				const r = game.host(a)
				log(r.status === 200 ? 'info' : 'warn', `host ${JSON.stringify(a)} → ${r.status}${r.body.error ? ` ${r.body.error}` : ''}`)
			}
		} catch (e) {
			log('warn', `scene failed: ${e?.stack || e}`)
		}
	})
	const stop = () => {
		if (refresh) clearInterval(refresh)
		game.disable()
		ws.close()
		server.close(() => process.exit(0))
		setTimeout(() => process.exit(0), 1000).unref()
	}
	process.on('SIGINT', stop)
	process.on('SIGTERM', stop)
}

main().catch((e) => {
	console.error(e?.stack || e)
	process.exit(1)
})
