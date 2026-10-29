'use strict'

/**
 * WO-804 — Calibrate the rig: GET / POST /api/tracking/follow/calibrate/rig (one session per server, in memory).
 * The app picks the anchor heads (rig-anchors.js), the operator puts each one's real beam on its marks in order — one
 * prompt at a time, "aim <head> at <mark>" — through the WO-700 live calibration session (calibrate-session.js
 * `point` with the mark's `at`: the angles the real head gets, from DMX), each anchor is solved
 * (calibrate-solve.js solvePoseForward) and every other head is inferred (rig-infer.js).
 *
 *   {action: 'start', max?}   plan the anchors and open the first; 409 without 3 marks or 2 heads
 *   {action: 'point'}         the beam of the prompted head is on the prompted mark
 *   {action: 'skip'}          that mark can't be reached: another mark replaces it (none left → the head is skipped)
 *   {action: 'skip_head'}     the prompted head is left to inference
 *   {action: 'undo'}          drop the prompted head's last mark
 *   {action: 'infer'}         stop measuring: the rest is inferred from the anchors solved so far
 *   {action: 'measure', id}   measure this head too (it joins the end of the anchors; prompted at once when all are done)
 *   {action: 'end'}           close (the head being measured is released)
 * Every reply is the session view: anchors with their status / fit, the prompt, and `result` (rig-infer.js inferRig:
 * every head measured or inferred with its residual). project.fixtures is client-owned: the client writes
 * `calibrated_pose` from `result` (follow_model.gd apply_rig).
 */

const { chooseAnchors, normalizeMarks, marksFor } = require('./rig-anchors')
const { inferRig } = require('./rig-infer')
const { solvePoseForward } = require('./calibrate-solve')
const { liveModel } = require('./calibrate-session')

/** @param {{ engine, calib, project?: () => object | null }} deps calib: calibrate-session.js createCalibration() */
function createRigCalibration({ engine, calib, project = () => null }) {
	let s = null // { rows, anchors: [{ id, name, row, marks, taken, status, solve, error }], cur, done, solved }

	const heads = () =>
		engine.fixtures
			.filter((fx) => fx.enabled && !fx.problem && liveModel(fx))
			.map((fx) => ({ id: fx.id, name: fx.name, pose: fx.pose }))
	const marks = () => normalizeMarks(project()?.fixtures?.marks)
	const markOf = (id) => marks().find((m) => m.id === id) || null
	const fxOf = (id) => engine.fixtures.find((f) => f.id === id)

	/** Open the live session on the current anchor; a head that can't be calibrated is skipped. */
	function openCur() {
		while (s.cur < s.anchors.length) {
			const a = s.anchors[s.cur]
			const r = calib.handle({ action: 'start', id: a.id, hold: false })
			if (r.status === 200) {
				a.status = 'measuring'
				return
			}
			Object.assign(a, { status: 'skipped', error: r.body?.error || 'cannot be calibrated' })
			s.cur++
		}
		s.done = true
	}

	function closeCur(status) {
		const a = s.anchors[s.cur]
		if (!a) return
		calib.handle({ action: 'end', id: a.id })
		if (status) a.status = status
		s.cur++
	}

	function solveCur(points) {
		const a = s.anchors[s.cur]
		const fx = fxOf(a.id)
		const lm = fx ? liveModel(fx) : null
		a.solve = lm ? solvePoseForward(points, lm.forward, { pose: fx.pose }) : { ok: false, need: 3 }
		if (a.solve.ok) s.solved[a.id] = a.solve
		closeCur(a.solve.ok ? 'solved' : 'skipped')
		openCur()
	}

	function view() {
		if (!s) return { active: false }
		const a = s.done ? null : s.anchors[s.cur]
		const m = a ? markOf(a.marks[a.taken]) : null
		const names = new Map(marks().map((k) => [k.id, k.name]))
		return {
			active: true,
			done: s.done,
			rows: s.rows.length,
			anchors: s.anchors.map((x) => ({
				id: x.id,
				name: x.name,
				row: x.row,
				status: x.status,
				marks: x.marks.map((id) => ({ id, name: names.get(id) || `Mark ${id}` })),
				taken: x.taken,
				rms_deg: x.solve?.ok ? x.solve.rms_deg : null,
				warning: x.solve?.warning || x.error || null,
			})),
			prompt: a
				? { id: a.id, name: a.name, anchor: s.cur + 1, anchors: s.anchors.length, n: a.taken + 1, of: a.marks.length,
					mark: m }
				: null,
			result: Object.keys(s.solved).length ? inferRig(heads(), s.solved, s.rows) : null,
		}
	}

	function handle(data) {
		const action = data?.action
		if (action === 'start') {
			if (s) closeCur()
			const list = heads()
			const mk = marks()
			if (list.length < 2) return { status: 409, body: { error: 'the rig needs 2 or more pan / tilt heads with a GDTF type' } }
			if (mk.length < 3) return { status: 409, body: { error: 'place at least 3 stage marks first (Preset marks)' } }
			const plan = chooseAnchors(list, { marks: mk, max: data.max })
			s = { rows: plan.rows, anchors: plan.anchors.map((x) => ({ ...x, taken: 0, status: 'pending', solve: null })), cur: 0,
				done: false, solved: {} }
			openCur()
			return { status: 200, body: view() }
		}
		if (action === 'end') {
			if (s && !s.done) closeCur()
			s = null
			return { status: 200, body: { active: false, ended: true } }
		}
		if (!s) return { status: 409, body: { error: 'no rig calibration — start first' } }
		const a = s.done ? null : s.anchors[s.cur]
		if (action === 'measure') {
			const id = String(data.id || '')
			const h = heads().find((x) => x.id === id)
			if (!h) return { status: 404, body: { error: `no pan / tilt head "${id}" to measure` } }
			if (a?.id === id) return { status: 200, body: view() }
			delete s.solved[id]
			const at = s.anchors.findIndex((x) => x.id === id)
			if (at >= 0 && at < s.cur) s.cur--
			if (at >= 0) s.anchors.splice(at, 1)
			s.anchors.push({ id, name: h.name, row: s.rows.find((r) => r.heads.includes(id))?.id, marks: marksFor(h, marks()),
				taken: 0, status: 'pending', solve: null })
			if (s.done) {
				s.done = false
				s.cur = s.anchors.length - 1
				openCur()
			}
			return { status: 200, body: view() }
		}
		if (action === 'infer') {
			if (a) closeCur('inferred')
			for (const x of s.anchors) if (x.status === 'pending') x.status = 'inferred'
			s.done = true
			return { status: 200, body: view() }
		}
		if (!a) return { status: 409, body: { error: 'every anchor is done — measure a head, or end' } }
		if (action === 'point') {
			const m = markOf(a.marks[a.taken])
			if (!m) return { status: 409, body: { error: 'the prompted mark was removed — skip it' } }
			const r = calib.handle({ action: 'point', id: a.id, at: [m.x, m.y, m.z] })
			if (r.status !== 200) return r
			a.taken++
			if (a.taken >= a.marks.length) solveCur(r.body.points)
			return { status: 200, body: view() }
		}
		if (action === 'undo') {
			if (a.taken > 0) {
				calib.handle({ action: 'undo', id: a.id })
				a.taken--
			}
			return { status: 200, body: view() }
		}
		if (action === 'skip') {
			const fx = fxOf(a.id)
			const left = marks().filter((m) => !a.marks.includes(m.id))
			const next = fx && left.length ? marksFor({ pose: fx.pose }, left, 1)[0] : null
			if (next === undefined || next === null) {
				closeCur('skipped')
				openCur()
			} else a.marks.splice(a.taken, 1, next)
			return { status: 200, body: view() }
		}
		if (action === 'skip_head') {
			closeCur('skipped')
			openCur()
			return { status: 200, body: view() }
		}
		return { status: 400, body: { error: 'action must be start | point | skip | skip_head | undo | infer | measure | end' } }
	}

	return {
		handle,
		view,
		/** The HTTP face: GET → the view; POST {action, …} → handle. */
		route(method, body) {
			if (method === 'GET') return { status: 200, body: view() }
			if (method !== 'POST') return { status: 405, body: { error: 'GET or POST' } }
			let data
			try {
				data = JSON.parse(body || '{}')
			} catch {
				return { status: 400, body: { error: 'body must be JSON' } }
			}
			return handle(data)
		},
	}
}

module.exports = { createRigCalibration }
