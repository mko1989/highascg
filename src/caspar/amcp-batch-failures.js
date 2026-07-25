'use strict'

/**
 * True when this line is the **AMCP batch** closing ack (second status token is `COMMIT`).
 * Examples: `202 COMMIT OK`, `RES uid 202 COMMIT OK`.
 * Per-command replies are `202 MIXER OK`, `202 PLAY OK`, etc. — those are **not** batch completion.
 * Do not match on a bare `COMMIT` substring (avoids confusion with mixer-related text).
 * @param {string} line
 */
function isBatchCommitAckLine(line) {
	const s = String(line).trim()
	if (!s) return false
	// After optional REQ id tokens: `<code> COMMIT` must be the AMCP status word (not `202 MIXER …`).
	return /^(\S+\s+)*2\d{2}\s+COMMIT(\s|$)/i.test(s)
}

/**
 * @typedef {{ code: number, line: string, command: string | null }} BatchFailure
 */

/**
 * Parse one AMCP status line into `{ code, command }`, tolerating the same optional leading
 * `REQ`/`RES <id>` tokens {@link isBatchCommitAckLine} skips (lazy prefix, first 3-digit token wins).
 * `202 PLAY OK` → `{ code: 202, command: 'PLAY' }`; `RES uid 404 PLAY FAILED` → `{ code: 404, … }`.
 * @param {string} line
 * @returns {{ code: number, command: string } | null}
 */
function parseBatchStatusLine(line) {
	const s = String(line).trim()
	if (!s) return null
	const m = s.match(/^(?:\S+\s+)*?([1-5]\d{2})(?:\s+(\S+))?(?:\s|$)/)
	if (!m) return null
	const code = parseInt(m[1], 10)
	if (!Number.isFinite(code)) return null
	return { code, command: (m[2] || '').toUpperCase() }
}

/**
 * `404 REMOVE FAILED` for a consumer that is not attached — best-effort teardown, caller swallows it.
 * Classified benign by amcp-protocol.js (`optionalRemoveMiss`) on the single-command path; mirrored
 * here so batched teardown blocks do not spam `error`. See WO-281 §1 pattern #7.
 * @param {number} code
 * @param {string} command
 */
function isOptionalRemoveMiss(code, command) {
	return code === 404 && command === 'REMOVE'
}

/**
 * WO-281 §4.1 — extract per-command failures from the lines drained inside a BEGIN…COMMIT batch.
 *
 * `amcp-protocol.handleLine` returns early while a drain is installed, so the error-classification
 * switch never sees these lines: without this, a `404`/`5xx` on a layer inside a take batch produced
 * no log, no rejection and no GUI signal. The drained `rawLines` (previously collected and never
 * read by anyone) are exactly the evidence, so they feed this extraction.
 *
 * Inner replies arrive in submission order, one status line per command, so the nth status line is
 * matched back to `commandLines[n]` — but only when the reply's command token agrees with the
 * candidate's verb, otherwise `command` is left null rather than mis-attributed.
 * @param {string[]} rawLines - lines drained between BEGIN and the terminal `2xx COMMIT` ack
 * @param {string[]} commandLines - the inner commands sent, in order (no BEGIN/COMMIT)
 * @returns {{ failures: BatchFailure[], benign: BatchFailure[] }}
 */
function extractBatchFailures(rawLines, commandLines) {
	/** @type {BatchFailure[]} */
	const failures = []
	/** @type {BatchFailure[]} */
	const benign = []
	let statusIndex = 0
	for (const raw of rawLines || []) {
		if (isBatchCommitAckLine(raw)) continue
		const parsed = parseBatchStatusLine(raw)
		if (!parsed) continue
		const idx = statusIndex++
		if (parsed.code < 400) continue
		const candidate = commandLines && commandLines[idx] ? String(commandLines[idx]).trim() : ''
		const verb = candidate ? candidate.split(/\s+/)[0].toUpperCase() : ''
		/** @type {BatchFailure} */
		const entry = {
			code: parsed.code,
			line: String(raw).trim(),
			command: verb && verb === parsed.command ? candidate : null,
		}
		if (isOptionalRemoveMiss(parsed.code, parsed.command)) benign.push(entry)
		else failures.push(entry)
	}
	return { failures, benign }
}

module.exports = {
	isBatchCommitAckLine,
	parseBatchStatusLine,
	isOptionalRemoveMiss,
	extractBatchFailures,
}
