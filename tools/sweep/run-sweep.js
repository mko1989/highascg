#!/usr/bin/env node
'use strict'

/**
 * WO-730 — the post-update sweep: one command that checks the whole box after an update (or any time).
 *
 *   node tools/sweep/run-sweep.js              # everything read-only: code, system, app, sandbox, cluster
 *   node tools/sweep/run-sweep.js --quick      # skip the heavy checks (client compile, sandbox) — ≈10 s
 *   node tools/sweep/run-sweep.js --peers      # + media copy to / from linked servers (writes there, then cleans)
 *   node tools/sweep/run-sweep.js --tests      # + the offline test suite (minutes)
 *   node tools/sweep/run-sweep.js --only=code,system   --json   --url=http://127.0.0.1:4200
 *
 * Read only on this box: no Caspar command, no project load on the live server, no restart. Compatibility (routes,
 * every project) is tried on a throwaway sandbox server. The server runs it by itself once after each update
 * (src/system/sweep-after-update.js); the last report: GET /api/system/update/sweep, or ~/.local/state/highascg/sweep/.
 * Exit code 1 when a check fails (warnings do not fail).
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { REPO, sh, request, unit, processStartMs } = require('./sweep-util')
const { codeId, sweepStateDir } = require('../../src/system/sweep-after-update')

const GROUPS = {
	code: require('./checks-code'),
	system: require('./checks-system'),
	app: require('./checks-app'),
	sandbox: require('./checks-sandbox'),
	cluster: require('./checks-cluster'),
}
const ICON = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', skip: 'skip' }

const arg = (k) => {
	const hit = process.argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`))
	return hit ? (hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true) : null
}

function server(url) {
	return {
		url,
		get: (p, t) => request('GET', url + p, undefined, t),
		post: (p, b, t) => request('POST', url + p, b, t),
	}
}

/** The operator kiosk (not a headless check run, not the VR client — WO-773 sweep fix): → { pid, startMs } or {}. */
function kiosk() {
	for (const pid of sh('pgrep', ['-x', 'godot']).out.trim().split('\n').filter(Boolean).map(Number)) {
		let cmd
		try {
			cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8')
		} catch {
			continue
		}
		if (cmd.includes('godot/client') && !cmd.includes('--headless') && !cmd.includes('--xr-mode'))
			return { pid, startMs: processStartMs(pid) }
	}
	return {}
}

/** One sandbox for the whole run, started on first use; `projects` copies this box's project files into it. */
function sandboxFactory(scratch) {
	let sb = null
	const fn = async ({ projects } = {}) => {
		if (!sb) {
			const { startSandbox } = require('../e2e/sandbox-server')
			const s = await startSandbox({ root: path.join(scratch, 'sandbox'), media: false })
			sb = { ...s, ...server(s.url) }
		}
		if (projects && fs.existsSync(projects)) {
			for (const f of fs.readdirSync(projects))
				if (f.endsWith('.json') && !f.includes('.sync-conflict-'))
					fs.copyFileSync(path.join(projects, f), path.join(sb.root, 'projects', f))
		}
		return sb
	}
	fn.stop = async () => sb && (await sb.stop())
	return fn
}

async function runSweep(opts = {}) {
	const url = opts.url || process.env.HIGHASCG_SWEEP_URL || 'http://127.0.0.1:4200'
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'highascg-sweep-'))
	const srv = server(url)
	const [st, cl, cfg, list] = await Promise.all([
		srv.get('/api/state', 20000),
		srv.get('/api/cluster'),
		srv.get('/api/config'),
		srv.get('/api/project/list'),
	])
	// the folder the server itself reads projects from (bridge/projects on a box, projects/ in a checkout)
	const listed = (list.data?.projects || []).map((p) => p.path && path.dirname(p.path)).filter(Boolean)
	const k = kiosk()
	const ctx = {
		server: srv,
		state: st.data,
		cluster: cl.data,
		config: cfg.data?.config || cfg.data,
		projectsDir: process.env.HIGHASCG_PROJECTS_DIR || listed[0] || path.join(REPO, 'projects'),
		serverPid: unit('highascg')?.pid || 0,
		kioskPid: k.pid || 0,
		kioskStartMs: k.startMs || 0,
		sandbox: sandboxFactory(scratch),
	}
	const only = opts.only ? new Set(String(opts.only).split(',')) : null
	const results = []
	const t0 = Date.now()
	try {
		for (const [group, checks] of Object.entries(GROUPS)) {
			if (only && !only.has(group)) continue
			for (const c of checks) {
				const base = { id: c.id, group, name: c.name }
				if (c.optIn && !opts[c.optIn]) results.push({ ...base, status: 'skip', summary: `only with --${c.optIn}` })
				else if (c.heavy && opts.quick) results.push({ ...base, status: 'skip', summary: 'skipped (--quick)' })
				else if (st.status !== 200 && group !== 'code' && group !== 'system' && group !== 'sandbox')
					results.push({ ...base, status: 'fail', summary: `server ${url} not answering (${st.status || st.error})` })
				else {
					const t = Date.now()
					try {
						results.push({ ...base, ...(await c.run(ctx)), ms: Date.now() - t })
					} catch (e) {
						results.push({
							...base,
							status: 'fail',
							summary: `check crashed: ${e instanceof Error ? e.message : e}`,
							ms: Date.now() - t,
						})
					}
				}
				opts.onResult?.(results[results.length - 1])
			}
		}
		if (opts.tests) {
			const t = Date.now()
			const xvfb = !sh('sh', ['-c', 'command -v xvfb-run']).code
			const r = xvfb
				? sh('xvfb-run', ['-a', process.execPath, 'tools/ci/run-offline-tests.js'], { timeoutMs: 900000 })
				: sh(process.execPath, ['tools/ci/run-offline-tests.js'], { timeoutMs: 900000 })
			const n = (k2) => Number((new RegExp(`ℹ ${k2} (\\d+)`).exec(r.out) || [])[1] || 0)
			results.push({
				id: 'tests.offline',
				group: 'tests',
				name: 'offline test suite',
				status: r.code === 0 ? 'pass' : 'fail',
				summary: `${n('tests')} tests, ${n('pass')} pass, ${n('fail')} fail, ${n('skipped')} skipped`,
				ms: Date.now() - t,
			})
			opts.onResult?.(results[results.length - 1])
		}
	} finally {
		await ctx.sandbox.stop()
		fs.rmSync(scratch, { recursive: true, force: true })
	}
	const count = (s) => results.filter((r) => r.status === s).length
	return {
		at: new Date().toISOString(),
		host: os.hostname(),
		codeId: codeId(),
		url,
		auto: !!opts.auto,
		ms: Date.now() - t0,
		totals: { pass: count('pass'), warn: count('warn'), fail: count('fail'), skip: count('skip') },
		results,
	}
}

function markdown(rep) {
	const lines = [
		`# Sweep — ${rep.host}, ${rep.at}`,
		'',
		`code ${rep.codeId} · ${(rep.ms / 1000).toFixed(1)} s · **${rep.totals.pass} pass, ${rep.totals.warn} warn, ${rep.totals.fail} fail**, ${rep.totals.skip} skipped`,
		'',
		'| | check | result |',
		'|---|---|---|',
	]
	const cell = (t) => String(t).replace(/\|/g, '/')
	for (const r of rep.results)
		lines.push(
			`| ${ICON[r.status]} | ${cell(r.name)} | ${cell(r.summary)}${r.details?.length ? '<br>' + r.details.map(cell).join('<br>') : ''} |`
		)
	return lines.join('\n') + '\n'
}

/** Keep the report as <stamp>.json/.md + last.json; the 20 newest stay. */
function save(rep, dir = sweepStateDir()) {
	fs.mkdirSync(dir, { recursive: true })
	const stamp = rep.at.replace(/[:.]/g, '-').slice(0, 19)
	fs.writeFileSync(path.join(dir, `${stamp}.json`), JSON.stringify(rep, null, 1))
	fs.writeFileSync(path.join(dir, `${stamp}.md`), markdown(rep))
	fs.writeFileSync(path.join(dir, 'last.json'), JSON.stringify(rep, null, 1))
	const old = fs
		.readdirSync(dir)
		.filter((f) => /^\d{4}-.*\.json$/.test(f))
		.sort()
		.slice(0, -20)
	for (const f of old)
		for (const e of ['.json', '.md']) fs.rmSync(path.join(dir, f.replace(/\.json$/, e)), { force: true })
	return path.join(dir, `${stamp}.md`)
}

if (require.main === module) {
	const json = arg('json')
	runSweep({
		url: arg('url'),
		quick: !!arg('quick'),
		peers: !!arg('peers'),
		tests: !!arg('tests'),
		only: arg('only'),
		auto: !!arg('auto'),
		onResult: json
			? null
			: (r) => {
					console.log(
						`${ICON[r.status].padEnd(4)}  ${r.name} — ${r.summary}${r.ms > 2000 ? ` (${(r.ms / 1000).toFixed(1)} s)` : ''}`
					)
					for (const d of r.details || []) console.log(`        ${d}`)
				},
	}).then(
		(rep) => {
			const file = save(rep)
			if (json) console.log(JSON.stringify(rep, null, 1))
			else
				console.log(
					`\n${rep.totals.pass} pass, ${rep.totals.warn} warn, ${rep.totals.fail} fail, ${rep.totals.skip} skipped in ${(rep.ms / 1000).toFixed(1)} s · ${file}`
				)
			process.exit(rep.totals.fail ? 1 : 0)
		},
		(e) => {
			console.error(`[sweep] ${e instanceof Error ? e.stack : e}`)
			process.exit(2)
		}
	)
}

module.exports = { runSweep, markdown, save }
