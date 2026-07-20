'use strict'

/**
 * A live YouTube stream key was found in cleartext in the journal and in Caspar's log
 * (2026-07-20). The `url` field was already redacted, but the full AMCP `ADD … STREAM <url> …`
 * command was logged verbatim alongside it, and the URL's last path segment IS the key.
 * Logs are read casually, shipped in bug reports and captured by support bundles, so the command
 * must be masked everywhere it is logged — not just in the field next to it.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')
const RTMP = path.join(REPO_ROOT, 'src/api/routes-streaming-channel-rtmp.js')
const { redactStreamUrl } = require('../../src/streaming/streaming-channel-status')

describe('stream key never reaches the logs', () => {
	it('redactStreamUrl masks the final path segment (the key)', () => {
		const out = redactStreamUrl('rtmp://x.rtmp.youtube.com/live2/super-secret-key')
		assert.doesNotMatch(out, /super-secret-key/)
		assert.match(out, /live2\/\*\*\*\*/)
	})

	it('no log call passes a raw ADD command', () => {
		const src = fs.readFileSync(RTMP, 'utf8')
		const raw = src.match(/command:\s*add(?:With|No)IdxCmd\b/g) || []
		assert.deepEqual(raw, [], 'every logged command must go through the mask helper')
	})

	it('every logged command goes through maskCmd', () => {
		const src = fs.readFileSync(RTMP, 'utf8')
		const logged = src.match(/command:\s*[A-Za-z(]+/g) || []
		assert.ok(logged.length > 0, 'the ADD command is still logged (WO-172 cross-check relies on it)')
		for (const l of logged) {
			assert.match(l, /maskCmd|redactedCmd/, `logged command must be masked, found: ${l}`)
		}
	})

	it('no pushRtmpLog call passes a raw url', () => {
		/* Only LOG calls — ctx.streamingChannelRtmp legitimately holds the real URL in memory,
		 * because that is the live stream's actual destination. */
		const src = fs.readFileSync(RTMP, 'utf8')
		const calls = src.match(/pushRtmpLog\([\s\S]{0,400}?\}\)/g) || []
		const leaking = calls.filter((c) => /url:\s*built\.url\b/.test(c))
		assert.deepEqual(leaking, [], 'a logged url must go through redactStreamUrl')
	})
})
