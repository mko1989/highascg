'use strict'

/**
 * WO-697 — save to / load from a HighAsCG stick (HIGHASCGEXF at ~/exfat) by hand. The box syncs with the stick on its
 * own only when it booted from it (src/system/boot-stick.js); for any other stick these are the only ways in or out.
 *
 * - save: every project of this box (+ its autosave) into the stick's projects/, and the settings pairs of the
 *   exfat-sync map (configs/ …) — the same files a boot stick receives. Never the private folder (per-machine pairing).
 * - load: one project from the stick into this box's projects. A different local file of that name is kept as
 *   `<slug>.json.before-stick-<time>` (not a .json: it stays out of the project list), and so is its autosave, which
 *   would otherwise win over the loaded file. The GUI then opens it with the normal POST /api/project/load.
 */

const fs = require('fs')
const path = require('path')
const { copyFilePreserveTimes } = require('./exfat-sync-fs')
const { pushProjectConfigToExfat } = require('./exfat-sync')
const { stickState } = require('./boot-stick')
const pvs = require('../engine/project-volume-sync')

function stamp() {
	return new Date().toISOString().replace(/[:.]/g, '-')
}

function stickRoot(deps) {
	const roots = pvs.getProjectRoots()
	const st = roots.usb ? stickState(roots.usb, deps) : { mounted: false, bootStick: false }
	return { roots, mounted: !!roots.usb && st.mounted, bootStick: st.bootStick }
}

function listed(dir, source) {
	return pvs.scanProjectsDir(dir, source).filter((p) => !p.corrupt && !p.isSyncConflict)
}

/** GET /api/system/stick */
function stickStatus(deps) {
	const { roots, mounted, bootStick } = stickRoot(deps)
	const onBox = new Set(listed(roots.local, 'local').map((p) => p.slug))
	const projects = mounted ? listed(pvs.volumeProjectsDir(roots.usb), 'usb') : []
	return {
		mounted,
		mount: roots.usb,
		bootStick,
		projects: projects
			.map((p) => ({ slug: p.slug, name: p.name, savedAt: p.savedAt, onBox: onBox.has(p.slug) }))
			.sort((a, b) => (Date.parse(b.savedAt || '') || 0) - (Date.parse(a.savedAt || '') || 0)),
	}
}

/** POST /api/system/stick/save → { projects, settings } copied counts. */
async function saveToStick(opts = {}) {
	const log = opts.log || (() => {})
	const { roots, mounted } = stickRoot(opts.deps)
	if (!mounted) return { error: 'No HighAsCG stick is plugged in.' }
	const dir = pvs.volumeProjectsDir(roots.usb)
	let projects = 0
	for (const p of listed(roots.local, 'local')) {
		copyFilePreserveTimes(p.path, path.join(dir, `${p.slug}.json`))
		const auto = path.join(roots.local, pvs.AUTOSAVE_SUBDIR, `${p.slug}.json`)
		if (fs.existsSync(auto)) copyFilePreserveTimes(auto, path.join(dir, pvs.AUTOSAVE_SUBDIR, `${p.slug}.json`))
		projects += 1
	}
	const push = opts.settings === false ? { copied: 0, errors: [] } : await pushProjectConfigToExfat({ manual: true, volume: 'usb', log })
	log('info', `[stick] saved ${projects} project(s) + ${push.copied} settings file(s) to ${roots.usb}`)
	return { projects, settings: push.copied, errors: push.errors || [] }
}

/** POST /api/system/stick/load { slug } → { slug, keptAs: [...] } */
function loadFromStick(slug, opts = {}) {
	const log = opts.log || (() => {})
	const s = String(slug || '').trim()
	if (!s || s !== path.basename(s) || s.startsWith('.') || s === pvs.AUTOSAVE_SUBDIR) return { error: 'Invalid project name.' }
	const { roots, mounted } = stickRoot(opts.deps)
	if (!mounted) return { error: 'No HighAsCG stick is plugged in.' }
	const dir = pvs.volumeProjectsDir(roots.usb)
	const src = path.join(dir, `${s}.json`)
	if (!fs.existsSync(src)) return { error: `"${s}" is not on the stick.` }
	try {
		JSON.parse(fs.readFileSync(src, 'utf8'))
	} catch {
		return { error: `"${s}" on the stick is not a readable project.` }
	}
	const keptAs = []
	const t = stamp()
	const place = (from, to) => {
		if (fs.existsSync(to)) {
			if (from && fs.readFileSync(to).equals(fs.readFileSync(from))) return
			fs.renameSync(to, `${to}.before-stick-${t}`)
			keptAs.push(path.basename(`${to}.before-stick-${t}`))
		}
		if (from) copyFilePreserveTimes(from, to)
	}
	place(src, path.join(roots.local, `${s}.json`))
	const stickAuto = path.join(dir, pvs.AUTOSAVE_SUBDIR, `${s}.json`)
	place(fs.existsSync(stickAuto) ? stickAuto : null, path.join(roots.local, pvs.AUTOSAVE_SUBDIR, `${s}.json`))
	log('info', `[stick] loaded ${s}.json from ${roots.usb}${keptAs.length ? ` (kept ${keptAs.join(', ')})` : ''}`)
	return { slug: s, keptAs }
}

module.exports = { stickStatus, saveToStick, loadFromStick }
