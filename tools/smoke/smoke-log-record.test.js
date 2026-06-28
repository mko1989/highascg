'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const logBuffer = require('../../src/utils/log-buffer')
const {
	inferCategoryFromMessage,
	parseLegacyLine,
	parseFilterList,
	recordMatchesFilters,
	LOG_CATEGORIES,
} = require('../../src/utils/log-record')
const { buildZipStore } = require('../../src/support/zip-store')
const { redactObject } = require('../../src/support/redact-settings')

test('inferCategoryFromMessage maps known tags', () => {
	assert.equal(inferCategoryFromMessage('[OS-Config] xrandr apply'), 'os-display')
	assert.equal(inferCategoryFromMessage('[ArtNet] listen on'), 'artnet')
	assert.equal(inferCategoryFromMessage('[scene-take] ch=1'), 'playback')
})

test('parseLegacyLine extracts level and category', () => {
	const line = '[2026-06-28 12:00:00.000] (HACG) [warn] [Config] save failed'
	const rec = parseLegacyLine(line)
	assert.equal(rec.level, 'warn')
	assert.equal(rec.category, 'config')
	assert.equal(rec.line, line)
})

test('log buffer filters by category and level', () => {
	logBuffer.clearHighasLines()
	logBuffer.appendHighasLine({
		ts: '2026-06-28 12:00:00.000',
		level: 'info',
		category: 'artnet',
		message: 'listen',
		line: '[2026-06-28 12:00:00.000] (HACG) [info] listen',
	})
	logBuffer.appendHighasLine({
		ts: '2026-06-28 12:00:01.000',
		level: 'warn',
		category: 'os-display',
		message: 'xrandr',
		line: '[2026-06-28 12:00:01.000] (HACG) [warn] xrandr',
	})

	const artnetOnly = logBuffer.getHighasLines({
		lines: 50,
		categories: parseFilterList('artnet'),
		levels: parseFilterList('info,warn,error'),
	})
	assert.deepEqual(artnetOnly, [
		'[2026-06-28 12:00:00.000] (HACG) [info] listen',
	])

	const warnOnly = logBuffer.getHighasLines({
		lines: 50,
		categories: parseFilterList('os-display,artnet'),
		levels: parseFilterList('warn'),
	})
	assert.deepEqual(warnOnly, [
		'[2026-06-28 12:00:01.000] (HACG) [warn] xrandr',
	])

	logBuffer.clearHighasLines()
})

test('recordMatchesFilters respects empty level set as allow-all', () => {
	const rec = { ts: '', level: 'debug', category: 'system' }
	assert.equal(recordMatchesFilters(rec, { categories: null, levels: null }), true)
	assert.equal(recordMatchesFilters(rec, { categories: new Set(['system']), levels: new Set(['info']) }), false)
})

test('LOG_CATEGORIES includes expected ids', () => {
	assert.ok(LOG_CATEGORIES.includes('os-display'))
	assert.ok(LOG_CATEGORIES.includes('artnet'))
})

test('redactObject strips sensitive keys', () => {
	const out = redactObject({ host: 'x', apiToken: 'secret', nested: { password: 'p' } })
	assert.equal(out.host, 'x')
	assert.equal(out.apiToken, '[REDACTED]')
	assert.equal(out.nested.password, '[REDACTED]')
})

test('buildZipStore produces valid zip signature', () => {
	const zip = buildZipStore({ 'hello.txt': 'world', 'dir/nested.json': '{"ok":true}' })
	assert.ok(Buffer.isBuffer(zip))
	assert.equal(zip.readUInt32LE(0), 0x04034b50)
	assert.ok(zip.length > 50)
})

test('buildSupportBundleFiles includes gpu-display and redaction manifest', async () => {
	const defaults = require('../../src/config/defaults')
	const { buildSupportBundleFiles } = require('../../src/support/build-support-bundle')
	const { files, manifest } = await buildSupportBundleFiles(
		{ config: defaults, getChannelCount: () => 1, _casparStatus: { connected: false } },
		{ logLines: 10, casparLines: 5 },
	)
	assert.ok(files['system/gpu-display.json'])
	assert.ok(Array.isArray(manifest.redactedKeyPatterns) && manifest.redactedKeyPatterns.includes('password'))
	assert.equal(manifest.kind, 'highascg-support-bundle')
})
