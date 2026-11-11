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
 * The write is the one the owner's PixelHue Studio app uses and has tested: `PUT /unico/v1/layers/window` with
 * `[{ layerId, window: { x, y, width, height } }]`, then a read-back (some firmware answers OK and keeps its own
 * geometry). Only layers whose rectangle differs are sent; a layer that is gone from the switcher is skipped and
 * named. A failure never fails the take — the picture on the wall is CasparCG's job either way.
 *
 * Removing it: delete this file and pixelhue-look-drive hooks — the single line in routes-scene-take-look.js, the
 * `drive` key in routes-pixelhue.js, the tick in the Godot Devices panel. Look layers keep an unused `pixelhue` key.
 */

const MIN_SIDE = 16 // px: smaller than this is a slip of the hand, not a picture

const int = (v) => Math.round(Number(v) || 0)

/**
 * The switcher windows a look asks for.
 * @param {{ layers?: object[] }} scene a stored look
 * @param {{ screens: object[] }} snap pixelhue-read snapshot
 * @returns {{ changes: { layerId: number, window: object, name: string }[], skipped: string[] }}
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
		const f = l.fill && typeof l.fill === 'object' ? l.fill : {}
		let width = int(Number(f.scaleX) * screen.width)
		let height = int(Number(f.scaleY) * screen.height)
		if (!(width >= MIN_SIDE) || !(height >= MIN_SIDE)) {
			skipped.push(`${name}: ${width}×${height} is too small`)
			continue
		}
		width = Math.min(width, screen.width)
		height = Math.min(height, screen.height)
		// kept inside the screen: the switcher refuses, or clips, a window that leaves it
		const x = Math.max(0, Math.min(screen.width - width, int(Number(f.x) * screen.width)))
		const y = Math.max(0, Math.min(screen.height - height, int(Number(f.y) * screen.height)))
		if (cur.x === x && cur.y === y && cur.width === width && cur.height === height) continue
		changes.push({ layerId, name, window: { x, y, width, height } })
	}
	return { changes, skipped }
}

const same = (l, w) => l && l.x === w.x && l.y === w.y && l.width === w.width && l.height === w.height

/**
 * @param {{ layers?: object[] }} scene
 * @param {{ read: Function, put: Function }} reader pixelhue-read reader
 * @param {{ wait?: (ms: number) => Promise<void> }} [deps]
 * @returns {Promise<{ sent: number, kept: number, skipped: string[] }>} kept: windows the switcher shows after the write
 */
async function driveLook(scene, reader, deps = {}) {
	const wait = deps.wait || ((ms) => new Promise((r) => setTimeout(r, ms)))
	const { changes, skipped } = windowsFromLook(scene, await reader.read())
	if (!changes.length) return { sent: 0, kept: 0, skipped }
	await reader.put('/unico/v1/layers/window', changes.map(({ layerId, window }) => ({ layerId, window })))
	let lost = changes
	for (let attempt = 0; attempt < 3 && lost.length; attempt++) {
		if (attempt) await wait(200)
		const all = (await reader.read()).screens.flatMap((s) => s.layers || [])
		lost = changes.filter((c) => !same(all.find((l) => l.layerId === c.layerId), c.window))
	}
	for (const c of lost) skipped.push(`${c.name}: the switcher did not keep the rectangle`)
	const kept = changes.length - lost.length
	return { sent: changes.length, kept, skipped }
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
