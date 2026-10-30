'use strict'

/**
 * WO-675 — presenter roster for recognition on stage. The audio tech sends a photo + name + mic number + note from
 * the phone intake page (presenter-routes.js); the operator binds a presenter to a tracked person (always by hand,
 * owner D1: the faces only SUGGEST); a bound presenter drives a hub marker named after them, and a zone action
 * `presenter` fires that presenter's own actions (look / Companion — the mic is a Companion button, owner D4).
 *
 * Owner D2 (WO-835): everything lives in /tmp (photos, roster, face features) and nowhere else. Never in the project,
 * config/, a stick or Syncthing. A reboot removes /tmp; a server restart removes it too, because a fresh process
 * starts with an EMPTY roster and deletes any leftover files (no load() from disk), and a clean shutdown deletes them
 * as well. That is exactly what the consent text on the intake page promises. D3: no photo without the consent tick.
 *
 * Faces: tools/tracking-detect/face_embed.py (OpenCV Zoo YuNet + SFace) gives each intake photo a 128-d unit
 * feature; the detection sidecar sends features of the persons on stage (`observe`). Cosine similarity, smoothed per
 * (person, presenter); a suggestion needs SUGGEST_MIN (SFace's published 0.363 same-person threshold) and a margin
 * over the next presenter. Bodies (P2): the same photo's whole-body feature (youtureid, 768-d) for wide shots where
 * faces are too small; face and body evidence are fused in presenter-match.js.
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const childProcess = require('child_process')
const { parseAction } = require('./zone-actions')
const { createMatcher, unit, KINDS } = require('./presenter-match')

const DEFAULT_DIR = path.join(os.tmpdir(), 'highascg-presenters')
// WO-835: the roots a presenter dir may live under: tmpfs-like locations that a reboot empties.
const TMP_ROOTS = () => [os.tmpdir(), '/dev/shm']
const DIR = process.env.HIGHASCG_PRESENTERS_DIR || DEFAULT_DIR
const MARKER_BASE = 65000 // presenter n drives hub marker MARKER_BASE + n (hub ids are 1…65535)
const MAX_PRESENTERS = 200
const MAX_PHOTO_BYTES = 6 * 1024 * 1024
const SUGGEST_MIN = KINDS.face.min
const TEXT_MAX = { name: 64, mic: 16, note: 280 }
const ACTIONS_MAX = 8

/** WO-835: a dir is acceptable only inside a tmp root; anything else (repo, config/, ~) would let photos outlive a reboot. */
function underTmp(dir) {
	const d = path.resolve(dir)
	return TMP_ROOTS().some((r) => d.startsWith(path.resolve(r) + path.sep))
}

const STALE = /^(roster\.json(\.tmp)?|p\d+\.jpg)$/

const clip = (v, n) => String(v ?? '').trim().slice(0, n)

/** One action per line / comma; only look: and companion: (a presenter's action never fires another presenter). */
function cleanActions(v) {
	const list = Array.isArray(v) ? v : String(v ?? '').split(/[\n,]/)
	return list.map((s) => String(s).trim()).filter((s) => {
		const a = parseAction(s)
		return a && (a.type === 'look' || a.type === 'companion')
	}).slice(0, ACTIONS_MAX)
}

/**
 * @param {object} ctx  server ctx (log)
 * @param {{ hub?, dir?, now?, embed?: (photoPath) => Promise<{ok, feature?, detail?, body?: {ok, feature?, detail?}}>,
 *   onChange?: () => void }} deps
 */
function createPresenters(ctx, deps = {}) {
	const log = typeof ctx?.log === 'function' ? ctx.log.bind(ctx) : () => {}
	const wanted = deps.dir || DIR
	const dir = underTmp(wanted) ? path.resolve(wanted) : DEFAULT_DIR
	if (dir !== path.resolve(wanted)) log('warn', `[presenters] ${wanted} is not under a tmp dir (owner D2: photos never persist); using ${dir}`)
	const now = deps.now || Date.now
	const hub = deps.hub || null
	const embed = deps.embed || defaultEmbed
	const roster = new Map() // id → presenter (with `face` / `body`: unit feature | null)
	const matcher = createMatcher(now)
	let rev = 0
	const changed = () => {
		rev++
		save()
		if (typeof deps.onChange === 'function') deps.onChange()
	}

	function ensureDir() {
		fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
	}

	function save() {
		try {
			ensureDir()
			const tmp = path.join(dir, 'roster.json.tmp')
			fs.writeFileSync(tmp, JSON.stringify({ presenters: [...roster.values()] }), { mode: 0o600 })
			fs.renameSync(tmp, path.join(dir, 'roster.json'))
		} catch (e) {
			log('warn', '[presenters] save: ' + (e?.message || e))
		}
	}

	/** WO-835: delete every presenter file in the dir (own file names only). A new process never reloads them. */
	function wipe() {
		let names
		try {
			names = fs.readdirSync(dir)
		} catch (_) {
			return 0
		}
		let n = 0
		for (const f of names.filter((x) => STALE.test(x))) {
			try {
				fs.unlinkSync(path.join(dir, f))
				n++
			} catch (_) {
				/* already gone */
			}
		}
		return n
	}

	function nextSlot() {
		const used = new Set([...roster.values()].map((p) => p.slot))
		for (let n = 1; n <= MAX_PRESENTERS; n++) if (!used.has(n)) return n
		return 0
	}

	const photoPath = (id) => path.join(dir, `${id}.jpg`)

	/** Public shape (no features: 128 + 768 floats per presenter are server business). */
	function view(p) {
		return { id: p.id, name: p.name, mic: p.mic, note: p.note, created: p.created, marker: MARKER_BASE + p.slot,
			face: p.face_status, body: p.body_status || 'unavailable', person: p.person, on_enter: p.on_enter, on_exit: p.on_exit }
	}

	/** {name, mic, note, consent, photo: base64 JPEG (data URL ok)} → { status, body } */
	async function create(data) {
		if (data?.consent !== true) return { status: 400, body: { error: 'consent is required (the presenter agreed to the photo being used for show automation)' } }
		const name = clip(data.name, TEXT_MAX.name)
		if (!name) return { status: 400, body: { error: 'name is required' } }
		const b64 = String(data.photo || '').replace(/^data:image\/jpeg;base64,/, '')
		const jpg = Buffer.from(b64, 'base64')
		if (jpg.length < 100 || jpg[0] !== 0xff || jpg[1] !== 0xd8) return { status: 400, body: { error: 'photo must be a JPEG' } }
		if (jpg.length > MAX_PHOTO_BYTES) return { status: 413, body: { error: 'photo too large' } }
		const slot = nextSlot()
		if (!slot) return { status: 409, body: { error: 'roster full' } }
		const id = `p${slot}`
		ensureDir()
		fs.writeFileSync(photoPath(id), jpg, { mode: 0o600 })
		const p = { id, slot, name, mic: clip(data.mic, TEXT_MAX.mic), note: clip(data.note, TEXT_MAX.note), created: now(),
			consent_at: now(), face_status: 'pending', face: null, body_status: 'pending', body: null, person: null, on_enter: [], on_exit: [] }
		roster.set(id, p)
		changed()
		log('info', `[presenters] ${id} "${name}" mic ${p.mic || '—'} added`)
		embed(photoPath(id)).then((r) => {
			if (roster.get(id) !== p) return
			p.face = r?.ok ? unit(r.feature) : null
			p.face_status = p.face ? 'ok' : r?.ok === false && r.detail === 'no face' ? 'none' : 'unavailable'
			if (!p.face) log('warn', `[presenters] ${id}: no face feature (${r?.detail || 'unknown'})`)
			p.body = r?.body?.ok ? unit(r.body.feature) : null
			p.body_status = p.body ? 'ok' : r?.body?.ok === false && r.body.detail === 'no person' ? 'none' : 'unavailable'
			if (!p.body) log('warn', `[presenters] ${id}: no body feature (${r?.body?.detail || 'unknown'})`)
			changed()
		})
		return { status: 201, body: { presenter: view(p) } }
	}

	function update(id, data) {
		const p = roster.get(id)
		if (!p) return { status: 404, body: { error: 'no such presenter' } }
		for (const k of ['name', 'mic', 'note']) if (data?.[k] !== undefined) p[k] = clip(data[k], TEXT_MAX[k])
		if (!p.name) p.name = id
		if (data?.on_enter !== undefined) p.on_enter = cleanActions(data.on_enter)
		if (data?.on_exit !== undefined) p.on_exit = cleanActions(data.on_exit)
		if (p.person) drive(p, null)
		changed()
		return { status: 200, body: { presenter: view(p) } }
	}

	function remove(id) {
		const p = roster.get(id)
		if (!p) return false
		roster.delete(id)
		if (hub) hub.remove(MARKER_BASE + p.slot)
		matcher.forget(id)
		try {
			fs.unlinkSync(photoPath(id))
		} catch (_) {
			/* already gone */
		}
		changed()
		return true
	}

	/** The operator's binding (D1): presenter ↔ person key (`w:<id>` fused, else `camera:tid`). A person has one presenter. */
	function assign(id, key) {
		const p = roster.get(id)
		if (!p) return { status: 404, body: { error: 'no such presenter' } }
		if (!/^\S+:\d+$/.test(String(key || ''))) return { status: 400, body: { error: 'key must be camera:tid or w:<id>' } }
		for (const q of roster.values()) if (q !== p && q.person === key) q.person = null
		p.person = String(key)
		changed()
		return { status: 200, body: { presenter: view(p) } }
	}

	function release(id) {
		const p = roster.get(id)
		if (!p) return { status: 404, body: { error: 'no such presenter' } }
		p.person = null
		if (hub) hub.remove(MARKER_BASE + p.slot)
		changed()
		return { status: 200, body: { presenter: view(p) } }
	}

	/** Features seen on stage, `kind` 'face' | 'body': [{ key, feature }] (presenter-match.js smooths them). */
	function observe(list, kind = 'face') {
		matcher.observe(kind, list, [...roster.values()])
	}

	/** [{ presenter, key, score, via }]: per person its best presenter when clear (presenter-match.js), never a pair the
	 * operator already confirmed. */
	function suggestions() {
		return matcher.suggestions((pid) => roster.has(pid), (pid, key) => roster.get(pid)?.person === key)
	}

	/** Bound presenters' markers follow their person: `locate(key)` → {x, y} | null (lost: the marker goes stale). */
	function drive(p, locate) {
		if (!hub) return
		const at = locate ? locate(p.person) : null
		const prev = hub.markers.get(MARKER_BASE + p.slot)
		const label = p.mic ? `${p.name} (mic ${p.mic})` : p.name
		if (at) hub.set({ id: MARKER_BASE + p.slot, name: label, x: at.x, y: at.y, z: 0, source: 'presenter' })
		else if (prev && prev.name !== label) hub.set({ ...prev, name: label, source: 'presenter' })
	}

	function tick(locate) {
		for (const p of roster.values()) if (p.person) drive(p, locate)
	}

	/** Zone action `presenter` (zone-service.js): the parsed actions of the presenter driving `marker`. */
	function actionsFor(marker, kind) {
		const p = [...roster.values()].find((q) => MARKER_BASE + q.slot === Number(marker))
		if (!p) return { presenter: null, actions: [] }
		const list = kind === 'first_entry' || kind === 'additional_entry' ? p.on_enter : p.on_exit
		return { presenter: p.id, name: p.name, actions: list.map(parseAction).filter(Boolean) }
	}

	function clear() {
		for (const id of [...roster.keys()]) remove(id)
		matcher.clear()
	}

	// WO-835: boot starts empty. The roster entries go with the photos: an entry exists only to be matched against its
	// photo's face/body features, so without the photo it is dead weight (and name + feature is personal data).
	const wiped = wipe()
	if (wiped) log('info', `[presenters] removed ${wiped} leftover file(s) from a previous run (photos never survive a restart)`)
	return {
		dir,
		/** Shutdown: delete photos + roster now (the consent text promises it). */
		dispose: () => {
			roster.clear()
			wipe()
		},
		get rev() {
			return rev
		},
		list: () => [...roster.values()].sort((a, b) => a.slot - b.slot).map(view),
		snapshot: () => ({ presenters: [...roster.values()].sort((a, b) => a.slot - b.slot).map(view), suggestions: suggestions() }),
		wantsFaces: () => [...roster.values()].some((p) => p.face),
		wantsBodies: () => [...roster.values()].some((p) => p.body),
		photo: (id) => (roster.has(id) ? fs.readFileSync(photoPath(id)) : null),
		create,
		update,
		remove,
		assign,
		release,
		observe,
		suggestions,
		tick,
		actionsFor,
		clear,
	}
}

/** The YOLO the intake photo's person box comes from: the plain detector if there, else any non-pose one. */
function intakeDetector(models) {
	try {
		const list = fs.readdirSync(models).filter((f) => /^yolo.*\.onnx$/.test(f) && !f.includes('-pose')).sort()
		const pick = list.includes('yolo26n.onnx') ? 'yolo26n.onnx' : list[0]
		return pick ? path.join(models, pick) : ''
	} catch (_) {
		return ''
	}
}

/** Intake photo → face + body features via the tracking venv (tools/tracking-detect/face_embed.py). */
function defaultEmbed(photo) {
	const DATA = path.join(os.homedir(), '.local', 'share', 'highascg')
	const python = process.env.HIGHASCG_TRACKING_PYTHON || path.join(DATA, 'tracking-venv', 'bin', 'python')
	const models = process.env.HIGHASCG_TRACKING_MODELS || path.join(DATA, 'models')
	const script = path.join(__dirname, '..', '..', 'tools', 'tracking-detect', 'face_embed.py')
	return new Promise((resolve) => {
		if (!fs.existsSync(python)) return resolve({ ok: false, detail: `no Python at ${python}` })
		const args = [script, photo, models, intakeDetector(models)].filter(Boolean)
		childProcess.execFile(python, args, { timeout: 30000, maxBuffer: 1 << 20 }, (err, stdout) => {
			try {
				resolve(JSON.parse(String(stdout).trim().split('\n').pop()))
			} catch (_) {
				resolve({ ok: false, detail: String(err?.message || 'face_embed failed') })
			}
		})
	})
}

module.exports = { createPresenters, cleanActions, underTmp, MARKER_BASE, SUGGEST_MIN, DIR, DEFAULT_DIR }
