/**
 * Format apply-os `modeCreation` rows for Device View status (WO-80 T80.B.3).
 * @param {Array<{ output?: string, modeName?: string, created?: boolean, source?: string }> | null | undefined} modeCreation
 * @returns {string}
 */
export function formatModeCreationStatus(modeCreation) {
	if (!Array.isArray(modeCreation) || !modeCreation.length) return ''
	const lines = modeCreation.map((row) => {
		const output = String(row?.output || '?').trim()
		const mode = String(row?.modeName || '?').trim()
		const source = String(row?.source || 'edid').trim()
		const tag = row?.created ? 'created' : 'existing'
		return `${output}: ${mode} (${tag}, ${source})`
	})
	const created = modeCreation.filter((row) => row?.created).length
	if (created > 0) {
		return `Custom RandR mode(s): ${created} created\n${lines.join('\n')}`
	}
	return `RandR modes:\n${lines.join('\n')}`
}
