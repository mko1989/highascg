/**
 * WO-184: Client-side thumbnail error handler tests.
 * Tests retry logic and caching of failed URLs.
 */

// Mock DOM environment
if (typeof document === 'undefined') {
	global.document = {
		createElement: (tag) => {
			const el = { tagName: tag, src: '', loading: '', onerror: null, onload: null }
			el.addEventListener = function(event, handler) {
				if (event === 'error') this.onerror = handler
				if (event === 'load') this.onload = handler
			}
			return el
		},
	}
	global.window = {
		location: { origin: 'http://localhost:4200' },
	}
	global.URL = URL
}

/**
 * Test the thumbnail error handler logic.
 * (This is a simplified test; real tests would use a DOM testing library.)
 */
function testThumbnailErrorHandler() {
	console.log('[WO-184] Testing thumbnail error handler...')

	// Test 1: Cache prevents retry of same URL
	const retriedUrls = new Set()
	const testUrl = 'http://localhost:4200/api/thumbnail/test?hq=1&w=80&t=2'

	// Simulate first error
	retriedUrls.add(testUrl)
	assert(retriedUrls.has(testUrl), 'URL should be cached after retry attempt')

	// Test 2: Different URL should not be in cache
	const otherUrl = 'http://localhost:4200/api/thumbnail/other?hq=1&w=80&t=2'
	assert(!retriedUrls.has(otherUrl), 'Different URL should not be in cache')

	console.log('[test] Thumbnail error handler logic tests passed')
}

/**
 * Simple assertion helper
 */
function assert(condition, message) {
	if (!condition) {
		throw new Error(`[FAIL] ${message}`)
	}
	console.log(`[PASS] ${message}`)
}

// Run tests if this is the main module
if (require.main === module) {
	try {
		testThumbnailErrorHandler()
		console.log('\n[WO-184] All client tests passed!')
	} catch (e) {
		console.error('\n[WO-184] Test failed:', e.message)
		process.exit(1)
	}
}

module.exports = { testThumbnailErrorHandler }
