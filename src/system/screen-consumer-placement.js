'use strict'

/**
 * WO-483 — put every Caspar screen-consumer window where its config says, after the WM has placed it.
 *
 * Openbox ships `<placement><policy>Smart</policy><center>yes</center>` with no `<applications>`
 * rule for casparcg, so it places new consumer windows by its own policy and discards the position
 * the config asked for. Measured on two boxes: a 1920x1080 consumer that should sit at 6144,0 was
 * parked at 4032,228 — dead centre of a 9984x1536 canvas — while its monitor stayed blank and
 * Caspar's log happily read `Initialized.`
 *
 * Only the operator-GUI consumer was ever placed (operator-gui-launcher-placement.js, WO-279,
 * which exists because "geometry belongs to the WM"). Everything else was left to chance: PGM1
 * happened to land correctly because Smart placement cannot usefully centre a window wider than
 * half the canvas and falls back to the top-left; PGM2, an ordinary 1080p consumer, did not.
 *
 * A plain `windowmove` is enough — verified on the box: the move sticks, so Openbox interferes at
 * placement time only and does not re-assert. The rects come from the generated `casparcg.config`
 * rather than being recomputed here: that file IS what Caspar was told, so the two can never drift.
 */

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

/**
 * Per-channel screen-consumer rects, in channel order, from a Caspar config XML.
 *
 * Deliberately regex-based: this reads one well-known shape out of a file we generate ourselves,
 * and pulling in an XML parser on the reconnect path is not worth it. Channels are counted by
 * `<channel>` order, which is how Caspar numbers them.
 * @param {string} xml
 * @returns {{ channel: number, x: number, y: number, width: number, height: number }[]}
 */
function parseScreenConsumerRects(xml) {
	const out = []
	if (!xml || typeof xml !== 'string') return out
	const channels = xml.match(/<channel>[\s\S]*?<\/channel>/g) || []
	channels.forEach((block, idx) => {
		const screen = block.match(/<screen>[\s\S]*?<\/screen>/)
		if (!screen) return
		const s = screen[0]
		const num = (tag) => {
			const m = s.match(new RegExp(`<${tag}>(-?\\d+)</${tag}>`))
			return m ? parseInt(m[1], 10) : null
		}
		const x = num('x')
		const y = num('y')
		if (x == null || y == null) return
		out.push({ channel: idx + 1, x, y, width: num('width') ?? 0, height: num('height') ?? 0 })
	})
	return out
}

/**
 * `xdotool search --name` takes a REGEX and the titles contain `[` and `|`; an unescaped `|` makes
 * the pattern an alternation that matches every window (which once had a diagnostic cheerfully
 * measuring the root window instead).
 * @param {number} channel
 */
function consumerTitlePattern(channel) {
	return `Screen consumer \\[${channel}\\|`
}

/**
 * Move each screen consumer to its configured position when it is not already there.
 * Best-effort throughout: a missing window, a missing xdotool or a failed move must never break the
 * caspar-connect path — the consumer is merely in the wrong place, which is the status quo.
 * @param {{ config?: Record<string, any>, log?: Function, execFileImpl?: Function, configPath?: string }} ctx
 * @returns {Promise<{ moved: number, alreadyCorrect: number, missing: number }>}
 */
async function placeScreenConsumers(ctx = {}) {
	const log = typeof ctx.log === 'function' ? ctx.log : () => {}
	const exec = ctx.execFileImpl || execFileAsync
	const result = { moved: 0, alreadyCorrect: 0, missing: 0 }

	const configPath =
		ctx.configPath ||
		String(ctx.config?.casparServer?.config_path || '').trim() ||
		path.join(process.env.HOME || '/home/casparcg', 'highascg/config/casparcg.config')

	let xml = ''
	try {
		xml = fs.readFileSync(configPath, 'utf8')
	} catch (e) {
		log('debug', `[Screen placement] no caspar config at ${configPath}: ${e?.message || e}`)
		return result
	}

	const rects = parseScreenConsumerRects(xml)
	if (rects.length === 0) return result

	const env = {
		...process.env,
		DISPLAY: process.env.DISPLAY || ':0',
		XAUTHORITY: process.env.XAUTHORITY || `${process.env.HOME || '/home/casparcg'}/.Xauthority`,
	}
	const opts = { env, timeout: 4000 }

	for (const rect of rects) {
		let wid = ''
		try {
			const { stdout } = await exec('xdotool', ['search', '--name', consumerTitlePattern(rect.channel)], opts)
			wid = String(stdout || '').trim().split(/\s+/).filter(Boolean)[0] || ''
		} catch {
			/* no window for this channel yet */
		}
		if (!wid) {
			result.missing++
			continue
		}
		let curX = null
		let curY = null
		try {
			const { stdout } = await exec('xdotool', ['getwindowgeometry', '--shell', wid], opts)
			const mx = String(stdout).match(/^X=(-?\d+)$/m)
			const my = String(stdout).match(/^Y=(-?\d+)$/m)
			curX = mx ? parseInt(mx[1], 10) : null
			curY = my ? parseInt(my[1], 10) : null
		} catch {
			/* fall through to an unconditional move */
		}
		if (curX === rect.x && curY === rect.y) {
			result.alreadyCorrect++
			continue
		}
		try {
			await exec('xdotool', ['windowmove', wid, String(rect.x), String(rect.y)], opts)
			result.moved++
			log(
				'info',
				`[Screen placement] ch ${rect.channel}: ${curX == null ? '?' : `${curX},${curY}`} → ${rect.x},${rect.y} (WM placed it elsewhere)`,
			)
		} catch (e) {
			log('warn', `[Screen placement] ch ${rect.channel}: windowmove failed: ${e?.message || e}`)
		}
	}

	if (result.moved > 0 || result.missing > 0) {
		log(
			'info',
			`[Screen placement] moved=${result.moved} already-correct=${result.alreadyCorrect} no-window=${result.missing}`,
		)
	}
	return result
}

module.exports = { parseScreenConsumerRects, consumerTitlePattern, placeScreenConsumers }
