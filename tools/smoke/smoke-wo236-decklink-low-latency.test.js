'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { buildDecklinkKeyFillConsumersXml } = require('../../src/config/decklink-key-fill')
const { buildDecklinkTiledConsumersXml } = require('../../src/config/config-generator-consumer-attach')

test('WO-236 buildDecklinkKeyFillConsumersXml: lowLatency false omits latency tag', () => {
	const xml = buildDecklinkKeyFillConsumersXml({
		fillDevice: 1,
		videoMode: '1080p5000',
		lowLatency: false,
	})
	assert.doesNotMatch(xml, /<latency>low<\/latency>/)
})

test('WO-236 buildDecklinkKeyFillConsumersXml: lowLatency absent omits latency tag', () => {
	const xml = buildDecklinkKeyFillConsumersXml({
		fillDevice: 1,
		videoMode: '1080p5000',
	})
	assert.doesNotMatch(xml, /<latency>low<\/latency>/)
})

test('WO-236 buildDecklinkKeyFillConsumersXml: lowLatency true emits latency tag', () => {
	const xml = buildDecklinkKeyFillConsumersXml({
		fillDevice: 1,
		videoMode: '1080p5000',
		lowLatency: true,
	})
	assert.match(xml, /<latency>low<\/latency>/)
})

test('WO-236 buildDecklinkKeyFillConsumersXml: lowLatency true with key/fill emits on fill device', () => {
	const xml = buildDecklinkKeyFillConsumersXml({
		fillDevice: 1,
		keyDevice: 2,
		keyer: 'internal',
		videoMode: '1080p5000',
		lowLatency: true,
	})
	const fillBlock = xml.split('<decklink>')[1]
	assert.match(fillBlock, /<latency>low<\/latency>/)
})

test('WO-236 buildDecklinkTiledConsumersXml: lowLatency false omits latency tag', () => {
	const tiles = [
		{
			device: 1,
			srcX: 0,
			srcY: 0,
			destX: 0,
			destY: 0,
			width: 1920,
			height: 1080,
			videoMode: '1080p5000',
		},
	]
	const xml = buildDecklinkTiledConsumersXml(tiles, {
		videoMode: '1080p5000',
		lowLatency: false,
	})
	assert.doesNotMatch(xml, /<latency>low<\/latency>/)
})

test('WO-236 buildDecklinkTiledConsumersXml: lowLatency absent omits latency tag', () => {
	const tiles = [
		{
			device: 1,
			srcX: 0,
			srcY: 0,
			destX: 0,
			destY: 0,
			width: 1920,
			height: 1080,
			videoMode: '1080p5000',
		},
	]
	const xml = buildDecklinkTiledConsumersXml(tiles, {
		videoMode: '1080p5000',
	})
	assert.doesNotMatch(xml, /<latency>low<\/latency>/)
})

test('WO-236 buildDecklinkTiledConsumersXml: lowLatency true emits latency tag', () => {
	const tiles = [
		{
			device: 1,
			srcX: 0,
			srcY: 0,
			destX: 0,
			destY: 0,
			width: 1920,
			height: 1080,
			videoMode: '1080p5000',
		},
	]
	const xml = buildDecklinkTiledConsumersXml(tiles, {
		videoMode: '1080p5000',
		lowLatency: true,
	})
	assert.match(xml, /<latency>low<\/latency>/)
})

test('WO-236 buildDecklinkTiledConsumersXml: lowLatency true with multiple tiles only on main block', () => {
	const tiles = [
		{
			device: 1,
			srcX: 0,
			srcY: 0,
			destX: 0,
			destY: 0,
			width: 1920,
			height: 1080,
			videoMode: '1080p5000',
		},
		{
			device: 2,
			srcX: 1920,
			srcY: 0,
			destX: 1920,
			destY: 0,
			width: 1920,
			height: 1080,
			videoMode: '1080p5000',
		},
	]
	const xml = buildDecklinkTiledConsumersXml(tiles, {
		videoMode: '1080p5000',
		lowLatency: true,
	})
	// Verify latency tag is present
	assert.match(xml, /<latency>low<\/latency>/)
	// Verify it appears only once (top-level, not in ports)
	const matches = xml.match(/<latency>low<\/latency>/g)
	assert.equal(matches.length, 1, 'latency tag should appear exactly once')
})
