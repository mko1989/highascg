'use strict'

/**
 * Read a `config/*.json` slice AS STAGED (the git index), not as it sits in the working tree.
 *
 * WO-473. `config/` is both the repo's factory defaults and the LIVE config of whatever box the
 * repo is checked out on — that conflation is the whole WO-425/470 leak class. The gates that pin
 * the shipped defaults (no audio outputs, no record output) must therefore judge what is
 * staged: a live box legitimately has its own outputs in the working tree, and asserting on the
 * file left those boxes permanently red, which is how a real red gets ignored. In CI the checkout
 * is clean, so the guard is unchanged there.
 *
 * @param {string} repoRoot
 * @param {string} relPath - repo-relative, e.g. 'config/record_outputs.json'
 * @returns {{ available: boolean, text?: string, reason?: string }} - `text` is the staged blob
 */
function readCommittedConfigSlice(repoRoot, relPath) {
	const { spawnSync } = require('child_process')
	/* The INDEX (`git show :path`), not HEAD — this is a pre-commit guard, so it must judge what
	 * is staged. In CI the checkout is clean, so index == HEAD == working tree. */
	const res = spawnSync('git', ['show', `:${relPath}`], {
		cwd: repoRoot,
		encoding: 'utf8',
		timeout: 15000,
	})
	if (res.error || res.status !== 0) {
		/* Not a git checkout (ISO / drop-update install) — nothing can be committed from here, so
		 * the guard has nothing to protect. The factory-shape assertions still run. */
		return { available: false, reason: String(res.error?.message || res.stderr || 'git show failed').trim() }
	}
	return { available: true, text: res.stdout }
}

module.exports = { readCommittedConfigSlice }
