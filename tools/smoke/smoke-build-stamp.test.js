'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	compareBuildStamps,
	parseServerReleaseAssetStamp,
} = require('../../src/system/build-stamp')

test('compareBuildStamps orders UTC stamps', () => {
	assert.ok(compareBuildStamps('2026-06-28T120000Z', '2026-06-27T120000Z') > 0)
	assert.ok(compareBuildStamps('2026-06-27T120000Z', '2026-06-28T120000Z') < 0)
	assert.equal(compareBuildStamps('2026-06-28T120000Z', '2026-06-28T120000Z'), 0)
})

test('parseServerReleaseAssetStamp reads tarball name', () => {
	assert.equal(
		parseServerReleaseAssetStamp('highascg-server_2026-06-28T143022Z.tar.gz'),
		'2026-06-28T143022Z',
	)
	assert.equal(parseServerReleaseAssetStamp('other.tar.gz'), null)
})
