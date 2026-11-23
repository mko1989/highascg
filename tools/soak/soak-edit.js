'use strict'
/**
 * WO-1133 edit phase: replays what the looks editor sends while an operator drags a layer box —
 * POST /api/preview/mixer-nudge at ~10 Hz with the changed layer's fill (src/api/routes-preview-nudge.js).
 * The 21.11 Caspar burst (+1.5 GB in 3 min) sat in exactly this traffic: ~400 MIXER lines on PRV and PGM in 5 min.
 *
 * Cosmetic only: nudges never touch the stored project (no autosave), and the next take restores every layer.
 * PRV drags need the look staged on PRV (the route refuses a foreign staged look); PGM drags (`target: 'pgm'`,
 * the GUI's "PGM edit") need it live on PGM.
 */

const NUDGE_HZ = 10

/** A drag path: the box wanders ±4 % around its stored position and comes back. */
function draggedLayer(layer, tSec) {
	const f = layer.fill || { x: 0, y: 0, scaleX: 1, scaleY: 1 }
	const dx = 0.04 * Math.sin(tSec * 0.9)
	const dy = 0.04 * Math.sin(tSec * 1.3)
	return { ...layer, fill: { ...f, x: (f.x ?? 0) + dx, y: (f.y ?? 0) + dy } }
}

/** Layers the editor can drag: sourced look-band layers (template overlays live on 700+ hosts, not here). */
function draggable(scene) {
	return (scene?.layers || []).filter((l) => l && l.source && l.source.value && Number(l.layerNumber) >= 1)
}

/**
 * Drag one random layer of `look` for `ms`, on PRV or PGM.
 * @param {{ api: Function, event: Function, waitUntil: Function, done: Function, main: number }} env
 * @param {{ id: string, name: string, scene: object }} look
 * @param {'prv'|'pgm'} target
 * @param {number} ms
 * @returns {Promise<{ sent: number, refused: number }>}
 */
async function dragFor(env, look, target, ms) {
	const layers = draggable(look.scene)
	if (!layers.length) return { sent: 0, refused: 0 }
	const layer = layers[Math.floor(Math.random() * layers.length)]
	const started = Date.now()
	let sent = 0
	let refused = 0
	while (!env.done() && Date.now() - started < ms) {
		const tick = Date.now()
		const body = {
			sceneId: look.id,
			mainIndex: env.main,
			layers: [draggedLayer(layer, (tick - started) / 1000)],
			...(look.scene?.composeCanvas ? { composeCanvas: look.scene.composeCanvas } : {}),
			...(target === 'pgm' ? { target: 'pgm' } : {}),
		}
		const r = await env.api('POST', '/api/preview/mixer-nudge', body)
		sent++
		if (r.status !== 200 || r.json?.ok === false) refused++
		await env.waitUntil(tick + 1000 / NUDGE_HZ)
	}
	env.event('drag', { look: look.name, layer: layer.layerNumber, target, sent, refused })
	return { sent, refused }
}

module.exports = { dragFor, draggable }
