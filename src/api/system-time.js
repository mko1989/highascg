/**
 * System time get/set — parse timedatectl show, toggle NTP, set manual time.
 * WO-193: password-gated time setting via wrapper script at /usr/local/lib/highascg/highascg-set-system-time.sh
 */

'use strict'

const { execFileSync } = require('child_process')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { checkNuclearPassword } = require('./routes-system-setup')

const SYSTEM_TIME_SCRIPT = '/usr/local/lib/highascg/highascg-set-system-time.sh'

/**
 * Parse timedatectl show output (key=value format) into an object.
 * @param {string} output - raw output from timedatectl show
 * @returns {{ now: string, timezone: string, ntp: boolean, synchronized: boolean }}
 */
function parseTimedatectlOutput(output) {
	const lines = String(output || '').split('\n')
	const data = {}

	for (const line of lines) {
		const trimmed = line.trim()
		if (!trimmed || !trimmed.includes('=')) continue
		const eqIdx = trimmed.indexOf('=')
		const key = trimmed.slice(0, eqIdx)
		const value = trimmed.slice(eqIdx + 1)
		data[key] = value
	}

	// Extract relevant fields
	const now = data.TimeUSec || ''
	const timezone = data.Timezone || 'UTC'
	const ntp = data.NTP === 'yes'
	const synchronized = data.NTPSynchronized === 'yes'

	return { now, timezone, ntp, synchronized }
}

/**
 * GET /api/system/time — read current time, timezone, NTP status (unprivileged).
 */
function isTimePasswordRequired(ctx) {
	const cfgUi = ctx?.config?.ui && typeof ctx.config.ui === 'object' ? ctx.config.ui : {}
	return cfgUi.nuclearRequirePassword === true || cfgUi.nuclearRequirePassword === 'true'
}

async function handleSystemTimeGet(_ctx) {
	try {
		const output = execFileSync('timedatectl', ['show'], {
			encoding: 'utf8',
			timeout: 5000,
			stdio: ['pipe', 'pipe', 'pipe'],
		})

		const parsed = parseTimedatectlOutput(output)

		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				now: parsed.now,
				timezone: parsed.timezone,
				ntp: parsed.ntp,
				synchronized: parsed.synchronized,
				passwordRequired: isTimePasswordRequired(_ctx),
			}),
		}
	} catch (e) {
		const msg = e?.stderr ? String(e.stderr).trim() : e?.message || 'Failed to read system time'
		return {
			status: 500,
			headers: JSON_HEADERS,
			body: jsonBody({ error: msg }),
		}
	}
}

/**
 * POST /api/system/time — set NTP and/or manual time (password-gated).
 * Body: { password: string, ntp?: boolean, set?: "YYYY-MM-DD HH:MM:SS" }
 */
async function handleSystemTimePost(body, ctx) {
	const pw = checkNuclearPassword(body, ctx)
	if (!pw.ok) {
		return { status: pw.status || 403, headers: JSON_HEADERS, body: jsonBody({ error: pw.error }) }
	}

	let payload
	try {
		payload = parseBody(body)
	} catch {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid JSON' }) }
	}

	const ntpChange = payload.ntp
	const setTime = String(payload.set || '').trim()

	// Validate set time format if provided
	if (setTime) {
		const parts = setTime.split(' ')
		if (parts.length < 2 || parts.length > 3) {
			return {
				status: 400,
				headers: JSON_HEADERS,
				body: jsonBody({ error: 'Invalid datetime format (expected "YYYY-MM-DD HH:MM[:SS]")' }),
			}
		}

		const datePattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/
		const timePattern = /^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$/

		if (!datePattern.test(parts[0])) {
			return {
				status: 400,
				headers: JSON_HEADERS,
				body: jsonBody({ error: 'Invalid date format (expected YYYY-MM-DD)' }),
			}
		}

		if (!timePattern.test(parts[1])) {
			return {
				status: 400,
				headers: JSON_HEADERS,
				body: jsonBody({ error: 'Invalid time format (expected HH:MM or HH:MM:SS)' }),
			}
		}
	}

	try {
		// If setting time, turn off NTP first
		if (setTime) {
			execFileSync('sudo', ['-n', SYSTEM_TIME_SCRIPT, 'ntp', 'off'], {
				encoding: 'utf8',
				timeout: 10000,
				stdio: ['pipe', 'pipe', 'pipe'],
			})

			// Extract date and time from the set string
			const parts = setTime.split(' ')
			const date = parts[0]
			const time = parts[1]

			execFileSync('sudo', ['-n', SYSTEM_TIME_SCRIPT, 'set', date, time], {
				encoding: 'utf8',
				timeout: 10000,
				stdio: ['pipe', 'pipe', 'pipe'],
			})
		} else if (ntpChange !== undefined) {
			// Toggle NTP
			const mode = ntpChange ? 'on' : 'off'
			execFileSync('sudo', ['-n', SYSTEM_TIME_SCRIPT, 'ntp', mode], {
				encoding: 'utf8',
				timeout: 10000,
				stdio: ['pipe', 'pipe', 'pipe'],
			})
		}

		// Refresh and return updated status
		const output = execFileSync('timedatectl', ['show'], {
			encoding: 'utf8',
			timeout: 5000,
			stdio: ['pipe', 'pipe', 'pipe'],
		})

		const parsed = parseTimedatectlOutput(output)

		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				now: parsed.now,
				timezone: parsed.timezone,
				ntp: parsed.ntp,
				synchronized: parsed.synchronized,
				passwordRequired: isTimePasswordRequired(_ctx),
			}),
		}
	} catch (e) {
		const stderr = e.stderr ? String(e.stderr).trim() : ''
		const stdout = e.stdout ? String(e.stdout).trim() : ''
		const msg = stderr || stdout || e.message || 'Time setting failed'

		return {
			status: 409,
			headers: JSON_HEADERS,
			body: jsonBody({ error: msg }),
		}
	}
}

module.exports = {
	handleSystemTimeGet,
	handleSystemTimePost,
	parseTimedatectlOutput, // Export for testing
}
