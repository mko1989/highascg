#!/usr/bin/env node
'use strict'

/**
 * WO-1026 — repoint the first layer of test looks, on the master:
 *
 *   node tools/e2e/two-box/set-look-source.js '{"sc_2box_mixer":"route://9-3","sc_2box_ppt":"route://10-4"}' [--api=127.0.0.1:4200]
 *
 * Once the live deck holds the looks, `POST /api/project/autosave` cannot change them (the server overwrites `scenes`
 * from its deck, routes-data-project-handlers.js → enrichProjectScenesFromLiveDeck), and no HTTP route edits a look's
 * source. This sends the deck back over the clients' own path (WS `scene_deck_sync`); the cluster then shares it.
 */

const WebSocket = require('ws')

async function main() {
	const map = JSON.parse(process.argv[2] || '{}')
	const api = (process.argv.find((a) => a.startsWith('--api=')) || '--api=127.0.0.1:4200').slice(6)
	const deck = (await (await fetch(`http://${api}/api/state`)).json())?.scene?.deck
	if (!deck || !Array.isArray(deck.sceneSnapshots)) throw new Error('no scene deck in /api/state')
	const sceneSnapshots = JSON.parse(JSON.stringify(deck.sceneSnapshots))
	const missing = Object.keys(map).filter((id) => !sceneSnapshots.some((s) => s.id === id && s.layers?.[0]?.source))
	if (missing.length) throw new Error(`no such look (or it has no first layer source): ${missing.join(', ')}`)
	for (const s of sceneSnapshots) if (map[s.id]) s.layers[0].source.value = map[s.id]
	const data = { looks: deck.looks, sceneSnapshots, layerPresets: deck.layerPresets, lookPresets: deck.lookPresets, previewSceneId: deck.previewSceneId }
	await new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://${api}/api/ws`)
		ws.on('error', reject)
		ws.on('open', () => {
			ws.send(JSON.stringify({ type: 'scene_deck_sync', data }))
			setTimeout(() => resolve(ws.close()), 2500)
		})
	})
	const after = (await (await fetch(`http://${api}/api/state`)).json()).scene.deck.sceneSnapshots
	let bad = 0
	for (const id of Object.keys(map)) {
		const now = after.find((s) => s.id === id)?.layers?.[0]?.source?.value
		console.log(`${now === map[id] ? 'ok  ' : 'FAIL'} ${id} → ${now}`)
		if (now !== map[id]) bad++
	}
	process.exit(bad ? 1 : 0)
}

main().catch((e) => {
	console.error(e?.message || e)
	process.exit(1)
})
