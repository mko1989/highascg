'use strict'

const fs = require('fs')
const path = require('path')
const { promisify } = require('util')
const { execFile } = require('child_process')

const execFileAsync = promisify(execFile)

const { REPO_ROOT } = require('../repo-paths')

/** @readonly */
const APPLY_SCRIPT_CANDIDATES = [
	path.join(REPO_ROOT, 'tools/runtime/highascg-nvidia-x-apply.sh'),
	'/usr/local/bin/highascg-nvidia-x-apply.sh',
]

/**
 * @returns {string|null}
 */
function resolveNvidiaXApplyScript() {
	for (const p of APPLY_SCRIPT_CANDIDATES) {
		try {
			if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
		} catch {
			/* ignore */
		}
	}
	return null
}

/**
 * Shell fragment: run NVIDIA playout policy (SyncToVBlank off + Force Composition Pipeline).
 * @returns {string[]}
 */
function buildNvidiaDisplayPolicyShellLines() {
	const script = resolveNvidiaXApplyScript()
	if (!script) return []
	const q = script.replace(/'/g, `'\\''`)
	return [
		`if [ -x '${q}' ]; then`,
		`  '${q}'`,
		`  ( sleep 6; '${q}' ) &`,
		`  ( sleep 18; '${q}' ) &`,
		`fi`,
	]
}

/**
 * Apply NVIDIA playout display policy live (after xrandr layout).
 * @param {NodeJS.ProcessEnv} env must include DISPLAY / XAUTHORITY
 * @param {{ log?: (level: string, msg: string) => void, timeoutMs?: number }} [opts]
 */
async function applyNvidiaDisplayPolicy(env, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const script = resolveNvidiaXApplyScript()
	if (!script) {
		log('warn', '[NVIDIA] highascg-nvidia-x-apply.sh not found — skip Force Composition Pipeline')
		return { ok: false, reason: 'script_missing' }
	}
	try {
		await execFileAsync(script, [], {
			env,
			timeout: opts.timeoutMs ?? 15_000,
		})
		log('info', '[NVIDIA] SyncToVBlank off + Force Composition Pipeline on all outputs')
		return { ok: true, script }
	} catch (e) {
		log('warn', `[NVIDIA] display policy failed: ${e?.message || e}`)
		return { ok: false, reason: 'exec_failed', error: e?.message || String(e) }
	}
}

module.exports = {
	APPLY_SCRIPT_CANDIDATES,
	resolveNvidiaXApplyScript,
	buildNvidiaDisplayPolicyShellLines,
	applyNvidiaDisplayPolicy,
}
