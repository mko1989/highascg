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
	}
}

async function runSmokeTest() {
	const manager = new SamplingManager(appCtx)
	
	const testConfig = {
		enabled: true,
		fps: 25,
		inputMode: 'file',
		fixtures: [
			{
				id: 'test-bar',
				sample: { x: 0, y: 0, w: 100, h: 100 },
				grid: { cols: 1, rows: 2 },
				colorOrder: 'rgb',
				universe: 1,
				startChannel: 1,
				protocol: 'artnet',
				destination: '127.0.0.1',
				gamma: 1.0,
				brightness: 1.0
			}
		]
	}

	console.log('--- Starting Smoke Test ---')
	await manager.updateConfig(testConfig)
	
	// Wait a bit for worker to start
	await new Promise(r => setTimeout(r, 500))

	const scaledW = Math.round(manager.width * manager.currentScale)
	const scaledH = Math.round(manager.height * manager.currentScale)
	const frameSize = scaledW * scaledH * 3
	
	console.log(`Feeding mock frame of size ${frameSize} (${scaledW}x${scaledH})...`)
	
	// Create a frame where the top half is RED and bottom half is GREEN
	const frame = Buffer.alloc(frameSize)
	for (let y = 0; y < scaledH; y++) {
		for (let x = 0; x < scaledW; x++) {
			const idx = (y * scaledW + x) * 3
			if (y < 5) {
				frame[idx] = 255 // Red
			} else {
				frame[idx + 1] = 255 // Green
			}
		}
	}

	// Mock DMX Output send to verify results
	manager.dmxOutput.send = (fixture, data) => {
		console.log(`[Mock DMX Output] Fixture ${fixture.id} Universe ${fixture.universe}:`, data)
		if (data[0] > 200 && data[1] < 50 && data[2] < 50) {
			console.log('SUCCESS: First cell is RED')
		}
		if (data[3] < 50 && data[4] > 200 && data[5] < 50) {
			console.log('SUCCESS: Second cell is GREEN')
		}
		
		console.log('--- Smoke Test Completed ---')
		manager.stop().then(() => process.exit(0))
	}

	// Write frame to FIFO (channel 1 path matches SamplingManager)
	const fifoPath = path.join(process.cwd(), '.sampling.1.pipe')
	const fifoStream = fs.createWriteStream(fifoPath)
	fifoStream.write(frame, () => {
		console.log('Frame written to FIFO')
		fifoStream.end()
	})

	// Timeout to exit if it fails
	setTimeout(() => {
		console.error('Smoke test timed out!')
		process.exit(1)
	}, 5000)
}

runSmokeTest().catch(e => {
	console.error('Smoke test failed:', e)
	process.exit(1)
})
