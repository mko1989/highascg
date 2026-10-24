'use strict'

/**
 * WO-730 — is the code on disk complete, and is it what runs? (after an update: applied, restarted, deps installed,
 * root copies refreshed — WO-511 / WO-727 were each one of these going wrong silently)
 */

const fs = require('fs')
const path = require('path')
const { REPO, sh, has, newestMtime, processStartMs, fmtTime } = require('./sweep-util')
const { checkInstalledHelpers } = require('../runtime/check-installed-helpers')

const readText = (rel) => {
	try {
		return fs.readFileSync(path.join(REPO, rel), 'utf8').trim()
	} catch {
		return ''
	}
}

module.exports = [
	{
		id: 'code.build-stamp',
		name: 'the running server is the build on disk',
		async run({ server }) {
			const v = await server.get('/api/system/version')
			if (v.status !== 200) return { status: 'fail', summary: `GET /api/system/version → ${v.status || v.error}` }
			const disk = readText('BUILD_STAMP') || readText('.highascg-build-stamp')
			if (!disk) return { status: 'skip', summary: 'no BUILD_STAMP on disk (a checkout)' }
			if (v.data.buildStamp !== disk)
				return { status: 'fail', summary: `server runs ${v.data.buildStamp}, disk has ${disk}: restart highascg` }
			return { status: 'pass', summary: `${disk} · package ${v.data.packageVersion}` }
		},
	},
	{
		id: 'code.restarted',
		name: 'server and kiosk started after the last code change',
		async run({ serverPid, kioskStartMs }) {
			const out = []
			let status = 'pass'
			const srv = newestMtime(['src', 'index.js', 'package.json'], { ext: /\.(js|json)$/ })
			const srvStart = processStartMs(serverPid)
			if (srvStart && srv.ms > srvStart) {
				status = 'warn'
				out.push(`server started ${fmtTime(srvStart)}, ${srv.file} changed ${fmtTime(srv.ms)}: restart highascg`)
			}
			if (kioskStartMs) {
				const cl = newestMtime(['godot/client'], { ext: /\.(gd|tscn|tres|cfg|godot)$/ })
				if (cl.ms > kioskStartMs) {
					status = 'warn'
					out.push(`kiosk started ${fmtTime(kioskStartMs)}, ${cl.file} changed ${fmtTime(cl.ms)}: reload it (F5)`)
				}
				if (cl.future) out.push(`${cl.future} client file(s) dated in the future (clock was set back) — not compared`)
			}
			if (srv.future) out.push(`${srv.future} server file(s) dated in the future (clock was set back) — not compared`)
			return {
				status,
				summary:
					out.join(' · ') ||
					`server since ${fmtTime(srvStart)}${kioskStartMs ? `, kiosk since ${fmtTime(kioskStartMs)}` : ''}`,
			}
		},
	},
	{
		id: 'code.node',
		name: 'Node version fits package.json engines',
		async run() {
			const want = Number((/>=\s*(\d+)/.exec(JSON.parse(readText('package.json')).engines?.node || '') || [])[1] || 0)
			const major = Number(process.versions.node.split('.')[0])
			return major >= want
				? { status: 'pass', summary: `node ${process.version} (needs ≥ ${want})` }
				: { status: 'fail', summary: `node ${process.version}, package.json needs ≥ ${want}` }
		},
	},
	{
		id: 'code.npm-deps',
		name: 'node_modules match package-lock (npm ls)',
		async run() {
			if (!has('npm')) return { status: 'skip', summary: 'npm not installed' }
			const r = sh('npm', ['ls', '--omit=dev', '--depth=0'], { timeoutMs: 60000 })
			if (r.code === 0) return { status: 'pass', summary: `${r.out.trim().split('\n').length - 1} top-level packages` }
			const bad = `${r.out}\n${r.err}`
				.split('\n')
				.filter((l) => /missing|invalid|ERR|extraneous/i.test(l))
				.slice(0, 5)
			return { status: 'fail', summary: `npm ls exit ${r.code}: run npm ci --omit=dev`, details: bad }
		},
	},
	{
		id: 'code.require-integrity',
		name: 'every require() in the tree resolves',
		async run() {
			const r = sh(process.execPath, ['tools/ci/check-require-integrity.js'], { timeoutMs: 120000 })
			if (r.code === 0) return { status: 'pass', summary: 'all relative requires resolve' }
			// the script also fails on conflict copies (their own check below) and stray .bak files
			const lines = `${r.out}${r.err}`.split('\n')
			const unresolved = lines.filter((l) => /^unresolved require/.test(l))
			const stray = lines
				.slice(lines.findIndex((l) => /stray artifact/.test(l)) + 1)
				.filter((l) => /^ {2}- /.test(l) && !/\.sync-conflict-/.test(l))
			if (unresolved.length)
				return { status: 'fail', summary: `${unresolved.length} unresolved require(s)`, details: unresolved.slice(0, 8) }
			if (r.timedOut || !lines.some((l) => /sync-conflict|stray artifact/.test(l)))
				return {
					status: 'fail',
					summary: `the check exited ${r.code}${r.timedOut ? ' (timeout)' : ''}`,
					details: lines.filter(Boolean).slice(0, 8),
				}
			if (/stray artifact/.test(r.err))
				return {
					status: 'warn',
					summary: 'all relative requires resolve · stray artifact files',
					details: stray.slice(0, 8),
				}
			return { status: 'pass', summary: 'all relative requires resolve' }
		},
	},
	{
		id: 'code.sync-conflicts',
		name: 'no Syncthing conflict copies in the tree',
		async run() {
			const found = []
			const walk = (dir, depth) => {
				let ents
				try {
					ents = fs.readdirSync(dir, { withFileTypes: true })
				} catch {
					return
				}
				for (const e of ents) {
					if (e.name === 'node_modules' || e.name === '.git' || e.name === '.stversions') continue
					const p = path.join(dir, e.name)
					if (e.name.includes('.sync-conflict-')) found.push(path.relative(REPO, p))
					else if (e.isDirectory() && depth < 6) walk(p, depth + 1)
				}
			}
			walk(REPO, 0)
			if (!found.length) return { status: 'pass', summary: 'none' }
			return {
				status: 'warn',
				summary: `${found.length} conflict cop${found.length === 1 ? 'y' : 'ies'} (a peer and this box both wrote the file)`,
				details: found.slice(0, 10),
			}
		},
	},
	{
		id: 'code.installed-helpers',
		name: 'root-installed helpers match the repo',
		async run() {
			const rows = checkInstalledHelpers()
			if (!rows.length) return { status: 'skip', summary: 'no installed helpers (not a box)' }
			const diff = rows.filter((r) => r.status === 'differs')
			const same = rows.filter((r) => r.status === 'same').length
			if (!diff.length) return { status: 'pass', summary: `${same} same` }
			return {
				status: 'warn',
				summary: `${diff.length} differ (${same} same): the next update refreshes the updaters; others need the install script`,
				details: diff.map((r) => `${r.installed} ≠ ${r.sources[0]}`),
			}
		},
	},
	{
		id: 'code.binaries',
		name: 'programs the app runs are installed',
		async run() {
			const need = ['ffmpeg', 'ffprobe', 'rsync', 'ssh']
			const want = ['xdotool', 'xrandr', 'nvidia-smi']
			const missNeed = need.filter((c) => !has(c))
			const missWant = want.filter((c) => !has(c))
			const caspar = path.join(REPO, 'bin/casparcg')
			const casparOk = fs.existsSync(caspar)
			if (!casparOk || missNeed.length)
				return { status: 'fail', summary: `missing: ${[...(casparOk ? [] : ['bin/casparcg']), ...missNeed].join(', ')}` }
			if (missWant.length) return { status: 'warn', summary: `optional missing: ${missWant.join(', ')}` }
			return { status: 'pass', summary: `bin/casparcg + ${need.length + want.length} tools` }
		},
	},
]
