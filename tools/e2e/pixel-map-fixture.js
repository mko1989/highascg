'use strict'

/**
 * WO-807 e2e — the sandbox side of godot/client/e2e/scenarios/07_pixel_map.gd (tools/e2e/run-gui-e2e.js calls
 * prepare() when that scenario is selected, after the sandbox server is up):
 *
 * 1. Project `e2e_pixel_map` in the SANDBOX's projects dir: the MHP rig's lighting patch (projects/mhp_harder.json
 *    `fixtures`, read only — the live project is never written) with every head's dest rewritten to 127.0.0.1:6455
 *    (loopback: never the rig's 255.255.255.255 broadcast, never :6454 = this box's own lighting input), the DMX
 *    master on for universe 18 only, the visualiser (console input) off and the follow output (PSN multicast) off.
 *    The GDTF types the patch uses are copied into the sandbox's projects/_gdtf. The scenario loads it.
 * 2. A known picture on the sandbox's PGM 1 shm surface, `<root>/shm/highascg-pgm1` (the path a sandbox announces —
 *    never /dev/shm): the simulated Caspar draws nothing, so this writer stands in for the channel. Its size follows
 *    the server's channel map; a new frame (seq + 1, same pixels) is published every 100 ms. The pattern (channel
 *    pixels; the scenario hand-checks against these numbers and re-averages the file itself):
 *      background (20, 24, 32)
 *      A1: x 400–449, y 300–499 (240, 32, 0)   A2: x 450–499, y 300–499 (16, 96, 200)
 *          → region 400,300 100 × 200, average = (128, 64, 100)
 *      B:  x 1200–1259, y 500–539 (0, 180, 90) with a 6 × 6 marker x 1226–1231, y 516–521 (255, 255, 0)
 *          → region 1200,500 60 × 40, point (centre pixel 1229, 519) = (255, 255, 0)
 */

const fs = require('fs')
const path = require('path')
const { getJson } = require('./sandbox-server')

const REPO_ROOT = path.resolve(__dirname, '../..')
const SOURCE = path.join(REPO_ROOT, 'projects', 'mhp_harder.json')
const SLUG = 'e2e_pixel_map'
const DEST = '127.0.0.1:6455'
const UNIVERSE = 18
const FRAME_MS = 100

const BG = [20, 24, 32]
const RECTS = [
	{ x: 400, y: 300, w: 50, h: 200, rgb: [240, 32, 0] },
	{ x: 450, y: 300, w: 50, h: 200, rgb: [16, 96, 200] },
	{ x: 1200, y: 500, w: 60, h: 40, rgb: [0, 180, 90] },
	{ x: 1226, y: 516, w: 6, h: 6, rgb: [255, 255, 0] },
]

/** The sandbox project: the rig's patch, loopback only. → { file, heads } */
function writeProject(projectsDir) {
	const src = JSON.parse(fs.readFileSync(SOURCE, 'utf8'))
	const fx = src.fixtures || {}
	const patch = (fx.patch || []).map((f) => ({ ...f, dest: DEST }))
	const project = {
		version: src.version,
		name: 'e2e pixel map', // slugs to SLUG: a save (autosave) re-slugs a project from its name and would rename the file away from SLUG, so 11 could not load it after 07
		slug: SLUG,
		savedAt: new Date().toISOString(),
		fixtures: {
			...fx,
			patch,
			output: { ...(fx.output || {}), enabled: false }, // no PSN multicast
			dmx: { ...(fx.dmx || {}), enabled: true, universes: [`artnet:${UNIVERSE}`], visualise: false, iface: '' },
		},
	}
	const bad = patch.filter((f) => f.dest !== DEST)
	if (bad.length) throw new Error(`refusing: ${bad.length} head(s) not on ${DEST}`)
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
	return { file, heads: patch.length }
}

/** BGRA premultiplied (alpha 255) pixels of the pattern. */
function pattern(width, height) {
	const px = Buffer.alloc(width * height * 4)
	for (let i = 0; i < px.length; i += 4) [px[i], px[i + 1], px[i + 2], px[i + 3]] = [BG[2], BG[1], BG[0], 255]
	for (const r of RECTS) {
		for (let y = r.y; y < Math.min(height, r.y + r.h); y++) {
			for (let x = r.x; x < Math.min(width, r.x + r.w); x++) {
				const i = (y * width + x) * 4
				;[px[i], px[i + 1], px[i + 2]] = [r.rgb[2], r.rgb[1], r.rgb[0]]
			}
		}
	}
	return px
}

/** A HASCGSHM v1 segment (caspar/modules/shm/hshm_abi.h) with the pattern in all 3 slots; publish() bumps the seq. */
function createSegment(file, width, height) {
	const stride = width * 4
	const slotSize = Math.ceil((4096 + stride * height) / 4096) * 4096
	const head = Buffer.alloc(4096)
	head.write('HASCGSHM', 0, 'latin1')
	head.writeUInt32LE(1, 8) // ABI
	head.writeUInt32LE(4096, 12)
	head.writeUInt32LE(width, 16)
	head.writeUInt32LE(height, 20)
	head.writeUInt32LE(stride, 24)
	head.writeUInt32LE(1, 28) // BGRA8 premultiplied
	head.writeUInt32LE(10, 32) // fps 10/1
	head.writeUInt32LE(1, 36)
	head.writeUInt32LE(3, 40)
	head.writeUInt32LE(1, 44) // channel
	for (let s = 0; s < 3; s++) head.writeBigUInt64LE(BigInt(4096 + s * slotSize), 48 + 8 * s)
	head.writeBigUInt64LE(BigInt(slotSize), 72)
	head.writeBigUInt64LE(BigInt(process.pid), 88)
	const tmp = `${file}.tmp`
	fs.writeFileSync(tmp, head)
	const fd = fs.openSync(tmp, 'r+')
	const px = pattern(width, height)
	for (let s = 0; s < 3; s++) fs.writeSync(fd, px, 0, px.length, 4096 + s * slotSize + 4096)
	fs.ftruncateSync(fd, 4096 + 3 * slotSize)
	fs.closeSync(fd)
	fs.renameSync(tmp, file)
	const out = fs.openSync(file, 'r+')
	let seq = 0
	const b8 = Buffer.alloc(8)
	return {
		width,
		height,
		publish() {
			seq++
			const slot = seq % 3
			b8.writeBigUInt64LE(BigInt(2 * seq))
			fs.writeSync(out, b8, 0, 8, 4096 + slot * slotSize) // the slot's seqlock: even = complete
			b8.writeBigUInt64LE((BigInt(seq) << 8n) | BigInt(slot))
			fs.writeSync(out, b8, 0, 8, 96) // latest
			b8.writeBigUInt64LE(BigInt(seq))
			fs.writeSync(out, b8, 0, 8, 120) // published
		},
		close: () => fs.closeSync(out),
	}
}

/**
 * Sandbox config overrides (startSandbox `config`): one PGM/PRV screen at 1080p50 from the first boot (ch 1 = PGM 1,
 * ch 2 = PRV 1). Seeded, not added at run time: the simulated Caspar answers INFO CONFIG once, at connect, and
 * channelResolutionsByChannel (the raster the pixel map validates rects against) comes from that answer only — a screen
 * added later has a channel number but no raster until Caspar restarts, which a sandbox never does.
 */
function sandboxConfig(root) {
	return {
		casparServer: { configPath: path.join(root, 'casparcg.config'), screen_count: 1, screen_1_mode: '1080p5000' },
		screenDestinations: { version: 1, destinations: [{ id: 'dst_e2e_pgm1', label: 'PGM/PRV 1', mainScreenIndex: 0, mode: 'pgm_prv',
			videoMode: '1080p5000', width: 1920, height: 1080, fps: 50, caspar: { bus: 'pgm' } }] },
	}
}

/**
 * @param {{ url: string, root: string, dirs: { projects: string } }} sb  startSandbox()'s result
 * @returns {{ slug: string, stop: () => void }}
 */
function prepare(sb, log = () => {}) {
	const { heads } = writeProject(sb.dirs.projects)
	log(`pixel map: project ${SLUG} (${heads} heads → ${DEST}, DMX master on for artnet:${UNIVERSE})`)
	const shmDir = path.join(sb.root, 'shm')
	fs.mkdirSync(shmDir, { recursive: true })
	let seg = null
	let busy = false
	let polled = 0
	const tick = async () => {
		if (busy) return
		busy = true
		try {
			if (!seg || Date.now() - polled > 2000) {
				polled = Date.now()
				const cm = (await getJson(`${sb.url}/api/settings`)).data?.channelMap || {}
				const ch = Number((cm.programChannels || [])[0]) || 0
				const r = ch ? (cm.channelResolutionsByChannel || {})[String(ch)] : null
				if (r && r.w > 0 && r.h > 0 && (!seg || seg.width !== r.w || seg.height !== r.h)) {
					seg?.close()
					seg = createSegment(path.join(shmDir, 'highascg-pgm1'), r.w, r.h)
					log(`pixel map: test pattern on pgm1 (channel ${ch}, ${r.w}×${r.h}) → ${path.join(shmDir, 'highascg-pgm1')}`)
				}
			}
			seg?.publish()
		} catch (e) {
			log(`pixel map: frame writer: ${e.message || e}`)
		} finally {
			busy = false
		}
	}
	const timer = setInterval(tick, FRAME_MS)
	return {
		slug: SLUG,
		stop() {
			clearInterval(timer)
			seg?.close()
		},
	}
}

module.exports = { prepare, sandboxConfig, pattern, writeProject, SLUG, DEST, RECTS, BG }
