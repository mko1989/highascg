'use strict'

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')
const { getChannelMap } = require('../config/routing')
const {
	resolveDecklinkVideoModeForTarget,
	pickAutoDecklinkSdiFormatForFeed,
} = require('../config/decklink-output-resolve')
const { isDecklinkIoOut } = require('../config/decklink-io-direction')
const { normalizeDeviceGraph } = require('../config/device-graph')
const { addEdgeToGraph } = require('../config/device-graph-edges')
const { DEFAULT_DEVICE_ID, DEST_DEVICE_ID } = require('../config/device-graph-constants')
const { destinationsFromConfig } = require('../config/screen-destinations')
const { destinationHasDecklinkOutput } = require('../config/device-graph-destination-wiring')
const { isFollowerRole, regenerateFollowerCasparFromDeviceView } = require('./follower-machine-profile')

const DEFAULT_CASPAR_CONFIG_PATH = path.join(REPO_ROOT, 'config', 'casparcg.config')

function casparConfigPath() {
	return module.exports.CASPAR_CONFIG_PATH || DEFAULT_CASPAR_CONFIG_PATH
}

function mergedFlatConfig(ctx) {
	const config = ctx?.config || {}
	const cs = config.casparServer || config.caspar_server || {}
	return {
		...config,
		...cs,
		deviceGraph: config.deviceGraph || config.device_graph,
		screenDestinations: config.screenDestinations || config.screen_destinations,
	}
}

/**
 * @param {object|null|undefined} dest
 * @returns {string|null}
 */
function resolveSdiModeFromDestination(dest) {
	if (!dest || typeof dest !== 'object') return null
	const picked = pickAutoDecklinkSdiFormatForFeed({
		videoMode: dest.videoMode,
		width: dest.width,
		height: dest.height,
		fps: dest.fps,
	})
	return picked.decklinkVideoMode || null
}

function isDecklinkOutConnector(c) {
	if (!c) return false
	if (c.kind === 'decklink_out') return true
	return (
		c.kind === 'decklink_io' && isDecklinkIoOut(c)
	)
}

/**
 * Clear decklink input slots that share a device number with PGM/MV SDI outputs.
 * @param {object} casparServer
 */
function clearDecklinkInputOutputConflicts(casparServer) {
	if (!casparServer || typeof casparServer !== 'object') return false
	const outputDevices = new Set()
	const screenCount = Math.max(1, parseInt(String(casparServer.screen_count || 1), 10) || 1)
	for (let n = 1; n <= screenCount; n++) {
		const d = parseInt(String(casparServer[`screen_${n}_decklink_device`] || '0'), 10) || 0
		if (d > 0) outputDevices.add(d)
	}
	const mv = parseInt(String(casparServer.multiview_decklink_device || '0'), 10) || 0
	if (mv > 0) outputDevices.add(mv)

	let changed = false
	for (let i = 1; i <= 8; i++) {
		const inDev = parseInt(String(casparServer[`decklink_input_${i}_device`] || '0'), 10) || 0
		if (inDev > 0 && outputDevices.has(inDev)) {
			casparServer[`decklink_input_${i}_device`] = 0
			changed = true
		}
	}
	return changed
}

/**
 * Follower: repair Device View DeckLink SDI (format, cabling, input conflicts). Does not restart Caspar.
 * @param {object} ctx
 */
function repairFollowerDecklinkGraph(ctx) {
	if (!isFollowerRole(ctx)) return { changed: false, readiness: { ok: true, warnings: [] } }

	const config = mergedFlatConfig(ctx)
	const readiness = assessFollowerCasparOutputReadiness(ctx)
	const destinations = destinationsFromConfig(config)
	let graph = normalizeDeviceGraph(config.deviceGraph)
	const connectors = [...(graph.connectors || [])]
	let edges = [...(graph.edges || [])]
	let changed = false

	const devices = [...(graph.devices || [])]
	if (!devices.some((d) => d?.id === DEST_DEVICE_ID)) {
		devices.push({ id: DEST_DEVICE_ID, role: 'destinations', label: 'Destinations' })
		changed = true
	}

	function ensureDestinationInConnector(dest) {
		const did = String(dest?.id || '').trim()
		if (!did) return null
		const id = `dst_in_${did}`
		let conn = connectors.find((c) => String(c?.id || '') === id)
		if (!conn) {
			conn = {
				id,
				deviceId: DEST_DEVICE_ID,
				kind: 'destination_in',
				externalRef: did,
				label: String(dest.label || did).slice(0, 120),
			}
			connectors.push(conn)
			changed = true
		}
		return conn
	}

	function findDecklinkOutByDevice(deviceNum) {
		return connectors.find(
			(c) =>
				isDecklinkOutConnector(c) &&
				(parseInt(String(c.externalRef || '0'), 10) || 0) === deviceNum,
		)
	}

	function ensureDecklinkOutConnector(screenN, deviceNum, sdiMode) {
		let conn = findDecklinkOutByDevice(deviceNum)
		if (!conn) {
			const idx = screenN - 1
			conn = {
				id: `dlsdi_${screenN}`,
				deviceId: DEFAULT_DEVICE_ID,
				kind: 'decklink_io',
				index: idx,
				label: `SDI ${screenN}`,
				externalRef: String(deviceNum),
				caspar: {
					ioDirection: 'out',
					bus: 'pgm',
					mainIndex: idx,
				},
			}
			connectors.push(conn)
			changed = true
		}
		if (!conn.caspar || typeof conn.caspar !== 'object') conn.caspar = {}
		if (!isDecklinkIoOut(conn)) {
			conn.caspar.ioDirection = 'out'
			changed = true
		}
		if (!conn.caspar.decklinkOutputVideoMode && sdiMode) {
			conn.caspar.decklinkOutputVideoMode = sdiMode
			changed = true
		}
		return conn
	}

	for (let destIndex = 0; destIndex < destinations.length; destIndex++) {
		const dest = destinations[destIndex]
		if (!dest || String(dest.mode || '') === 'multiview') continue
		const screenN = (parseInt(String(dest.mainScreenIndex ?? destIndex), 10) || 0) + 1
		if (screenN < 1) continue

		const sdiMode = resolveSdiModeFromDestination(dest)
		const prefix = `screen_${screenN}_`
		let deviceNum = parseInt(String(config[`${prefix}decklink_device`] || '0'), 10) || 0
		const wiringCtx = {
			g: { ...graph, connectors, edges },
			byId: new Map(connectors.map((c) => [String(c?.id || ''), c])),
			outgoing: new Map(),
			destinations,
		}
		for (const e of edges) {
			const src = String(e?.sourceId || '')
			if (!src) continue
			if (!wiringCtx.outgoing.has(src)) wiringCtx.outgoing.set(src, [])
			wiringCtx.outgoing.get(src).push(String(e?.sinkId || ''))
		}
		const hasCable = destinationHasDecklinkOutput(dest, destIndex, wiringCtx)

		if (deviceNum <= 0 && hasCable) {
			for (const c of connectors) {
				if (!isDecklinkOutConnector(c)) continue
				const srcIds = new Set(
					edges.filter((e) => String(e?.sinkId || '') === String(c.id || '')).map((e) => e.sourceId),
				)
				const destInId = `dst_in_${String(dest.id || '')}`
				if (srcIds.has(destInId)) {
					deviceNum = parseInt(String(c.externalRef || '0'), 10) || 0
					break
				}
			}
		}

		if (deviceNum <= 0 && !hasCable) continue

		const outConn = ensureDecklinkOutConnector(screenN, deviceNum, sdiMode)
		const destConn = ensureDestinationInConnector(dest)
		if (destConn && outConn) {
			const wired = edges.some(
				(e) =>
					String(e?.sourceId || '') === String(destConn.id) &&
					String(e?.sinkId || '') === String(outConn.id),
			)
			if (!wired) {
				const trial = addEdgeToGraph({ ...graph, connectors, edges, devices }, destConn.id, outConn.id)
				if (trial.ok && trial.graph) {
					graph = trial.graph
					edges = [...(graph.edges || [])]
					changed = true
				}
			}
		}
	}

	const nextCasparServer = { ...(ctx.config?.casparServer || {}) }
	if (clearDecklinkInputOutputConflicts(nextCasparServer)) changed = true

	if (changed && ctx?.configManager) {
		const nextGraph = normalizeDeviceGraph({ ...graph, connectors, edges, devices })
		const next = { ...ctx.configManager.get() }
		next.deviceGraph = nextGraph
		next.casparServer = nextCasparServer
		ctx.configManager.save(next)
		if (ctx.config) Object.assign(ctx.config, ctx.configManager.get())
	}

	const afterReadiness = changed ? assessFollowerCasparOutputReadiness(ctx) : readiness
	return { changed, readiness: afterReadiness }
}

/**
 * Follower: repair graph then regenerate Caspar when SDI output is not ready.
 * @param {object} ctx
 */
async function repairFollowerDecklinkOutput(ctx) {
	if (!isFollowerRole(ctx)) return { ok: true, skipped: true, changed: false }

	const { changed, readiness } = repairFollowerDecklinkGraph(ctx)
	if (readiness.ok && !changed) {
		return { ok: true, changed: false, readiness }
	}

	if (typeof ctx.log === 'function' && (changed || !readiness.ok)) {
		ctx.log('info', '[replication] Follower DeckLink SDI repair — regenerating casparcg.config')
	}

	const regen = await regenerateFollowerCasparFromDeviceView(ctx)
	const after = assessFollowerCasparOutputReadiness(ctx)
	return {
		ok: after.ok && regen.ok !== false,
		changed,
		regenerateOk: !!regen.ok,
		readiness: after,
		regenerateError: regen.ok ? null : regen.body?.error || 'regenerate failed',
	}
}

/**
 * Follower: DeckLink may be selected in Device View but omitted from casparcg.config when SDI format is unset.
 * @param {object} ctx
 */
function assessFollowerCasparOutputReadiness(ctx) {
	if (!isFollowerRole(ctx)) return { ok: true, warnings: [] }

	const config = mergedFlatConfig(ctx)
	const cs = config
	const screenCount = Math.max(1, parseInt(String(cs.screen_count || config.screen_count || 1), 10) || 1)
	const map = getChannelMap(config)
	/** @type {Array<{ screen: number, channel: number, decklinkDevice: number, code: string, message: string }>} */
	const warnings = []

	for (let screen = 1; screen <= screenCount; screen++) {
		const decklinkDevice = parseInt(String(cs[`screen_${screen}_decklink_device`] || '0'), 10) || 0
		if (decklinkDevice <= 0) continue

		const pgmCh = map.programCh(screen)
		const decklinkVideoMode = resolveDecklinkVideoModeForTarget(config, 'screen', screen)
		if (!decklinkVideoMode) {
			warnings.push({
				screen,
				channel: pgmCh,
				decklinkDevice,
				code: 'decklink_sdi_format_missing',
				message: `Screen ${screen} PGM (ch ${pgmCh}): DeckLink device ${decklinkDevice} has no SDI format — wire a destination with a known canvas size, or set SDI format on the port in Device View.`,
			})
			continue
		}

		let casparXml = ''
		try {
			if (fs.existsSync(casparConfigPath())) casparXml = fs.readFileSync(casparConfigPath(), 'utf8')
		} catch {
			casparXml = ''
		}

		const channelComment = `Caspar channel ${pgmCh}:`
		const blockStart = casparXml.indexOf(channelComment)
		if (blockStart >= 0) {
			const blockEnd = casparXml.indexOf('</channel>', blockStart)
			const block = blockEnd > blockStart ? casparXml.slice(blockStart, blockEnd) : casparXml.slice(blockStart)
			if (!/<decklink[\s>]/i.test(block)) {
				warnings.push({
					screen,
					channel: pgmCh,
					decklinkDevice,
					code: 'decklink_missing_from_caspar_config',
					message: `Screen ${screen} PGM (ch ${pgmCh}): DeckLink device ${decklinkDevice} is not in casparcg.config — click Regenerate Caspar from Device View on this backup box.`,
				})
			}
		}
	}

	return { ok: warnings.length === 0, warnings }
}

module.exports = {
	assessFollowerCasparOutputReadiness,
	repairFollowerDecklinkGraph,
	repairFollowerDecklinkOutput,
	resolveSdiModeFromDestination,
	CASPAR_CONFIG_PATH: DEFAULT_CASPAR_CONFIG_PATH,
}
