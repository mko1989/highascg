/**
 * Live input modal DOM shell — USB / V4L2 capture section.
 */
import { attachMathInput } from '../lib/math-input.js'

export function buildV4l2Section() {
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
	attachMathInput(v4l2Fps, { decimals: 0 })
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

	return {
		v4l2Wrap,
		v4l2RefreshBtn,
		v4l2DiscoverStatus,
		v4l2Select,
		v4l2Manual,
		v4l2DeviceInput,
		v4l2Format,
		v4l2Fps,
		v4l2AudioSelect,
		v4l2AudioManual,
		v4l2SlotHint,
	}
}
