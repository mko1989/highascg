/**
 * WO-193: System time parser and wrapper validation smoke tests.
 */

'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')
const { execSync, spawnSync } = require('child_process')
const path = require('path')

// Test the parser from system-time.js
const { parseTimedatectlOutput } = require('../../src/api/system-time')

describe('WO-193: System time tests', () => {
	describe('timedatectl parser', () => {
		it('parses real timedatectl show output', () => {
			const output = `Timezone=Etc/UTC
LocalRTC=no
CanNTP=yes
NTP=yes
NTPSynchronized=yes
TimeUSec=Tue 2026-07-14 10:27:20 UTC
RTCTimeUSec=Tue 2026-07-14 10:27:20 UTC`
			const result = parseTimedatectlOutput(output)
			assert.strictEqual(result.timezone, 'Etc/UTC')
			assert.strictEqual(result.ntp, true)
			assert.strictEqual(result.synchronized, true)
			assert.strictEqual(result.now, 'Tue 2026-07-14 10:27:20 UTC')
		})

		it('parses output with NTP off', () => {
			const output = `Timezone=Etc/UTC
LocalRTC=no
CanNTP=yes
NTP=no
NTPSynchronized=no
TimeUSec=Tue 2026-07-14 10:27:20 UTC
RTCTimeUSec=Tue 2026-07-14 10:27:20 UTC`
			const result = parseTimedatectlOutput(output)
			assert.strictEqual(result.ntp, false)
			assert.strictEqual(result.synchronized, false)
		})

		it('parses output with different timezone', () => {
			const output = `Timezone=America/New_York
LocalRTC=no
CanNTP=yes
NTP=yes
NTPSynchronized=yes
TimeUSec=Tue 2026-07-14 06:27:20 EDT
RTCTimeUSec=Tue 2026-07-14 06:27:20 EDT`
			const result = parseTimedatectlOutput(output)
			assert.strictEqual(result.timezone, 'America/New_York')
		})

		it('handles empty output gracefully', () => {
			const result = parseTimedatectlOutput('')
			assert.strictEqual(result.timezone, 'UTC')
			assert.strictEqual(result.ntp, false)
			assert.strictEqual(result.synchronized, false)
			assert.strictEqual(result.now, '')
		})

		it('handles null output gracefully', () => {
			const result = parseTimedatectlOutput(null)
			assert.strictEqual(result.timezone, 'UTC')
			assert.strictEqual(result.ntp, false)
		})
	})

	describe('wrapper script validation', () => {
		const scriptPath = path.join(__dirname, '../../scripts/runtime/highascg-set-system-time.sh')

		it('rejects invalid date format', () => {
			const result = spawnSync('bash', [scriptPath, 'set', '2026/07/14', '10:27:20'], {
				stdio: 'pipe',
				timeout: 5000,
			})
			assert.strictEqual(result.status, 2, 'Should exit with code 2 for invalid args')
			const stderr = String(result.stderr || '')
			assert(stderr.includes('date'), 'Should mention invalid date')
		})

		it('rejects invalid time format (no minutes)', () => {
			const result = spawnSync('bash', [scriptPath, 'set', '2026-07-14', '10'], {
				stdio: 'pipe',
				timeout: 5000,
			})
			assert.strictEqual(result.status, 2, 'Should exit with code 2 for invalid args')
			const stderr = String(result.stderr || '')
			assert(stderr.includes('time'), 'Should mention invalid time')
		})

		it('accepts seconds in HH:MM:SS format even if invalid value (timedatectl validates)', () => {
			// The wrapper only validates format, not semantic values
			// timedatectl will reject invalid values like 60 seconds
			const result = spawnSync('bash', [scriptPath, 'set', '2026-07-14', '10:27:60'], {
				stdio: 'pipe',
				timeout: 5000,
			})
			const stderr = String(result.stderr || '')
			assert(!stderr.includes('Invalid time'), 'Should accept HH:MM:SS format')
		})

		it('rejects invalid NTP mode', () => {
			const result = spawnSync('bash', [scriptPath, 'ntp', 'maybe'], {
				stdio: 'pipe',
				timeout: 5000,
			})
			assert.strictEqual(result.status, 2, 'Should exit with code 2 for invalid mode')
		})

		it('rejects unknown command', () => {
			const result = spawnSync('bash', [scriptPath, 'invalid'], {
				stdio: 'pipe',
				timeout: 5000,
			})
			assert.strictEqual(result.status, 2, 'Should exit with code 2 for unknown command')
		})

		it('validates date with missing leading zeros', () => {
			const result = spawnSync('bash', [scriptPath, 'set', '2026-7-14', '10:27:20'], {
				stdio: 'pipe',
				timeout: 5000,
			})
			assert.strictEqual(result.status, 2, 'Should reject date without leading zeros')
		})

		it('validates time with missing leading zeros', () => {
			const result = spawnSync('bash', [scriptPath, 'set', '2026-07-14', '9:27:20'], {
				stdio: 'pipe',
				timeout: 5000,
			})
			assert.strictEqual(result.status, 2, 'Should reject time without leading zeros')
		})

		it('accepts valid date-time format with HH:MM:SS', () => {
			// This will fail with "Run as root" since we're not running as root,
			// but the validation should pass before that error.
			const result = spawnSync('bash', [scriptPath, 'set', '2026-07-14', '10:27:20'], {
				stdio: 'pipe',
				timeout: 5000,
			})
			const stderr = String(result.stderr || '')
			// Should NOT be a validation error
			assert(!stderr.includes('Invalid date'), 'Should accept valid date format')
			assert(!stderr.includes('Invalid time'), 'Should accept valid time format')
		})

		it('accepts valid date-time format with HH:MM', () => {
			const result = spawnSync('bash', [scriptPath, 'set', '2026-07-14', '10:27'], {
				stdio: 'pipe',
				timeout: 5000,
			})
			const stderr = String(result.stderr || '')
			assert(!stderr.includes('Invalid date'), 'Should accept valid date format')
			assert(!stderr.includes('Invalid time'), 'Should accept valid time format')
		})

		it('errors before any timedatectl call on invalid args', () => {
			// Bad args should fail fast without attempting sudo/timedatectl
			const result = spawnSync('bash', [scriptPath, 'set', 'invalid-date', '10:27:20'], {
				stdio: 'pipe',
				timeout: 5000,
			})
			assert.strictEqual(result.status, 2, 'Should exit 2 on validation failure')
			// Should not attempt timedatectl (no permission denied message)
			const stderr = String(result.stderr || '')
			assert(!stderr.includes('permission'), 'Should not attempt privileged call')
		})
	})

	describe('syntax validation', () => {
		it('script passes bash -n syntax check', () => {
			const scriptPath = path.join(__dirname, '../../scripts/runtime/highascg-set-system-time.sh')
			const result = spawnSync('bash', ['-n', scriptPath], {
				stdio: 'pipe',
				timeout: 5000,
			})
			assert.strictEqual(result.status, 0, 'Bash syntax check should pass')
		})
	})
})
