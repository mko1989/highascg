/**
 * Wire Live Sources inspector selection events.
 */
export function attachInspectorLiveSourceSelectionEvents({ update, getSelection }) {
	window.addEventListener('live-audio-input-select', (e) => {
		const d = e.detail
		if (d && d.slot != null) {
			const s = parseInt(String(d.slot), 10)
			if (Number.isFinite(s) && s >= 1) {
				update({ type: 'liveAudioInput', slot: Math.floor(s) })
				return
			}
		}
		if (d == null) {
			if (getSelection()?.type === 'liveAudioInput') update(null)
		}
	})

	window.addEventListener('webpage-host-select', (e) => {
		const d = e.detail
		if (d && (d.sourceId || d.value || d.hostChannel != null)) {
			update({
				type: 'webpageHost',
				sourceId: d.sourceId,
				value: d.value,
				hostChannel: d.hostChannel,
			})
			return
		}
		if (d == null) {
			if (getSelection()?.type === 'webpageHost') update(null)
		}
	})

	window.addEventListener('ndi-host-select', (e) => {
		const d = e.detail
		if (d && (d.sourceId || d.value || d.hostChannel != null)) {
			update({
				type: 'ndiHost',
				sourceId: d.sourceId,
				value: d.value,
				hostChannel: d.hostChannel,
			})
			return
		}
		if (d == null) {
			if (getSelection()?.type === 'ndiHost') update(null)
		}
	})

	window.addEventListener('v4l2-input-select', (e) => {
		const d = e.detail
		if (d && d.slot != null) {
			const s = parseInt(String(d.slot), 10)
			if (Number.isFinite(s) && s >= 1) {
				update({ type: 'v4l2Input', slot: Math.floor(s) })
				return
			}
		}
		if (d == null) {
			if (getSelection()?.type === 'v4l2Input') update(null)
		}
	})
}
