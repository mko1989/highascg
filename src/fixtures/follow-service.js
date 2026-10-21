'use strict'

/**
 * WO-616 T11 — wires the follow engine into the running server (started by the tracking module): marker hub in,
 * `project.fixtures` from the active project (at boot, then on every project write via project-events), Art-Net
 * out through one ephemeral socket. Refuses destinations that would land on this box's own lighting input
 * (src/artnet/lighting-input-receiver.js listens on :6454 for one port-address — the global border).
 * WO-631: with `output.protocol` "psn" (the default) the markers go out as PosiStageNet trackers instead (psn.js)
 * and the console aims its own fixtures; "artnet" is the backup where this box drives pan/tilt itself.
 * WO-615 T4: typed fixtures resolve their GDTF mode through gdtf-store.js (reload() after an import / delete);
 * sACN goes out through the same socket and is refused on the box's own input universe when it would land here
 * (multicast, or unicast to a local address on :5568).
 */

const os = require('os')
const { FollowEngine } = require('./follow-engine')
const { ArtnetSender, ARTNET_PORT } = require('./artdmx')
const { PsnSender } = require('./psn')
const { ConsoleFrames } = require('./follow-through')
const { onProjectChanged } = require('../engine/project-events')
const gdtfStore = require('./gdtf-store')
const { SACN_PORT } = require('./sacn')

function ipv4ToInt(ip) {
	return ip.split('.').reduce((a, b) => ((a << 8) | Number(b)) >>> 0, 0)
}

/** Addresses a packet sent to reaches this machine: loopback, limited broadcast, own and directed broadcast. */
function localTargets() {
	const out = new Set(['255.255.255.255'])
	for (const list of Object.values(os.networkInterfaces())) {
		for (const a of list || []) {
			if (a.family !== 'IPv4' && a.family !== 4) continue
			out.add(a.address)
			const ip = ipv4ToInt(a.address)
			const mask = ipv4ToInt(a.netmask)
			const b = (ip | (~mask >>> 0)) >>> 0
			out.add([24, 16, 8, 0].map((s) => (b >>> s) & 255).join('.'))
		}
	}
	return out
}

/** This box's IPv4 addresses (the PSN interface choices). */
function ipv4Addresses() {
	const out = []
	for (const [name, list] of Object.entries(os.networkInterfaces())) {
		for (const a of list || []) if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push({ name, address: a.address })
	}
	return out
}

/** Port-address the box's Art-Net input listens on, or null when that input is off. */
function inputPortAddress(ctx) {
	const dmx = ctx?.config?.dmx || {}
	if (dmx.artnetInputEnabled === false) return null
	try {
		const { resolveArtnetPatch } = require('../artnet/artnet-slot-config')
		const p = resolveArtnetPatch(ctx, dmx)
		return ((p.net & 0x7f) << 8) | ((p.subnet & 0x0f) << 4) | (p.universe & 0x0f)
	} catch (_) {
		return 0
	}
}

/** The universe number the box's lighting input uses (it may run sACN on it), or null when the input is off. */
function inputUniverse(ctx) {
	const dmx = ctx?.config?.dmx || {}
	if (dmx.artnetInputEnabled === false) return null
	try {
		const { resolveArtnetPatch } = require('../artnet/artnet-slot-config')
		return resolveArtnetPatch(ctx, dmx).universe & 0x0f
	} catch (_) {
		return 0
	}
}

const isMulticast = (host) => {
	const first = Number(String(host).split('.')[0])
	return first >= 224 && first <= 239
}

function createFollowService(ctx, hub) {
	const log = typeof ctx?.log === 'function' ? ctx.log.bind(ctx) : () => {}
	const sender = new ArtnetSender({ log })
	const psn = new PsnSender({ hub, log })
	const consoleFrames = new ConsoleFrames({ log })
	let targets = localTargets()
	const reachesSelf = (to) => to.port === ARTNET_PORT && (to.host.startsWith('127.') || targets.has(to.host))
	const sacnReachesSelf = (to) => isMulticast(to.host) || (to.port === SACN_PORT && (to.host.startsWith('127.') || targets.has(to.host)))
	const engine = new FollowEngine({
		hub,
		consoleFrames,
		send: (to, packet) => sender.send(to, packet),
		isSelfLoop: (to, universe, protocol) => protocol === 'sacn'
			? sacnReachesSelf(to) && inputUniverse(ctx) === universe
			: reachesSelf(to) && inputPortAddress(ctx) === universe,
		reachesSelf,
		resolveMode: (typeId, mode) => {
			try {
				return gdtfStore.mode(typeId, mode)
			} catch (_) {
				return null
			}
		},
	})
	let lastJson = ''
	const apply = (project) => {
		const slice = project?.fixtures ?? null
		const json = JSON.stringify(slice)
		if (json === lastJson) return
		lastJson = json
		targets = localTargets()
		engine.configure(slice)
		psn.configure({ ...engine.psn, enabled: engine.enabled && engine.protocol === 'psn' })
		if (engine.through.enabled && engine.protocol === 'artnet') consoleFrames.start()
		else consoleFrames.stop()
		const ok = engine.fixtures.filter((f) => !f.problem).length
		log('info', `[follow] patch: ${engine.fixtures.length} fixture(s), ${ok} outputtable, output ${engine.enabled ? 'ON' : 'off'} (${engine.protocol})`)
		for (const f of engine.fixtures) if (f.problem) log('warn', `[follow] ${f.name}: ${f.problem}`)
	}
	try {
		const { loadFullProject } = require('../engine/project-scenes')
		apply(loadFullProject())
	} catch (e) {
		log('warn', '[follow] initial project load: ' + (e?.message || e))
	}
	const off = onProjectChanged(apply)
	engine.start()
	return {
		engine,
		/** Re-resolve the patch (a GDTF type was imported or deleted). */
		reload() {
			lastJson = ''
			try {
				apply(require('../engine/project-scenes').loadFullProject())
			} catch (e) {
				log('warn', '[follow] reload: ' + (e?.message || e))
			}
		},
		sender,
		psn,
		status: () => ({ ...engine.status(), packets_sent: sender.sent, send_errors: sender.errors, psn: { ...psn.status(), interfaces: ipv4Addresses() },
			console: consoleFrames.status() }),
		/** What clients draw (WS `tracking:follow`): no counters, so it only changes when an aim / state does. */
		snapshot: () => {
			const s = engine.status()
			return { output_enabled: s.output_enabled, protocol: s.protocol,
				fixtures: s.fixtures.map(({ id, state, pan, tilt, problem, through, console }) =>
					({ id, state, pan, tilt, problem, through, console })) }
		},
		stop() {
			off()
			engine.stop()
			sender.close()
			psn.close()
			consoleFrames.stop()
		},
	}
}

module.exports = { createFollowService, localTargets, inputPortAddress }
