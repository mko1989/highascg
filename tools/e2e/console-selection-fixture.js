'use strict'

/**
 * WO-857 e2e — the sandbox side of godot/client/e2e/scenarios/14_wo857_console_selection.gd (tools/e2e/run-gui-e2e.js calls
 * prepare() when that scenario is selected, with the tracking plugin on so the fixture rig is served):
 *
 * Project `e2e_console_selection` in the SANDBOX's projects dir: seven heads of the MHP rig (projects/mhp_harder.json,
 * read only, never written) — MAC Quantum Profile 11..16 in a row and Vizi Beam CMY 121 — each carrying the console head
 * number its name ends with as an explicit `fid` (the real rig gets the same numbers from its MVR FixtureIDs, WO-796).
 * Every dest is 127.0.0.1:6455 and the DMX master / PSN output are off, so nothing is sent anywhere. The GDTF types the
 * heads use are copied into the sandbox's projects/_gdtf.
 * udpPort(): a free UDP port for the grandMA3 plugin listener (HIGHASCG_GMA3_SELECTION_PORT); the scenario plays the Lua
 * plugin and sends its datagrams there (HIGHASCG_E2E_GMA3_PORT).
 */

const dgram = require('dgram')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')
const SOURCE = path.join(REPO_ROOT, 'projects', 'mhp_harder.json')
const SLUG = 'e2e_console_selection'
const DEST = '127.0.0.1:6455'
const WANT = /^(MAC Quantum Profile 1[1-6]|Vizi Beam CMY 121)$/

/** A free UDP port on loopback. */
function udpPort() {
	return new Promise((resolve, reject) => {
		const s = dgram.createSocket('udp4')
		s.once('error', reject)
		s.bind(0, '127.0.0.1', () => {
			const { port } = s.address()
			s.close(() => resolve(port))
		})
	})
}

/** @returns {{ file: string, heads: { id: string, name: string, fid: number }[] }} */
function writeProject(projectsDir) {
	const src = JSON.parse(fs.readFileSync(SOURCE, 'utf8'))
	const fx = src.fixtures || {}
	const patch = (fx.patch || [])
		.filter((f) => WANT.test(String(f.name)))
		.map((f) => ({ ...f, dest: DEST, fid: Number(/(\d+)$/.exec(f.name)[1]) }))
	if (patch.length !== 7) throw new Error(`console-selection fixture: found ${patch.length} of the 7 heads in ${SOURCE}`)
	if (patch.some((f) => f.dest !== DEST)) throw new Error(`refusing: a head is not on ${DEST}`)
	const project = {
		version: src.version,
		name: 'e2e console selection',
		slug: SLUG,
		savedAt: new Date().toISOString(),
		fixtures: { ...fx, patch, output: { ...(fx.output || {}), enabled: false },
			dmx: { ...(fx.dmx || {}), enabled: false, universes: [], visualise: false, iface: '' } },
	}
	const gdtf = path.join(projectsDir, '_gdtf')
	fs.mkdirSync(gdtf, { recursive: true })
	for (const id of new Set(patch.map((f) => f.typeId).filter(Boolean))) {
		for (const ext of ['.gdtf', '.json']) {
			const from = path.join(REPO_ROOT, 'projects', '_gdtf', id + ext)
			if (fs.existsSync(from)) fs.copyFileSync(from, path.join(gdtf, id + ext))
		}
	}
	const file = path.join(projectsDir, `${SLUG}.json`)
	fs.writeFileSync(file, JSON.stringify(project, null, 2))
	return { file, heads: patch.map((f) => ({ id: f.id, name: f.name, fid: f.fid })) }
}

/** @param {{ dirs: { projects: string } }} sb startSandbox()'s result */
function prepare(sb, log = () => {}) {
	const { heads } = writeProject(sb.dirs.projects)
	log(`console selection: project ${SLUG} (${heads.length} heads, fids ${heads.map((h) => h.fid).join(',')}; every dest ${DEST}, output off)`)
	return { slug: SLUG, heads, stop() {} }
}

module.exports = { prepare, udpPort, writeProject, SLUG, DEST }
