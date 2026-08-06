import { timelineState } from '../lib/timeline-state.js'
import { api } from '../lib/api-client.js'
import { parseNumberInput } from '../lib/math-input.js'
import {
	parseCompanionLocationInput,
	formatCompanionLocation,
	parseCompanionCoordField,
	flagCompanionCoords,
} from '../lib/companion-location-parse.js'
import { companionButtonPreviewUrl, invalidateCompanionFlagThumbs } from '../lib/companion-button-preview-url.js'
import { openCompanionButtonPickerModal } from './companion-button-picker-modal.js'
import { appendTimelineInspectorPosition, syncTimelineToServer } from './inspector-panel-timeline-shared.js'

/**
 * @param {{
 *   root: HTMLElement,
 *   renderEmpty: () => void,
 *   onClearSelection: () => void,
 * }} deps
 */
export function renderTimelineFlagInspector(deps, timelineId, flagId) {
	const { root, renderEmpty, onClearSelection } = deps
	root.innerHTML = ''
	const tl = timelineState.getTimeline(timelineId)
	const flag = tl?.flags?.find((f) => f.id === flagId)
	if (!flag) {
		renderEmpty()
		return
	}
	const title = document.createElement('div')
	title.className = 'inspector-title'
	title.textContent = 'Timeline flag'
	root.appendChild(title)

	const fps = tl?.fps || 25
	const dur = tl?.duration ?? 999999
	appendTimelineInspectorPosition(root, {
		timeMs: flag.timeMs,
		fps,
		maxMs: dur,
		onCommit: (ms) => {
			timelineState.updateFlag(timelineId, flagId, { timeMs: ms })
			syncTimelineToServer()
			window.dispatchEvent(new CustomEvent('timeline-redraw-request'))
			renderTimelineFlagInspector(deps, timelineId, flagId)
		},
	})

	const grp = document.createElement('div')
	grp.className = 'inspector-group'
	grp.innerHTML = '<div class="inspector-group__title">Flag</div>'

	const labelWrap = document.createElement('div')
	labelWrap.className = 'inspector-field'
	const labelLab = document.createElement('label')
	labelLab.className = 'inspector-field__label'
	labelLab.textContent = 'Label'
	const labelInp = document.createElement('input')
	labelInp.type = 'text'
	labelInp.className = 'inspector-field__input'
	labelInp.value = flag.label || ''
	labelInp.addEventListener('change', () => {
		timelineState.updateFlag(timelineId, flagId, { label: labelInp.value.trim() })
		syncTimelineToServer()
	})
	labelLab.appendChild(labelInp)
	labelWrap.appendChild(labelLab)
	grp.appendChild(labelWrap)

	const typeWrap = document.createElement('div')
	typeWrap.className = 'inspector-field'
	const typeLab = document.createElement('label')
	typeLab.className = 'inspector-field__label'
	typeLab.textContent = 'Action'
	const typeSel = document.createElement('select')
	typeSel.className = 'inspector-field__select'
	typeSel.innerHTML =
		'<option value="pause">Pause</option><option value="play">Play (resume)</option><option value="jump">Jump to</option><option value="companion_press">Companion button press</option>'
	typeSel.value = flag.type || 'pause'
	typeSel.addEventListener('change', () => {
		timelineState.updateFlag(timelineId, flagId, { type: typeSel.value })
		syncTimelineToServer()
		renderTimelineFlagInspector(deps, timelineId, flagId)
	})
	typeLab.appendChild(typeSel)
	typeWrap.appendChild(typeLab)
	grp.appendChild(typeWrap)

	const showJump = (flag.type || 'pause') === 'jump'
	const jumpWrap = document.createElement('div')
	jumpWrap.className = 'inspector-field'
	if (!showJump) jumpWrap.style.display = 'none'
	const jumpLab = document.createElement('label')
	jumpLab.className = 'inspector-field__label'
	jumpLab.textContent = 'Jump to time (ms)'
	const jumpInp = document.createElement('input')
	jumpInp.type = 'text'
	jumpInp.className = 'inspector-field__input inspector-math-input'
	jumpInp.value = flag.jumpTimeMs != null && Number.isFinite(flag.jumpTimeMs) ? String(flag.jumpTimeMs) : ''
	jumpInp.placeholder = 'optional'
	jumpInp.addEventListener('change', () => {
		const raw = jumpInp.value.trim()
		const v = raw === '' ? undefined : parseNumberInput(raw, 0)
		timelineState.updateFlag(timelineId, flagId, { jumpTimeMs: v })
		syncTimelineToServer()
	})
	jumpLab.appendChild(jumpInp)
	jumpWrap.appendChild(jumpLab)
	grp.appendChild(jumpWrap)

	const refWrap = document.createElement('div')
	refWrap.className = 'inspector-field'
	if (!showJump) refWrap.style.display = 'none'
	const refLab = document.createElement('label')
	refLab.className = 'inspector-field__label'
	refLab.textContent = 'Or jump to flag'
	const refSel = document.createElement('select')
	refSel.className = 'inspector-field__select'
	const other = (tl.flags || []).filter((f) => f.id !== flagId)
	refSel.innerHTML =
		'<option value="">—</option>' +
		other.map((f) => `<option value="${f.id}">${(f.label || f.type || 'flag') + ' @ ' + Math.round(f.timeMs) + 'ms'}</option>`).join('')
	refSel.value = flag.jumpFlagId || ''
	refSel.addEventListener('change', () => {
		timelineState.updateFlag(timelineId, flagId, { jumpFlagId: refSel.value || undefined })
		syncTimelineToServer()
	})
	refLab.appendChild(refSel)
	refWrap.appendChild(refLab)
	grp.appendChild(refWrap)

	const hint = document.createElement('p')
	hint.className = 'inspector-field inspector-field--hint'
	hint.textContent = 'For “Jump to”, set a time (ms) or pick another flag; time wins if both are set.'
	if (!showJump) hint.style.display = 'none'
	grp.appendChild(hint)

	const showCompanion = (flag.type || 'pause') === 'companion_press'

	const companionWrap = document.createElement('div')
	if (!showCompanion) companionWrap.style.display = 'none'

	const companionTitle = document.createElement('div')
	companionTitle.className = 'inspector-group__title'
	companionTitle.textContent = 'Companion Button'
	companionTitle.style.marginTop = '4px'
	companionWrap.appendChild(companionTitle)

	const coords = flagCompanionCoords(flag)

	const previewWrap = document.createElement('div')
	previewWrap.className = 'companion-inspector-preview'
	const previewImg = document.createElement('img')
	previewImg.className = 'companion-inspector-preview__img'
	previewImg.alt = 'Companion button preview'
	previewImg.width = 72
	previewImg.height = 72
	previewImg.src = companionButtonPreviewUrl(coords.page, coords.row, coords.column)
	/* One delayed retry: the jpg route subscribes on demand and the first frame can miss its
	 * 1.5 s window right after a rebind. */
	let previewRetryTimer = null
	previewImg.onerror = () => {
		previewWrap.classList.add('companion-inspector-preview--missing')
		if (previewRetryTimer) return
		previewRetryTimer = setTimeout(() => {
			previewRetryTimer = null
			if (previewImg.isConnected) previewImg.src = `${previewImg.src.split('?')[0]}?t=${Date.now()}`
		}, 1200)
	}
	previewImg.onload = () => {
		previewWrap.classList.remove('companion-inspector-preview--missing')
	}
	previewWrap.appendChild(previewImg)
	companionWrap.appendChild(previewWrap)

	const previewStatus = document.createElement('p')
	previewStatus.className = 'inspector-field inspector-field--hint companion-inspector-preview-status'
	previewStatus.textContent = 'Checking Companion preview…'
	companionWrap.appendChild(previewStatus)

	/* WO-450 round 4 (todos06.08: "the displayed companion button does not update once set"):
	 * this used to re-derive coords from timelineState.getActive() with a fallback to the
	 * STALE closure flag — editing a non-active timeline (or an immutable flag update) showed
	 * the OLD button forever. The caller knows the new coords; use them directly. */
	let boundCoords = { page: coords.page, row: coords.row, column: coords.column }
	const refreshPreviewImg = (page, row, column) => {
		if (previewRetryTimer) {
			clearTimeout(previewRetryTimer)
			previewRetryTimer = null
		}
		boundCoords = { page, row, column }
		previewImg.src = companionButtonPreviewUrl(page, row, column, Date.now())
	}

	/* WO-450 round 5 (todos06.08: "I need it to update live"): follow the same WS preview
	 * events the picker uses, so a Companion-side change redraws the bound preview without a
	 * page reload. Self-removes once this inspector render is gone from the DOM. */
	const onPreviewWs = (e) => {
		if (!previewImg.isConnected) {
			window.removeEventListener('companion-button-preview', onPreviewWs)
			return
		}
		const d = e.detail
		if (!d || d.page !== boundCoords.page || d.row !== boundCoords.row || d.column !== boundCoords.column) return
		previewImg.src = companionButtonPreviewUrl(d.page, d.row, d.column, d.mtimeMs || Date.now())
	}
	window.addEventListener('companion-button-preview', onPreviewWs)

	const applyCoords = (page, row, column) => {
		timelineState.updateFlag(timelineId, flagId, {
			companionPage: page,
			companionRow: row,
			companionColumn: column,
		})
		syncTimelineToServer()
		refreshPreviewImg(page, row, column)
		/* Rebind must also repaint the flag's thumb on the timeline canvas — the canvas only
		 * redraws on its own events, so without this the OLD button stayed until reload. */
		invalidateCompanionFlagThumbs()
	}

	const locWrap = document.createElement('div')
	locWrap.className = 'inspector-field'
	const locLab = document.createElement('label')
	locLab.className = 'inspector-field__label'
	locLab.textContent = 'Location (page row column)'
	const locInp = document.createElement('input')
	locInp.type = 'text'
	locInp.className = 'inspector-field__input'
	locInp.placeholder = '1 0 2'
	locInp.value = formatCompanionLocation(coords.page, coords.row, coords.column)
	locInp.addEventListener('change', () => {
		const parsed = parseCompanionLocationInput(locInp.value)
		if (!parsed) {
			locInp.value = formatCompanionLocation(coords.page, coords.row, coords.column)
			return
		}
		locInp.value = formatCompanionLocation(parsed.page, parsed.row, parsed.column)
		pageInp.value = String(parsed.page)
		rowInp.value = String(parsed.row)
		colInp.value = String(parsed.column)
		applyCoords(parsed.page, parsed.row, parsed.column)
	})
	locLab.appendChild(locInp)
	locWrap.appendChild(locLab)
	companionWrap.appendChild(locWrap)

	const makeCoordField = (labelText, propName, defaultVal, _allowNegative) => {
		const fw = document.createElement('div')
		fw.className = 'inspector-field'
		const fl = document.createElement('label')
		fl.className = 'inspector-field__label'
		fl.textContent = labelText
		const fi = document.createElement('input')
		fi.type = 'text'
		fi.inputMode = 'numeric'
		fi.className = 'inspector-field__input'
		fi.value = flag[propName] != null ? String(flag[propName]) : String(defaultVal)
		fi.addEventListener('change', () => {
			const page =
				propName === 'companionPage'
					? parseCompanionCoordField(fi.value, { min: 1 })
					: parseCompanionCoordField(pageInp.value, { min: 1 })
			const row =
				propName === 'companionRow'
					? parseCompanionCoordField(fi.value, { allowNegative: true })
					: parseCompanionCoordField(rowInp.value, { allowNegative: true })
			const column =
				propName === 'companionColumn'
					? parseCompanionCoordField(fi.value, { allowNegative: true })
					: parseCompanionCoordField(colInp.value, { allowNegative: true })
			if (page == null || row == null || column == null) {
				fi.value = flag[propName] != null ? String(flag[propName]) : String(defaultVal)
				return
			}
			pageInp.value = String(page)
			rowInp.value = String(row)
			colInp.value = String(column)
			locInp.value = formatCompanionLocation(page, row, column)
			applyCoords(page, row, column)
		})
		fl.appendChild(fi)
		fw.appendChild(fl)
		return fi
	}

	const pageInp = makeCoordField('Page (1+)', 'companionPage', 1, false)
	const rowInp = makeCoordField('Row (0+)', 'companionRow', 0, true)
	const colInp = makeCoordField('Column (0+)', 'companionColumn', 0, true)
	companionWrap.appendChild(pageInp.parentElement)
	companionWrap.appendChild(rowInp.parentElement)
	companionWrap.appendChild(colInp.parentElement)

	const btnRow = document.createElement('div')
	btnRow.className = 'companion-inspector-actions'
	const pickBtn = document.createElement('button')
	pickBtn.type = 'button'
	pickBtn.className = 'inspector-btn-sm'
	pickBtn.textContent = 'Choose button…'
	pickBtn.addEventListener('click', () => {
		openCompanionButtonPickerModal({
			initial: flagCompanionCoords(flag),
			onSelect: ({ page, row, column }) => {
				pageInp.value = String(page)
				rowInp.value = String(row)
				colInp.value = String(column)
				locInp.value = formatCompanionLocation(page, row, column)
				applyCoords(page, row, column)
			},
		})
	})
	btnRow.appendChild(pickBtn)

	const testPressBtn = document.createElement('button')
	testPressBtn.type = 'button'
	testPressBtn.className = 'inspector-btn-sm'
	testPressBtn.textContent = 'Test press'
	testPressBtn.title = 'Send Companion HTTP press (down + release), same as playhead crossing this flag'
	testPressBtn.addEventListener('click', async () => {
		const page = parseCompanionCoordField(pageInp.value, { min: 1 })
		const row = parseCompanionCoordField(rowInp.value, { allowNegative: true })
		const column = parseCompanionCoordField(colInp.value, { allowNegative: true })
		if (page == null || row == null || column == null) {
			previewStatus.classList.add('companion-inspector-preview-status--warn')
			previewStatus.textContent = 'Invalid page / row / column for test press.'
			return
		}
		testPressBtn.disabled = true
		const prevLabel = testPressBtn.textContent
		testPressBtn.textContent = 'Pressing…'
		try {
			const r = await api.post('/api/companion/button-preview/test-press', { page, row, column })
			if (r?.ok) {
				previewStatus.classList.remove('companion-inspector-preview-status--warn')
				previewStatus.textContent = `Test press sent to ${formatCompanionLocation(page, row, column)}.`
			} else {
				previewStatus.classList.add('companion-inspector-preview-status--warn')
				previewStatus.textContent = `Test press failed: ${r?.error || `Companion HTTP ${r?.status ?? 'error'}`}`
			}
		} catch (e) {
			previewStatus.classList.add('companion-inspector-preview-status--warn')
			previewStatus.textContent = `Test press failed: ${e?.message || e}`
		} finally {
			testPressBtn.disabled = false
			testPressBtn.textContent = prevLabel
		}
	})
	btnRow.appendChild(testPressBtn)

	companionWrap.appendChild(btnRow)

	void api.get('/api/companion/button-preview/status').then((st) => {
		if (!previewStatus.isConnected) return
		if (st?.previewAvailable) {
			previewStatus.textContent = 'Preview via Companion Satellite (Button Subscriptions API).'
			return
		}
		previewStatus.classList.add('companion-inspector-preview-status--warn')
		previewStatus.textContent =
			st?.hint ||
			'Companion button preview unavailable. Enable Satellite + Button Subscriptions API in Companion Settings.'
		/* WO-450/452: do NOT disable the picker — a binding is just page/row/column and the
		 * modal now renders a clickable blind grid without previews. Disabling here is what
		 * read as "the chooser does not open at all" once the status started truthfully
		 * reporting subscriptions_disabled (todos06.08 line 29). */
		if (st?.reason === 'subscriptions_disabled') {
			pickBtn.title = 'Previews need Button Subscriptions API in Companion Settings — picking works without them'
		}
	}).catch(() => {
		if (previewStatus.isConnected) {
			previewStatus.classList.add('companion-inspector-preview-status--warn')
			previewStatus.textContent = 'Could not reach HighAsCG Companion preview status.'
		}
	})

	grp.appendChild(companionWrap)

	const del = document.createElement('button')
	del.type = 'button'
	del.className = 'inspector-btn-sm'
	del.textContent = 'Remove flag'
	del.style.marginTop = '8px'
	del.addEventListener('click', () => {
		timelineState.removeFlag(timelineId, flagId)
		syncTimelineToServer()
		onClearSelection()
	})
	grp.appendChild(del)
	root.appendChild(grp)
}
