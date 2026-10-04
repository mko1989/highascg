/**
 * Sources panel — multi-select media copy/move/delete.
 */

import { api } from '../lib/api-client.js'
import { mergeMediaProbeOverlay } from './sources-panel-helpers.js'
import { getDefaultUploadSubdir } from '../lib/project-media-context.js'
import { copyMediaFiles, deleteMediaFiles, formatMediaOpResult, moveMediaFiles } from '../lib/media-file-ops.js'
import { showMediaFolderPicker, listMediaFolders } from './media-folder-picker-modal.js'

/**
 * @param {object} ctx
 */
export function createMediaSelection(ctx) {
	const {
		stateStore,
		getMediaWithProbe,
		selectedMedia,
		lastSelectedMediaId,
		visibleMediaOrder,
		selectionBar,
		selectionCountEl,
		setStatus,
		refreshMedia,
		render,
	} = ctx

	function toggleMediaSelection(id, modifiers = {}) {
		const multi = modifiers.ctrlKey || modifiers.metaKey
		if (modifiers.shiftKey && lastSelectedMediaId.current) {
			const a = visibleMediaOrder.current.indexOf(lastSelectedMediaId.current)
			const b = visibleMediaOrder.current.indexOf(id)
			if (a >= 0 && b >= 0) {
				const lo = Math.min(a, b)
				const hi = Math.max(a, b)
				if (!multi) selectedMedia.clear()
				for (let i = lo; i <= hi; i++) selectedMedia.add(visibleMediaOrder.current[i])
			} else if (!multi) {
				selectedMedia.clear()
				selectedMedia.add(id)
			}
		} else if (multi) {
			if (selectedMedia.has(id)) selectedMedia.delete(id)
			else selectedMedia.add(id)
		} else if (selectedMedia.size === 1 && selectedMedia.has(id)) {
			selectedMedia.clear()
		} else {
			selectedMedia.clear()
			selectedMedia.add(id)
		}
		lastSelectedMediaId.current = id
		render()
	}

	/** WO-592: exactly one selected file → media inspector; anything else withdraws it. */
	let announcedId = null
	function announceInspectorSelection() {
		const id = selectedMedia.size === 1 ? String(Array.from(selectedMedia)[0]) : null
		if (id === announcedId) return
		announcedId = id
		let item = null
		if (id) {
			const list = mergeMediaProbeOverlay(stateStore.getState().media || [], getMediaWithProbe())
			item = list.find((m) => String(m?.id ?? m) === id) || { id }
		}
		window.dispatchEvent(new CustomEvent('media-file-select', { detail: item ? { id, item } : null }))
	}

	function updateSelectionBar() {
		const count = selectedMedia.size
		if (selectionBar) selectionBar.style.display = count > 0 ? 'flex' : 'none'
		if (selectionCountEl) {
			selectionCountEl.textContent = `${count} selected`
		}
		announceInspectorSelection()
	}

	async function runMediaTransfer(op, ids) {
		const list = ids?.length ? ids : Array.from(selectedMedia)
		if (list.length === 0) return
		const s = stateStore.getState()
		const mediaList = mergeMediaProbeOverlay(s.media || [], getMediaWithProbe())
		const title = op === 'copy' ? `Copy ${list.length} file${list.length === 1 ? '' : 's'} to` : `Move ${list.length} file${list.length === 1 ? '' : 's'} to`
		const dest = await showMediaFolderPicker({
			title,
			mediaList,
			initialPath: getDefaultUploadSubdir(),
		})
		if (dest == null) return
		const folders = new Set(listMediaFolders(mediaList))
		if (dest && !folders.has(dest)) {
			await api.post('/api/media/mkdir', { path: dest }).catch(() => {})
		}
		setStatus(`${op === 'copy' ? 'Copying' : 'Moving'} ${list.length}…`, 'info')
		const result = op === 'copy' ? await copyMediaFiles(list, dest) : await moveMediaFiles(list, dest)
		setStatus(formatMediaOpResult(result, op === 'copy' ? 'Copied' : 'Moved'), result.failed ? 'error' : 'ok')
		if (result.failed && result.errors[0]) console.warn('[media]', result.errors[0])
		if (op === 'move') selectedMedia.clear()
		refreshMedia()
	}

	async function runMediaDelete(ids) {
		const list = ids?.length ? ids : Array.from(selectedMedia)
		if (list.length === 0) return
		if (!confirm(`Delete ${list.length} selected file${list.length === 1 ? '' : 's'}?\n\nThis cannot be undone.`)) return
		setStatus(`Deleting ${list.length}…`, 'info')
		const result = await deleteMediaFiles(list)
		setStatus(formatMediaOpResult(result, 'Deleted'), result.failed ? 'error' : 'ok')
		selectedMedia.clear()
		refreshMedia()
	}

	/** Next render re-announces the selection even if unchanged (file content/name changed under it). */
	function forceReannounce() {
		announcedId = undefined
	}

	return {
		forceReannounce,
		toggleMediaSelection,
		updateSelectionBar,
		runMediaTransfer,
		runMediaDelete,
	}
}
