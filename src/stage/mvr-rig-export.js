'use strict'

/**
 * WO-765 — the calibrated rig → an MVR the desk imports (grandMA3 / MagicQ), so its 3D layout — and its position-based
 * aiming (PSN, XYZ / MArker, tracker palettes) — matches the real stage. Pure (the caller reads the files).
 *
 * Built from the ORIGINAL imported archive (projects/_mvr/<id>.mvr, the scene the project shows): every member is kept,
 * and in GeneralSceneDescription.xml only the <Matrix> of each patched fixture with a calibrated_pose (WO-764 / WO-804)
 * is replaced (mvr-xml-spans.js: the fixture's own Matrix, nothing re-serialised) — fixture UUIDs, FixtureID, unit,
 * addresses, GDTFSpec / GDTFMode, layers, classes, groups, trusses and every other object stay byte for byte, so a desk
 * that matches by UUID / FixtureID moves its existing fixtures instead of adding a second rig. Added (stable UUIDs, so a
 * re-export updates them): a "HighAsCG fixtures" layer for patch heads the archive does not have (the build path: their
 * GDTFs from the type store), a "HighAsCG marks" layer of FocusPoints for the stage marks, and one XML comment after the
 * declaration listing every head: calibrated (measured) / inferred / unchanged, the move, the fit.
 *
 *   frames   calibrated_pose is a STAGE pose (PSN m, the previs frame); the file frame is the stage with the scene's
 *            placement undone (project.previs.mvr.place: shift + turn, mvr_model.gd place_pose).
 *   matrix   world = matrixFromPose(file pose, old world) (mvr-patch.js: the exact inverse of the importer's
 *            poseFromMatrix, column scales and handedness kept); the element is LOCAL to its parent, so
 *            local' = local · world⁻¹ · world'.
 *   types    opts.patchTypes: also write HighAsCG's own types / modes / addresses (magicq-mvr.js rewriteScene, the
 *            WO-796 MagicQ path: a scene whose GDTFs are placeholders HighAsCG replaced).
 */

const { mul, mvrMatrix } = require('./mvr-math')
const { poseFromMatrix, matrixFromPose } = require('./mvr-patch')
const { scanScene, splice } = require('./mvr-xml-spans')
const { uuidOf } = require('./mvr-export')
const { rewriteScene, absAddress } = require('../vr/magicq-mvr')
const { turnedDeg } = require('../fixtures/calibrate-pose')

const SCENE = 'GeneralSceneDescription.xml'
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const r3 = (v) => Math.round(v * 1000) / 1000 || 0
const r2 = (v) => Math.round(v * 100) / 100 || 0
const wrap = (v) => ((((v + 180) % 360) + 360) % 360) - 180

/** Stage pose → file pose: the scene placement undone (place = { x, y, z, yaw }, Godot Y turn of −yaw then shift). */
function unplace(pose, place) {
	const p = place || {}
	const a = ((Number(p.yaw) || 0) * Math.PI) / 180
	// Godot frame g = (x, z, −y); stage g = Ry(−yaw) · file g + T  ⇒  file g = Ry(yaw) · (stage g − T)
	const gx = (Number(pose.x) || 0) - (Number(p.x) || 0)
	const gy = (Number(pose.z) || 0) - (Number(p.z) || 0)
	const gz = -(Number(pose.y) || 0) + (Number(p.y) || 0)
	const fx = gx * Math.cos(a) + gz * Math.sin(a)
	const fz = -gx * Math.sin(a) + gz * Math.cos(a)
	return { ...pose, x: fx, y: -fz, z: gy, yaw: wrap((Number(pose.yaw) || 0) - (Number(p.yaw) || 0)) }
}

/**
 * Affine 4×4 (column-major) inverse; null when singular (WO-1106 B22: a zero-scale source matrix divided by det 0 and
 * wrote NaN into the exported matrix).
 */
function invAffine(m) {
	const a = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]]
	const det = a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
		a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
	if (!(Math.abs(det) >= 1e-12)) return null
	const inv = [
		[(a[1][1] * a[2][2] - a[1][2] * a[2][1]) / det, (a[0][2] * a[2][1] - a[0][1] * a[2][2]) / det, (a[0][1] * a[1][2] - a[0][2] * a[1][1]) / det],
		[(a[1][2] * a[2][0] - a[1][0] * a[2][2]) / det, (a[0][0] * a[2][2] - a[0][2] * a[2][0]) / det, (a[0][2] * a[1][0] - a[0][0] * a[1][2]) / det],
		[(a[1][0] * a[2][1] - a[1][1] * a[2][0]) / det, (a[0][1] * a[2][0] - a[0][0] * a[2][1]) / det, (a[0][0] * a[1][1] - a[0][1] * a[1][0]) / det],
	]
	const t = [m[12], m[13], m[14]]
	const out = new Array(16).fill(0)
	for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) out[c * 4 + r] = inv[r][c]
	for (let r = 0; r < 3; r++) out[12 + r] = -(inv[r][0] * t[0] + inv[r][1] * t[1] + inv[r][2] * t[2])
	out[15] = 1
	return out
}

/** Column-major 4×4 (metres) → MVR <Matrix> text {u}{v}{w}{o mm}. */
function matrixText(m) {
	const f = (v, d) => {
		const n = Number(v.toFixed(d))
		return String(n === 0 ? 0 : n)
	}
	const col = (c, k, d) => `{${[0, 1, 2].map((r) => f(m[c * 4 + r] * k, d)).join(',')}}`
	return `${col(0, 1, 9)}${col(1, 1, 9)}${col(2, 1, 9)}${col(3, 1000, 3)}`
}

/** One fixture element for a patch head the archive does not have (the build path). */
function fixtureXml(fx, uuid, world, nameOf, fid) {
	const a = absAddress(fx)
	return [
		`<Fixture name="${esc(fx.name)}" uuid="${uuid}">`,
		`<Matrix>${matrixText(world)}</Matrix>`,
		`<GDTFSpec>${esc(nameOf(fx.typeId))}</GDTFSpec>`,
		`<GDTFMode>${esc(fx.mode)}</GDTFMode>`,
		a ? `<Addresses><Address break="0">${a}</Address></Addresses>` : '<Addresses/>',
		`<FixtureID>${fid}</FixtureID>`,
		'<UnitNumber>0</UnitNumber>',
		'</Fixture>',
	].join('')
}

const layerXml = (name, children) =>
	`<Layer name="${esc(name)}" uuid="${uuidOf(`layer:highascg:${name}`)}"><ChildList>${children.join('\n')}</ChildList></Layer>\n`

/** The report comment (no "--" inside an XML comment). */
function commentOf(report) {
	const c = report.counts
	const lines = [
		`HighAsCG calibrated rig export (WO-765), ${report.at}`,
		`${c.calibrated} measured, ${c.inferred} inferred, ${c.unchanged} unchanged, ${c.added} added (HighAsCG fixtures layer).`,
		'Positions of measured / inferred heads are where HighAsCG solved them from stage marks; unchanged = as in the source file.',
		...report.heads.map((h) => `${h.fid ?? '-'} ${h.name}: ${h.status}${h.status === 'unchanged' ? '' : ` moved ${h.moved_m} m turned ${h.turned_deg} deg`}${h.fit ? ` (${h.fit})` : ''}`),
	]
	return `<!-- ${lines.map((l) => String(l).replace(/-{2,}/g, '-')).join('\n     ')} -->\n`
}

/** One line of fit for a calibrated_pose. */
function fitOf(cp) {
	if (!cp) return ''
	if (cp.source === 'inferred') return cp.residual_m != null ? `inferred, +/-${r2(cp.residual_m)} m` : 'inferred'
	return [cp.verdict, cp.rms_deg != null ? `fit ${r2(cp.rms_deg)} deg` : '', cp.marks ? `${cp.marks} marks` : ''].filter(Boolean).join(', ')
}

/**
 * @param {{ patch: object[], marks?: object[], place?: object, sceneXml?: string | null, objects?: object[],
 *   files?: Record<string, Buffer>, nameOf?: (typeId: string) => string, gdtfOf?: (typeId: string) => Buffer | null,
 *   patchTypes?: boolean, withMarks?: boolean, at?: string }} input
 *   sceneXml / objects / files: the original archive (objects: mvr-scene.js parseScene objects for the world matrices;
 *   files: every member) — absent → a new MVR of the patch alone
 * @returns {{ files: Record<string, Buffer>, report: object }}
 */
function buildRigExport(input) {
	const patch = (Array.isArray(input.patch) ? input.patch : []).filter((fx) => fx && fx.id && fx.enabled !== false)
	const nameOf = input.nameOf || ((id) => `HighAsCG@Fixture@hacg-${id}.gdtf`)
	const files = { ...(input.files || {}) }
	let xml = input.sceneXml ? String(input.sceneXml) : null
	const report = { at: input.at || new Date().toISOString(), base: xml ? 'original' : 'new', heads: [], notes: [] }
	const typesUsed = new Set()
	if (xml && input.patchTypes) {
		const rw = rewriteScene(xml, patch, nameOf)
		xml = rw.xml
		for (const t of rw.types) typesUsed.add(t)
	}
	const world = new Map((input.objects || []).filter((o) => o.fixture?.matrix).map((o) => [String(o.uuid).toLowerCase(), o.fixture]))
	const scan = xml ? scanScene(xml) : { fixtures: [] }
	const inFile = new Map(scan.fixtures.filter((f) => f.uuid).map((f) => [f.uuid.toLowerCase(), f]))
	const edits = []
	const added = []
	let fidNext = 1 + Math.max(0, ...[...world.values()].map((f) => Number(f.id) || 0), ...patch.map((f) => Number(f.fid) || 0))
	for (const fx of patch) {
		const cp = fx.calibrated_pose && Number.isFinite(Number(fx.calibrated_pose.x)) ? fx.calibrated_pose : null
		const uuid = (/^mvr-(.+)$/.exec(String(fx.id)) || [])[1]?.toLowerCase()
		const el = uuid ? inFile.get(uuid) : null
		const src = uuid ? world.get(uuid) : null
		const row = { id: fx.id, name: fx.name || fx.id, fid: src?.id || fx.fid || null, uuid: uuid ? uuid.toUpperCase() : null }
		if (el && src) {
			const old = src.matrix
			const oldPose = poseFromMatrix(old)
			if (!cp) {
				report.heads.push({ ...row, status: 'unchanged', file_pose: oldPose, matrix: old })
				continue
			}
			const filePose = unplace(cp, input.place)
			const neu = matrixFromPose(filePose, old)
			const local = el.matrix ? mvrMatrix(el.matrix.text) : mvrMatrix('')
			const oldInv = invAffine(old)
			// singular source world (zero scale): its parent cannot be recovered — write the new pose as the element's own
			const local2 = oldInv ? mul(mul(local, oldInv), neu) : neu
			if (!oldInv) report.notes.push(`${row.name}: the source matrix has zero scale, written as a world matrix`)
			const text = `<Matrix>${matrixText(local2)}</Matrix>`
			if (el.matrix) edits.push({ start: el.matrix.start, end: el.matrix.end, text })
			else if (el.bodyStart >= 0) edits.push({ start: el.bodyStart, end: el.bodyStart, text })
			else edits.push({ start: el.end - 2, end: el.end, text: `>${text}</Fixture>` })
			const newPose = poseFromMatrix(neu)
			report.heads.push({ ...row, status: cp.source === 'inferred' ? 'inferred' : 'calibrated', file_pose: newPose, was: oldPose, matrix: neu,
				moved_m: r3(Math.hypot(newPose.x - oldPose.x, newPose.y - oldPose.y, newPose.z - oldPose.z)),
				turned_deg: r2(turnedDeg(oldPose, newPose)), fit: fitOf(cp), verdict: cp.verdict || null })
			continue
		}
		if (!fx.typeId || !fx.mode) {
			report.heads.push({ ...row, status: 'skipped', reason: 'no GDTF type' })
			continue
		}
		// the build path: a head HighAsCG patched that the source file does not have
		const pose = cp || fx.pose || {}
		const filePose = unplace(pose, input.place)
		const m = matrixFromPose(filePose)
		const newUuid = (uuid || uuidOf(`fixture:${fx.id}`).toLowerCase()).toUpperCase()
		const fid = row.fid || fidNext++
		typesUsed.add(fx.typeId)
		added.push(fixtureXml(fx, newUuid, m, nameOf, fid))
		report.heads.push({ ...row, uuid: newUuid, fid, status: 'added', calibrated: cp ? cp.source : null, file_pose: poseFromMatrix(m), matrix: m,
			fit: fitOf(cp), verdict: cp?.verdict || null })
	}
	const marks = input.withMarks === false ? [] : (Array.isArray(input.marks) ? input.marks : [])
	const focus = marks.filter((k) => [k?.x, k?.y, k?.z].every((v) => Number.isFinite(Number(v)))).map((k) => {
		const p = unplace({ x: k.x, y: k.y, z: k.z, yaw: 0 }, input.place)
		return `<FocusPoint name="${esc(k.name || `Mark ${k.id}`)}" uuid="${uuidOf(`mark:${k.id}`)}"><Matrix>{1,0,0}{0,1,0}{0,0,1}{${[p.x, p.y, p.z].map((v) => r3(v * 1000)).join(',')}}</Matrix><Geometries/></FocusPoint>`
	})
	const layers = (added.length ? layerXml('HighAsCG fixtures', added) : '') + (focus.length ? layerXml('HighAsCG marks', focus) : '')
	report.counts = {
		calibrated: report.heads.filter((h) => h.status === 'calibrated').length,
		inferred: report.heads.filter((h) => h.status === 'inferred').length,
		unchanged: report.heads.filter((h) => h.status === 'unchanged').length,
		added: added.length,
		skipped: report.heads.filter((h) => h.status === 'skipped').length,
		marks: focus.length,
	}
	if (xml) {
		if (layers && scan.layersClose >= 0) edits.push({ start: scan.layersClose, end: scan.layersClose, text: layers })
		else if (layers) report.notes.push('the source file has no <Layers>: added fixtures / marks not written')
		edits.push({ start: scan.declEnd, end: scan.declEnd, text: `${scan.declEnd ? '\n' : ''}${commentOf(report)}` })
		xml = splice(xml, edits)
	} else {
		xml = [
			'<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
			commentOf(report).trimEnd(),
			'<GeneralSceneDescription verMajor="1" verMinor="6" provider="HighAsCG" providerVersion="1">',
			`<Scene><Layers>\n${layers}</Layers></Scene>`,
			'</GeneralSceneDescription>',
			'',
		].join('\n')
	}
	files[SCENE] = Buffer.from(xml, 'utf8')
	for (const id of typesUsed) {
		const buf = input.gdtfOf?.(id)
		if (buf) files[nameOf(id)] = buf
		else report.notes.push(`GDTF of type ${id} not found — the desk needs it to patch ${nameOf(id)}`)
	}
	if (input.patchTypes) {
		const used = new Set([...xml.matchAll(/<GDTFSpec>([^<]*)<\/GDTFSpec>/g)].map((m) => m[1].replace(/\.gdtf$/i, '')))
		for (const k of Object.keys(files)) if (/\.gdtf$/i.test(k) && !used.has(k.replace(/\.gdtf$/i, ''))) delete files[k]
	}
	return { files, report }
}

module.exports = { buildRigExport, unplace, invAffine, matrixText, SCENE }
