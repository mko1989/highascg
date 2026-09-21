/**
 * WO-575 — pure text/decision helpers for the media browser's "Encode to HAP" (no DOM, no fetch).
 * Job shapes are the server's `media:hap-encode` payload / GET /api/media/hap-encode items
 * (src/media/hap-encode-queue.js `snapshot()`).
 */

const FORMAT_LABEL = { hap: 'HAP', hap_alpha: 'HAP Alpha', hap_q: 'HAP Q' }

/** Same rule as the server (`pickHapFormat`): FFmpeg has no HAP Q Alpha, alpha wins. */
export function hapFormatFor({ alpha, hq }) {
	if (alpha) return { format: 'hap_alpha', label: FORMAT_LABEL.hap_alpha, downgraded: !!hq }
	if (hq) return { format: 'hap_q', label: FORMAT_LABEL.hap_q, downgraded: false }
	return { format: 'hap', label: FORMAT_LABEL.hap, downgraded: false }
}

/** True when anything is playing on any channel/layer (server playback matrix). */
export function isAnythingPlaying(state) {
	const matrix = state?.playback?.matrix || state?.playbackMatrix || {}
	return Object.values(matrix).some((cell) => cell && cell.playing)
}

/**
 * Warnings shown in the modal under the toggles.
 * @param {{ alpha: boolean, hq: boolean, onAir: boolean, probe: null | Array<{ ok: boolean, reason?: string, hasAlpha?: boolean }> }} p
 * @returns {string[]}
 */
export function hapModalWarnings({ alpha, hq, onAir, probe }) {
	const out = []
	if (alpha && hq) out.push('HAP Q has no alpha in this encoder — will encode HAP Alpha.')
	if (Array.isArray(probe)) {
		const todo = probe.filter((p) => p.ok)
		if (!alpha) {
			const n = todo.filter((p) => p.hasAlpha).length
			if (n > 0)
				out.push(`${n} file${n === 1 ? ' has' : 's have'} an alpha channel that will be dropped. Turn Alpha on to keep it.`)
		}
		const skipped = probe.length - todo.length
		if (skipped > 0 && todo.length > 0)
			out.push(
				`${skipped} file${skipped === 1 ? '' : 's'} will be skipped (already HAP, already encoded, or not a video).`
			)
		if (todo.length === 0) out.push('Nothing to encode: every selected file would be skipped.')
	}
	if (onAir) out.push('Something is playing on-air. Encoding uses many CPU cores and can cause dropped frames.')
	return out
}

/** @returns {boolean} */
export function hapJobActive(job) {
	return !!job && !job.finished
}

/**
 * One status line for everything still running/queued, e.g. "Encoding HAP 2/5 · 43%".
 * Skipped files don't count towards the total (they take no time).
 * @param {object[]} jobs
 * @returns {string | null} null when nothing is active
 */
export function hapProgressText(jobs) {
	const active = (jobs || []).filter(hapJobActive)
	if (!active.length) return null
	const items = active.flatMap((j) => j.items).filter((it) => it.state !== 'skipped')
	const total = items.length
	const finished = items.filter((it) => ['done', 'failed', 'cancelled'].includes(it.state)).length
	const running = items.find((it) => it.state === 'running')
	const label = FORMAT_LABEL[active[0].format] || 'HAP'
	const pct = running ? ` · ${Math.round((running.pct || 0) * 100)}%` : ''
	return `Encoding ${label} ${Math.min(total, finished + 1)}/${total}${pct}`
}

/**
 * Final line for a finished job, with the severity for the status colour.
 * @returns {{ text: string, kind: 'ok' | 'error' | 'info' }}
 */
export function hapFinishedSummary(job) {
	const c = job.counts || {}
	const bits = []
	if (c.done) bits.push(`${c.done} encoded`)
	if (c.skipped) bits.push(`${c.skipped} skipped`)
	if (c.failed) bits.push(`${c.failed} failed`)
	if (c.cancelled) bits.push(`${c.cancelled} cancelled`)
	const resized = job.items.filter((it) => it.note).length
	if (resized) bits.push(`${resized} resized to a multiple of 4`)
	const firstFail = job.items.find((it) => it.state === 'failed')
	let text = `HAP: ${bits.join(', ') || 'nothing to do'}`
	if (firstFail) text += ` — ${firstFail.id}: ${firstFail.reason}`
	else if (!c.done && c.skipped) {
		const why = job.items.find((it) => it.state === 'skipped')
		if (why?.reason) text += ` (${why.reason})`
	}
	return { text, kind: c.failed ? 'error' : c.done ? 'ok' : 'info' }
}
