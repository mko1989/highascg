const WebSocket = require('/home/casparcg/highascg/node_modules/ws')
const N = [['Narvil — Red / Run', '1fece3f2-eedb-41af-ac2c-eddf90d83f3b'], ['Narvil — Magenta / Promises', '75580f5a-0300-4967-9948-1dd9542cad50'], ['Narvil — Blue Grubson', '62e83df5-b58c-4cc3-9a72-8374ac95b395'], ['Narvil — Green / Move', 'd9d65e55-f930-426a-b1ea-06186452a009'], ['Narvil — 5.00', '3b4af3db-981e-4bb5-919e-e2d3ac0d9ab2']]
;(async () => {
	const api = '127.0.0.1:4200'
	const deck = (await (await fetch(`http://${api}/api/state`)).json()).scene.deck
	console.log(Object.keys(deck), deck.looks?.length, deck.sceneSnapshots?.length, JSON.stringify(deck.looks?.[0]).slice(0, 300), JSON.stringify(deck.sceneSnapshots?.[0]).slice(0, 300))
	if (process.argv[2] !== 'go') return
	const looks = JSON.parse(JSON.stringify(deck.looks)), snaps = JSON.parse(JSON.stringify(deck.sceneSnapshots))
	for (const [name, id] of N) {
		if (!looks.some((l) => l.id === id)) looks.push({ ...JSON.parse(JSON.stringify(looks[0])), id, name })
		if (!snaps.some((l) => l.id === id)) snaps.push({ ...JSON.parse(JSON.stringify(snaps[0])), id, name })
	}
	const data = { looks, sceneSnapshots: snaps, layerPresets: deck.layerPresets, lookPresets: deck.lookPresets, previewSceneId: deck.previewSceneId }
	await new Promise((res, rej) => { const ws = new WebSocket(`ws://${api}/api/ws`); ws.on('error', rej); ws.on('open', () => { ws.send(JSON.stringify({ type: 'scene_deck_sync', data })); setTimeout(() => res(ws.close()), 2500) }) })
	const after = (await (await fetch(`http://${api}/api/state`)).json()).scene.deck
	console.log(after.looks.map((l) => l.name))
})()
