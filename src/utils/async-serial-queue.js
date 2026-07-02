'use strict'

/**
 * In-process async serialization (WO-100 Phase C).
 * Ensures fn() runs only after prior enqueued work finished.
 */

/** @type {Promise<void>} */
let _tail = Promise.resolve()

/**
 * @template T
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
function runSerialized(fn) {
	const run = _tail.then(() => fn())
	_tail = run.then(
		() => undefined,
		() => undefined,
	)
	return run
}

/** Reset queue — for tests only. */
function _resetSerializedQueueForTests() {
	_tail = Promise.resolve()
}

module.exports = { runSerialized, _resetSerializedQueueForTests }
