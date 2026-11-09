'use strict'

/**
 * WO-979 — the two sandbox servers of the role-split run (tools/e2e/duties-scenario.js): what each one is, and the
 * PSN ears that tell which one sends.
 *
 *   media      owns the screen (one PGM/PRV destination, pixel-map-fixture's sandboxConfig) and three looks
 *              (Opener, Closer, Credits). Its project has PSN output ON, so only the duty gate keeps it quiet.
 *   tracking   detection on + one camera (the tracking duty, WO-723): the camera is tools/test-env/fake-detect-sidecar.js
 *              behind HIGHASCG_TRACKING_PYTHON (one walking person), the model an empty file. Its project has PSN
 *              output ON too, and two "on air" rules (WO-712 R4): Opener → auto:home, Closer → look:duties_credits.
 * Both run the Tracking plugin (the follow engine, the Auto director, zones), so "the media box defers" is the duty
 * code answering, not a module that is missing.
 *
 * PSN stays on this machine: each server sends to its own port of an administratively scoped group (GROUP, never the
 * PSN default 236.10.10.10:56565 a desk / MagicQ listens on) out of the loopback interface (iface 127.0.0.1, TTL 1).
 * psnEar(port) joins that group on 127.0.0.1 and counts what arrives. No DMX patch: nothing goes out on Art-Net.
 */

const dgram = require('dgram')
const fs = require('fs')
const path = require('path')
const { decode } = require('../../src/fixtures/psn')
const { sandboxConfig } = require('./pixel-map-fixture')

const GROUP = '239.255.97.9'
const LOOPBACK = '127.0.0.1'
const MODEL = 'fake-person.onnx'
const SIDECAR = path.join(__dirname, '..', 'test-env', 'fake-detect-sidecar.js')
const LOOKS = { opener: 'duties_opener', closer: 'duties_closer', credits: 'duties_credits' }
const SLUGS = { media: 'e2e_duties_media', tracking: 'e2e_duties_tracking' }
const CAMERA = {
	id: 'cam_fake',
	role: 'in1',
	raster: [1920, 1080],
	cam: { pos_x: 0, pos_y: -8, pos_z: 4, pitch: -25, yaw: 0, roll: 0, fov: 60, lens_k1: 0, lens_k2: 0 },
}

const psnOutput = (port, name) => ({
	enabled: true,
	protocol: 'psn',
	psn: { group: GROUP, port, iface: LOOPBACK, system_name: name, axes: 'stage' },
})

function look(id, name, colour) {
	return {
		id,
		name,
		layers: [
			{
				layerNumber: 10,
				source: { type: 'media', value: `E2E_${colour}`, label: name },
				fill: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
				opacity: 1,
			},
		],
	}
}

/** The media server's show: three looks, PSN on (gated off by the duty). */
function mediaProject(psnPort) {
	return {
		version: 1,
		name: SLUGS.media, // a save re-slugs a project from its name: keep the two equal
		slug: SLUGS.media,
		savedAt: new Date().toISOString(),
		scenes: {
			scenes: [
				look(LOOKS.opener, 'Opener', 'RED'),
				look(LOOKS.closer, 'Closer', 'BLUE'),
				look(LOOKS.credits, 'Credits', 'GREEN'),
			],
		},
		fixtures: { patch: [], output: psnOutput(psnPort, 'wo979-media') },
	}
}

/** The tracking server's show: detection + the fake camera, PSN on, two on-air rules. No looks of its own. */
function trackingProject(psnPort) {
	return {
		version: 1,
		name: SLUGS.tracking,
		slug: SLUGS.tracking,
		savedAt: new Date().toISOString(),
		scenes: { scenes: [] },
		fixtures: { patch: [], output: psnOutput(psnPort, 'wo979-tracking') },
		previs: {
			tracking: {
				cameras: [CAMERA],
				detection: { enabled: true, model: MODEL, pin_mode: 'off', interval_ms: 100 },
				zones: {
					enabled: true,
					list: [],
					on_air: [
						{ id: 'wo979_home', when: 'Opener', do: 'auto:home', enabled: true }, // by name, ignoring case (R4)
						{ id: 'wo979_credits', when: 'closer', do: `look:${LOOKS.credits}`, enabled: true }, // → the master takes it
					],
				},
			},
		},
	}
}

/**
 * The tracking show for a LIVE box (no fake sidecar via env there): the same show with detection.simulate, so the
 * server runs the imitated camera (src/tracking/detect-sim.js) itself. Copy it into the box's projects dir and load it
 * with broadcastProject (WO-979 runbook).
 */
function liveTrackingProject(psnPort = 56599) {
	const doc = trackingProject(psnPort)
	doc.previs.tracking.detection.simulate = true
	return doc
}

/** startSandbox options for a role (before the server starts: the models dir must exist for detect-service). */
function sandboxOptions(role, root) {
	if (role === 'media') return { tracking: true, config: sandboxConfig(root) }
	const models = path.join(root, 'models')
	fs.mkdirSync(models, { recursive: true })
	fs.writeFileSync(path.join(models, MODEL), '') // detect-service checks it exists; the fake sidecar never opens it
	fs.chmodSync(SIDECAR, 0o755)
	return {
		tracking: true,
		// WO-1026: detection only runs where a camera is local — the tracking server has the camera's DeckLink input (in1)
		config: { casparServer: { configPath: path.join(root, 'casparcg.config'), decklink_input_count: 1 } },
		env: { HIGHASCG_TRACKING_PYTHON: SIDECAR, HIGHASCG_TRACKING_MODELS: models, FAKE_DETECT_PERSONS: '1' },
	}
}

/** Write a role's project into a sandbox's projects dir → its slug (the scenario loads it over the API). */
function writeProject(role, projectsDir, psnPort) {
	const doc = role === 'media' ? mediaProject(psnPort) : trackingProject(psnPort)
	fs.writeFileSync(path.join(projectsDir, `${doc.slug}.json`), JSON.stringify(doc, null, 2))
	return doc.slug
}

/** A PSN listener on GROUP:port via loopback → { port, count(), names(), trackers(), reset(), close() }. */
function psnEar(port) {
	const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
	let packets = 0
	const names = new Set()
	const trackers = new Map() // id → last pos
	sock.on('message', (buf) => {
		let d
		try {
			d = decode(buf)
		} catch {
			return
		}
		packets++
		if (d.systemName) names.add(d.systemName)
		for (const [id, t] of Object.entries(d.trackers)) if (t.pos) trackers.set(Number(id), t.pos)
	})
	return new Promise((resolve, reject) => {
		sock.once('error', reject)
		sock.bind(port, () => {
			try {
				sock.addMembership(GROUP, LOOPBACK)
			} catch (e) {
				return reject(e)
			}
			resolve({
				port,
				count: () => packets,
				names: () => [...names],
				trackers: () => Object.fromEntries(trackers),
				reset() {
					packets = 0
					names.clear()
					trackers.clear()
				},
				close: () => new Promise((r) => sock.close(r)),
			})
		})
	})
}

/**
 * Sandbox nodes [media, tracking] → their shows loaded, a PSN ear per server, a marker on each hub (the WO-978 puppet
 * when the server has it, else a marker written over POST /api/tracking/markers, the hub's own API).
 * → { ears: { media, tracking }, stop() }
 */
async function prepare(nodes, log = () => {}) {
	const { freePort } = require('./sandbox-server')
	const ears = {}
	const timers = []
	const roles = ['media', 'tracking']
	try {
		for (const [i, role] of roles.entries()) {
			const n = nodes[i]
			ears[role] = await psnEar(await freePort())
			const slug = writeProject(role, n.sb.dirs.projects, ears[role].port)
			const l = await n.post('/api/project/load', { slug, broadcastProject: true }) // broadcast: the follow / detect services take it
			if (l.status !== 200) throw new Error(`${n.id}: load ${slug} → ${l.status} ${JSON.stringify(l.data)?.slice(0, 200)}`)
			const pup = await n.post('/api/tracking/puppet', {
				enabled: true,
				id: 7,
				pattern: 'circle',
				ttl_min: 30,
				name: `wo979-${role}`,
			})
			if (pup.status === 200)
				log(`${n.id}: ${role} show ${slug}, puppet marker 7, PSN → ${GROUP}:${ears[role].port} via ${LOOPBACK}`)
			else {
				let k = 0
				const write = () =>
					n.post('/api/tracking/markers', {
						id: 7,
						x: Math.cos(k / 10),
						y: 2 + Math.sin(k++ / 10),
						z: 1.7,
						name: `wo979-${role}`,
					})
				timers.push(setInterval(write, 200))
				log(`${n.id}: ${role} show ${slug}, no puppet API (${pup.status}): marker 7 over POST /api/tracking/markers`)
			}
		}
	} catch (e) {
		for (const e2 of Object.values(ears)) await e2.close()
		timers.forEach(clearInterval)
		throw e
	}
	return {
		ears,
		async stop() {
			timers.forEach(clearInterval)
			for (const n of nodes) await n.post('/api/tracking/puppet', { enabled: false }).catch(() => {})
			for (const e of Object.values(ears)) await e.close()
		},
	}
}

module.exports = {
	liveTrackingProject,
	prepare,
	GROUP,
	LOOKS,
	SLUGS,
	MODEL,
	SIDECAR,
	mediaProject,
	trackingProject,
	sandboxOptions,
	writeProject,
	psnEar,
}
