#!/usr/bin/env node
/**
 * Smoke test for `web/lib/previs-uv-mapper.js` (WO-17).
 *
 * Usage: `node tools/smoke-previs-uv.mjs`
 *
 * Uses `.mjs` explicitly so Node parses the mapper as an ES module regardless of the
 * repo's CommonJS default. Exits non-zero on any failure.
 */

import { __selfTest } from '../web/lib/previs-uv-mapper.js'

const result = __selfTest()

console.log(`[previs-uv] passed: ${result.passed}  failed: ${result.failed}`)
if (result.failures.length > 0) {
	console.log('[previs-uv] failures:')
	for (const f of result.failures) console.log('  -', f)
	process.exit(1)
}
process.exit(0)
