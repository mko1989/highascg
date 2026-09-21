/**
 * WO-575 — Sources panel: "Encode to HAP" for the selected media. Owns the job list + status line;
 * the server (src/media/hap-encode-queue.js) does the encoding and pushes `media:hap-encode`.
 */

import { showHapEncodeModal } from './media-hap-encode-modal.js'
import { startHapEncode, cancelHapEncode, fetchHapEncodeJobs } from '../lib/media-file-ops.js'
import { hapProgressText, hapFinishedSummary, hapJobActive, isAnythingPlaying } from '../lib/hap-encode-status.js'

/**
 * @param {object} ctx
 * @param {{ getState: () => object }} ctx.stateStore
 * @param {{ on?: Function } | undefined} ctx.wsClient
 * @param {Set<string>} ctx.selectedMedia
 * @param {(msg: string, kind: 'info' | 'ok' | 'error') => void} ctx.setStatus
 * @param {() => void} ctx.refreshMedia
 * @param {HTMLElement | null} ctx.cancelBtn
 */
export function createHapEncode(ctx) {
	const { stateStore, wsClient, selectedMedia, setStatus, refreshMedia, cancelBtn } = ctx
	/** @type {Map<string, object>} */
	const jobs = new Map()
	const announced = new Set()

	function render() {
		const list = [...jobs.values()]
		const text = hapProgressText(list)
		if (cancelBtn) cancelBtn.style.display = text ? '' : 'none'
		if (text) setStatus(text, 'info')
	}

	function onJob(job) {
		if (!job?.jobId) return
		jobs.set(job.jobId, job)
		if (!hapJobActive(job) && !announced.has(job.jobId)) {
			announced.add(job.jobId)
			const { text, kind } = hapFinishedSummary(job)
			// Still-active sibling jobs own the status line; their next tick replaces this.
			setStatus(text, kind)
			if (job.counts?.done) refreshMedia()
		}
		render()
	}

	async function run() {
		const ids = Array.from(selectedMedia)
		if (ids.length === 0) return
		const opts = await showHapEncodeModal({ ids, onAir: isAnythingPlaying(stateStore.getState()) })
		if (!opts) return
		setStatus(`Queueing ${ids.length} for HAP…`, 'info')
		try {
			const job = await startHapEncode(ids, opts)
			onJob(job)
		} catch (e) {
			setStatus(`HAP encode failed to start: ${e?.message || e}`, 'error')
		}
	}

	async function cancelAll() {
		const active = [...jobs.values()].filter(hapJobActive)
		await Promise.all(active.map((j) => cancelHapEncode(j.jobId).catch(() => {})))
	}

	function attach() {
		if (wsClient?.on) wsClient.on('media:hap-encode', onJob)
		if (cancelBtn) cancelBtn.onclick = () => void cancelAll()
		// A reloaded kiosk re-attaches to whatever is still encoding. Finished jobs are marked
		// announced so a reload doesn't replay old summaries.
		void fetchHapEncodeJobs()
			.then((res) => {
				for (const j of res?.jobs || []) {
					if (!hapJobActive(j)) announced.add(j.jobId)
					jobs.set(j.jobId, j)
				}
				render()
			})
			.catch(() => {})
	}

	return { run, attach }
}
