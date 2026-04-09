/**
 * Stagger waveform GET starts so many clips do not hammer the server at once (WO T5.4).
 */

const MIN_GAP_MS = 55
let _lastStart = 0
const _pending = []

function pump() {
	if (!_pending.length) return
	const job = _pending.shift()
	if (!job) return
	const now = Date.now()
	const wait = Math.max(0, MIN_GAP_MS - (now - _lastStart))
	const run = () => {
		_lastStart = Date.now()
		job()
		pump()
	}
	if (wait > 0) setTimeout(run, wait)
	else run()
}

/**
 * @param {() => void} run — call fetch() inside
 */
export function enqueueWaveformFetch(run) {
	_pending.push(run)
	if (_pending.length === 1) pump()
}
