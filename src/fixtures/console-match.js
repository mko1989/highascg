'use strict'

/**
 * Match the project to the lighting console's head positions (owner 14.11: "how can we automate it so highascg matches
 * chamsys positions"). MagicQ sends no positions over OSC; it prints them: Patch → View Heads → File → Print Window →
 * Create CSV. This reads that CSV (the column headings of the MagicQ manual, "Importing Heads → Supported Column
 * Headings": comma or semicolon, case-insensitive), pairs its rows with the patch (universe + address first, the head
 * number / MVR FixtureID second) and finds the ONE move of the whole project that puts our heads on the console's.
 *
 *   Console frame (MagicQ): X across, Y up, Z depth. Ours (PSN / hub): x stage left, y upstage, z up.
 *   A console position in our frame is (X, −Z, Y) — the same mapping PSN output `y_up` sends (psn.js).
 *
 * Pure: parseCsv(text) → { rows, columns, problems } · pair(rows, patch, fidOf) → { pairs, by, unmatched }
 *       fit(pairs) → { shift, rms, max, yaw_deg, mirrored, worst } · shiftProject(project, shift) (in place)
 *       setHeads(project, pairs) (in place: each paired head takes the console's position)
 *       exportCsv(patch, fidOf) → the other way: our positions as a CSV MagicQ imports with "Vis only" (Patch → View
 *       Chans → Import Heads): head number, DMX (MagicQ universe = Art-Net universe + 1), X / Y / Z in metres.
 */

const HEAD = ['head no', 'headno', 'hdno', 'headnum', 'head', 'channel', 'spot', 'fixture id']
const NAME = ['head name', 'hd name', 'headname', 'hdname', 'name', 'purpose', 'short name']
const UNI = ['universe', 'dmx line', 'uni']
const DMX = ['dmx', 'dmx no', 'dmxno', 'dmx num', 'dmx address', 'dmx channel', 'dmx patch', 'patch', 'patch address', 'address']
const AX = {
	x: ['x', 'x location', 'x pos', 'x position', 'position x', 'pos x'],
	y: ['y', 'y location', 'y pos', 'y position', 'position y', 'pos y'],
	z: ['z', 'z location', 'z pos', 'z position', 'position z', 'pos z'],
}

const r4 = (v) => Math.round(v * 1e4) / 1e4

/** One CSV line → cells (quotes, doubled quotes). */
function cells(line, sep) {
	const out = []
	let cur = ''
	let q = false
	for (let i = 0; i < line.length; i++) {
		const c = line[i]
		if (q) {
			if (c === '"' && line[i + 1] === '"') cur += line[++i]
			else if (c === '"') q = false
			else cur += c
		} else if (c === '"') q = true
		else if (c === sep) {
			out.push(cur)
			cur = ''
		} else cur += c
	}
	out.push(cur)
	return out.map((s) => s.trim())
}

function num(s, decimalComma) {
	let t = String(s ?? '').trim().replace(/\s*(mm|m)$/i, '')
	if (decimalComma) t = t.replace(',', '.')
	return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t) ? Number(t) : NaN
}

/** "1-001" / "2.17" / "1/1" → { universe, address }; a bare number above 512 is absolute; else address only. */
function dmxOf(s) {
	const t = String(s ?? '').trim()
	const m = /^(\d+)\s*[-./:]\s*(\d+)$/.exec(t)
	if (m) return { universe: Number(m[1]), address: Number(m[2]) }
	if (!/^\d+$/.test(t)) return null
	const n = Number(t)
	return n > 512 ? { universe: Math.floor((n - 1) / 512) + 1, address: ((n - 1) % 512) + 1 } : { universe: 0, address: n }
}

function parseCsv(text) {
	const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
	const problems = []
	const find = (hdr, names) => hdr.findIndex((h) => names.includes(h))
	let at = -1
	let sep = ','
	let col = null
	for (let i = 0; i < Math.min(lines.length, 12) && at < 0; i++) {
		for (const s of [',', ';', '\t']) {
			const hdr = cells(lines[i], s).map((h) => h.toLowerCase().replace(/[()[\]]/g, '').replace(/\s+/g, ' ').trim())
			const c = { head: find(hdr, HEAD), name: find(hdr, NAME), uni: find(hdr, UNI), dmx: find(hdr, DMX), x: find(hdr, AX.x), y: find(hdr, AX.y), z: find(hdr, AX.z) }
			if (c.x >= 0 && c.y >= 0 && c.z >= 0 && (c.head >= 0 || c.dmx >= 0)) {
				at = i
				sep = s
				col = c
				break
			}
		}
	}
	if (!col) return { rows: [], columns: null, problems: ['No heading row with X, Y, Z and a head number or DMX address was found.'] }
	const rows = []
	for (const line of lines.slice(at + 1)) {
		const c = cells(line, sep)
		const p = ['x', 'y', 'z'].map((k) => num(c[col[k]], sep === ';'))
		if (p.some((v) => !Number.isFinite(v))) continue
		const d = col.dmx >= 0 ? dmxOf(c[col.dmx]) : null
		const u = col.uni >= 0 ? num(c[col.uni]) : NaN
		const head = col.head >= 0 ? num(c[col.head]) : NaN
		rows.push({
			head: Number.isInteger(head) && head > 0 ? head : 0,
			name: col.name >= 0 ? c[col.name] || '' : '',
			universe: Number.isInteger(u) ? u : d ? d.universe : 0,
			address: d ? d.address : 0,
			pos: p,
		})
	}
	if (!rows.length) problems.push('The file has the headings but no row with three numeric positions.')
	// MagicQ works in metres; a file in millimetres has values in the thousands.
	if (rows.some((r) => r.pos.some((v) => Math.abs(v) > 500))) for (const r of rows) r.pos = r.pos.map((v) => v / 1000)
	return { rows, columns: col, problems }
}

/** Console position → our frame. */
const toOurs = (p) => [p[0], -p[2], p[1]]

/**
 * @param {object[]} rows parseCsv rows @param {object[]} patch project.fixtures.patch
 * @param {(id: string) => number} [fidOf] patch id → console head number (console-fid-map), 0 = none
 */
function pair(rows, patch, fidOf = () => 0) {
	const list = (Array.isArray(patch) ? patch : []).filter((f) => f && f.pose && f.enabled !== false)
	const tryDmx = (off) => {
		const at = new Map(list.map((f) => [`${Number(f.universe) + off}/${Number(f.address)}`, f]))
		return rows.map((r) => (r.universe > 0 && r.address > 0 ? at.get(`${r.universe}/${r.address}`) : null) || null)
	}
	// MagicQ universe U + 1 outputs Art-Net U by default (magicq-mvr.js); a desk numbered like the patch has offset 0.
	const cand = [0, 1].map((off) => ({ off, hits: tryDmx(off) }))
	const count = (c) => c.hits.filter(Boolean).length
	const dmx = count(cand[1]) > count(cand[0]) ? cand[1] : cand[0]
	const byHead = new Map()
	for (const f of list) {
		const fid = Number(fidOf(f.id)) || Number(f.fid) || 0
		if (fid > 0 && !byHead.has(fid)) byHead.set(fid, f)
	}
	const heads = rows.map((r) => (r.head ? byHead.get(r.head) || null : null))
	const useDmx = count(dmx) >= heads.filter(Boolean).length
	const hits = useDmx ? dmx.hits.map((f, i) => f || heads[i]) : heads.map((f, i) => f || dmx.hits[i])
	const seen = new Set()
	const pairs = []
	const unmatched = []
	rows.forEach((r, i) => {
		const f = hits[i]
		if (!f || seen.has(f.id)) return unmatched.push(r)
		seen.add(f.id)
		pairs.push({ id: f.id, name: f.name || r.name, head: r.head, ours: [Number(f.pose.x) || 0, Number(f.pose.y) || 0, Number(f.pose.z) || 0], target: toOurs(r.pos) })
	})
	return { pairs, by: useDmx ? 'DMX address' : 'head number', universe_offset: useDmx ? dmx.off : 0, unmatched, unpaired_patch: list.length - pairs.length }
}

const median = (a) => {
	const s = [...a].sort((x, y) => x - y)
	const m = s.length >> 1
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Best rotation (optionally with a mirror) of the floor plan about the centroids → { rms, yaw_deg }. */
function planFit(pairs, mirror) {
	const n = pairs.length
	const c = (k, i) => pairs.reduce((s, p) => s + p[k][i], 0) / n
	const [ax, ay, bx, by] = [c('ours', 0), c('ours', 1), c('target', 0), c('target', 1)]
	let sc = 0
	let ss = 0
	const pts = pairs.map((p) => [(mirror ? -1 : 1) * (p.ours[0] - ax), p.ours[1] - ay, p.target[0] - bx, p.target[1] - by])
	for (const [x, y, u, v] of pts) {
		sc += x * u + y * v
		ss += x * v - y * u
	}
	const th = Math.atan2(ss, sc)
	let e = 0
	for (const [x, y, u, v] of pts) e += (x * Math.cos(th) - y * Math.sin(th) - u) ** 2 + (x * Math.sin(th) + y * Math.cos(th) - v) ** 2
	return { rms: Math.sqrt(e / n), yaw_deg: (th * 180) / Math.PI }
}

function fit(pairs) {
	if (!pairs.length) return null
	const shift = [0, 1, 2].map((i) => r4(median(pairs.map((p) => p.target[i] - p.ours[i]))))
	const errs = pairs.map((p) => ({ id: p.id, name: p.name, head: p.head, err: Math.hypot(...[0, 1, 2].map((i) => p.target[i] - p.ours[i] - shift[i])) }))
	const rms = Math.sqrt(errs.reduce((s, e) => s + e.err * e.err, 0) / errs.length)
	const out = { shift: { x: shift[0], y: shift[1], z: shift[2] }, rms: r4(rms), max: r4(Math.max(...errs.map((e) => e.err))), yaw_deg: 0, mirrored: false }
	if (pairs.length >= 3) {
		const plain = planFit(pairs, false)
		const flip = planFit(pairs, true)
		out.yaw_deg = Math.round(plain.yaw_deg * 100) / 100
		out.turned_rms = r4(plain.rms)
		out.mirrored = flip.rms + 0.05 < plain.rms * 0.5 // a mirrored plan fits clearly better than a turned one
	}
	out.worst = errs.sort((a, b) => b.err - a.err).slice(0, 8).map((e) => ({ ...e, err: r4(e.err) }))
	return out
}

/** Move every stage-frame coordinate of the project by `shift` ({x, y, z}, metres), in place. */
function shiftProject(project, shift) {
	const [dx, dy, dz] = [Number(shift.x) || 0, Number(shift.y) || 0, Number(shift.z) || 0]
	const xyz = (o) => {
		if (!o || typeof o !== 'object') return
		o.x = r4((Number(o.x) || 0) + dx)
		o.y = r4((Number(o.y) || 0) + dy)
		o.z = r4((Number(o.z) || 0) + dz)
	}
	const pv = project.previs || {}
	if (pv.mvr?.id) xyz((pv.mvr.place ||= { x: 0, y: 0, z: 0, yaw: 0 }))
	for (const o of pv.stage?.objects || []) {
		// stage objects are stored in Godot's frame: [x, up, −y]
		if (Array.isArray(o.position) && o.position.length === 3) o.position = [r4(o.position[0] + dx), r4(o.position[1] + dz), r4(o.position[2] - dy)]
	}
	const t = pv.tracking || {}
	if (t.grid) {
		t.grid.x_offset = r4((Number(t.grid.x_offset) || 0) + dx)
		t.grid.y_offset = r4((Number(t.grid.y_offset) || 0) + dy)
		t.grid.z_offset = r4((Number(t.grid.z_offset) || 0) + dz)
	}
	for (const c of t.cameras || []) {
		if (c.cam) {
			c.cam.pos_x = (Number(c.cam.pos_x) || 0) + dx
			c.cam.pos_y = (Number(c.cam.pos_y) || 0) + dy
			c.cam.pos_z = (Number(c.cam.pos_z) || 0) + dz
		}
		for (const p of c.points || []) if (Array.isArray(p.world) && p.world.length === 3) p.world = [r4(p.world[0] + dx), r4(p.world[1] + dy), r4(p.world[2] + dz)]
	}
	for (const p of t.ptz || []) xyz(p.pose)
	for (const f of project.fixtures?.patch || []) xyz(f.pose)
	for (const m of project.fixtures?.marks || []) xyz(m)
	return project
}

/** Each paired head takes the console's position (after any shift), in place → how many moved. */
function setHeads(project, pairs) {
	const at = new Map(pairs.map((p) => [p.id, p.target]))
	let n = 0
	for (const f of project.fixtures?.patch || []) {
		const t = at.get(f.id)
		if (!t || !f.pose) continue
		f.pose.x = r4(t[0])
		f.pose.y = r4(t[1])
		f.pose.z = r4(t[2])
		n++
	}
	return n
}

/** Our patch → the console's CSV (positions only; rotations are left to the console). Heads without a number are skipped. */
function exportCsv(patch, fidOf = () => 0) {
	const rows = []
	for (const f of Array.isArray(patch) ? patch : []) {
		const head = Number(fidOf(f?.id)) || Number(f?.fid) || 0
		if (!head || !f.pose || f.enabled === false) continue
		const u = Number(f.universe) + (f.protocol === 'sacn' ? 0 : 1)
		const n = (v) => (Math.round((Number(v) || 0) * 100) / 100).toFixed(2)
		rows.push([head, `"${String(f.name || '').replace(/"/g, "'")}"`, `${u}-${String(f.address).padStart(3, '0')}`, n(f.pose.x), n(f.pose.z), n(-f.pose.y)])
	}
	rows.sort((a, b) => a[0] - b[0])
	return { csv: ['Head no,Head name,DMX,X,Y,Z', ...rows.map((r) => r.join(','))].join('\r\n') + '\r\n', heads: rows.length }
}

module.exports = { parseCsv, pair, fit, shiftProject, setHeads, dmxOf, exportCsv }
