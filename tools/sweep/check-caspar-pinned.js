'use strict'

/**
 * WO-1022 — caspar.pinned: is the running Caspar the build this release pins (caspar/PINNED.json)?
 *
 * Read only. The running version is node's last VERSION answer (/api/state caspar.versionLine); the swap helper's last
 * decision is bin/caspar-swap.state (scripts/exfat/highascg-caspar-swap.sh). A mismatch is a warning, not a failure:
 * Caspar still plays, and the summary says why it differs (held, skipped, rolled back, a dev checkout, or a box whose
 * updater predates WO-1022 — the next update swaps it).
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { REPO } = require('./sweep-util')

function readState(file) {
	try {
		return Object.fromEntries(
			fs
				.readFileSync(file, 'utf8')
				.split('\n')
				.filter((l) => l.includes('='))
				.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
		)
	} catch {
		return null
	}
}

/**
 * @param {{ pin: object|null, caspar: object|null, swap: object|null, held: boolean, checkout: boolean }} o
 * @returns {{ status: 'pass'|'warn'|'skip', summary: string }}
 */
function pinnedStatus({ pin, caspar, swap, held, checkout }) {
	if (!pin?.shortSha) return { status: 'skip', summary: 'no caspar/PINNED.json in this tree' }
	if (!caspar?.connected || !caspar.versionLine)
		return { status: 'skip', summary: `Caspar not connected (pinned ${pin.shortSha}; app.caspar reports it)` }
	const running = String(caspar.versionLine).trim()
	if (running.includes(pin.shortSha)) return { status: 'pass', summary: `running the pinned ${running}` }
	const why = held
		? 'held by ~/.highascg/caspar-hold'
		: checkout
			? 'a git checkout: Caspar is swapped by hand here (caspar/README.md)'
			: swap?.result === 'rolled-back' || swap?.result === 'skipped'
				? `${swap.result}: ${swap.reason || '?'}`
				: swap?.result === 'swapped'
					? 'swapped, Caspar not restarted onto it yet'
					: 'no swap recorded: the next update installs it (updaters older than WO-1022 do not)'
	return { status: 'warn', summary: `running ${running}, release pins ${pin.version || pin.shortSha} — ${why}` }
}

module.exports = {
	id: 'caspar.pinned',
	name: 'running Caspar is the build the release pins (WO-1022)',
	async run({ state }) {
		let pin = null
		try {
			pin = JSON.parse(fs.readFileSync(path.join(REPO, 'caspar/PINNED.json'), 'utf8'))
		} catch {
			/* no pin → skip */
		}
		return pinnedStatus({
			pin,
			caspar: state?.caspar || null,
			swap: readState(path.join(REPO, 'bin/caspar-swap.state')),
			held: fs.existsSync(path.join(os.homedir(), '.highascg/caspar-hold')),
			checkout: fs.existsSync(path.join(REPO, '.git')),
		})
	},
}
module.exports.pinnedStatus = pinnedStatus
