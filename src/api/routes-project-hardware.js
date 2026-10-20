/**
 * WO-608 — project hardware reconcile on the node (web lib/project-import-flow.js + project-hardware-apply.js).
 *   GET  /api/project/hardware-check → { severity, items, sameMachine, prompt, projectName, hasHardware }
 *        `prompt` is the web's boot / reconnect rule: a mismatch that is neither "same machine" nor only soft OS
 *        layout / Caspar screen-mode drift.
 *   POST /api/project/hardware-apply → { ok, steps, warnings } — Device View + routing, OS layout, Caspar config
 *        (the web's three client-side calls, run in-process).
 * The comparison itself is the web's pure client/lib/project-hardware-mismatch.js (dynamic import).
 */
'use strict'

const path = require('path')
const { pathToFileURL } = require('url')
const { JSON_HEADERS, jsonBody } = require('./response')

const MISMATCH_LIB = pathToFileURL(path.join(__dirname, '../../client/lib/project-hardware-mismatch.js')).href
const SOFT_BOOT_SECTIONS = new Set(['OS display layout', 'Caspar screen modes'])

let _lib = null
const lib = () => (_lib ||= import(MISMATCH_LIB))

/** Route result → parsed JSON body, or null on an error status / unparsable body. */
function bodyOf(r) {
	if (!r || (r.status && r.status >= 400)) return null
	try {
		return typeof r.body === 'string' ? JSON.parse(r.body) : r.body && typeof r.body === 'object' ? JSON.parse(String(r.body)) : null
	} catch {
		return null
	}
}

/** The web fetchLiveHardwareContext, in-process. */
async function liveContext(ctx) {
	const safe = (fn) => Promise.resolve().then(fn).then(bodyOf, () => null)
	const [deviceViewSnap, deviceSnapBuild, settings] = await Promise.all([
		safe(() => require('./routes-device-view').handleGet('/api/device-view/snapshot', ctx, {})),
		safe(() => require('./routes-device-snapshot').handleGet('/api/device-snapshot/build', ctx)),
		safe(() => require('./routes-settings').handleGet('/api/settings', ctx)),
	])
	return { deviceViewSnap, deviceSnapBuild, settings }
}

/** Web boot / reconnect rule (importProjectWithHardwareReconcile, source server-bootstrap|server-reconnect). */
function needsPrompt(report) {
	if (report.severity === 'none' || report.sameMachine) return false
	return !(report.severity === 'soft' && report.items.every((it) => SOFT_BOOT_SECTIONS.has(it.section)))
}

async function check(ctx) {
	const project = await require('./routes-data-project-read').loadProjectMerged(ctx)
	const hw = project && project.hardwareConfig
	const M = await lib()
	const projectName = (project && project.name) || 'This project'
	if (!M.hasProjectHardwareConfig(hw)) {
		return { severity: 'none', items: [], sameMachine: false, prompt: false, projectName, hasHardware: false }
	}
	const report = M.detectHardwareMismatch(hw, await liveContext(ctx))
	return { ...report, prompt: needsPrompt(report), projectName, hasHardware: true }
}

async function apply(ctx) {
	const project = await require('./routes-data-project-read').loadProjectMerged(ctx)
	const hw = project && project.hardwareConfig
	const M = await lib()
	if (!M.hasProjectHardwareConfig(hw)) return { ok: false, error: 'The project has no saved hardware' }
	const steps = []
	const warnings = []
	const r1 = await require('./routes-data').handleProject('/api/project/apply-hardware', JSON.stringify({ hardwareConfig: hw }), ctx)
	const b1 = bodyOf(r1)
	if (!b1 || !b1.ok) return { ok: false, error: (b1 && b1.error) || 'Project hardware apply failed' }
	if (b1.applied === true) steps.push('Device graph, destinations, and routing applied')
	else warnings.push('No device snapshot payload in project hardware')
	const osPatch = M.osDisplayKeysFromHardware(hw)
	if (Object.keys(osPatch).length) {
		try {
			const b2 = bodyOf(await require('./routes-settings').handleOsPost('/api/settings/apply-os', JSON.stringify(osPatch), ctx))
			if (!b2 || b2.ok === false) warnings.push((b2 && b2.error) || 'OS layout apply returned not ok')
			else steps.push('GPU / xrandr layout applied')
		} catch (e) {
			warnings.push(`OS layout apply failed: ${(e && e.message) || e}`)
		}
	}
	try {
		const r3 = await require('./routes-caspar-config').handlePost('/api/caspar-config/apply', '{}', ctx)
		if (r3 && r3.status >= 400) throw new Error((bodyOf({ body: r3.body }) || {}).error || `HTTP ${r3.status}`)
		steps.push('Caspar config regenerated (restart may be required)')
	} catch (e) {
		warnings.push(`Caspar config apply failed: ${(e && e.message) || e}`)
	}
	return { ok: true, steps, warnings }
}

const reply = (data) => ({ status: data.ok === false ? 400 : 200, headers: JSON_HEADERS, body: jsonBody(data) })

module.exports = {
	needsPrompt,
	check,
	apply,
	handleGet: async (p, ctx) => (p === '/api/project/hardware-check' ? reply(await check(ctx)) : null),
	handlePost: async (p, ctx) => (p === '/api/project/hardware-apply' ? reply(await apply(ctx)) : null),
}
