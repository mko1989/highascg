'use strict'

/**
 * WO-836 Part 3c — argv parsing for tools/test-agent/ui and /caspar. Pure (unit-tested in
 * tools/smoke/test-agent-cmdline.test.js). `bool` flags take no value, `val` flags take the next token.
 * Unknown `--x` flags are an error (a Haiku agent that typos a flag must be told, not silently ignored).
 * A bare `--` ends flag parsing, so a label that starts with "-" can still be passed.
 */

/**
 * @param {string[]} argv
 * @param {{ bool?: string[], val?: string[] }} spec
 * @returns {{ pos: string[], flags: Record<string, string|boolean> }}
 */
function parseArgs(argv, spec = {}) {
	const bool = new Set(spec.bool || [])
	const val = new Set(spec.val || [])
	const pos = []
	const flags = {}
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		if (a === '--') {
			pos.push(...argv.slice(i + 1))
			break
		}
		if (!a.startsWith('--') || a.length === 2) {
			pos.push(a)
			continue
		}
		const eq = a.indexOf('=')
		const name = (eq > 0 ? a.slice(2, eq) : a.slice(2)).trim()
		if (bool.has(name)) {
			flags[name] = true
		} else if (val.has(name)) {
			if (eq > 0) flags[name] = a.slice(eq + 1)
			else if (i + 1 < argv.length) flags[name] = argv[++i]
			else throw new Error(`--${name} needs a value`)
		} else {
			throw new Error(`unknown flag --${name} (allowed: ${[...bool, ...val].map((f) => '--' + f).join(' ') || 'none'})`)
		}
	}
	return { pos, flags }
}

/** "x,y,w,h" → {x,y,w,h} (non-negative integers) or throws. */
function parseCrop(s) {
	const m = String(s || '').match(/^(\d+),(\d+),(\d+),(\d+)$/)
	if (!m) throw new Error(`--crop wants x,y,w,h (four whole numbers), got '${s}'`)
	const [x, y, w, h] = m.slice(1).map(Number)
	if (w < 1 || h < 1) throw new Error('--crop width and height must be at least 1')
	return { x, y, w, h }
}

/** "3" | "3-10" → {channel, layer|null}; throws otherwise. */
function parseChannelLayer(s) {
	const m = String(s || '').match(/^(\d+)(?:-(\d+))?$/)
	if (!m) throw new Error(`channel must look like 1 or 1-10 (channel-layer), got '${s}'`)
	return { channel: Number(m[1]), layer: m[2] != null ? Number(m[2]) : null }
}

module.exports = { parseArgs, parseCrop, parseChannelLayer }
