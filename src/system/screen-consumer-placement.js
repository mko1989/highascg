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
		/* WO-1034: every <screen> of the channel — a destination on two jacks (fill + key) and slice windows are
		 * further windows of the same channel, each with its own place. */
		for (const s of block.match(/<screen>[\s\S]*?<\/screen>/g) || []) {
			const num = (tag) => {
				const m = s.match(new RegExp(`<${tag}>(-?\\d+)</${tag}>`))
				return m ? parseInt(m[1], 10) : null
			}
			const x = num('x')
			const y = num('y')
			if (x == null || y == null) continue
			out.push({ channel: idx + 1, x, y, width: num('width') ?? 0, height: num('height') ?? 0 })
		}
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
 * WO-1034: which window of a channel belongs to which configured rect. The windows of one channel share a title, so
 * a window already standing on a rect IS that rect's window (pairing by search order pulled the fill window of a
 * fill + key pair onto the key's jack); what is left pairs up by size first, then in window-id order.
 * @param {{ x: number, y: number, width: number, height: number }[]} rects
 * @param {{ wid: string, x: number|null, y: number|null, width?: number|null, height?: number|null }[]} wins
 * @returns {{ rect: object, win: object | null }[]} one row per rect
 */
function pairWindowsWithRects(rects, wins) {
	/* ascending window id = the order Caspar created them = config order: the tie-break when no position tells them apart */
	const free = [...wins].sort((a, b) => (Number(a.wid) || 0) - (Number(b.wid) || 0))
	const take = (pred) => {
		const i = free.findIndex(pred)
		return i < 0 ? null : free.splice(i, 1)[0]
	}
	const rows = rects.map((rect) => ({ rect, win: take((w) => w.x === rect.x && w.y === rect.y) }))
	for (const row of rows) {
		if (!row.win) row.win = take((w) => w.width === row.rect.width && w.height === row.rect.height)
	}
	for (const row of rows) if (!row.win) row.win = take(() => true)
	return rows
}

/**
 * Move each screen consumer to its configured position when it is not already there.
 * Best-effort throughout: a missing window, a missing xdotool or a failed move must never break the
 * caspar-connect path — the consumer is merely in the wrong place, which is the status quo.
 * @param {{ config?: Record<string, any>, log?: Function, execFileImpl?: Function, configPath?: string }} ctx
 * @returns {Promise<{ moved: number, alreadyCorrect: number, missing: number }>}
 */
async function placeScreenConsumers(ctx = {}) {
	if (require('../bootstrap/sandbox').isSandbox()) return { placed: 0, missing: 0, skipped: 'sandbox' } // WO-719: the live :0
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

	const geometry = async (wid) => {
		try {
			const { stdout } = await exec('xdotool', ['getwindowgeometry', '--shell', wid], opts)
			const n = (k) => {
				const m = String(stdout).match(new RegExp(`^${k}=(-?\\d+)$`, 'm'))
				return m ? parseInt(m[1], 10) : null
			}
			return { x: n('X'), y: n('Y'), width: n('WIDTH'), height: n('HEIGHT') }
		} catch {
			return { x: null, y: null, width: null, height: null } // falls through to an unconditional move
		}
	}

	for (const channel of [...new Set(rects.map((r) => r.channel))]) {
		const wanted = rects.filter((r) => r.channel === channel)
		let wids = []
		try {
			const { stdout } = await exec('xdotool', ['search', '--name', consumerTitlePattern(channel)], opts)
			wids = String(stdout || '').trim().split(/\s+/).filter(Boolean)
		} catch {
			/* no window for this channel yet */
		}
		const wins = []
		for (const wid of wids.slice(0, wanted.length + 4)) wins.push({ wid, ...(await geometry(wid)) })
		for (const { rect, win } of pairWindowsWithRects(wanted, wins)) {
			if (!win) {
				result.missing++
				continue
			}
			if (win.x === rect.x && win.y === rect.y) {
				result.alreadyCorrect++
				continue
			}
			try {
				await exec('xdotool', ['windowmove', win.wid, String(rect.x), String(rect.y)], opts)
				result.moved++
				log(
					'info',
					`[Screen placement] ch ${rect.channel}: ${win.x == null ? '?' : `${win.x},${win.y}`} → ${rect.x},${rect.y} (WM placed it elsewhere)`,
				)
			} catch (e) {
				log('warn', `[Screen placement] ch ${rect.channel}: windowmove failed: ${e?.message || e}`)
			}
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

module.exports = { parseScreenConsumerRects, consumerTitlePattern, pairWindowsWithRects, placeScreenConsumers }
