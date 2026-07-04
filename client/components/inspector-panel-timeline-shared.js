import { timelineState } from '../lib/timeline-state.js'
import { api } from '../lib/api-client.js'
import { fmtSmpte, parseTcInput } from './timeline-canvas.js'

/**
 * Prominent timeline position row (SMPTE + ms) directly under the inspector title.
 * @param {HTMLElement} root
 * @param {{ timeMs: number, fps?: number, maxMs?: number, onCommit: (ms: number) => void }} opts
 */
export function appendTimelineInspectorPosition(root, { timeMs, fps = 25, maxMs, onCommit }) {
	const row = document.createElement('div')
	row.className = 'inspector-timeline-position'

	const lab = document.createElement('label')
	lab.className = 'inspector-timeline-position__label'
	lab.textContent = 'Position'

	const tcInp = document.createElement('input')
	tcInp.type = 'text'
	tcInp.className = 'inspector-field__input inspector-math-input'
	tcInp.spellcheck = false
	tcInp.value = fmtSmpte(timeMs, fps)
	tcInp.title = 'SMPTE (HH:MM:SS:FF), ++500 / --500 offset, or plain ms'

	const msHint = document.createElement('span')
	msHint.className = 'inspector-timeline-position__ms'
	msHint.textContent = `${Math.round(timeMs)} ms`

	const commit = () => {
		const parsed = parseTcInput(tcInp.value, timeMs, maxMs, fps)
		if (parsed == null) {
			tcInp.value = fmtSmpte(timeMs, fps)
			return
		}
		const clamped = Math.max(0, Math.min(parsed, maxMs ?? 999999999))
		tcInp.value = fmtSmpte(clamped, fps)
		msHint.textContent = `${Math.round(clamped)} ms`
		if (clamped !== timeMs) onCommit(clamped)
	}

	tcInp.addEventListener('change', commit)
	tcInp.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			tcInp.blur()
		}
	})

	lab.appendChild(tcInp)
	row.appendChild(lab)
	row.appendChild(msHint)
	root.appendChild(row)
}

export async function syncTimelineToServer() {
	const tl = timelineState.getActive()
	if (!tl) return
	try {
		await api.put(`/api/timelines/${tl.id}`, tl)
	} catch {
		try { await api.post('/api/timelines', tl) } catch {}
	}
}
