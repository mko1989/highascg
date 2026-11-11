'use strict'

/**
 * WO-1038 — looks drive the PixelHue switcher (a side feature: off unless switched on in Devices ▸ PixelHue, and
 * removable — see "Removing it" below).
 *
 * A look layer dropped from Sources ▸ Live ▸ PixelHue layers remembers the switcher layer it came from
 * (`layer.pixelhue = { layerId, screenId, name }`). Its rectangle in the look IS the programming: move / size the
 * placeholder like any other layer, save the look. On a PROGRAM take of that look the server moves each such
 * switcher layer onto its placeholder's rectangle, so one look places the CasparCG layers and the switcher's layers.
 *
 * A placeholder can also name the SOURCE its switcher layer shows (`layer.pixelhue.source = { id, type, name }`, picked
 * in the layer inspector; none = leave the switcher's source alone).
 *
 * Based on the owner's pixelhue-studio (github.com/mko1989/pixelhue-studio, 1.6.0-alpha.2, lib/studio-programming.js
 * + lib/program-geometry.js): the same requests, order, limits and read-back; the same editable layer types
 * (normal, AUX, logo, the fill layer of a Cut & Fill pair); screen-relative coordinates; a locked PGM is respected.
 * Only layers that differ are written; one that is gone from the switcher is skipped and named. A failure never
 * fails the take — the picture on the wall is CasparCG's job either way.
 *
 * Removing it: delete this file and pixelhue-look-drive hooks — the single line in routes-scene-take-look.js, the
 * `drive` key in routes-pixelhue.js, the tick in the Godot Devices panel. Look layers keep an unused `pixelhue` key.
 */

// Device limits as pixelhue-studio's program-geometry.js reads them from layer_2.xml: a side 64–131070 px, global
// X / Y ±500000. Layers may roam off the screen (the device default, PixelFlow's behaviour); a switcher set to keep
// windows inside the screen refuses such a window and the read-back says so.
const SIDE_MIN = 64
const SIDE_MAX = 131070
const POS_MAX = 500000
const PROGRAMMABLE = new Set(['normal', 'aux', 'logo']) // studio programmingLayers: types 2, 4, 32 and 256 (Cut & Fill fill)

const int = (v) => Math.round(Number(v) || 0)
const sameWindow = (l, w) => l && l.x === w.x && l.y === w.y && l.width === w.width && l.height === w.height
const sameSource = (l, src) => l && Number(l.sourceId) === Number(src.id) && Number(l.sourceType) === Number(src.type)

/**
 * What a look asks of the switcher. Windows are screen-relative here (as the read gives them); `driveLook` adds the
 * screen origin when it writes.
 * @param {{ layers?: object[] }} scene a stored look
 * @param {{ screens: object[] }} snap pixelhue-read snapshot
 * @returns {{ changes: { layerId: number, name: string, screen: object, window?: object, source?: object }[], skipped: string[] }}
 */
function windowsFromLook(scene, snap) {
	const changes = []
	const skipped = []
	const seen = new Set()
	for (const l of Array.isArray(scene?.layers) ? scene.layers : []) {
		const link = l?.pixelhue
		if (!link || typeof link !== 'object' || link.drive === false || !Number.isFinite(Number(link.layerId))) continue
		const layerId = Number(link.layerId)
		if (seen.has(layerId)) continue // two placeholders of one switcher layer: the lower look layer wins
		seen.add(layerId)
		const name = String(link.name || layerId)
		const screen = (snap?.screens || []).find((s) => (s.layers || []).some((x) => x.layerId === layerId))
		const cur = screen?.layers.find((x) => x.layerId === layerId)
		if (!cur || !(screen.width > 0) || !(screen.height > 0)) {
			skipped.push(`${name}: not on the switcher any more`)
			continue
		}
		if (!PROGRAMMABLE.has(cur.type)) {
			skipped.push(`${name}: a ${cur.type} layer is not programmed from a look`)
			continue
		}
		if (cur.scene === 'pgm' && screen.pgmLocked) {
			skipped.push(`${name}: PGM of ${screen.name || 'its screen'} is locked on the switcher`)
			continue
		}
		const f = l.fill && typeof l.fill === 'object' ? l.fill : {}
		const window = { x: int(Number(f.x) * screen.width), y: int(Number(f.y) * screen.height),
			width: int(Number(f.scaleX) * screen.width), height: int(Number(f.scaleY) * screen.height) }
		if (window.width < SIDE_MIN || window.height < SIDE_MIN || window.width > SIDE_MAX || window.height > SIDE_MAX) {
			skipped.push(`${name}: ${window.width}×${window.height} is outside the switcher's ${SIDE_MIN}–${SIDE_MAX} px`)
			continue
		}
		if (Math.abs(window.x + int(screen.x)) > POS_MAX || Math.abs(window.y + int(screen.y)) > POS_MAX) {
			skipped.push(`${name}: too far off the screen`)
			continue
		}
		const change = { layerId, name, screen }
		const src = link.source && typeof link.source === 'object' && Number.isFinite(Number(link.source.id)) && Number.isFinite(Number(link.source.type)) ? link.source : null
		// a screen cannot show its own PGM / PVW (studio sourcePayload)
		if (src && [3, 4].includes(Number(src.type)) && Number(src.id) === Number(screen.screenId)) skipped.push(`${name}: a screen cannot show itself`)
		else if (src && !sameSource(cur, src)) change.source = { id: Number(src.id), type: Number(src.type), ...(src.connectorType != null ? { connectorType: Number(src.connectorType) } : {}) }
		if (!sameWindow(cur, window) || change.source) change.window = window
		if (change.window || change.source) changes.push(change)
	}
	return { changes, skipped }
}

const globalWindow = (c) => ({ ...c.window, x: c.window.x + int(c.screen.x), y: c.window.y + int(c.screen.y) })
const sourcePayload = (src) => ({
	general: { sourceId: src.id, sourceType: src.type, ...(src.connectorType != null ? { connectorType: src.connectorType } : {}) },
	primary: { sourceId: src.id, sourceType: src.type },
})

/**
 * Writes, in pixelhue-studio's order (applyProgramming 'source' / applyProgramGeometry):
 *   layers/aspect-ratio { 5, locked }   for a layer whose source changes — a custom ratio, so routing a source of
 *                                       another shape cannot resize the rectangle (the look's rectangle is the truth;
 *                                       unlike Studio it is NOT re-locked to the source's own ratio afterwards)
 *   layers/source                        the new sources
 *   layers/window                        every changed rectangle, one request
 * then a read-back (some firmware answers OK and keeps its own geometry).
 * @param {{ layers?: object[] }} scene
 * @param {{ read: Function, put: Function }} reader pixelhue-read reader
 * @param {{ wait?: (ms: number) => Promise<void> }} [deps]
 * @returns {Promise<{ sent: number, kept: number, skipped: string[] }>} sent / kept: switcher layers asked / as asked afterwards
 */
async function driveLook(scene, reader, deps = {}) {
	const wait = deps.wait || ((ms) => new Promise((r) => setTimeout(r, ms)))
	const { changes, skipped } = windowsFromLook(scene, await reader.read())
	if (!changes.length) return { sent: 0, kept: 0, skipped }
	const routed = changes.filter((c) => c.source)
	if (routed.length) {
		await reader.put('/unico/v1/layers/aspect-ratio', routed.map((c) => ({ layerId: c.layerId, aspectRatio: 5, locked: 1 })))
		await reader.put('/unico/v1/layers/source', routed.map((c) => ({ layerId: c.layerId, source: sourcePayload(c.source) })))
	}
	const moved = changes.filter((c) => c.window)
	if (moved.length) await reader.put('/unico/v1/layers/window', moved.map((c) => ({ layerId: c.layerId, window: globalWindow(c) })))
	const ok = (all, c) => {
		const l = all.find((x) => x.layerId === c.layerId)
		return (!c.window || sameWindow(l, c.window)) && (!c.source || sameSource(l, c.source))
	}
	let lost = changes
	for (let attempt = 0; attempt < 3 && lost.length; attempt++) {
		if (attempt) await wait(200)
		const all = (await reader.read()).screens.flatMap((s) => s.layers || [])
		lost = changes.filter((c) => !ok(all, c))
	}
	for (const c of lost) skipped.push(`${c.name}: the switcher did not keep the ${c.source ? 'source / rectangle' : 'rectangle'}`)
	return { sent: changes.length, kept: changes.length - lost.length, skipped }
}

/** Does this look carry anything for the switcher? (cheap: no network) */
function lookDrivesSwitcher(scene) {
	return (Array.isArray(scene?.layers) ? scene.layers : []).some((l) => l?.pixelhue && l.pixelhue.drive !== false && Number.isFinite(Number(l.pixelhue.layerId)))
}

/**
 * The take hook (routes-scene-take-look.js, program takes only). Never throws, never delays the take: it runs beside it.
 * @param {object} scene the stored look being taken
 * @param {object} ctx server ctx (log)
 * @param {{ settings?: () => { host: string, drive: boolean }, reader?: (host: string) => object }} [deps]
 */
function driveLookOnTake(scene, ctx, deps = {}) {
	try {
		if (!lookDrivesSwitcher(scene)) return null
		const routes = require('../api/routes-pixelhue')
		const { host, drive } = (deps.settings || routes.readSettings)()
		if (!host || !drive) return null
		const log = typeof ctx?.log === 'function' ? ctx.log.bind(ctx) : () => {}
		return driveLook(scene, (deps.reader || routes.readerFor)(host), deps)
			.then((r) => {
				if (r.sent || r.skipped.length) {
					log(r.skipped.length ? 'warn' : 'info', `[pixelhue] look "${scene?.name || scene?.id}": ${r.kept}/${r.sent} switcher layer(s) moved${r.skipped.length ? ' — ' + r.skipped.join('; ') : ''}`)
				}
				return r
			})
			.catch((e) => {
				log('warn', `[pixelhue] look "${scene?.name || scene?.id}": the switcher was not driven: ${e?.message || e}`)
				return null
			})
	} catch (_) {
		return null
	}
}

module.exports = { windowsFromLook, driveLook, lookDrivesSwitcher, driveLookOnTake }
