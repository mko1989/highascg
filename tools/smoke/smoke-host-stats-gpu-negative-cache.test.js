'use strict'

/**
 * On a box with no NVIDIA GPU the nvidia-smi probe returns null, and the cache-hit guard used to
 * test `_gpuCache.text` — which is null in exactly that case — so the negative was never cached and
 * every host-stats poll spawned another doomed nvidia-smi. Observed on the AMD test laptop:
 * gpu.source was null in the response while nvidia-smi sat in the process list using CPU.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const SRC = fs.readFileSync(
	path.join(__dirname, '..', '..', 'src', 'api', 'routes-host-stats.js'),
	'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

test('the GPU cache-hit test does not depend on a truthy result', () => {
	const fn = SRC.slice(SRC.indexOf('async function getGpuCached'))
	const guard = /if\s*\(\s*_gpuCache\.([a-zA-Z]+)[^)]*GPU_TTL_MS[^)]*\)/.exec(fn)
	assert.ok(guard, 'getGpuCached still has a TTL guard')
	assert.notEqual(
		guard[1],
		'text',
		'gating on .text means a null probe result is never cached, so a machine with no NVIDIA GPU ' +
			're-spawns nvidia-smi on every single poll',
	)
	assert.equal(guard[1], 'at', 'gate on the timestamp so negative results are cached too')
})

test('a null probe still records a cache timestamp', () => {
	const fn = SRC.slice(SRC.indexOf('async function getGpuCached'))
	assert.match(
		fn,
		/_gpuCache\s*=\s*\{\s*text:\s*null,\s*at:\s*now/,
		'the miss path must stamp `at`, otherwise the guard above can never hit',
	)
})
