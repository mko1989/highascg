'use strict'

/**
 * WO-1029 apply harness — bed helpers for "Apply (restart Caspar) across linked servers, air state kept"
 * (contract: scratchpad APPLY-CONTRACT.md). Attached to the bed by virtual-boxes.js (`Object.assign(bed, applyHelpers(bed))`).
 *
 *   await bed.cable('vb-b', 'backup', true, { via: 'vb-a' })  add / remove a destination's cable through the box's own
 *                                                             device-view API, or through `via`'s relay (what an operator
 *                                                             on A's client editing B's devices does)
 *   await bed.touch('vb-b', { via: 'vb-a' })   dirty a box without moving content (see touch)
 *   await bed.dirtyOf('vb-b')        GET /api/caspar-config/dirty  (answered by that box)
 *   await bed.planOf('vb-a')         GET /api/cluster/apply-plan
 *   const r = await bed.apply('vb-a', { servers?, force? })   POST /api/cluster/apply the way the client presses it
 *   bed.screens('vb-a')              what is on every cabled destination: { destId: { pgm: [layers], prv: [layers] } }
 *                                    layer = { layer, source, kind, playing, loop, position (s), length }
 *   await bed.waitRestored('vb-a', () => bool, 'what')       deadline wait on the screens
 *   bed.restartsOf('vb-a')           the fake's restart markers; bed.restartOrder() = all boxes' markers by time
 */

const assert = require('node:assert/strict')
const { waitFor } = require('./cluster-nodes')

function applyHelpers(bed) {
	const { box } = bed

	/** Cable (or uncable) destination `key` on its own output; `via` = another box whose relay carries the edit. */
	async function cable(id, key, on, { via } = {}) {
		const b = box(id)
		const i = bed.dests.findIndex((d) => d.key === key)
		const d = bed.dests[i]
		const body = on ? { addEdge: { sourceId: `dst_in_${d.id}`, sinkId: `vb_out_${i + 1}` } } : { removeEdge: { id: `e_${d.id}_out_${i + 1}` } }
		const r = via ? await box(via).node.post(`/api/cluster/peers/${id}/relay/api/device-view`, body) : await b.node.post('/api/device-view', body)
		assert.ok(r.status === 200 && r.data?.ok !== false, `${via ? via + ' → ' : ''}${id}: cable ${key} ${on ? 'on' : 'off'}: ${r.status} ${JSON.stringify(r.data)?.slice(0, 200)}`)
		on ? b.cabled.add(d.id) : b.cabled.delete(d.id)
		return r
	}

	/**
	 * Make `id` dirty (or clean again): flips the video mode of a destination that is NOT cabled on that box (so no
	 * content moves) between 1080p5000 and 1080p2500 through the box's own device-view API, or `via`'s relay. A cable
	 * change alone does not alter the generated casparcg.config of a virtual box (its outputs are not DeckLink / GPU
	 * heads), so it is not dirty; a channel video mode is.
	 */
	async function touch(id, { via } = {}) {
		const b = box(id)
		const d = bed.dests.find((x) => !b.cabled.has(x.id))
		assert.ok(d, `${id}: every destination is cabled — nothing to touch`)
		b.touched = !b.touched
		const body = { updateDestination: { id: d.id, videoMode: b.touched ? '1080p2500' : '1080p5000' } }
		const r = via ? await box(via).node.post(`/api/cluster/peers/${id}/relay/api/device-view`, body) : await b.node.post('/api/device-view', body)
		assert.ok(r.status === 200 && r.data?.ok !== false, `${via ? via + ' → ' : ''}${id}: touch ${d.id}: ${r.status} ${JSON.stringify(r.data)?.slice(0, 200)}`)
		return d.id
	}

	/** Every cabled destination's PGM / PRV channel as the fake Caspar shows it, with clip positions. */
	function screens(id) {
		const b = box(id)
		const out = {}
		for (const destId of b.cabled) {
			out[destId] = {}
			for (const bus of ['pgm', 'prv']) {
				const ch = b.chans.get(destId)?.[bus]
				out[destId][bus] = ch > 0 ? layersOf(b.caspar, ch) : []
				out[destId][`${bus}Ch`] = ch
			}
		}
		return out
	}

	const layersOf = (cg, ch) =>
		cg.visible(ch).map((l) => ({ layer: l.layer, ...(l.fg ? cg.clip(ch, l.layer) || { source: l.fg.source, kind: l.fg.kind, playing: l.fg.playing } : {}), cg: l.cg ? l.cg.template : undefined }))

	/** Refresh a box's channel numbers from its own device view (they can change across an apply). */
	async function refreshChannels(id) {
		const b = box(id)
		const r = await b.node.get('/api/device-view')
		assert.equal(r.status, 200, `${id} device view: ${r.status}`)
		const cm = r.data.live?.caspar?.channelMap || {}
		b.chans.clear()
		for (const d of r.data.screenDestinations?.destinations || []) {
			const i = Number(d.mainScreenIndex) || 0
			b.chans.set(d.id, { pgm: cm.programChannels?.[i], prv: cm.previewChannels?.[i], mainIdx: i })
		}
	}

	return {
		cable,
		touch,
		screens,
		refreshChannels,
		dirtyOf: (id) => box(id).node.get('/api/caspar-config/dirty'),
		planOf: (id) => box(id).node.get('/api/cluster/apply-plan'),
		/** The press: the apply covers every dirty server (or `servers`); long call (restarts, restores). */
		apply: (id, body = {}, ms = 45000) => box(id).node.post('/api/cluster/apply', body, ms),
		/** Wait (deadline) until `pred()` holds on the screens; returns pred's value. */
		waitRestored: (id, pred, what, ms = 15000) => waitFor(`${id}: ${what}`, async () => pred(screens(id)), ms, 50).then((r) => r.value),
		/** The fake's restart markers after `since` (a bed.mark() or a seq; 0 = all). */
		restartsOf: (id, since = 0) => box(id).caspar.restarts(typeof since === 'object' ? since[id] : since),
		/** All boxes' restart markers after `since` in time order: [{ box, seq, t, n }]. */
		restartOrder: (since = 0) => [...bed.boxes.values()].flatMap((b) => bed.restartsOf(b.id, since).map((r) => ({ box: b.id, ...r }))).sort((x, y) => x.t - y.t),
		/**
		 * Put every box in the state the apply tests start from: its Caspar runs the config the node generates (the fake
		 * reads the written file at restart), so "dirty" begins false. One plain single-box apply per box, before linking.
		 */
		async baseline() {
			for (const b of bed.boxes.values()) {
				const r = await b.node.post('/api/caspar-config/apply', { force: true }, 40000)
				assert.equal(r.status, 200, `${b.id} baseline apply: ${r.status} ${JSON.stringify(r.data)?.slice(0, 200)}`)
			}
			for (const b of bed.boxes.values()) {
				await bed.waitConnected(b.id)
				await waitFor(`${b.id} aligned with its Caspar`, async () => (await b.node.get('/api/state')).data?.configComparison?.aligned === true, 15000, 150)
				await refreshChannels(b.id)
			}
			return bed.mark()
		},
		/** Wait until the node of `id` is connected to its (restarted) fake Caspar again. */
		waitConnected: (id, ms = 15000) => waitFor(`${id} connected to its Caspar`, async () => (await box(id).node.get('/api/device-view')).data?.live?.caspar?.connected === true, ms, 100),
	}
}

module.exports = { applyHelpers }
