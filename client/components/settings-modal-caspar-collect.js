/**
 * Data collection logic for CasparCG Settings.
 */
export function collectOpenalAudioRoutingFromModal(modal) {
	const programSystemAudioDevices = []
	const previewSystemAudioEnabled = []
	const previewSystemAudioDevices = []
	for (let n = 1; n <= 4; n++) {
		const pgmIn = modal.querySelector(`#set-caspar-screen-${n}-pgm-openal`)
		const prvEn = modal.querySelector(`#set-caspar-screen-${n}-prv-openal-en`)
		const prvIn = modal.querySelector(`#set-caspar-screen-${n}-prv-openal`)
		programSystemAudioDevices.push(pgmIn ? pgmIn.value.trim() : '')
		previewSystemAudioEnabled.push(!!(prvEn && prvEn.checked))
		previewSystemAudioDevices.push(prvIn ? prvIn.value.trim() : '')
	}
	return { programSystemAudioDevices, previewSystemAudioEnabled, previewSystemAudioDevices }
}
