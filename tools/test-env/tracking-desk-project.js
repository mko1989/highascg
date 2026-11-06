#!/usr/bin/env node
'use strict'

/**
 * WO-978 — the project half of tools/test-env/tracking-desk.sh: switch the ACTIVE project's PSN output on for the test
 * (and back), the safe way (memory project-data-fix-via-autosave): read the stored project file (never GET
 * /api/project/file — it masks stream keys), change `fixtures.output` only, POST /api/project/autosave with the stored
 * rev. The server bumps rev and broadcasts; a running client takes it as a remote sync.
 *
 *   node tools/test-env/tracking-desk-project.js on  --state <file> --iface <ip> [--axes y_up|stage]
 *   node tools/test-env/tracking-desk-project.js off --state <file>
 *   node tools/test-env/tracking-desk-project.js status
 *
 * `on` records the slug and the previous `fixtures.output` (or its absence) in <file> the first time only, so a second
 * `up` never overwrites the real "before". `off` puts exactly that back — only `output`, so a patch edited meanwhile
 * survives — and deletes <file>. A project that had no `fixtures` at all ends with `fixtures: {}` (the same meaning;
 * never null — Godot reads `project.fixtures` as a Dictionary).
 */

const fs = require('fs')

const API = process.env.HIGHASCG_API || 'http://127.0.0.1:4200'

async function api(method, p, body) {
	const r = await fetch(API + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
	const text = await r.text()
	let data
	try {
		data = JSON.parse(text)
	} catch {
		data = text
	}
	return { status: r.status, data }
}

async function active() {
	const r = await api('GET', '/api/project/list')
	const p = (r.data?.projects || []).find((q) => q.active) || null
	if (!p?.path) throw new Error('no active project (GET /api/project/list)')
	return { slug: p.slug, file: p.path, doc: JSON.parse(fs.readFileSync(p.path, 'utf8')) }
}

/** The next `fixtures` for `on` / `off` (pure, tested). `prevOutput` undefined = the project had no output. */
function withOutput(fixtures, output) {
	const f = fixtures && typeof fixtures === 'object' && !Array.isArray(fixtures) ? { ...fixtures } : {}
	if (output === undefined) delete f.output
	else f.output = output
	return f
}

/** The PSN output the test needs, on top of what was there (group / port / name kept). */
function testOutput(prev, { iface, axes }) {
	const o = prev && typeof prev === 'object' ? prev : {}
	const psn = o.psn && typeof o.psn === 'object' ? o.psn : {}
	return { ...o, enabled: true, protocol: 'psn', psn: { ...psn, iface: iface || '', axes: axes === 'stage' ? 'stage' : 'y_up' } }
}

async function save(doc) {
	const r = await api('POST', '/api/project/autosave', { project: doc })
	if (r.status !== 200) throw new Error(`autosave ${r.status}: ${JSON.stringify(r.data).slice(0, 300)}`)
	return r.data
}

async function main(argv) {
	const cmd = argv[0]
	const arg = (k) => {
		const i = argv.indexOf(k)
		return i >= 0 ? argv[i + 1] : null
	}
	const state = arg('--state')
	const a = await active()
	if (cmd === 'status') {
		const out = a.doc.fixtures?.output
		const f = await api('GET', '/api/tracking/follow')
		const psn = f.data?.psn || {}
		console.log(`project ${a.slug} rev ${a.doc.rev}: fixtures.output ${out ? JSON.stringify(out) : '(none)'}`)
		console.log(`follow: output ${f.data?.output_enabled ? 'ON' : 'off'} (${f.data?.protocol}), PSN ${psn.enabled ? 'sending' : 'off'}` +
			` iface ${psn.iface || 'default'} axes ${psn.axes} packets ${psn.packets_sent ?? 0}${psn.last_error ? ` error ${psn.last_error}` : ''}`)
		return
	}
	if (!state) throw new Error('--state <file> is required')
	if (cmd === 'on') {
		if (!fs.existsSync(state)) {
			const prev = a.doc.fixtures?.output
			fs.writeFileSync(state, JSON.stringify({ slug: a.slug, had_output: prev !== undefined, output: prev ?? null }, null, 1))
		}
		const next = testOutput(a.doc.fixtures?.output, { iface: arg('--iface'), axes: arg('--axes') })
		a.doc.fixtures = withOutput(a.doc.fixtures, next)
		await save(a.doc)
		console.log(`project ${a.slug}: PSN output ON (iface ${next.psn.iface || 'default'}, axes ${next.psn.axes})`)
	} else if (cmd === 'off') {
		if (!fs.existsSync(state)) return console.log('project: nothing to restore (no state file)')
		const s = JSON.parse(fs.readFileSync(state, 'utf8'))
		if (s.slug !== a.slug) throw new Error(`active project is ${a.slug}, the test changed ${s.slug} — load it, then run down again`)
		a.doc.fixtures = withOutput(a.doc.fixtures, s.had_output ? s.output : undefined)
		await save(a.doc)
		fs.unlinkSync(state)
		console.log(`project ${a.slug}: fixtures.output restored (${s.had_output ? JSON.stringify(s.output) : 'none'})`)
	} else throw new Error('usage: on|off|status')
}

if (require.main === module)
	main(process.argv.slice(2)).catch((e) => {
		console.error(`tracking-desk-project: ${e.message}`)
		process.exit(1)
	})

module.exports = { withOutput, testOutput }
