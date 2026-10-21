'use strict'

/**
 * WO-616 T13b — automatic beam-spot detection for the fixture calibration (calibrate-session.js): instead of the
 * operator clicking the spot in the camera picture, the server leases the camera's shm surface (WO-597, client id
 * LEASE_ID), averages a few stills (hshm-read.js), finds the spot (beam-spot.js) and casts it onto the floor through
 * the solved camera (camera-model.pixelToFloor, plane = the tracking grid's z offset).
 *
 * POST /api/tracking/follow/calibrate/spot {camera, action?, id?, add?}
 *   action 'find' (default)  → { spot: {camera, px, raster, at, peak, contrast, area, ambiguous, reference} }; with
 *                              `id` (a fixture being calibrated) and add ≠ false, an unambiguous spot is also added
 *                              as a calibration point and the reply is that session (+ spot)
 *   action 'reference'       remember this camera's picture with the beam OFF (or aimed off stage): later finds
 *                              only look at what got brighter — LED walls and lit scenery drop out
 *   action 'clear'           forget the reference
 */

const { detectCameras } = require('../tracking/detect-model')
const { pixelToFloor } = require('../tracking/camera-model')
const { readLatestFrame } = require('../tracking/hshm-read')
const { lumaGrid, findBeamSpot } = require('./beam-spot')

const LEASE_ID = 'fixture-calibrate'
const FRAMES = 3
const WAIT_MS = 2000
const POLL_MS = 40

function createSpotFinder({ calib, project, lease, read = readLatestFrame, sleep, now = Date.now }) {
	const refs = new Map() // camera id → luma grid with the beam off
	const pause = sleep || ((ms) => new Promise((res) => setTimeout(res, ms)))

	async function grab(role) {
		await lease([role])
		const file = `/dev/shm/highascg-${role}`
		const frames = []
		let since = 0
		let last = ''
		const until = now() + WAIT_MS
		while (frames.length < FRAMES && now() < until) {
			const f = read(file, { since })
			if (f.state === 'frame') {
				frames.push(f)
				since = f.seq
			} else last = f.state + (f.error ? ` (${f.error})` : '')
			if (frames.length < FRAMES) await pause(POLL_MS)
		}
		return frames.length ? { grid: lumaGrid(frames) } : { error: `no picture from ${role} (${last || 'timeout'})` }
	}

	async function handle(data) {
		const id = String(data?.camera || '')
		const tracking = project()?.previs?.tracking
		const c = detectCameras(tracking, { cameras: {} }).find((k) => k.id === id)
		if (!c) return { status: 404, body: { error: `no tracking camera "${id}" with a video surface` } }
		const action = data?.action || 'find'
		if (action === 'clear') {
			refs.delete(id)
			return { status: 200, body: { camera: id, reference: false } }
		}
		if (action !== 'find' && action !== 'reference') return { status: 400, body: { error: 'action must be find | reference | clear' } }
		const g = await grab(c.role)
		if (g.error) return { status: 503, body: { error: g.error } }
		if (action === 'reference') {
			refs.set(id, g.grid)
			return { status: 200, body: { camera: id, reference: true } }
		}
		if (!c.cam) return { status: 409, body: { error: `camera "${id}" is not calibrated — solve it first (T3)` } }
		const s = findBeamSpot(g.grid, { ref: refs.get(id) || null })
		const [w, h] = c.raster
		const spot = { camera: id, raster: [w, h], ...s }
		if (!s.ok) return { status: 422, body: { error: s.reason, spot } }
		spot.px = [(s.px[0] * w) / g.grid.width, (s.px[1] * h) / g.grid.height].map((v) => Math.round(v * 10) / 10)
		const planeZ = Number(tracking?.grid?.z_offset) || 0
		const at = pixelToFloor(c.cam, spot.px, w, h, planeZ)
		if (!at || !at.every(Number.isFinite)) return { status: 422, body: { error: 'the spot does not land on the floor in this camera', spot } }
		spot.at = at.map((v) => Math.round(v * 1000) / 1000)
		if (!data.id || data.add === false) return { status: 200, body: { spot } }
		if (s.ambiguous) return { status: 409, body: { error: 'two bright areas — click the right one in the picture, or take a reference', spot } }
		const r = calib.handle({ action: 'point', id: data.id, at: spot.at })
		return { status: r.status, body: { ...r.body, spot } }
	}

	return { handle }
}

module.exports = { createSpotFinder, LEASE_ID }
