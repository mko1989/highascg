'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
	readBootXrandrSnapshot,
	resolveBootXrandrQueryPath,
} = require('../../src/utils/boot-xrandr-snapshot')
const {
	prefersFlatXrandrTopology,
	discoverGpuPhysicalTopologyFromXrandr,
} = require('../../src/utils/gpu-topology-xrandr')

describe('boot xrandr snapshot', () => {
	it('readBootXrandrSnapshot returns null when file missing', () => {
		const prev = process.env.HIGHASCG_BOOT_XRANDR_PATH
		process.env.HIGHASCG_BOOT_XRANDR_PATH = path.join(os.tmpdir(), `highascg-missing-xrandr-${Date.now()}.txt`)
		try {
			assert.equal(readBootXrandrSnapshot(), null)
		} finally {
			if (prev === undefined) delete process.env.HIGHASCG_BOOT_XRANDR_PATH
			else process.env.HIGHASCG_BOOT_XRANDR_PATH = prev
		}
	})

	it('readBootXrandrSnapshot reads fresh capture with meta', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'highascg-boot-xrandr-'))
		const queryPath = path.join(dir, 'boot-xrandr-query.txt')
		const metaPath = path.join(dir, 'boot-xrandr-meta.json')
		fs.writeFileSync(queryPath, 'DP-0 connected 1920x1080+0+0\n', 'utf8')
		fs.writeFileSync(
			metaPath,
			JSON.stringify({ capturedAt: new Date().toISOString(), display: ':0' }),
			'utf8',
		)
		const prev = process.env.HIGHASCG_BOOT_XRANDR_PATH
		process.env.HIGHASCG_BOOT_XRANDR_PATH = queryPath
		try {
			const snap = readBootXrandrSnapshot()
			assert.ok(snap?.raw.includes('DP-0'))
			assert.equal(resolveBootXrandrQueryPath(), queryPath)
			const rows = discoverGpuPhysicalTopologyFromXrandr(snap.raw)
			assert.equal(rows?.length, 1)
		} finally {
			if (prev === undefined) delete process.env.HIGHASCG_BOOT_XRANDR_PATH
			else process.env.HIGHASCG_BOOT_XRANDR_PATH = prev
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})
})

describe('prefersFlatXrandrTopology', () => {
	it('prefers flat for four DP-only outputs', () => {
		const outputs = ['DP-0', 'DP-1', 'DP-2', 'DP-3']
		const pairs = [
			['DP-0', 'DP-1'],
			['DP-2', 'DP-3'],
		]
		assert.equal(prefersFlatXrandrTopology(outputs, pairs, {}), true)
	})

	it('keeps paired mode when HDMI is present', () => {
		const outputs = ['DP-0', 'DP-1', 'HDMI-0', 'DP-2', 'DP-3', 'DP-4', 'DP-5']
		const pairs = [
			['DP-0', 'DP-1'],
			['HDMI-0', 'HDMI-1'],
			['DP-2', 'DP-3'],
			['DP-4', 'DP-5'],
		]
		assert.equal(prefersFlatXrandrTopology(outputs, pairs, {}), false)
	})
})
