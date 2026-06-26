/**
 * Batch copy / move / delete for Caspar media browser (server filesystem).
 * @see to_server/MEDIA_BROWSER_API.md
 */
import { api } from './api-client.js'

/**
 * @param {string[]} sourceIds
 * @param {string} targetFolder - destination folder path ('' = media root)
 * @param {'move' | 'copy'} op
 */
async function batchTransfer(sourceIds, targetFolder, op) {
	const ids = [...new Set(sourceIds.map((id) => String(id || '').trim()).filter(Boolean))]
	if (ids.length === 0) return { ok: 0, failed: 0, errors: [] }

	const endpoint = op === 'copy' ? '/api/media/copy' : '/api/media/move'
	const targetId = String(targetFolder || '').trim()

	// Prefer batch API when server supports it
	try {
		const res = await api.post(endpoint, { sourceIds: ids, targetId })
		if (res?.ok !== false) {
			const ok = Number(res?.moved ?? res?.copied ?? res?.count ?? ids.length)
			return { ok: Number.isFinite(ok) ? ok : ids.length, failed: 0, errors: [] }
		}
	} catch {
		/* fall through to per-file */
	}

	let ok = 0
	/** @type {{ id: string, message: string }[]} */
	const errors = []
	for (const sourceId of ids) {
		try {
			await api.post(endpoint, { sourceId, targetId })
			ok++
		} catch (e) {
			errors.push({ id: sourceId, message: e?.message || String(e) })
		}
	}
	return { ok, failed: errors.length, errors }
}

/**
 * @param {string[]} sourceIds
 * @param {string} targetFolder
 */
export function moveMediaFiles(sourceIds, targetFolder) {
	return batchTransfer(sourceIds, targetFolder, 'move')
}

/**
 * @param {string[]} sourceIds
 * @param {string} targetFolder
 */
export function copyMediaFiles(sourceIds, targetFolder) {
	return batchTransfer(sourceIds, targetFolder, 'copy')
}

/**
 * @param {string[]} ids
 */
export async function deleteMediaFiles(ids) {
	const list = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))]
	if (list.length === 0) return { ok: 0, failed: 0, errors: [] }

	try {
		const res = await api.post('/api/media/delete', { ids: list })
		if (res?.ok !== false) {
			const ok = Number(res?.deleted ?? res?.count ?? list.length)
			return { ok: Number.isFinite(ok) ? ok : list.length, failed: 0, errors: [] }
		}
	} catch {
		/* per-file */
	}

	let ok = 0
	/** @type {{ id: string, message: string }[]} */
	const errors = []
	for (const id of list) {
		try {
			await api.post('/api/media/delete', { id })
			ok++
		} catch (e) {
			errors.push({ id, message: e?.message || String(e) })
		}
	}
	return { ok, failed: errors.length, errors }
}

/**
 * @param {{ ok: number, failed: number, errors: { id: string, message: string }[] }} result
 * @param {string} verb - e.g. "Moved", "Copied", "Deleted"
 */
export function formatMediaOpResult(result, verb) {
	const total = result.ok + result.failed
	if (result.failed === 0) return `${verb} ${result.ok} file${result.ok === 1 ? '' : 's'}`
	return `${verb} ${result.ok} of ${total} — ${result.failed} failed`
}
