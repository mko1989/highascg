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

describe('WO-307 — SRT passphrase and the transport-layer log sites', () => {
	const { redactStreamUrl: redact2, redactAmcpCommandForLog } = require('../../src/streaming/stream-secret-redact')
	const TRANSPORT = path.join(REPO_ROOT, 'src/caspar/amcp-client-transport.js')

	it('redactStreamUrl masks the SRT passphrase query param, keeps the rest', () => {
		const out = redact2('srt://10.0.0.5:9000?latency=120000&streamid=pgm&mode=caller&passphrase=SUPERSECRET&pbkeylen=16')
		assert.doesNotMatch(out, /SUPERSECRET/)
		assert.match(out, /passphrase=\*\*\*\*/)
		assert.match(out, /latency=120000/, 'non-secret params must stay readable')
		assert.match(out, /streamid=pgm/)
	})

	it('redactAmcpCommandForLog finds the secret whether quoted or bare, anywhere in the string', () => {
		const bare = redactAmcpCommandForLog('ADD 3-97 STREAM srt://h:9000?passphrase=ABCDESECRET -format mpegts -i -')
		assert.doesNotMatch(bare, /ABCDESECRET/)
		const quoted = redactAmcpCommandForLog('ADD 3-97 STREAM "rtmp://x.rtmp.youtube.com/live2/super-secret-key" -format flv')
		assert.doesNotMatch(quoted, /super-secret-key/)
		const inErrorMessage = redactAmcpCommandForLog('AMCP response timeout: PLAY 3-97 srt://h:9000?passphrase=ABCDESECRET')
		assert.doesNotMatch(inErrorMessage, /ABCDESECRET/)
	})

	it('the transport layer routes every log/history/error site through redactAmcpCommandForLog', () => {
		/* This is the file that actually sends AMCP commands to Caspar. Every place it logs, records
		 * to disk, or builds an Error message from `trimmed`/`originalCmdString` must be redacted —
		 * this is where the 2026-07-20 YouTube-key incident's fix did NOT reach, because that fix
		 * only touched routes-streaming-channel-rtmp.js's own log calls. */
		const src = fs.readFileSync(TRANSPORT, 'utf8')
		const raw = src
			.split('\n')
			.map((line, i) => ({ line, n: i + 1 }))
			.filter(({ line }) => /\btrimmed\b/.test(line))
			.filter(({ line }) => /self\.log\(|recordAmcpHistory\(|new Error\(/.test(line))
			.filter(({ line }) => !/redactAmcpCommandForLog/.test(line))
		assert.deepEqual(
			raw.map((r) => `${r.n}: ${r.line.trim()}`),
			[],
			'every log/history/Error site touching the raw command must go through redactAmcpCommandForLog',
		)
	})

	it('the functional send path is NOT redacted (Caspar needs the real secret to work)', () => {
		const src = fs.readFileSync(TRANSPORT, 'utf8')
		assert.match(src, /socket\.send\(trimmed\)/, 'socket.send must still get the real command')
		assert.match(src, /socket\.sendRaw\(trimmed\)/, 'sendRaw must still get the real command')
		assert.match(src, /fanoutSingleCommand\(trimmed\)/, 'replication fan-out must still get the real command')
	})
})

describe('WO-307 — srt:// clips must never go through media-filename normalization', () => {
	const { isPassthroughAmcpClip } = require('../../src/media/caspar-cls-id')
	const { normalizeClipPlayAmcpLine } = require('../../src/caspar/amcp-clip-resolve')

	it('isPassthroughAmcpClip recognizes srt:// alongside every other network scheme here', () => {
		assert.equal(isPassthroughAmcpClip('srt://h:9000?passphrase=x'), true)
		// Siblings that were already correct, so a regression here is visible against a known-good set.
		assert.equal(isPassthroughAmcpClip('rtmp://h/app'), true)
		assert.equal(isPassthroughAmcpClip('udp://h:1'), true)
		assert.equal(isPassthroughAmcpClip('route://3-10'), true)
	})

	it('a PLAY of an srt:// clip is left byte-for-byte alone (found live, verifying the SRT feature)', () => {
		/* Found live: /api/raw (which runs normalizeClipPlayAmcpLine, unlike the real streaming-start
		 * path) treated a PLAY srt://... command as a media FILENAME and mangled it into
		 * `"SRT:/HOST:9000?PASSPHRASE=..."` — uppercased, single-slash, requoted — because srt was
		 * simply missing from the passthrough scheme list (added this session; rtmp/udp/route were
		 * already there). Harmless for the actual streaming feature (routes-streaming-channel-rtmp.js
		 * calls amcp.raw() directly, bypassing this normalizer entirely) but a real trap for the next
		 * caller that plays an srt:// clip through /api/raw or any LOAD/LOADBG/PLAY path. */
		const line = 'PLAY 3-97 srt://198.51.100.5:9000?latency=120000&passphrase=SHOULDNOTCHANGE'
		assert.equal(normalizeClipPlayAmcpLine(line, {}), line)
	})
})
