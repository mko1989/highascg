'use strict'

/**
 * WO-1036 — camera pictures of the persons on stage, for the operator to name (presenters.js `capture` /
 * `nameCapture`). The detection sidecar writes one JPEG per person per camera; this picks ONE per person and gives it
 * the key the operator's binding uses: with fused cameras the fused person (`w:<id>` — the binding then survives the
 * person being hidden in one camera) and the picture where they are largest; with one camera, `camera:tid`.
 */

const NOT_RUNNING = 'Person detection is not running on this server: nothing to take a picture of.'

const area = (s) => (Array.isArray(s.box) ? Math.max(0, s.box[2] - s.box[0]) * Math.max(0, s.box[3] - s.box[1]) : 0)

/**
 * @param {{ camera: string, tid: number, file: string, box?: number[] }[]} shots
 * @param {{ fused: boolean, persons: { id: number, age_s: number, keys: string[] }[] }} world
 * @returns {{ keep: object[], drop: object[] }} keep: one per person, with `key`; drop: files nobody will name
 */
function pickPerPerson(shots, world) {
	const owner = new Map()
	if (world.fused) for (const w of world.persons) if (w.age_s === 0) for (const k of w.keys) owner.set(k, w.id)
	const best = new Map()
	const drop = []
	for (const s of shots) {
		const wid = owner.get(`${s.camera}:${s.tid}`)
		const key = world.fused ? (wid === undefined ? '' : `w:${wid}`) : `${s.camera}:${s.tid}`
		const prev = best.get(key)
		if (!key || (prev && area(prev) >= area(s))) drop.push(s)
		else {
			if (prev) drop.push(prev)
			best.set(key, { ...s, key })
		}
	}
	return { keep: [...best.values()], drop }
}

/** POST /api/tracking/presenters/capture → { status, body } */
async function takeCameraPictures({ presenters, detect, worldPersons }) {
	if (!presenters || !detect?.available) return { status: 409, body: { error: NOT_RUNNING } }
	const shots = await detect.capture(presenters.captureDir())
	const { keep, drop } = pickPerPerson(shots, { fused: detect.solvedCameras >= 2, persons: worldPersons() })
	// a keyless entry is deleted by capture(): no camera picture is left behind unnamed and unlisted
	const taken = presenters.capture([...keep, ...drop.map((s) => ({ ...s, key: '' }))])
	return { status: 200, body: { taken, captures: presenters.snapshot().captures } }
}

module.exports = { pickPerPerson, takeCameraPictures }
