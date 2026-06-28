'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { normalizeReplicationConfig } = require('../../src/config/replication-config')
const { parseChannelPlayheadXml } = require('../../src/replication/playhead-export')
const { bindAmcpFanout, unbindAmcpFanout } = require('../../src/replication/amcp-fanout')
const peerClient = require('../../src/replication/peer-client')
const playheadExport = require('../../src/replication/playhead-export')

const SAMPLE_INFO_XML = `<?xml version="1.0" encoding="utf-8"?>
<channel>
  <framerate>50</framerate>
  <stage>
    <layer>
      <layer_10>
        <foreground>
          <producer name="CLIP_A">
            <frame>620</frame>
            <nb-frames>2500</nb-frames>
          </producer>
        </foreground>
      </layer_10>
    </layer>
  </stage>
</channel>`

function reloadPlayheadSync() {
	const syncPath = path.resolve(__dirname, '../../src/replication/playhead-sync.js')
	delete require.cache[syncPath]
	return require('../../src/replication/playhead-sync')
}

function fanoutLeaderCtx(overrides = {}) {
	return {
		config: {
			replication: normalizeReplicationConfig({
				enabled: true,
				role: 'leader',
				pairId: 'pair-1',
				selfId: 'leader',
				peer: { host: '192.168.0.10', port: 4200, token: 'tok' },
				mirrorTransport: 'amcp-fanout',
				peerCaspar: { host: '192.168.0.10', port: 5250 },
				playheadSync: {
					enabled: true,
					softThresholdMs: 150,
					minCorrectionIntervalMs: 1000,
					maxCorrectionsPerMinute: 6,
					...overrides.playheadSync,
				},
				...overrides.replication,
			}),
		},
		log: () => {},
	}
}

test('normalizeReplicationConfig includes playheadSync defaults', () => {
	const repl = normalizeReplicationConfig({ enabled: true })
	assert.equal(repl.playheadSync.enabled, true)
	assert.equal(repl.playheadSync.softThresholdMs, 150)
	assert.equal(repl.playheadSync.minCorrectionIntervalMs, 5000)
})

test('parseChannelPlayheadXml extracts playing layer time and frame', async () => {
	const parsed = await parseChannelPlayheadXml(SAMPLE_INFO_XML)
	assert.equal(parsed.framerate, '50')
	assert.equal(parsed.layers['10'].clip, 'CLIP_A')
	assert.equal(parsed.layers['10'].state, 'playing')
	assert.equal(parsed.layers['10'].timeSec, 12.4)
	assert.equal(parsed.layers['10'].frame, 620)
})

test('tickPlayheadSync skips correction when drift below soft threshold', async (t) => {
	const origPeer = peerClient.peerHttpRequest
	const origExport = playheadExport.exportProgramPlayheads
	/** @type {string[]} */
	const corrections = []

	t.after(() => {
		peerClient.peerHttpRequest = origPeer
		playheadExport.exportProgramPlayheads = origExport
		unbindAmcpFanout()
		delete require.cache[path.resolve(__dirname, '../../src/replication/playhead-sync.js')]
	})

	playheadExport.exportProgramPlayheads = async () => ({
		channels: {
			'1': { layers: { '10': { clip: 'CLIP_A', state: 'playing', timeSec: 10, frame: 500 } } },
		},
	})
	peerClient.peerHttpRequest = async () => ({
		ok: true,
		json: {
			channels: {
				'1': { layers: { '10': { clip: 'CLIP_A', state: 'playing', timeSec: 9.95, frame: 497 } } },
			},
		},
	})

	const { tickPlayheadSync } = reloadPlayheadSync()
	const ctx = fanoutLeaderCtx()
	const runtime = {
		roleState: { getRole: () => 'leader' },
		peerReachable: true,
		peerCasparConnection: {
			isConnected: true,
			enqueueCorrection: (cmd) => corrections.push(cmd),
		},
	}
	bindAmcpFanout(ctx, runtime)

	await tickPlayheadSync(ctx, runtime)
	await tickPlayheadSync(ctx, runtime)
	assert.equal(corrections.length, 0)
	assert.ok(Math.abs(runtime.playheadDriftMs) <= 150)
})

test('tickPlayheadSync sends SEEK after sustained drift over threshold', async (t) => {
	const origPeer = peerClient.peerHttpRequest
	const origExport = playheadExport.exportProgramPlayheads
	/** @type {string[]} */
	const corrections = []

	t.after(() => {
		peerClient.peerHttpRequest = origPeer
		playheadExport.exportProgramPlayheads = origExport
		unbindAmcpFanout()
		delete require.cache[path.resolve(__dirname, '../../src/replication/playhead-sync.js')]
	})

	playheadExport.exportProgramPlayheads = async () => ({
		channels: {
			'1': { layers: { '10': { clip: 'CLIP_A', state: 'playing', timeSec: 10, frame: 500 } } },
		},
	})
	peerClient.peerHttpRequest = async () => ({
		ok: true,
		json: {
			channels: {
				'1': { layers: { '10': { clip: 'CLIP_A', state: 'playing', timeSec: 9.2, frame: 460 } } },
			},
		},
	})

	const { tickPlayheadSync } = reloadPlayheadSync()
	const ctx = fanoutLeaderCtx({ playheadSync: { minCorrectionIntervalMs: 1000 } })
	const runtime = {
		roleState: { getRole: () => 'leader' },
		peerReachable: true,
		peerCasparConnection: {
			isConnected: true,
			enqueueCorrection: (cmd) => corrections.push(cmd),
		},
	}
	bindAmcpFanout(ctx, runtime)

	await tickPlayheadSync(ctx, runtime)
	assert.equal(corrections.length, 0, 'first tick only counts consecutive over-soft')

	await tickPlayheadSync(ctx, runtime)
	assert.equal(corrections.length, 1)
	assert.equal(corrections[0], 'PLAY 1-10 SEEK 500')
	assert.ok(runtime.playheadDriftMs >= 150)
})
