/**
 * WO-575 — "Encode to HAP" options modal: Alpha + HQ toggles (both OFF every time it opens; the
 * owner specified these defaults, so nothing is remembered), a short file list, and warnings.
 */
import { probeMediaForHap } from '../lib/media-file-ops.js'
import { hapFormatFor, hapModalWarnings } from '../lib/hap-encode-status.js'

const MODAL_ID = 'media-hap-encode-modal'
const LIST_MAX = 6

/**
 * @param {{ ids: string[], onAir?: boolean }} opts
 * @returns {Promise<{ alpha: boolean, hq: boolean } | null>} null when cancelled
 */
export function showHapEncodeModal({ ids, onAir = false }) {
	if (document.getElementById(MODAL_ID)) return Promise.resolve(null)

	return new Promise((resolve) => {
		const modal = document.createElement('div')
		modal.id = MODAL_ID
		modal.className = 'modal-overlay media-hap-encode-overlay'
		modal.innerHTML = HAP_MODAL_HTML
		document.body.appendChild(modal)

		modal.querySelector('#hap-count').textContent = `${ids.length} file${ids.length === 1 ? '' : 's'}`
		const filesEl = modal.querySelector('#hap-files')
		for (const id of ids.slice(0, LIST_MAX)) {
			const li = document.createElement('li')
			li.title = id
			li.textContent = id.split('/').pop() || id
			filesEl.appendChild(li)
		}
		if (ids.length > LIST_MAX) {
			const more = document.createElement('li')
			more.textContent = `…and ${ids.length - LIST_MAX} more`
			filesEl.appendChild(more)
		}

		const alphaEl = modal.querySelector('#hap-alpha')
		const hqEl = modal.querySelector('#hap-hq')
		const formatEl = modal.querySelector('#hap-format')
		const warnEl = modal.querySelector('#hap-warnings')
		const okBtn = modal.querySelector('#hap-ok')
		/** @type {null | Array<object>} */
		let probe = null

		const refresh = () => {
			const opts = { alpha: alphaEl.checked, hq: hqEl.checked }
			formatEl.textContent = `Format: ${hapFormatFor(opts).label}`
			const warnings = hapModalWarnings({ ...opts, onAir, probe })
			warnEl.replaceChildren(
				...warnings.map((w) => {
					const p = document.createElement('p')
					p.className = 'media-hap-encode__warning'
					p.textContent = w
					return p
				})
			)
			if (probe && !probe.some((p) => p.ok)) okBtn.disabled = true
		}

		const close = (value) => {
			document.removeEventListener('keydown', onKey, true)
			modal.remove()
			resolve(value)
		}
		const onKey = (e) => {
			if (e.key === 'Escape') {
				e.stopPropagation()
				close(null)
			}
		}
		document.addEventListener('keydown', onKey, true)

		alphaEl.addEventListener('change', refresh)
		hqEl.addEventListener('change', refresh)
		modal.querySelector('#hap-close')?.addEventListener('click', () => close(null))
		modal.querySelector('#hap-cancel')?.addEventListener('click', () => close(null))
		okBtn.addEventListener('click', () => close({ alpha: alphaEl.checked, hq: hqEl.checked }))
		modal.addEventListener('click', (e) => {
			if (e.target === modal) close(null)
		})

		refresh()
		// Pre-check is advisory (alpha-drop / skip warnings); Encode is usable before it returns.
		probeMediaForHap(ids)
			.then((res) => {
				if (!document.getElementById(MODAL_ID) || !Array.isArray(res?.items)) return
				probe = res.items
				refresh()
			})
			.catch(() => {})
	})
}

/** Static markup only — every dynamic value is written with textContent below. */
const HAP_MODAL_HTML = `
	<div class="modal-content media-hap-encode">
		<div class="modal-header">
			<h2>Encode to HAP</h2>
			<button type="button" class="modal-close" id="hap-close" aria-label="Close">&times;</button>
		</div>
		<div class="modal-body">
			<p class="media-hap-encode__hint"><span id="hap-count"></span> — saved next to the original as <code>&lt;name&gt;_HAP.mov</code>. Originals are not changed.</p>
			<ul class="media-hap-encode__files" id="hap-files"></ul>
			<label class="media-hap-encode__toggle"><input type="checkbox" id="hap-alpha" /><span>Alpha channel</span></label>
			<label class="media-hap-encode__toggle"><input type="checkbox" id="hap-hq" /><span>High quality (HAP Q)</span></label>
			<p class="media-hap-encode__format" id="hap-format"></p>
			<div class="media-hap-encode__warnings" id="hap-warnings"></div>
		</div>
		<div class="modal-footer">
			<button type="button" class="btn btn--secondary" id="hap-cancel">Cancel</button>
			<button type="button" class="btn btn--primary" id="hap-ok">Encode</button>
		</div>
	</div>
`
