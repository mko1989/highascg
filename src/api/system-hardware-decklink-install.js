/**
 * DeckLink install POST handler — triggers tar.gz/deb install from vendor dirs via sudo.
 * WO-188: add UI-triggered DeckLink install from exFAT/bridge vendor directories.
 */

'use strict'

const { execFileSync } = require('child_process')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { checkNuclearPassword } = require('./routes-system-setup')

const DECKLINK_INSTALL_SCRIPT = '/usr/local/lib/highascg/decklink-install-from-exfat.sh'

/**
 * POST /api/system/decklink/install — install or skip based on vendor availability.
 * Requires nuclear password (same gate as system/update/apply).
 * Returns {ok, action: 'installed'|'skipped', reason: <string>}
 */
async function handleDecklinkInstallPost(body, ctx) {
	const pw = checkNuclearPassword(body, ctx)
	if (!pw.ok) {
		return { status: pw.status || 403, headers: JSON_HEADERS, body: jsonBody({ error: pw.error }) }
	}

	let payload = {}
	try {
		payload = parseBody(body)
	} catch {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid JSON' }) }
	}

	// Invoke the install script via sudo -n (requires sudoers entry)
	try {
		const output = execFileSync('sudo', ['-n', DECKLINK_INSTALL_SCRIPT], {
			encoding: 'utf8',
			timeout: 300000, // 5 minutes
			stdio: ['pipe', 'pipe', 'pipe'],
		})

		// Parse output to extract the action and reason
		const lines = String(output).split('\n')
		const lastLine = lines[lines.length - 2] || ''

		// Script outputs "skip: <reason>" or "ok: <reason>"
		let action = 'skipped'
		let reason = 'unknown'

		if (lastLine.includes('skip:')) {
			action = 'skipped'
			reason = lastLine.replace(/.*skip:\s*/, '').trim()
		} else if (lastLine.includes('ok:')) {
			action = 'installed'
			reason = lastLine.replace(/.*ok:\s*/, '').trim()
		}

		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				action,
				reason,
			}),
		}
	} catch (e) {
		const stderr = e.stderr ? String(e.stderr).trim() : ''
		const stdout = e.stdout ? String(e.stdout).trim() : ''
		const msg = stderr || stdout || e.message || 'Install script failed'

		return {
			status: 409,
			headers: JSON_HEADERS,
			body: jsonBody({
				error: msg,
			}),
		}
	}
}

module.exports = {
	handleDecklinkInstallPost,
}
