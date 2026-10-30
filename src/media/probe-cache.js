'use strict'

/**
 * WO-845: freshness stamps for the ffprobe result cache (`ctx._mediaProbeCache` / `ctx._mediaProbeTried`).
 *
 * The cache is keyed by media id only and used to be filled once per id and never revisited, so replacing
 * `clip.mov` (ingest overwrite, version restore, HAP re-encode) left /api/media and getState().media serving the old
 * duration / resolution / fps / codec until the node restarted. Each probe now records `size:mtime` of the file it
 * read; a later call drops the entry (and the "tried" mark, so it is probed again) when the file's size or mtime
 * differs. Entries nobody stamped (CINF-derived durations written by the playback tracker) are left alone.
 */

const fs = require('fs')

/** @param {string} filePath @returns {Promise<string|null>} `size:mtimeMs`, or null when the file cannot be stat'ed */
async function statStamp(filePath) {
	try {
		const st = await fs.promises.stat(filePath)
		return `${st.size}:${Math.round(st.mtimeMs)}`
	} catch {
		return null
	}
}

/**
 * Remember what the file looked like when `id` was probed. Take the stamp BEFORE running ffprobe so a change during
 * the probe is caught by the next comparison.
 * @param {object} ctx
 * @param {string} id
 * @param {string|null} stamp
 */
function recordProbeStamp(ctx, id, stamp) {
	if (stamp == null) return
	const stamps = (ctx._mediaProbeStamp = ctx._mediaProbeStamp || {})
	stamps[id] = stamp
}

/**
 * Invalidate probe entries whose file changed on disk.
 * @param {object} ctx
 * @param {string[]} ids  media ids to check (only stamped ones are stat'ed)
 * @param {(id: string) => string|null} resolveFile  absolute path of an id (null = skip)
 * @returns {Promise<string[]>} the ids dropped
 */
async function dropStaleProbeEntries(ctx, ids, resolveFile) {
	const stamps = ctx._mediaProbeStamp
	if (!stamps) return []
	const dropped = []
	await Promise.all(
		ids.map(async (id) => {
			const was = stamps[id]
			if (was === undefined) return
			const fp = resolveFile(id)
			if (!fp) return
			const now = await statStamp(fp)
			if (now === null || now === was) return // gone files keep their last answer; unchanged files stay cached
			delete stamps[id]
			if (ctx._mediaProbeCache) delete ctx._mediaProbeCache[id]
			if (ctx._mediaProbeTried && typeof ctx._mediaProbeTried.delete === 'function') ctx._mediaProbeTried.delete(id)
			dropped.push(id)
		}),
	)
	return dropped
}

module.exports = { statStamp, recordProbeStamp, dropStaleProbeEntries }
