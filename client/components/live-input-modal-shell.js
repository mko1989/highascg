/**
 * Live input modal DOM shell.
 */

export function createLiveInputModalShell(defaultCh = 5) {
	const modal = document.createElement('div')
	modal.id = 'live-input-modal'
	modal.className = 'modal-overlay'

	const content = document.createElement('div')
	content.className = 'modal-content live-input-modal'
	content.setAttribute('role', 'dialog')
	content.setAttribute('aria-labelledby', 'live-input-modal-title')
	modal.appendChild(content)

	const header = document.createElement('div')
	header.className = 'modal-header'
	const title = document.createElement('h2')
	title.id = 'live-input-modal-title'
	title.textContent = 'Add live input'
	const closeBtn = document.createElement('button')
	closeBtn.type = 'button'
	closeBtn.className = 'modal-close'
	closeBtn.id = 'live-input-close'
	closeBtn.setAttribute('aria-label', 'Close')
	closeBtn.textContent = '×'
	header.appendChild(title)
	header.appendChild(closeBtn)
	content.appendChild(header)

	const body = document.createElement('div')
	body.className = 'modal-body'
	content.appendChild(body)

	const hintEl = document.createElement('p')
	hintEl.className = 'settings-note live-input-modal__hint'
	hintEl.id = 'live-input-hint'
	body.appendChild(hintEl)

	const typeGroup = document.createElement('div')
	typeGroup.className = 'settings-group'
	const typeLabel = document.createElement('label')
	typeLabel.textContent = 'Type'
	const kindSel = document.createElement('select')
	kindSel.id = 'live-input-kind'
	const typeOptions = [
		['decklink', 'Decklink'],
		['ndi', 'NDI'],
		['browser', 'Web Browser'],
		['live_audio', 'Live Audio'],
		['usb_video', 'USB Video (V4L2)'],
	]
	for (const [value, label] of typeOptions) {
		const option = document.createElement('option')
		option.value = value
		option.textContent = label
		kindSel.appendChild(option)
	}
	typeGroup.appendChild(typeLabel)
	typeGroup.appendChild(kindSel)
	body.appendChild(typeGroup)

	const chRow = document.createElement('div')
	chRow.className = 'settings-group'
	chRow.id = 'live-input-ch-row'
	chRow.style.display = 'none'
	chRow.style.flexWrap = 'wrap'
	chRow.style.gap = '0.75rem'
	chRow.style.alignItems = 'flex-end'
	const chCol = document.createElement('div')
	const chLabel = document.createElement('label')
	chLabel.textContent = 'Channel'
	const chInput = document.createElement('input')
	chInput.type = 'number'
	chInput.id = 'live-input-ch'
	chInput.min = '1'
	chInput.max = '999'
	chInput.value = String(defaultCh)
	chInput.style.width = '5rem'
	chCol.appendChild(chLabel)
	chCol.appendChild(chInput)
	const layerCol = document.createElement('div')
	const layerLabel = document.createElement('label')
	layerLabel.textContent = 'Layer'
	const layerInput = document.createElement('input')
	layerInput.type = 'number'
	layerInput.id = 'live-input-layer'
	layerInput.min = '0'
	layerInput.max = '999'
	layerInput.value = '1'
	layerInput.style.width = '5rem'
	layerCol.appendChild(layerLabel)
	layerCol.appendChild(layerInput)
	chRow.appendChild(chCol)
	chRow.appendChild(layerCol)
	body.appendChild(chRow)

	const dlChFixed = document.createElement('div')
	dlChFixed.className = 'settings-group'
	dlChFixed.id = 'live-input-decklink-ch-fixed'
	dlChFixed.style.display = 'none'
	const dlChFixedText = document.createElement('p')
	dlChFixedText.className = 'settings-note'
	dlChFixedText.style.margin = '0'
	dlChFixedText.textContent = 'Caspar host channel: '
	const chFixedVal = document.createElement('strong')
	chFixedVal.id = 'live-input-ch-fixed-val'
	const chPlannedNote = document.createElement('span')
	chPlannedNote.id = 'live-input-ch-planned-note'
	chPlannedNote.className = 'settings-note'
	dlChFixedText.appendChild(chFixedVal)
	dlChFixedText.appendChild(chPlannedNote)
	dlChFixed.appendChild(dlChFixedText)
	body.appendChild(dlChFixed)

	const dlWrap = document.createElement('div')
	dlWrap.className = 'settings-group'
	dlWrap.id = 'live-input-decklink-wrap'
	const dlLabel = document.createElement('label')
	dlLabel.textContent = 'SDI port'
	const decklinkPortRow = document.createElement('div')
	decklinkPortRow.style.display = 'flex'
	decklinkPortRow.style.flexWrap = 'wrap'
	decklinkPortRow.style.gap = '0.5rem'
	decklinkPortRow.style.alignItems = 'center'
	const decklinkSlotSel = document.createElement('select')
	decklinkSlotSel.id = 'live-input-decklink-slot'
	decklinkSlotSel.style.minWidth = '10rem'
	decklinkSlotSel.style.maxWidth = '100%'
	const decklinkPortStatus = document.createElement('span')
	decklinkPortStatus.id = 'live-input-decklink-port-status'
	decklinkPortStatus.className = 'settings-note'
	decklinkPortRow.appendChild(decklinkSlotSel)
	decklinkPortRow.appendChild(decklinkPortStatus)
	const decklinkLayerInput = document.createElement('input')
	decklinkLayerInput.type = 'hidden'
	decklinkLayerInput.id = 'live-input-layer-dl'
	decklinkLayerInput.value = '1'
	dlWrap.appendChild(dlLabel)
	dlWrap.appendChild(decklinkPortRow)
	dlWrap.appendChild(decklinkLayerInput)
	body.appendChild(dlWrap)

	const ndiWrap = document.createElement('div')
	ndiWrap.className = 'settings-group'
	ndiWrap.id = 'live-input-ndi-wrap'
	ndiWrap.style.display = 'none'
	const ndiLabel = document.createElement('label')
	ndiLabel.textContent = 'NDI source'
	const ndiDiscoverRow = document.createElement('div')
	ndiDiscoverRow.style.display = 'flex'
	ndiDiscoverRow.style.flexWrap = 'wrap'
	ndiDiscoverRow.style.gap = '0.5rem'
	ndiDiscoverRow.style.alignItems = 'center'
	ndiDiscoverRow.style.marginBottom = '0.35rem'
	const ndiDiscoverBtn = document.createElement('button')
	ndiDiscoverBtn.type = 'button'
	ndiDiscoverBtn.className = 'btn btn--secondary'
	ndiDiscoverBtn.id = 'live-input-ndi-discover'
	ndiDiscoverBtn.textContent = 'Discover NDI sources'
	const ndiDiscoverStatus = document.createElement('span')
	ndiDiscoverStatus.id = 'live-input-ndi-discover-status'
	ndiDiscoverStatus.className = 'settings-note'
	ndiDiscoverRow.appendChild(ndiDiscoverBtn)
	ndiDiscoverRow.appendChild(ndiDiscoverStatus)
	const ndiSelect = document.createElement('select')
	ndiSelect.id = 'live-input-ndi-select'
	ndiSelect.style.width = '100%'
	ndiSelect.style.maxWidth = '100%'
	ndiSelect.style.marginBottom = '0.35rem'
	const ndiManualLabel = document.createElement('label')
	ndiManualLabel.style.fontSize = '12px'
	ndiManualLabel.textContent = 'Or type name manually'
	const ndiManual = document.createElement('input')
	ndiManual.type = 'text'
	ndiManual.id = 'live-input-ndi-manual'
	ndiManual.placeholder = 'Exact NDI source name'
	ndiManual.style.width = '100%'
	const ndiAttrHost = document.createElement('div')
	ndiAttrHost.id = 'live-input-ndi-attribution'
	ndiWrap.appendChild(ndiLabel)
	ndiWrap.appendChild(ndiDiscoverRow)
	ndiWrap.appendChild(ndiSelect)
	ndiWrap.appendChild(ndiManualLabel)
	ndiWrap.appendChild(ndiManual)
	ndiWrap.appendChild(ndiAttrHost)
	body.appendChild(ndiWrap)

	const browserWrap = document.createElement('div')
	browserWrap.className = 'settings-group'
	browserWrap.id = 'live-input-browser-wrap'
	browserWrap.style.display = 'none'
	const browserLabel = document.createElement('label')
	browserLabel.textContent = 'URL'
	const browserUrl = document.createElement('input')
	browserUrl.type = 'text'
	browserUrl.id = 'live-input-browser-url'
	browserUrl.placeholder = 'https://...'
	browserUrl.style.width = '100%'
	const browserCgLabel = document.createElement('label')
	browserCgLabel.style.marginTop = '0.5rem'
	browserCgLabel.style.display = 'flex'
	browserCgLabel.style.alignItems = 'center'
	browserCgLabel.style.gap = '0.35rem'
	browserCgLabel.style.fontWeight = 'normal'
	browserCgLabel.style.cursor = 'pointer'
	const browserAsCg = document.createElement('input')
	browserAsCg.type = 'checkbox'
	browserAsCg.id = 'live-input-browser-as-cg'
	browserCgLabel.appendChild(browserAsCg)
	browserCgLabel.appendChild(document.createTextNode('Add as CG template (plays highascg_browser_url + passes URL via CG UPDATE)'))
	browserWrap.appendChild(browserLabel)
	browserWrap.appendChild(browserUrl)
	browserWrap.appendChild(browserCgLabel)
	body.appendChild(browserWrap)

	const liveAudioWrap = document.createElement('div')
	liveAudioWrap.className = 'settings-group'
	liveAudioWrap.id = 'live-input-live-audio-wrap'
	liveAudioWrap.style.display = 'none'
	const liveAudioLabel = document.createElement('label')
	liveAudioLabel.textContent = 'ALSA / USB capture device'
	const liveAudioDiscoverRow = document.createElement('div')
	liveAudioDiscoverRow.style.display = 'flex'
	liveAudioDiscoverRow.style.flexWrap = 'wrap'
	liveAudioDiscoverRow.style.gap = '0.5rem'
	liveAudioDiscoverRow.style.alignItems = 'center'
	liveAudioDiscoverRow.style.marginBottom = '0.35rem'
	const audioRefreshBtn = document.createElement('button')
	audioRefreshBtn.type = 'button'
	audioRefreshBtn.className = 'btn btn--secondary'
	audioRefreshBtn.id = 'live-input-audio-refresh'
	audioRefreshBtn.textContent = 'Refresh devices'
	const audioDiscoverStatus = document.createElement('span')
	audioDiscoverStatus.id = 'live-input-audio-discover-status'
	audioDiscoverStatus.className = 'settings-note'
	liveAudioDiscoverRow.appendChild(audioRefreshBtn)
	liveAudioDiscoverRow.appendChild(audioDiscoverStatus)
	const audioSelect = document.createElement('select')
	audioSelect.id = 'live-input-audio-select'
	audioSelect.style.width = '100%'
	audioSelect.style.maxWidth = '100%'
	audioSelect.style.marginBottom = '0.35rem'
	const audioManualLabel = document.createElement('label')
	audioManualLabel.style.fontSize = '12px'
	audioManualLabel.textContent = 'Or type ALSA URI manually'
	const audioManual = document.createElement('input')
	audioManual.type = 'text'
	audioManual.id = 'live-input-audio-manual'
	audioManual.placeholder = 'alsa://hw:1,0'
	audioManual.style.width = '100%'
	const audioSlotHint = document.createElement('p')
	audioSlotHint.className = 'settings-note'
	audioSlotHint.id = 'live-input-audio-slot-hint'
	audioSlotHint.style.margin = '0.5rem 0 0'
	liveAudioWrap.appendChild(liveAudioLabel)
	liveAudioWrap.appendChild(liveAudioDiscoverRow)
	liveAudioWrap.appendChild(audioSelect)
	liveAudioWrap.appendChild(audioManualLabel)
	liveAudioWrap.appendChild(audioManual)
	liveAudioWrap.appendChild(audioSlotHint)
	body.appendChild(liveAudioWrap)

	const v4l2Wrap = document.createElement('div')
	v4l2Wrap.className = 'settings-group'
	v4l2Wrap.id = 'live-input-v4l2-wrap'
	v4l2Wrap.style.display = 'none'
	const v4l2Label = document.createElement('label')
	v4l2Label.textContent = 'USB / V4L2 capture device'
	const v4l2DiscoverRow = document.createElement('div')
	v4l2DiscoverRow.style.display = 'flex'
	v4l2DiscoverRow.style.flexWrap = 'wrap'
	v4l2DiscoverRow.style.gap = '0.5rem'
	v4l2DiscoverRow.style.alignItems = 'center'
	v4l2DiscoverRow.style.marginBottom = '0.35rem'
	const v4l2RefreshBtn = document.createElement('button')
	v4l2RefreshBtn.type = 'button'
	v4l2RefreshBtn.className = 'btn btn--secondary'
	v4l2RefreshBtn.id = 'live-input-v4l2-refresh'
	v4l2RefreshBtn.textContent = 'Refresh devices'
	const v4l2DiscoverStatus = document.createElement('span')
	v4l2DiscoverStatus.id = 'live-input-v4l2-discover-status'
	v4l2DiscoverStatus.className = 'settings-note'
	v4l2DiscoverRow.appendChild(v4l2RefreshBtn)
	v4l2DiscoverRow.appendChild(v4l2DiscoverStatus)
	const v4l2Select = document.createElement('select')
	v4l2Select.id = 'live-input-v4l2-select'
	v4l2Select.style.width = '100%'
	v4l2Select.style.maxWidth = '100%'
	v4l2Select.style.marginBottom = '0.35rem'
	const v4l2ManualLabel = document.createElement('label')
	v4l2ManualLabel.style.fontSize = '12px'
	v4l2ManualLabel.textContent = 'Or type device path manually'
	const v4l2Manual = document.createElement('input')
	v4l2Manual.type = 'text'
	v4l2Manual.id = 'live-input-v4l2-manual'
	v4l2Manual.placeholder = '/dev/video0'
	v4l2Manual.style.width = '100%'
	const v4l2DeviceLabel = document.createElement('label')
	v4l2DeviceLabel.style.marginTop = '0.5rem'
	v4l2DeviceLabel.textContent = 'Label (optional)'
	const v4l2DeviceInput = document.createElement('input')
	v4l2DeviceInput.type = 'text'
	v4l2DeviceInput.id = 'live-input-v4l2-label'
	v4l2DeviceInput.placeholder = 'ATEM PGM'
	v4l2DeviceInput.style.width = '100%'
	const v4l2FormatRow = document.createElement('div')
	v4l2FormatRow.style.display = 'flex'
	v4l2FormatRow.style.flexWrap = 'wrap'
	v4l2FormatRow.style.gap = '0.75rem'
	v4l2FormatRow.style.marginTop = '0.5rem'
	const v4l2FormatCol = document.createElement('div')
	const v4l2FormatLabel = document.createElement('label')
	v4l2FormatLabel.textContent = 'Format'
	const v4l2Format = document.createElement('select')
	v4l2Format.id = 'live-input-v4l2-format'
	for (const [value, label] of [['auto', 'auto'], ['mjpeg', 'mjpeg'], ['yuyv422', 'yuyv422']]) {
		const opt = document.createElement('option')
		opt.value = value
		opt.textContent = label
		v4l2Format.appendChild(opt)
	}
	v4l2FormatCol.appendChild(v4l2FormatLabel)
	v4l2FormatCol.appendChild(v4l2Format)
	const v4l2FpsCol = document.createElement('div')
	const v4l2FpsLabel = document.createElement('label')
	v4l2FpsLabel.textContent = 'FPS (0=auto)'
	const v4l2Fps = document.createElement('input')
	v4l2Fps.type = 'number'
	v4l2Fps.id = 'live-input-v4l2-fps'
	v4l2Fps.min = '0'
	v4l2Fps.max = '120'
	v4l2Fps.value = '0'
	v4l2Fps.style.width = '5rem'
	v4l2FpsCol.appendChild(v4l2FpsLabel)
	v4l2FpsCol.appendChild(v4l2Fps)
	v4l2FormatRow.appendChild(v4l2FormatCol)
	v4l2FormatRow.appendChild(v4l2FpsCol)
	const v4l2SlotHint = document.createElement('p')
	v4l2SlotHint.className = 'settings-note'
	v4l2SlotHint.id = 'live-input-v4l2-slot-hint'
	v4l2SlotHint.style.margin = '0.5rem 0 0'
	const v4l2AudioLabel = document.createElement('label')
	v4l2AudioLabel.style.marginTop = '0.5rem'
	v4l2AudioLabel.textContent = 'Audio (optional)'
	const v4l2AudioSelect = document.createElement('select')
	v4l2AudioSelect.id = 'live-input-v4l2-audio-select'
	v4l2AudioSelect.style.width = '100%'
	v4l2AudioSelect.style.maxWidth = '100%'
	const v4l2AudioManualLabel = document.createElement('label')
	v4l2AudioManualLabel.style.fontSize = '12px'
	v4l2AudioManualLabel.style.marginTop = '0.35rem'
	v4l2AudioManualLabel.style.display = 'block'
	v4l2AudioManualLabel.textContent = 'Or type ALSA device manually'
	const v4l2AudioManual = document.createElement('input')
	v4l2AudioManual.type = 'text'
	v4l2AudioManual.id = 'live-input-v4l2-audio-manual'
	v4l2AudioManual.placeholder = 'none or hw:3,0'
	v4l2AudioManual.style.width = '100%'
	v4l2Wrap.appendChild(v4l2Label)
	v4l2Wrap.appendChild(v4l2DiscoverRow)
	v4l2Wrap.appendChild(v4l2Select)
	v4l2Wrap.appendChild(v4l2ManualLabel)
	v4l2Wrap.appendChild(v4l2Manual)
	v4l2Wrap.appendChild(v4l2DeviceLabel)
	v4l2Wrap.appendChild(v4l2DeviceInput)
	v4l2Wrap.appendChild(v4l2FormatRow)
	v4l2Wrap.appendChild(v4l2SlotHint)
	v4l2Wrap.appendChild(v4l2AudioLabel)
	v4l2Wrap.appendChild(v4l2AudioSelect)
	v4l2Wrap.appendChild(v4l2AudioManualLabel)
	v4l2Wrap.appendChild(v4l2AudioManual)
	body.appendChild(v4l2Wrap)

	const footerRow = document.createElement('div')
	footerRow.style.display = 'flex'
	footerRow.style.flexWrap = 'wrap'
	footerRow.style.gap = '0.5rem'
	footerRow.style.alignItems = 'center'
	const playBtn = document.createElement('button')
	playBtn.type = 'button'
	playBtn.className = 'btn btn--primary'
	playBtn.id = 'live-input-play'
	playBtn.textContent = 'Add live source'
	const statusEl = document.createElement('span')
	statusEl.id = 'live-input-status'
	statusEl.className = 'settings-note'
	footerRow.appendChild(playBtn)
	footerRow.appendChild(statusEl)
	body.appendChild(footerRow)

	document.body.appendChild(modal)

	return {
		modal,
		elements: {
			hintEl,
			kindSel,
			dlWrap,
			ndiWrap,
			browserWrap,
			liveAudioWrap,
			v4l2Wrap,
			chRow,
			dlChFixed,
			chFixedVal,
			chPlannedNote,
			closeBtn,
			playBtn,
			statusEl,
			decklinkSlotSel,
			decklinkPortStatus,
			decklinkLayerInput,
			browserAsCg,
			audioRefreshBtn,
			audioDiscoverStatus,
			audioSelect,
			audioManual,
			audioSlotHint,
			v4l2RefreshBtn,
			v4l2DiscoverStatus,
			v4l2Select,
			v4l2Manual,
			v4l2Label: v4l2DeviceInput,
			v4l2Format,
			v4l2Fps,
			v4l2AudioSelect,
			v4l2AudioManual,
			v4l2SlotHint,
			ndiDiscoverBtn,
			ndiDiscoverStatus,
			ndiSelect,
			ndiManual,
			ndiAttrHost,
			browserUrl,
			chInput,
			layerInput,
			statusText: statusEl,
		}
	}
}
