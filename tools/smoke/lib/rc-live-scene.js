'use strict'

/**
 * WO-1082 — the live box's MVR scenes for the RC smokes, read straight from projects/ (never written).
 *   liveScene({ id? }) → { inp, dir, name, mvrStore } | null
 *     id given   the project that shows THAT scene (the show-specific assertions are pinned to the scene they describe)
 *     no id      the newest project with an MVR scene (whatever show is live: only what must hold for ANY show)
 *   NARVIL     the scene the show-specific assertions were written against (Narvil, 27 × 61 m banquet hall + stage)
 * mvr-store reads projectsRoot() (a temp dir under the test runner): mvrStore points it at the live dir per read call.
 */

const fs = require('fs')
const path = require('path')

const NARVIL = '405f970d98a2'

function liveScene({ id } = {}) {
	const { LIVE_PROJECTS_DIR } = require('../../../src/engine/projects-root')
	const { sceneInputs } = require('../../../modules/rc-game/server/rc-scene')
	let best = null
	for (const f of fs.existsSync(LIVE_PROJECTS_DIR) ? fs.readdirSync(LIVE_PROJECTS_DIR) : []) {
		if (!/^[\w-]+\.json$/.test(f)) continue
		try {
			const full = path.join(LIVE_PROJECTS_DIR, f)
			const inp = sceneInputs(JSON.parse(fs.readFileSync(full, 'utf8')))
			if (!inp.id || (id && inp.id !== id)) continue
			if (!fs.existsSync(path.join(LIVE_PROJECTS_DIR, '_mvr', `${inp.id}.json`))) continue
			const t = fs.statSync(full).mtimeMs
			if (!best || t > best.t) best = { inp, t, name: f }
		} catch {
			/* not a project */
		}
	}
	if (!best) return null
	const store = require('../../../src/stage/mvr-store')
	const withLive = (fn) => {
		const prev = process.env.HIGHASCG_PROJECTS_DIR
		process.env.HIGHASCG_PROJECTS_DIR = LIVE_PROJECTS_DIR
		try {
			return fn()
		} finally {
			if (prev == null) delete process.env.HIGHASCG_PROJECTS_DIR
			else process.env.HIGHASCG_PROJECTS_DIR = prev
		}
	}
	const mvrStore = { get: (k) => withLive(() => store.get(k)), mesh: (k, key) => withLive(() => store.mesh(k, key)) }
	return { inp: best.inp, dir: LIVE_PROJECTS_DIR, name: best.name, mvrStore }
}

module.exports = { liveScene, NARVIL }
