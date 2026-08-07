'use strict'

const fs = require('fs')
const path = require('path')
const { SamplingManager } = require('../src/sampling/dmx-sampling')

// Mock AppCtx
const appCtx = {
	log: (level, msg) => console.log(`[${level.toUpperCase()}] ${msg}`),
	amcp: {
		isConnected: true,
		raw: async (cmd) => {
			console.log(`[Mock AMCP] Command: ${cmd}`)
			return { ok: true }
		}
	},
	_wsBroadcast: (type, data) => {
		if (type === 'dmx:colors') {
			process.send({ type: 'ws-broadcast', data })
		}
	}
}

// Wrap in child process to capture ws broadcasts easily if needed,
// but for simple smoke test we just check console.
appCtx._wsBroadcast = (type, data) => {
	console.log(`[Mock WS] Broadcast ${type}:`, JSON.stringify(data).slice(0, 100) + '...')
}

async function runSmokeTest() {
	const manager = new SamplingManager(appCtx)
	
	const testConfig = {
		enabled: true,
		fps: 25,
		inputMode: 'file',
		fixtures: [
			{
				id: 'rotated-bar',
				sample: { x: 100, y: 100, w: 100, h: 20 },
				rotation: 90, // Vertical now
				grid: { cols: 1, rows: 2 },
				colorOrder: 'rgb',
				universe: 1,
				startChannel: 1,
				protocol: 'artnet',
				sourceChannel: 2, // Test multi-channel
				gamma: 1.0,
				brightness: 1.0
			}
		]
	}

	console.log('--- Starting Advanced Smoke Test ---')
	await manager.updateConfig(testConfig)
	
	await new Promise(r => setTimeout(r, 500))

	const scaledW = 192, scaledH = 108
	const frameSize = scaledW * scaledH * 3
	
	console.log(`Feeding mock frame to channel 2 FIFO...`)
	
	// Frame for ch2: Top half is RED, bottom half is GREEN
	const frame = Buffer.alloc(frameSize)
	for (let y = 0; y < scaledH; y++) {
		for (let x = 0; x < scaledW; x++) {
			const idx = (y * scaledW + x) * 3
			if (y < 54) frame[idx] = 255 // Red
			else frame[idx + 1] = 255 // Green
		}
	}

	// The rotated fixture 100,100,100x20 @ 90deg is vertical.
	// Its center is 150, 110.
	// At 10% scale, center is 15, 11.
	// Unrotated local coords for 2 cells: (0,-5) and (0,5)
	// Rotated 90deg: (5,0) and (-5,0)
	// Global scaled: (20, 11) and (10, 11)
	// Both gy=11 are < 54, so both should be RED.
	
	manager.dmxOutput.send = (fixture, data) => {
		console.log(`[Mock DMX] ${fixture.id} data:`, data)
		if (data[0] === 255 && data[3] === 255) {
			console.log('SUCCESS: Both cells sampled correctly from Red area after rotation')
		} else {
			console.error('FAILURE: Unexpected colors after rotation')
		}
		
		console.log('--- Smoke Test Completed ---')
		manager.stop().then(() => process.exit(0))
	}

	const fifoPath = path.join(process.cwd(), '.sampling.2.pipe')
	const fifoStream = fs.createWriteStream(fifoPath)
	fifoStream.write(frame, () => {
		fifoStream.end()
	})

	setTimeout(() => {
		console.error('Smoke test timed out!')
		process.exit(1)
	}, 5000)
}

runSmokeTest().catch(e => {
	console.error('Smoke test failed:', e)
	process.exit(1)
})
