#!/usr/bin/env node
'use strict'

/**
 * WO-728 — media copy to / from another server, end to end through its sshd and the forced command it really runs
 * (WO-724 push, WO-727 pull — both were only ever proven by hand). Uses the app's own rsync argv and ssh options
 * (sync-project-media-rsync.js) and this box's replication key, so it fails where Send media / a pull would.
 *
 *   node tools/e2e/replication-check.js --peer=192.168.0.4
 *   node tools/e2e/replication-check.js --peer=127.0.0.1      # this box's own sshd + wrapper (when it trusts its key)
 *
 * On the peer it writes only under media/.highascg-check/ and empties that folder again at the end (the empty
 * folder stays: removing it would need --delete on media/ itself). Exit code = failed steps.
 */

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { rsyncArgs, rsyncSshOpts } = require('../../src/replication/sync-project-media-rsync')

const DIR = 'media/.highascg-check/'
// what broke: spaces (WO-724/727), plus every character rsync escapes on the remote command line
const FILES = { "Tlo Orange Ball/BAZA 2.txt": 'a', "a & b (1)/it's [x] #1.txt": 'b', 'plain.txt': 'c' }
const WRAPPER_SAYS = /highascg-replication-ssh:/

function rsync(args, cwd) {
	const t0 = Date.now()
	const r = spawnSync('rsync', args, { cwd, encoding: 'utf8', timeout: 120000 })
	const out = `${r.stdout || ''}${r.stderr || ''}`.trim()
	if (r.status !== 0) throw new Error(`rsync exit ${r.status}: ${out.split('\n').slice(-3).join(' | ')}`)
	return { ms: Date.now() - t0, out }
}

function writeTree(root, files) {
	for (const [rel, body] of Object.entries(files)) {
		const f = path.join(root, DIR, rel)
		fs.mkdirSync(path.dirname(f), { recursive: true })
		fs.writeFileSync(f, body)
	}
}

/** Relative file → content under <root>/<DIR>. */
function readTree(root) {
	const out = {}
	const base = path.join(root, DIR)
	const walk = (rel) => {
		for (const e of fs.readdirSync(path.join(base, rel), { withFileTypes: true })) {
			const r = rel ? `${rel}/${e.name}` : e.name
			if (e.isDirectory()) walk(r)
			else out[r] = fs.readFileSync(path.join(base, r), 'utf8')
		}
	}
	if (fs.existsSync(base)) walk('')
	return out
}

function steps({ host, user = 'casparcg', remoteRoot = path.resolve(__dirname, '../..'), sshOpts = rsyncSshOpts() }) {
	const o = { remote: `${user}@${host}:`, remoteRoot, sshCommand: `ssh ${sshOpts}` }
	const ssh = (cmd) => spawnSync('ssh', [...sshOpts.split(/\s+/).filter(Boolean), `${user}@${host}`, cmd], { encoding: 'utf8', timeout: 30000 })
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'highascg-repl-check-'))
	const dir = (n) => fs.mkdirSync(path.join(tmp, n), { recursive: true }) || path.join(tmp, n)
	return [
		{
			name: 'the key only runs the forced command (no shell, no path outside media/ + template/)',
			run() {
				const refused = {}
				for (const [why, cmd] of [
					['a shell command', 'id'],
					['outside media/', 'rsync --server --sender . /etc/passwd'],
					['escaped ..', `rsync --server --sender . ${remoteRoot}/media/\\.\\./config`],
					['an unescaped ;', `rsync --server --sender . ${remoteRoot}/media/x;id`],
				]) {
					const r = ssh(cmd)
					assert.ok(r.status !== 255, `ssh to ${host} failed: ${(r.stderr || '').trim().split('\n').pop()}`)
					assert.notEqual(r.status, 0, `${why} ran: ${(r.stdout || '').trim().slice(0, 120)}`)
					assert.match(r.stderr, WRAPPER_SAYS, `${why}: refused, but not by the forced command: ${r.stderr.trim()}`)
					refused[why] = r.stderr.trim().replace(WRAPPER_SAYS, '').trim()
				}
				return refused
			},
		},
		{
			name: 'push: a folder with spaces, "&", "(1)", quotes and brackets in names arrives (Send media)',
			run() {
				writeTree(dir('push'), FILES)
				return { ms: rsync(rsyncArgs('push', DIR, o), path.join(tmp, 'push')).ms }
			},
		},
		{
			name: 'pull: the same folder comes back byte for byte (hot-backup pair direction)',
			run() {
				const r = rsync(rsyncArgs('pull', DIR, o), dir('pull'))
				assert.deepEqual(readTree(path.join(tmp, 'pull')), FILES)
				return { ms: r.ms }
			},
		},
		{
			name: 'pull: one file named on the remote command line (escaped by rsync)',
			run() {
				const rel = Object.keys(FILES)[1]
				const r = rsync(rsyncArgs('pull', DIR + rel, o), dir('one'))
				assert.deepEqual(readTree(path.join(tmp, 'one')), { [rel]: FILES[rel] })
				return { ms: r.ms }
			},
		},
		{
			name: `clean up: ${DIR} emptied on the peer`,
			always: true,
			run() {
				fs.mkdirSync(path.join(dir('empty'), DIR), { recursive: true })
				rsync(['--delete', ...rsyncArgs('push', DIR, o)], path.join(tmp, 'empty'))
				const left = rsync(rsyncArgs('pull', DIR, o), dir('after'))
				assert.deepEqual(readTree(path.join(tmp, 'after')), {}, 'files left on the peer')
				fs.rmSync(tmp, { recursive: true, force: true })
				return { ms: left.ms }
			},
		},
	]
}

/** → [{ step, status: 'pass'|'fail'|'skip', ms, metrics|error }]; after a failure only `always` steps run. */
function runReplicationCheck(opts) {
	const results = []
	for (const s of steps(opts)) {
		if (results.some((r) => r.status === 'fail') && !s.always) {
			results.push({ step: s.name, status: 'skip', reason: 'an earlier step failed' })
			continue
		}
		const t0 = Date.now()
		try {
			results.push({ step: s.name, status: 'pass', ms: Date.now() - t0, metrics: s.run() })
		} catch (e) {
			results.push({ step: s.name, status: 'fail', ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) })
		}
		opts.onStep?.(results[results.length - 1])
	}
	return results
}

if (require.main === module) {
	const peer = (process.argv.find((a) => a.startsWith('--peer=')) || '').slice(7)
	if (!peer) {
		console.error('usage: node tools/e2e/replication-check.js --peer=<host>')
		process.exit(101)
	}
	const results = runReplicationCheck({
		host: peer,
		onStep: (r) => console.log(`[replication-check] ${r.status.toUpperCase().padEnd(4)} ${r.step}${r.error ? ` — ${r.error}` : r.metrics ? ` ${JSON.stringify(r.metrics)}` : ''}`),
	})
	const n = (st) => results.filter((r) => r.status === st).length
	console.log(`[replication-check] ${peer}: ${n('pass')} pass, ${n('skip')} skipped, ${n('fail')} failed`)
	process.exit(n('fail'))
}

module.exports = { runReplicationCheck, FILES, DIR }
