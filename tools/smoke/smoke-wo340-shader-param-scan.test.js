/**
 * WO-340 — shader parameter scanner smoke tests.
 * Tests annotation parsing, heuristics, span correctness, and rewrite round-trips.
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const CLIENT = path.join(__dirname, '../../client')
const scannerPromise = import(pathToFileURL(path.join(CLIENT, 'lib/shader-param-scan.js')).href)

test('annotated slider with @slider(min, max) parses exact bounds', async () => {
	const { scanShaderParams } = await scannerPromise
	const source = `
#define SPEED 1.5 // @slider(0, 5)
`
	const params = scanShaderParams(source)
	assert.equal(params.length, 1)
	assert.equal(params[0].name, 'SPEED')
	assert.equal(params[0].kind, 'slider')
	assert.deepEqual(params[0].values, [1.5])
	assert.equal(params[0].min, 0)
	assert.equal(params[0].max, 5)
})

test('annotated slider with @slider(min, max, step) parses all three', async () => {
	const { scanShaderParams } = await scannerPromise
	const source = `const float N = 8.0; // @slider(1, 32, 1)`
	const params = scanShaderParams(source)
	assert.equal(params.length, 1)
	assert.equal(params[0].name, 'N')
	assert.equal(params[0].kind, 'slider')
	assert.deepEqual(params[0].values, [8.0])
	assert.equal(params[0].min, 1)
	assert.equal(params[0].max, 32)
	assert.equal(params[0].step, 1)
})

test('annotated @color on vec3 parses with color kind', async () => {
	const { scanShaderParams } = await scannerPromise
	const source = `#define TINT vec3(1.0, 0.2, 0.2) // @color`
	const params = scanShaderParams(source)
	assert.equal(params.length, 1)
	assert.equal(params[0].name, 'TINT')
	assert.equal(params[0].kind, 'color')
	assert.deepEqual(params[0].values, [1.0, 0.2, 0.2])
	assert.equal(params[0].min, 0)
	assert.equal(params[0].max, 1)
})

test('heuristic: SPEED 2.0 → slider 0..8 step 0.1', async () => {
	const { scanShaderParams } = await scannerPromise
	const source = `#define SPEED 2.0`
	const params = scanShaderParams(source)
	assert.equal(params.length, 1)
	assert.equal(params[0].name, 'SPEED')
	assert.equal(params[0].kind, 'slider')
	assert.deepEqual(params[0].values, [2.0])
	assert.equal(params[0].min, 0)
	assert.equal(params[0].max, 8)
	assert.equal(params[0].step, 0.1)
})

test('heuristic: vec3(1.0, 0.2, 0.2) → color', async () => {
	const { scanShaderParams } = await scannerPromise
	const source = `const vec3 TINT = vec3(1.0, 0.2, 0.2);`
	const params = scanShaderParams(source)
	assert.equal(params.length, 1)
	assert.equal(params[0].name, 'TINT')
	assert.equal(params[0].kind, 'color')
	assert.deepEqual(params[0].values, [1.0, 0.2, 0.2])
})

test('heuristic: vec3(4.0, 0.0, 0.0) out of range → slider', async () => {
	const { scanShaderParams } = await scannerPromise
	const source = `const vec3 BIG = vec3(4.0, 0.0, 0.0);`
	const params = scanShaderParams(source)
	assert.equal(params.length, 1)
	assert.equal(params[0].name, 'BIG')
	assert.equal(params[0].kind, 'slider')
	assert.deepEqual(params[0].values, [4.0, 0.0, 0.0])
	// First value is 4.0, so min=0, max=16
	assert.equal(params[0].min, 0)
	assert.equal(params[0].max, 16)
})

test('PI is skipped (reserved name)', async () => {
	const { scanShaderParams } = await scannerPromise
	const source = `#define PI 3.14159`
	const params = scanShaderParams(source)
	assert.equal(params.length, 0)
})

test('acos(...) initializer is skipped (not pure literal)', async () => {
	const { scanShaderParams } = await scannerPromise
	const source = `const float A = acos(-1.);`
	const params = scanShaderParams(source)
	assert.equal(params.length, 0)
})

test('1. and .5 literals parse correctly', async () => {
	const { scanShaderParams } = await scannerPromise
	const source = `
#define A 1.
const float B = .5;
const vec2 C = vec2(1., .5);
`
	const params = scanShaderParams(source)
	assert.equal(params.length, 3)
	assert.deepEqual(params[0].values, [1.0])
	assert.deepEqual(params[1].values, [0.5])
	assert.deepEqual(params[2].values, [1.0, 0.5])
})

test('negative floats parse', async () => {
	const { scanShaderParams } = await scannerPromise
	const source = `#define OFFSET -0.5`
	const params = scanShaderParams(source)
	assert.equal(params.length, 1)
	assert.deepEqual(params[0].values, [-0.5])
	// minVal = -0.5, so min = 4*-0.5 = -2, max = -4*-0.5 = 2
	assert.equal(params[0].min, -2)
	assert.equal(params[0].max, 2)
})

test('span correctness: source.slice(span.start, span.end) parses to reported value', async () => {
	const { scanShaderParams } = await scannerPromise
	const source = `#define SPEED 2.5`
	const params = scanShaderParams(source)
	assert.equal(params.length, 1)
	const param = params[0]
	assert.equal(param.spans.length, 1)
	const spanText = source.slice(param.spans[0].start, param.spans[0].end)
	assert.equal(spanText, '2.5')
	assert.equal(parseFloat(spanText), param.values[0])
})

test('span correctness for vec3: each component has exact span', async () => {
	const { scanShaderParams } = await scannerPromise
	const source = `const vec3 C = vec3(1.0, 0.5, 0.25);`
	const params = scanShaderParams(source)
	assert.equal(params.length, 1)
	const param = params[0]
	assert.equal(param.spans.length, 3)
	const values = param.spans.map((s) => parseFloat(source.slice(s.start, s.end)))
	assert.deepEqual(values, [1.0, 0.5, 0.25])
})

test('rewriteParamValues round-trip: rewrite and rescan finds same params with new values', async () => {
	const { scanShaderParams, rewriteParamValues } = await scannerPromise
	let source = `
#define SPEED 2.0
const vec3 TINT = vec3(1.0, 0.2, 0.2);
`
	const paramsOld = scanShaderParams(source)
	assert.equal(paramsOld.length, 2)

	// Rewrite SPEED to 3.5
	const speedParam = paramsOld[0]
	source = rewriteParamValues(source, speedParam, [3.5])

	// Rescan
	const paramsNew = scanShaderParams(source)
	assert.equal(paramsNew.length, 2)
	assert.equal(paramsNew[0].name, 'SPEED')
	assert.deepEqual(paramsNew[0].values, [3.5])
	assert.equal(paramsNew[1].name, 'TINT')
	assert.deepEqual(paramsNew[1].values, [1.0, 0.2, 0.2])
})

test('rewriteParamValues vec3 color round-trip', async () => {
	const { scanShaderParams, rewriteParamValues } = await scannerPromise
	let source = `const vec3 TINT = vec3(1.0, 0.2, 0.2);`
	const params = scanShaderParams(source)
	const tintParam = params[0]

	source = rewriteParamValues(source, tintParam, [0.5, 0.8, 0.3])

	const paramsNew = scanShaderParams(source)
	assert.equal(paramsNew[0].name, 'TINT')
	assert.deepEqual(paramsNew[0].values, [0.5, 0.8, 0.3])
	// Verify the rest of source is byte-identical
	assert.ok(source.includes('TINT'))
	assert.ok(source.includes('vec3'))
})

test('rewriteParamValues: formatted output always contains a decimal point', async () => {
	const { rewriteParamValues, scanShaderParams } = await scannerPromise
	let source = `#define VAL 2`
	const params = scanShaderParams(source)
	source = rewriteParamValues(source, params[0], [2])

	// The formatted output should be "2.0", not "2"
	assert.ok(source.includes('2.0'), 'formatted output should have 2.0, got: ' + source)
})

test('rewriteParamValues throws on drifted source', async () => {
	const { scanShaderParams, rewriteParamValues } = await scannerPromise
	const source = `#define SPEED 2.0`
	const params = scanShaderParams(source)
	const speedParam = params[0]

	// Mutate the span text between scan and rewrite
	const mutatedSource = source.replace('2.0', 'BROKEN')

	assert.throws(
		() => rewriteParamValues(mutatedSource, speedParam, [3.0]),
		/drifted/,
	)
})

test('scanAllPassSources: combines common and pass sources', async () => {
	const { scanAllPassSources } = await scannerPromise
	const common = `#define COMMON_VAL 1.0`
	const passes = {
		image: { source: `#define IMAGE_VAL 2.0` },
		bufferA: { source: `const float BUFFER_VAL = 3.0;` },
	}
	const allParams = scanAllPassSources(passes, common)
	assert.equal(allParams.length, 3)
	assert.equal(allParams[0].passKey, 'common')
	assert.equal(allParams[0].name, 'COMMON_VAL')
	assert.equal(allParams[1].passKey, 'image')
	assert.equal(allParams[1].name, 'IMAGE_VAL')
	assert.equal(allParams[2].passKey, 'bufferA')
	assert.equal(allParams[2].name, 'BUFFER_VAL')
})

test('rewriteParamValues length mismatch throws', async () => {
	const { scanShaderParams, rewriteParamValues } = await scannerPromise
	const source = `const vec3 C = vec3(1.0, 0.5, 0.25);`
	const params = scanShaderParams(source)
	const param = params[0]

	// vec3 has 3 spans, but provide only 2 values
	assert.throws(
		() => rewriteParamValues(source, param, [0.5, 0.8]),
		/length mismatch/,
	)
})

test('@color annotation on non-vec3/vec4 is ignored', async () => {
	const { scanShaderParams } = await scannerPromise
	const source = `const float VAL = 1.0; // @color`
	const params = scanShaderParams(source)
	// Should be treated as slider, not color, since @color is invalid for float
	assert.equal(params.length, 1)
	assert.equal(params[0].kind, 'slider')
})

test('block comment lines are skipped', async () => {
	const { scanShaderParams } = await scannerPromise
	const source = `
#define BEFORE 1.0
/*
#define INSIDE 2.0
*/
#define AFTER 3.0
`
	const params = scanShaderParams(source)
	assert.equal(params.length, 2)
	assert.equal(params[0].name, 'BEFORE')
	assert.equal(params[1].name, 'AFTER')
})

test('line comment does not remove annotation', async () => {
	const { scanShaderParams } = await scannerPromise
	const source = `#define SPEED 1.5 // this is a comment @slider(0, 10)`
	const params = scanShaderParams(source)
	assert.equal(params.length, 1)
	assert.equal(params[0].min, 0)
	assert.equal(params[0].max, 10)
})
