/**
 * Smoke test for `web/lib/previs-state.js`. Runs the store through its mutations with a
 * fake in-memory `Storage` impl and asserts event emission + persistence behaviour.
 *
 * Usage: `npm run smoke:previs-state`.
 */

import { createPrevisState, PREVIS_STATE_EVENTS } from '../web/lib/previs-state.js'

class MemStorage {
	constructor() { this.map = new Map() }
	getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
	setItem(k, v) { this.map.set(k, String(v)) }
	removeItem(k) { this.map.delete(k) }
}

const failures = []
function assert(cond, msg) { if (!cond) failures.push(msg) }
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b) }

const storage = new MemStorage()
const store = createPrevisState({ storage, storageKey: 'test.key' })

let changeCount = 0
store.on(PREVIS_STATE_EVENTS.CHANGE, () => { changeCount++ })

let lastActive = null
store.on(PREVIS_STATE_EVENTS.ACTIVE, (s) => { lastActive = s.activeModelId })

store.setModels([
	{ id: 'a', name: 'A', filename: 'a.glb', ext: '.glb', sizeBytes: 1, uploadedAt: 't' },
	{ id: 'b', name: 'B', filename: 'b.glb', ext: '.glb', sizeBytes: 2, uploadedAt: 't' },
])
assert(changeCount >= 1, 'setModels should emit change')
assert(store.getSnapshot().models.length === 2, 'two models stored')

store.setActiveModel('a')
assert(lastActive === 'a', 'active event fired')

store.setTag('a', 'mesh-uuid-1', { screenId: 'scr1', type: 'regular' })
assert(store.getTagsForModel('a')['mesh-uuid-1'].screenId === 'scr1', 'tag written')

store.clearTag('a', 'mesh-uuid-1')
assert(!store.getTagsForModel('a')['mesh-uuid-1'], 'tag cleared')

store.addPreset('a', { id: 'p1', name: 'ISO', position: [0, 0, 0], target: [0, 0, 0], fov: 45 })
assert(store.getPresets('a').length === 1, 'preset added')

store.setUI({ grid: false })
assert(store.getUI().grid === false, 'ui toggle applied')
assert(store.getUI().backgroundColor === 0x0a0a0a, 'default backgroundColor merged')
assert(store.getUI().prvFractionWhen3d === 0.2, 'default prvFractionWhen3d merged')
assert(store.getUI().virtualCanvasWidth === 1920 && store.getUI().virtualCanvasHeight === 1080, 'default virtual canvas merged')

store.setUI({ virtualCanvasWidth: 32, virtualCanvasHeight: 9000 })
assert(store.getUI().virtualCanvasWidth === 64 && store.getUI().virtualCanvasHeight === 8192, 'virtual canvas clamped')
store.setUI({ virtualCanvasWidth: 1920, virtualCanvasHeight: 1080 })

store.removeModel('a')
assert(!store.getSnapshot().models.find((m) => m.id === 'a'), 'model a removed')
assert(store.getActiveModel() === null, 'active cleared when model removed')
assert(!store.getTagsForModel('a')['mesh-uuid-1'], 'tags pruned with model removal')

await new Promise((r) => setTimeout(r, 400))
const persisted = JSON.parse(storage.getItem('test.key') || '{}')
assert(deepEqual(persisted.models, store.getSnapshot().models), 'persisted matches live state')
assert(persisted.ui && persisted.ui.grid === false, 'ui persisted')

const store2 = createPrevisState({ storage, storageKey: 'test.key' })
assert(store2.getSnapshot().models.length === 1, 'reload restores models')
assert(store2.getUI().grid === false, 'reload restores ui')

if (failures.length) {
	console.log(`[previs-state] failures=${failures.length}`)
	for (const f of failures) console.log('  -', f)
	process.exit(1)
}
console.log('[previs-state] ok — all assertions passed')
process.exit(0)
