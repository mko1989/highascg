/**
 * WO-592 D — multi-rename dialog. Live old → new preview; nothing touches disk until "Rename N
 * files" (POST /api/media/rename: all-or-nothing, every look/playlist/timeline follows).
 * A `.modal-overlay`, so operator-GUI holes are withdrawn while it is open.
 */
import { api } from '../lib/api-client.js'
import { escapeHtml } from '../lib/dom-escape.js'
import { buildMultiRenamePlan, parseNumberedName } from '../lib/media-multi-rename.js'

const MODAL_ID = 'media-multi-rename-modal'

/**
 * @param {{ ids: string[], existingIds: string[] }} opts
 * @returns {Promise<Array<{ from: string, to: string }> | null>} applied renames, or null if cancelled
 */
export function showMediaMultiRename({ ids, existingIds }) {
	if (document.getElementById(MODAL_ID) || !ids?.length) return Promise.resolve(null)
	const titles = ids.map((id) => parseNumberedName(id.slice(id.lastIndexOf('/') + 1)).title)
	const common = titles.every((t) => t === titles[0]) ? titles[0] : ''

	return new Promise((resolve) => {
		const modal = document.createElement('div')
		modal.id = MODAL_ID
		modal.className = 'modal-overlay media-multi-rename-overlay'
		modal.innerHTML = `
			<div class="modal-content media-multi-rename">
				<div class="modal-header">
					<h2>Rename ${ids.length} file${ids.length === 1 ? '' : 's'}</h2>
					<button type="button" class="modal-close" data-act="cancel" aria-label="Close">&times;</button>
				</div>
				<div class="modal-body">
					<label class="media-multi-rename__field">
						<span>New title</span>
						<input type="text" class="inspector-field__input" data-k="title" value="${escapeHtml(common)}" placeholder="empty = keep each file's title" />
					</label>
					<div class="media-multi-rename__renumber">
						<label><input type="checkbox" data-k="renumber" /> Renumber</label>
						<label>from <input type="number" class="inspector-field__input" data-k="start" value="1" min="0" /></label>
						<label>step <input type="number" class="inspector-field__input" data-k="step" value="1" min="1" /></label>
						<label>digits <input type="number" class="inspector-field__input" data-k="pad" value="2" min="0" max="6" /></label>
					</div>
					<p class="media-multi-rename__hint">Numbers and extensions stay. Looks, playlists and timelines follow the new names.</p>
					<div class="media-multi-rename__preview"></div>
					<div class="media-multi-rename__error"></div>
				</div>
				<div class="modal-footer">
					<button type="button" class="btn btn--secondary" data-act="cancel">Cancel</button>
					<button type="button" class="btn btn--primary" data-act="ok">Rename</button>
				</div>
			</div>`
		document.body.appendChild(modal)

		const q = (k) => modal.querySelector(`[data-k="${k}"]`)
		const preview = modal.querySelector('.media-multi-rename__preview')
		const errEl = modal.querySelector('.media-multi-rename__error')
		const okBtn = modal.querySelector('[data-act="ok"]')
		let plan = []

		const update = () => {
			const renumber = q('renumber').checked
				? { start: Number(q('start').value) || 0, step: Number(q('step').value) || 1, pad: Number(q('pad').value) || 0 }
				: null
			for (const k of ['start', 'step', 'pad']) q(k).disabled = !renumber
			plan = buildMultiRenamePlan(ids, { title: q('title').value, renumber }, existingIds)
			const name = (p) => escapeHtml(p.slice(p.lastIndexOf('/') + 1))
			preview.innerHTML = plan
				.map(
					(r) => `<div class="media-multi-rename__row${r.error ? ' media-multi-rename__row--bad' : r.from === r.to ? ' media-multi-rename__row--same' : ''}">
						<span>${name(r.from)}</span><span>→</span><span>${name(r.to)}${r.error ? ` <em>${escapeHtml(r.error)}</em>` : ''}</span></div>`,
				)
				.join('')
			const changes = plan.filter((r) => r.from !== r.to)
			const bad = plan.some((r) => r.error)
			okBtn.disabled = bad || !changes.length
			okBtn.textContent = `Rename ${changes.length} file${changes.length === 1 ? '' : 's'}`
		}

		const close = (result) => {
			modal.remove()
			resolve(result)
		}
		modal.addEventListener('input', update)
		modal.addEventListener('change', update)
		modal.addEventListener('click', async (e) => {
			const act = e.target.closest('[data-act]')?.getAttribute('data-act')
			if (act === 'cancel') close(null)
			if (act !== 'ok' || okBtn.disabled) return
			const renames = plan.filter((r) => r.from !== r.to).map(({ from, to }) => ({ from, to }))
			okBtn.disabled = true
			errEl.textContent = ''
			try {
				await api.post('/api/media/rename', { renames })
				close(renames)
			} catch (err) {
				errEl.textContent = err?.message || 'Rename failed — nothing was changed'
				okBtn.disabled = false
			}
		})
		update()
		q('title').focus()
		q('title').select()
	})
}
