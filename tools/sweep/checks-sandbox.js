'use strict'

/**
 * WO-730 — compatibility with what this box already has, tried on a throwaway sandbox server (WO-719: own root, own
 * HOME, `--no-caspar`, HIGHASCG_SANDBOX=1) so the live server and Caspar are never touched:
 *   - every GET route without parameters answers without a 5xx / timeout
 *   - every project file of this box (copied into the sandbox) loads with this code
 */

const fs = require('fs')
const path = require('path')
const { REPO } = require('./sweep-util')

const SKIP_ROUTES = new Set(['/api/support/bundle']) // builds a full support archive: minutes, not a probe

function getRoutes() {
	const src = fs.readFileSync(path.join(REPO, 'src/api/router.js'), 'utf8')
	return [...new Set([...src.matchAll(/routes\.get\('(\/api\/[^':*]+)'/g)].map((m) => m[1]))].filter(
		(r) => !SKIP_ROUTES.has(r)
	)
}

function projectSlugs(dir) {
	try {
		return fs
			.readdirSync(dir)
			.filter((f) => f.endsWith('.json') && !f.includes('.sync-conflict-') && !f.startsWith('_'))
			.map((f) => f.slice(0, -5))
	} catch {
		return []
	}
}

module.exports = [
	{
		id: 'sandbox.routes',
		name: 'every GET route answers on a sandbox (no 5xx but 501, no timeout)',
		heavy: true,
		async run({ sandbox }) {
			const sb = await sandbox()
			const routes = getRoutes()
			const bad = []
			const tally = {}
			const t0 = Date.now()
			for (const p of routes) {
				const r = await sb.get(p, 20000)
				tally[r.status] = (tally[r.status] || 0) + 1
				// 501 = "not on this host" (e.g. no ALSA mixer in CI) is an answer, not a crash
				if (r.status === 0 || (r.status >= 500 && r.status !== 501))
					bad.push(`${p} → ${r.status || r.error} ${String(r.data?.error || r.text || '').slice(0, 100)}`)
			}
			const counts = Object.entries(tally)
				.map(([s, n]) => `${n}×${s}`)
				.join(' ')
			if (bad.length)
				return { status: 'fail', summary: `${bad.length}/${routes.length} crashed (${counts})`, details: bad }
			return {
				status: 'pass',
				summary: `${routes.length} routes in ${((Date.now() - t0) / 1000).toFixed(1)} s (${counts})`,
			}
		},
	},
	{
		id: 'sandbox.projects',
		name: 'every project on this box loads with this code (on a sandbox)',
		heavy: true,
		async run({ sandbox, projectsDir }) {
			const slugs = projectSlugs(projectsDir)
			if (!slugs.length) return { status: 'skip', summary: `no projects in ${projectsDir}` }
			const sb = await sandbox({ projects: projectsDir })
			const logFile = path.join(sb.root, 'server.log')
			const bad = []
			const t0 = Date.now()
			for (const slug of slugs) {
				const before = fs.statSync(logFile).size
				const r = await sb.post('/api/project/load', { slug }, 30000)
				const errs = fs
					.readFileSync(logFile, 'utf8')
					.slice(before)
					.split('\n')
					.filter((l) => /\[error\]|TypeError|ReferenceError|Unhandled/.test(l))
				const now = r.status === 200 ? await sb.get('/api/project/list') : null
				const loaded = now?.data?.activeSlug === slug
				if (r.status !== 200)
					bad.push(`${slug}: load → ${r.status || r.error} ${String(r.data?.error || '').slice(0, 100)}`)
				else if (!loaded) bad.push(`${slug}: load said 200 but the active project is ${now?.data?.activeSlug}`)
				else if (errs.length) bad.push(`${slug}: ${errs[0].replace(/^\[[^\]]*\]\s*/, '').slice(0, 150)}`)
			}
			const secs = ((Date.now() - t0) / 1000).toFixed(1)
			if (bad.length)
				return {
					status: 'fail',
					summary: `${bad.length}/${slugs.length} projects fail to load (${secs} s)`,
					details: bad.slice(0, 12),
				}
			return { status: 'pass', summary: `${slugs.length} projects loaded in ${secs} s` }
		},
	},
]

module.exports.getRoutes = getRoutes
module.exports.projectSlugs = projectSlugs
