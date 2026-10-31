'use strict'

/**
 * Validation helpers for xrandr subprocess invocation (WO-97).
 */

const XRANDR_OUTPUT_RE = /^[A-Za-z0-9._-]+$/
/** Mode tokens like 1920x1080, 1920x1080_60, 1920x1080_60.00 */
const XRANDR_MODE_RE = /^\d{3,5}x\d{3,5}(_\d+(?:\.\d+)?)?$/i

function assertSafeXrandrOutputName(name) {
	const s = String(name || '').trim()
	if (!s || !XRANDR_OUTPUT_RE.test(s)) {
		throw new Error(`Unsafe xrandr output name: ${JSON.stringify(name)}`)
	}
	return s
}

function assertSafeXrandrModeToken(mode) {
	const s = String(mode || '').trim()
	if (!s || !XRANDR_MODE_RE.test(s)) {
		throw new Error(`Unsafe xrandr mode token: ${JSON.stringify(mode)}`)
	}
	return s
}

/**
 * @param {Array<{ output: string, x: number, y: number, mode: string, rate?: number|null }>} heads
 * @param {string} [display] X display / screen (WO-906: `:0.0` / `:0.1` with the playout X screen)
 * @returns {string[]}
 */
function buildXrandrLayoutArgv(heads, display = ':0') {
	if (!/^:\d+(\.\d+)?$/.test(display)) throw new Error(`Invalid X display ${display}`)
	const args = ['--display', display]
	for (const h of heads) {
		const output = assertSafeXrandrOutputName(h.output)
		const mode = assertSafeXrandrModeToken(h.mode)
		const x = Number(h.x)
		const y = Number(h.y)
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			throw new Error(`Invalid xrandr position for ${output}`)
		}
		args.push('--output', output, '--pos', `${Math.round(x)}x${Math.round(y)}`, '--mode', mode)
		if (h.rate != null) {
			const rate = Number(h.rate)
			if (Number.isFinite(rate) && rate > 0) {
				args.push('--rate', String(Math.round(rate * 100) / 100))
			}
		}
	}
	return args
}

/** @param {string[]} argv */
function shellQuoteArg(arg) {
	const s = String(arg)
	if (/^[A-Za-z0-9._@/:+-]+$/.test(s)) return s
	return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * Shell command for persisted apply-layout.sh (tokens pre-validated).
 * @param {string[]} argv from buildXrandrLayoutArgv
 */
function formatXrandrLayoutShellCommand(argv) {
	const parts = ['xrandr', ...argv].map(shellQuoteArg)
	return `DISPLAY=${argv[0] === '--display' ? argv[1] : ':0'} ${parts.join(' ')}`
}

/** @param {string[]} argv */
function formatXrandrArgvForLog(argv) {
	return ['xrandr', ...argv].join(' ')
}

module.exports = {
	XRANDR_MODE_RE,
	assertSafeXrandrOutputName,
	assertSafeXrandrModeToken,
	buildXrandrLayoutArgv,
	formatXrandrLayoutShellCommand,
	formatXrandrArgvForLog,
}
