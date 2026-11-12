'use strict'

const fs = require('fs')

/**
 * WO-1045: name + savedAt of a show file, keyed by the file's identity (mtime, size, inode). Parsing every show on every
 * list call (~24 MB for 2 × 65 shows here) blocked the event loop ~150 ms a time — a web Sources panel asking 7×/s
 * starved the OSC → WS meter feed (VU meters at ~13 Hz with 270 ms gaps). A changed file has a new identity.
 * @type {Map<string, { key: string, name: unknown, savedAt: unknown }>}
 */
const _headCache = new Map()
const HEAD_CACHE_MAX = 2000

/** `{ name, savedAt }` of the project at `p` (stat `st`), parsed only when the file changed; throws on bad JSON. */
function readProjectHead(p, st) {
	const key = st ? `${st.mtimeMs}:${st.size}:${st.ino}` : ''
	const hit = key ? _headCache.get(p) : null
	if (hit && hit.key === key) return hit
	const project = JSON.parse(fs.readFileSync(p, 'utf8'))
	const head = project && typeof project === 'object' ? { key, name: project.name, savedAt: project.savedAt } : null
	if (key && head) {
		if (_headCache.size >= HEAD_CACHE_MAX) _headCache.clear()
		_headCache.set(p, head)
	}
	return head
}

module.exports = { readProjectHead, _headCache }
