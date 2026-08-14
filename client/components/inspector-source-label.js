/**
 * One operator-editable source name, mounted wherever that source is configured (WO-525).
 *
 * Owner 14.08: *"label for a decklink input does not apply. it should be shared label in host
 * channel and in decklink ports inspector."*
 *
 * The store, the route and the enrichment all worked — a label set in the UI really did reach the
 * server and really was applied. Two things were wrong on the way back:
 *
 *  1. The first control read `sourceLabels` off `ctx.lastPayload`, which is the **device-view
 *     snapshot**, not `/api/state`. That key is only in `/api/state`, so the value was always
 *     `undefined`, the field opened blank, and a saved name looked lost.
 *  2. It existed in one inspector only, so the same input showed a name in one place and a generic
 *     one in the other.
 *
 * This reads `extraLiveSources` instead — which BOTH payloads carry, already enriched with `label`,
 * `generatedLabel` and `labelIsCustom` (WO-506). No store import, no payload-shape assumption, and
 * the same component in both inspectors, so "shared" is literal rather than two copies kept in step.
 */

import { api } from '../lib/api-client.js'
import { shortLabelPill } from '../lib/source-label.js'

/**
 * Resolve what a source is currently called, from an `extraLiveSources` list.
 * @param {Array<object>|null|undefined} sources
 * @param {string} connectorId
 * @param {string} [fallbackLabel]
 * @returns {{ custom: string, generated: string }}
 */
export function readSourceLabelState(sources, connectorId, fallbackLabel = '') {
	const key = String(connectorId || '').trim()
	const list = Array.isArray(sources) ? sources : []
	const mine = list.find((s) => String(s?.connectorId || '') === key) || null
	// `label` already holds the override when one is set; `generatedLabel` is kept alongside it so a
	// blank field can advertise what it will fall back to.
	const custom = mine?.labelIsCustom ? String(mine.label || '').trim() : ''
	const generated = String(mine?.generatedLabel || (mine?.labelIsCustom ? '' : mine?.label) || '').trim()
	return { custom, generated: generated || fallbackLabel }
}

/**
 * @param {HTMLElement} parent
 * @param {object} opts
 * @param {string} opts.connectorId stable key that survives re-cabling, e.g. `dlsdi_3`
 * @param {Array<object>} [opts.sources] `extraLiveSources` from whichever payload the caller holds
 * @param {string} [opts.fallbackLabel]
 * @param {() => unknown} [opts.onSaved] usually the inspector's `load()` — re-fetches the payload
 * @returns {{ refresh: (sources?: Array<object>) => void } | null} null without a stable key
 */
export function mountSourceLabelControl(parent, { connectorId, sources, fallbackLabel = '', onSaved } = {}) {
	const key = String(connectorId || '').trim()
	if (!parent || !key) return null

	const row = document.createElement('div')
	row.className = 'inspector-source-label'
	row.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-bottom:8px'
	row.appendChild(
		Object.assign(document.createElement('span'), { textContent: 'Label', style: 'font-size:10px;opacity:0.6' }),
	)
	const input = Object.assign(document.createElement('input'), {
		type: 'text',
		className: 'device-view__inspector-input',
		maxLength: 64,
	})
	input.title = 'Shown wherever this source appears. Leave empty to use the generated name.'
	const hint = Object.assign(document.createElement('span'), { style: 'font-size:10px;opacity:0.45' })

	let editing = false
	function refresh(nextSources) {
		// Never clobber what the operator is typing — a payload refresh mid-edit must not fight them.
		if (editing) return
		const { custom, generated } = readSourceLabelState(nextSources ?? sources, key, fallbackLabel)
		input.value = custom
		input.placeholder = generated || key
		const shown = custom || generated
		hint.textContent = shown ? `Top-bar chip: ${shortLabelPill(shown) || '—'}` : ''
	}

	let saving = false
	async function save() {
		if (saving) return
		saving = true
		try {
			await api.post('/api/sources/label', { sourceId: key, label: input.value })
			// A rename changes no Caspar config — it must NOT mark the restart hint dirty. Demanding a
			// playout restart to rename a camera would be absurd.
			if (typeof onSaved === 'function') await onSaved()
		} catch (e) {
			hint.textContent = `Save failed: ${e?.message || e}`
		} finally {
			saving = false
		}
	}

	input.addEventListener('focus', () => {
		editing = true
	})
	input.addEventListener('blur', () => {
		editing = false
		void save()
	})
	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') input.blur()
		if (e.key === 'Escape') {
			editing = false
			refresh()
			input.blur()
		}
	})

	row.appendChild(input)
	row.appendChild(hint)
	parent.appendChild(row)
	refresh()
	return { refresh }
}
