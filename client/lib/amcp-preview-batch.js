/**
 * Shared AMCP batch sender for preview / inspector paths (same chunking + COMMIT split as scenes preview).
 */
import { api } from './api-client.js'

const AMCP_BATCH_MAX_COMMANDS = 64

/**
 * @param {string[]} commands
 */
export async function postAmcpPreviewPipeline(commands) {
	const lines = commands.map(String).map((s) => s.trim()).filter(Boolean)
	if (lines.length === 0) return
	const commitLines = []
	const batchable = []
	for (const line of lines) {
		if (/^MIXER\s+\d+\s+COMMIT\b/i.test(line)) commitLines.push(line)
		else batchable.push(line)
	}
	for (let i = 0; i < batchable.length; i += AMCP_BATCH_MAX_COMMANDS) {
		const chunk = batchable.slice(i, i + AMCP_BATCH_MAX_COMMANDS)
		try {
			await api.post('/api/amcp/batch', { commands: chunk })
		} catch {
			try {
				await api.post('/api/amcp/raw-batch', { commands: chunk })
			} catch {
				for (const t of chunk) {
					try {
						await api.post('/api/raw', { cmd: t })
					} catch {
						/* ignore */
					}
				}
			}
		}
	}
	for (const c of commitLines) {
		try {
			await api.post('/api/raw', { cmd: c })
		} catch {
			/* ignore */
		}
	}
}

export { AMCP_BATCH_MAX_COMMANDS }
