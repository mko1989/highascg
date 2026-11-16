'use strict'

/**
 * WO-1094 — the person-detection runtime's verdict, pure: facts (runtime-probe.js gathers them) → per feature
 * ready / missing / broken with the reason in plain words. Features and their models: tools/tracking-detect/features.json.
 *   facts = { system: { version: '3.14.4' | null, venv: bool }, venv: { exists, python: bool (interpreter file),
 *     cfgVersion: '3.14.4' | null, libDirs: ['python3.14'] }, probe: null | { ok, version, imports: { numpy: { ok, version,
 *     error } … }, providers: [] , error }, models: { 'x.onnx': { bytes, mtime } }, partial: ['x.onnx'] }
 *   → { verdict, reason, apt, core: { state, reason, python, packages, providers, gpu }, features: [{ id, label, uses,
 *     license, state, reason, models: [{ file, bytes, state, optional? }] }], installed_at, bytes }
 * verdict: 'ready' (core + every default feature) | 'partial' (core ready, a default feature missing) | 'missing' (not
 * installed) | 'broken' (installed but will not run — Repair). A model smaller than MIN_MODEL_BYTES is truncated.
 */

const MIN_MODEL_BYTES = 100000

const mm = (v) => {
	const m = /^(\d+)\.(\d+)/.exec(String(v || ''))
	return m ? `${m[1]}.${m[2]}` : ''
}

function coreState(f, spec) {
	const sys = mm(f.system?.version)
	if (!f.venv?.exists) {
		if (!sys) return { state: 'missing', reason: 'Person detection is not installed on this machine, and python3 is missing', apt: 'sudo apt install python3' }
		return { state: 'missing', reason: 'Person detection is not installed on this machine' }
	}
	if (!sys) return { state: 'broken', reason: 'python3 is not installed on this machine (the venv needs it)', apt: 'sudo apt install python3' }
	const built = mm(f.venv.cfgVersion) || mm((f.venv.libDirs || []).map((d) => d.replace(/^python/, ''))[0])
	if (built && built !== sys) return { state: 'broken', reason: `venv built for Python ${built}, the system has ${sys} — Repair rebuilds it` }
	if ((f.venv.libDirs || []).length && !f.venv.libDirs.includes(`python${sys}`))
		return { state: 'broken', reason: `venv has packages for ${f.venv.libDirs.join(', ')}, the system has Python ${sys} — Repair rebuilds it` }
	if (!f.venv.python) return { state: 'broken', reason: 'the venv has no Python interpreter — Repair rebuilds it' }
	if (!f.probe) return { state: 'ready', reason: 'not checked yet', unchecked: true }
	if (f.probe.error) return { state: 'broken', reason: `the venv's Python does not run: ${f.probe.error} — Repair rebuilds it` }
	for (const mod of spec.core?.imports || []) {
		const r = f.probe.imports?.[mod]
		if (!r || !r.ok) return { state: 'broken', reason: `${mod} will not import${r?.error ? ': ' + r.error : ''} — Repair reinstalls it` }
	}
	return { state: 'ready', reason: '' }
}

function modelState(file, f) {
	const m = f.models?.[file]
	if (!m) return { file, bytes: 0, state: (f.partial || []).includes(file) ? 'partial' : 'missing' }
	if (m.bytes < MIN_MODEL_BYTES) return { file, bytes: m.bytes, state: 'truncated' }
	return { file, bytes: m.bytes, mtime: m.mtime, state: 'ready' }
}

const WHY = { missing: 'not installed', partial: 'download incomplete', truncated: 'file is truncated' }

function featureState(id, feat, core, f, person) {
	const models = (feat.models || []).map((m) => modelState(m, f))
	const optional = (feat.optional || []).map((m) => ({ ...modelState(m, f), optional: true }))
	const base = { id, label: feat.label, uses: feat.uses, license: feat.license, default: !!feat.default, models: [...models, ...optional] }
	if (core.state !== 'ready') return { ...base, state: core.state, reason: core.reason }
	if (!models.length && id !== 'person') return { ...base, state: person.state, reason: person.state === 'ready' ? '' : 'needs person boxes' }
	const bad = models.find((m) => m.state !== 'ready')
	if (!bad) return { ...base, state: 'ready', reason: '' }
	return { ...base, state: bad.state === 'truncated' ? 'broken' : 'missing', reason: `${bad.file}: ${WHY[bad.state]}` }
}

const firstMtime = (list) => {
	const t = list.map((m) => Number(m.mtime)).filter((v) => v > 0)
	return t.length ? Math.min(...t) : null
}

/** @param {object} facts @param {object} spec features.json */
function evaluate(facts, spec) {
	const f = facts || {}
	const core = coreState(f, spec)
	const feats = spec.features || {}
	const person = featureState('person', feats.person || { models: [] }, core, f, { state: core.state })
	const features = Object.entries(feats).map(([id, feat]) => (id === 'person' ? person : featureState(id, feat, core, f, person)))
	const defaults = features.filter((x) => x.default)
	let verdict
	let reason
	if (core.state !== 'ready') {
		verdict = core.state
		reason = core.reason
	} else if (defaults.every((x) => x.state === 'ready')) {
		verdict = 'ready'
		reason = ''
	} else {
		const off = defaults.filter((x) => x.state !== 'ready')
		verdict = person.state === 'ready' ? 'partial' : person.state
		reason = off.map((x) => `${x.label}: ${x.reason}`).join('; ')
	}
	const providers = f.probe?.providers || []
	const all = Object.values(f.models || {})
	return {
		verdict,
		reason,
		...(core.apt ? { apt: core.apt } : {}),
		core: {
			state: core.state,
			reason: core.reason,
			python: f.probe?.version || f.venv?.cfgVersion || null,
			system_python: f.system?.version || null,
			packages: Object.fromEntries(Object.entries(f.probe?.imports || {}).map(([k, v]) => [k, v.ok ? v.version : null])),
			providers,
			gpu: providers.some((p) => /CUDA|TensorRT/.test(p)),
			checked: !core.unchecked,
		},
		features,
		installed_at: firstMtime(all),
		bytes: all.reduce((s, m) => s + (m.bytes || 0), 0) + (f.venv?.bytes || 0),
	}
}

/** One line for About / logs: "ready (CPU)" … */
function summaryLine(st) {
	if (!st) return 'Person detection on this machine: checking…'
	const where = 'Previs → Tracking → Detect'
	if (st.verdict === 'ready') return `Person detection on this machine: installed (${st.core.gpu ? 'GPU' : 'CPU'}). Manage it in ${where}.`
	if (st.verdict === 'partial') return `Person detection on this machine: installed, partly (${st.reason}). Complete it in ${where}.`
	if (st.verdict === 'missing') return `Person detection on this machine: not installed. Install it in ${where}.`
	return `Person detection on this machine: needs repair (${st.reason}). Repair it in ${where}.`
}

module.exports = { evaluate, summaryLine }
