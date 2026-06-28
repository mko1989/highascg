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
	assert.equal(repl.playheadSync.enabled, false)
	assert.equal(repl.playheadSync.softThresholdMs, 150)
	assert.equal(repl.playheadSync.minCorrectionIntervalMs, 2000)
})

const FFMPEG_INFO_XML = `<?xml version="1.0" encoding="utf-8"?>
<channel>
  <framerate>50</framerate>
  <stage>
    <layer>
      <layer_10>
        <foreground>
          <file>
            <clip>0</clip>
            <clip>60</clip>
            <name>clip-preview.mp4</name>
            <path>media/clip-preview.mp4</path>
            <time>31.88</time>
            <time>60</time>
          </file>
          <producer>ffmpeg</producer>
        </foreground>
      </layer_10>
    </layer>
  </stage>
</channel>`

test('parseChannelPlayheadXml reads ffmpeg file.time and name (not duration as clip)', async () => {
	const parsed = await parseChannelPlayheadXml(FFMPEG_INFO_XML)
	assert.equal(parsed.layers['10'].clip, 'clip-preview.mp4')
	assert.equal(parsed.layers['10'].timeSec, 31.88)
	assert.equal(parsed.layers['10'].frame, 1594)
})

test('exportProgramPlayheads uses OSC state without AMCP INFO', async () => {
	const infoCalls = []
	const ctx = {
		config: { screen_count: 1, casparServer: { screen_count: 1, channel_layout: 'mono' }, screenDestinations: [{ id: 'm1', mainScreenIndex: 0, mode: 'pgm_prv' }] },
		oscState: {
			getSnapshot: () => ({
				channels: {
					1: {
						framerate: '50',
						layers: {
							10: {
								type: 'ffmpeg',
								paused: false,
								file: { name: 'clip.mp4', elapsed: 12.5, fps: 50 },
							},
						},
					},
				},
			}),
		},
		amcp: { info: () => { infoCalls.push(1); return Promise.reject(new Error('should not call')) } },
	}
	const liveSceneState = require('../../src/state/live-scene-state')
	const orig = liveSceneState.getAll
	liveSceneState.getAll = () => ({ 1: { sceneId: 'look-1' } })
	try {
		const { exportProgramPlayheads } = require('../../src/replication/playhead-export')
		const out = await exportProgramPlayheads(ctx)
		assert.equal(infoCalls.length, 0)
		assert.equal(out.channels['1'].layers['10'].timeSec, 12.5)
		assert.equal(out.channels['1'].layers['10'].clip, 'clip.mp4')
	} finally {
		liveSceneState.getAll = orig
	}
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

test('tickPlayheadSync never sends AMCP corrections regardless of drift', async (t) => {
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
				'1': { layers: { '10': { clip: 'CLIP_A', state: 'playing', timeSec: 8, frame: 400 } } },
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
	await tickPlayheadSync(ctx, runtime)
	assert.equal(corrections.length, 0)
	assert.ok(runtime.playheadDriftMs >= 150)
})
