'use strict'

/**
 * WO-888 — boot-time sync of Caspar's on-screen window contract:
 *   1. caspar-env (__GL_SYNC_DISPLAY_DEVICE, WO-407) is rewritten at node start, not only on a full Apply, so the
 *      resolver (first PGM screen unless another screen is ticked; never the operator monitor) takes effect at the
 *      next Caspar launch without an Apply;
 *   2. Openbox gets a per-app rule for Caspar's screen consumers (WM_CLASS instance "casparcg" — the class is the
 *      window title "Screen consumer [..]", so the rule matches name=, not class=): never focused, out of alt-tab.
 *      A focus change on Caspar's render window cost PGM a frame (owner 31.10: micro stutter when alt-tabbing).
 * The rc.xml edit is idempotent (marker = the rule's name attribute) and needs a Caspar window re-map to apply.
 */

const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')

const RULE_MARKER = '<application name="casparcg"'
const RULE = `  <!-- WO-888 (HighAsCG): Caspar screen consumers (WM_CLASS instance "casparcg") never take focus and are left out
       of alt-tab — focus changes on Caspar's render window cost PGM a frame (micro stutter on alt-tab). -->
  ${RULE_MARKER} type="normal">
    <focus>no</focus>
    <skip_taskbar>yes</skip_taskbar>
    <skip_pager>yes</skip_pager>
    <layer>above</layer>
    <decor>no</decor>
  </application>
`

/**
 * Pure: rc.xml text with the Caspar rule added, or null when it is already there / there is no <applications>.
 * @param {string} xml
 * @returns {string | null}
 */
function withCasparRule(xml) {
	if (typeof xml !== 'string' || xml.includes(RULE_MARKER)) return null
	const at = xml.indexOf('<applications>')
	if (at < 0) return null
	const end = at + '<applications>'.length
	return `${xml.slice(0, end)}\n${RULE}${xml.slice(end).replace(/^\n/, '')}`
}

/**
 * @param {{ home?: string, log?: Function, reconfigure?: (env: object) => void }} [opts]
 * @returns {'added' | 'present' | 'no_rc'}
 */
function ensureOpenboxCasparRule(opts = {}) {
	const log = opts.log || (() => {})
	const rc = path.join(opts.home || process.env.HOME || '/home/casparcg', '.config', 'openbox', 'rc.xml')
	let xml
	try {
		xml = fs.readFileSync(rc, 'utf8')
	} catch {
		return 'no_rc'
	}
	const next = withCasparRule(xml)
	if (next == null) return xml.includes(RULE_MARKER) ? 'present' : 'no_rc'
	fs.writeFileSync(`${rc}.pre-wo888`, xml)
	fs.writeFileSync(rc, next)
	log('info', '[Caspar window] Openbox rule added: Caspar screen consumers never take focus (WO-888)')
	const reconfigure =
		opts.reconfigure ||
		((env) => execFile('openbox', ['--reconfigure'], { env, timeout: 5000 }, () => {}))
	try {
		reconfigure(require('../utils/x-display-session-runtime-env').displaySessionEnv())
	} catch {
		/* no X / no openbox: the rule applies at the next session */
	}
	return 'added'
}

/**
 * Node boot: both steps; a sandbox instance (tools/e2e next to the live server) touches neither.
 * @param {object} config
 * @param {Function} log (level, msg)
 */
function syncCasparWindowOnBoot(config, log) {
	if (require('../bootstrap/sandbox').isSandbox()) return
	try {
		require('../utils/caspar-gl-sync-env').writeCasparGlSyncEnvFile({ config, log })
	} catch (e) {
		log('warn', `[Caspar GL sync] boot write failed: ${e?.message || e}`)
	}
	try {
		ensureOpenboxCasparRule({ log })
	} catch (e) {
		log('warn', `[Caspar window] Openbox rule failed: ${e?.message || e}`)
	}
}

module.exports = { withCasparRule, ensureOpenboxCasparRule, syncCasparWindowOnBoot, RULE_MARKER }
