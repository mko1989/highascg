'use strict'

/**
 * WO-906 — playout outputs on a second X screen of the same X server: the operator GUI heads alone on screen 0
 * (`:0.0`), every other GPU head of the layout plan (PGM / PRV / multiview / mapping outputs) on screen 1 (`:0.1`).
 * Windows can never cross between X screens, so no GUI window, alt-tab or dialog can cover a playout output and the
 * Caspar window can never bury the GUI.
 *
 * ONE machine-local switch, `casparServer.playout_x_screen` (default off = one X screen, exactly as before), read like
 * WO-868's flag from the nested app config and from the flat generator config.
 *
 * The rest of the server keeps ONE virtual canvas — the layout plan's positions (operator heads left, playout heads to
 * the right). Each X screen starts at 0,0, so its heads are the plan's heads minus the screen's ORIGIN (the plan's
 * min x / y of the group). Only three places translate:
 *   - the xrandr apply (os-config-xrandr-apply.js) — one `xrandr --display :0.N` per screen, positions minus origin;
 *   - the Caspar window positions (layout-sync, playout origin subtracted) + caspar-env `CASPAR_DISPLAY=:0.1`;
 *   - the inventory probes (hardware-info-xrandr.js) — both screens' `xrandr` output merged back onto the plan's
 *     canvas ({@link mergeScreensXrandrText}), so verify / watchdog / Device View read one desktop as before.
 * Runtime truth is the INSTALLED conf (not the config flag): its `# highascg-x-screen` lines name each screen's
 * display, origin and outputs, so an X server that still runs the previous layout is read the way it was started.
 */

const fs = require('fs')
const path = require('path')

const FLAG_KEY = 'playout_x_screen'
const CONF_PATH = '/etc/X11/xorg.conf.d/98-highascg-screens.conf'
const HELPER = '/usr/local/lib/highascg/highascg-xorg-screens-apply.sh'
const OPERATOR_DISPLAY = ':0.0'

/**
 * The installed conf's path. Under the Node test runner (NODE_TEST_CONTEXT) never the box's file — a smoke on the live
 * box must not read (or, through the sync, replace) the real X layout; tests point HIGHASCG_XORG_SCREENS_CONF at a temp.
 */
function confPath() {
	if (process.env.HIGHASCG_XORG_SCREENS_CONF) return process.env.HIGHASCG_XORG_SCREENS_CONF
	return process.env.NODE_TEST_CONTEXT ? '/nonexistent/highascg-test/98-highascg-screens.conf' : CONF_PATH
}
const PLAYOUT_DISPLAY = ':0.1'

/** @param {unknown} v */
function truthy(v) {
	return v === true || v === 'true' || v === 1 || v === '1'
}

/** @param {object | null | undefined} config nested app config or flat generator config */
function isPlayoutXScreen(config) {
	if (!config || typeof config !== 'object') return false
	const cs = config.casparServer && typeof config.casparServer === 'object' ? config.casparServer : null
	if (cs && Object.prototype.hasOwnProperty.call(cs, FLAG_KEY)) return truthy(cs[FLAG_KEY])
	return truthy(config[FLAG_KEY])
}

/**
 * The plan's GPU heads, deduped by connector in the xrandr apply's order, split by X screen.
 * @param {object} layout calculateLayoutPositions() result
 * @param {(sysId: string) => string} [resolve] plan sysId → xrandr connector (default: as is)
 * @returns {{ operator: { origin: {x:number,y:number}, heads: object[] }, playout: { origin: {x:number,y:number}, heads: object[] } }}
 */
function splitScreens(layout, resolve = (s) => s) {
	const seen = new Set()
	const heads = []
	const add = (info, operator) => {
		const output = String(resolve(String(info?.sysId || '').trim()) || '').trim()
		if (!output || seen.has(output) || !Number.isFinite(Number(info.x)) || !Number.isFinite(Number(info.y))) return
		seen.add(output)
		heads.push({ ...info, output, x: Number(info.x), y: Number(info.y), operator })
	}
	/* operator heads first: a connector cabled to the GUI AND a screen stays on the operator screen */
	Object.values(layout?.operatorGui || {}).forEach((h) => add(h, true))
	for (const group of [layout?.screens, layout?.multiview, layout?.prv]) Object.values(group || {}).forEach((h) => add(h, false))
	;(Array.isArray(layout?.mappingGpuOutputs) ? layout.mappingGpuOutputs : []).forEach((h) => add(h, false))
	const side = (operator) => {
		const hs = heads.filter((h) => h.operator === operator)
		const origin = hs.length ? { x: Math.min(...hs.map((h) => h.x)), y: Math.min(...hs.map((h) => h.y)) } : { x: 0, y: 0 }
		return { origin, heads: hs.map((h) => ({ ...h, sx: h.x - origin.x, sy: h.y - origin.y })) }
	}
	return { operator: side(true), playout: side(false) }
}

/**
 * The playout screen's origin on the layout canvas when the switch is on AND there is something to separate (an
 * operator head and a playout head), else null — the generator's and the conf's one condition.
 * @param {object} config nested or flat
 * @param {object} layout calculateLayoutPositions() result
 */
function playoutOrigin(config, layout) {
	if (!isPlayoutXScreen(config)) return null
	const split = splitScreens(layout)
	return split.operator.heads.length && split.playout.heads.length ? split.playout.origin : null
}

/**
 * The two-screen xorg.conf.d file for a split (the root helper validates and installs it). Modes are
 * `nvidia-auto-select` (the EDID preferred mode — a NovaStar processor drives only that one): the session's
 * apply-layout.sh and every Apply set the planned mode / rate with xrandr per screen, as on one screen today.
 * Screen 1 sits BELOW-RIGHT of screen 0 with no shared edge, so the pointer cannot wander onto a playout output.
 * @param {ReturnType<typeof splitScreens>} split
 * @param {{ busId: string }} opts busId as Xorg wants it (`PCI:1:0:0`)
 * @returns {string | null} null when the split has no playout or no operator head (nothing to separate)
 */
function buildXorgScreensConf(split, { busId }) {
	if (!split.playout.heads.length || !split.operator.heads.length) return null
	if (!/^PCI:\d+:\d+:\d+$/.test(String(busId || ''))) throw new Error(`invalid BusID ${busId}`)
	const screens = [
		{ n: 0, name: 'HighAsCG Operator', display: OPERATOR_DISPLAY, ...split.operator },
		{ n: 1, name: 'HighAsCG Playout', display: PLAYOUT_DISPLAY, ...split.playout },
	]
	const w0 = Math.max(...split.operator.heads.map((h) => h.sx + (Number(h.width) || 0)))
	const h0 = Math.max(...split.operator.heads.map((h) => h.sy + (Number(h.height) || 0)))
	const out = [
		/* ASCII only: the root helper refuses anything else */
		'# WO-906 - generated by HighAsCG from the layout plan (casparServer.playout_x_screen); installed by',
		'# highascg-xorg-screens-apply.sh. Operator GUI heads on :0.0, playout heads on :0.1, Xinerama off.',
		'# The lines below map each X screen back onto the layout canvas (x-screens.js): n display origin outputs.',
		...screens.map((s) => `# highascg-x-screen ${s.n} ${s.display} ${s.origin.x} ${s.origin.y} ${s.heads.map((h) => h.output).join(',')}`),
		'',
		'Section "ServerLayout"',
		'    Identifier "HighAsCG Screens"',
		'    Screen 0 "HighAsCG Operator" 0 0',
		`    Screen 1 "HighAsCG Playout" Absolute ${w0 + 64} ${h0 + 64}`,
		'    Option "Xinerama" "0"',
		'EndSection',
	]
	for (const s of screens) {
		const tag = s.n === 0 ? 'Operator' : 'Playout'
		const meta = s.heads
			.map((h) => `${h.output}: nvidia-auto-select +${h.sx}+${h.sy} {ForceCompositionPipeline=On}`)
			.join(', ')
		out.push(
			'',
			'Section "Device"',
			`    Identifier "HighAsCG GPU ${tag}"`,
			'    Driver "nvidia"',
			`    BusID "${busId}"`,
			`    Screen ${s.n}`,
			'    Option "ForceCompositionPipeline" "On"',
			'EndSection',
			'',
			'Section "Screen"',
			`    Identifier "${s.name}"`,
			`    Device "HighAsCG GPU ${tag}"`,
			'    DefaultDepth 24',
			`    Option "UseDisplayDevice" "${s.heads.map((h) => h.output).join(', ')}"`,
			`    Option "metamodes" "${meta}"`,
			'EndSection',
		)
	}
	return out.join('\n') + '\n'
}

/**
 * The installed layout's screens (`# highascg-x-screen` lines), or [] = one X screen.
 * @param {string} [text] conf text (default: the installed file)
 * @returns {Array<{ n: number, display: string, x: number, y: number, outputs: string[] }>}
 */
function installedScreens(text) {
	let src = text
	if (src === undefined) {
		try {
			src = fs.readFileSync(confPath(), 'utf8')
		} catch {
			return []
		}
	}
	const rows = []
	for (const m of String(src).matchAll(/^# highascg-x-screen (\d+) (:\d+\.\d+) (-?\d+) (-?\d+) (\S*)$/gm)) {
		rows.push({ n: +m[1], display: m[2], x: +m[3], y: +m[4], outputs: m[5].split(',').filter(Boolean) })
	}
	return rows.length > 1 ? rows : []
}

/** X screen of a connector under the installed layout → { display, x, y } (origin), or null = one screen. */
function screenOfOutput(output, screens = installedScreens()) {
	const s = screens.find((r) => r.outputs.includes(output))
	return s ? { display: s.display, x: s.x, y: s.y } : screens.length ? { display: screens[0].display, x: screens[0].x, y: screens[0].y } : null
}

/**
 * Can this output carry the operator GUI? Under the two-screen layout only screen 0's outputs can (the GUI and the
 * pointer never reach :0.1); with one X screen any output can.
 */
function isOperatorPickable(output, screens = installedScreens()) {
	return screens.length < 2 || screens[0].outputs.includes(String(output || ''))
}

const OUT_LINE = /^(\S+) (connected|disconnected)( primary)?( (\d+)x(\d+)\+(-?\d+)\+(-?\d+))?/

/** `xrandr` text → { header, blocks: [{ name, connected, lines }] } */
function splitXrandrText(text) {
	const lines = String(text || '').split('\n')
	const res = { header: '', blocks: [] }
	for (const line of lines) {
		if (/^Screen \d+:/.test(line)) {
			if (!res.header) res.header = line
			continue
		}
		const m = line.match(OUT_LINE)
		if (m) res.blocks.push({ name: m[1], connected: m[2] === 'connected', lines: [line] })
		else if (res.blocks.length && line) res.blocks[res.blocks.length - 1].lines.push(line)
	}
	return res
}

/**
 * Per-screen `xrandr` outputs ([{ screen, text }]) → one text on the plan's canvas: each connected output's position
 * plus its screen's origin, `primary` only from screen 0, an output listed connected on one screen dropped from the
 * others, the `Screen` line = screen 0's with `current` = the union of the shifted screens.
 * @param {Array<{ screen: { x: number, y: number }, text: string }>} parts
 */
function mergeScreensXrandrText(parts) {
	const parsed = parts.map((p, i) => ({ ...p, i, ...splitXrandrText(p.text) }))
	const connectedOn = new Map()
	for (const p of parsed) for (const b of p.blocks) if (b.connected && !connectedOn.has(b.name)) connectedOn.set(b.name, p.i)
	let w = 0
	let h = 0
	const body = []
	const emitted = new Set()
	for (const p of parsed) {
		const cur = p.header.match(/current (\d+) x (\d+)/)
		if (cur) {
			w = Math.max(w, p.screen.x + +cur[1])
			h = Math.max(h, p.screen.y + +cur[2])
		}
		for (const b of p.blocks) {
			const owner = connectedOn.has(b.name) ? connectedOn.get(b.name) : 0
			if (owner !== p.i || emitted.has(b.name)) continue
			emitted.add(b.name)
			const first = b.lines[0].replace(OUT_LINE, (all, name, state, primary, geo, gw, gh, gx, gy) => {
				const pr = primary && p.i === 0 ? primary : ''
				return `${name} ${state}${pr}${geo ? ` ${gw}x${gh}+${+gx + p.screen.x}+${+gy + p.screen.y}` : ''}`
			})
			body.push(first, ...b.lines.slice(1))
		}
	}
	const header = (parsed[0]?.header || 'Screen 0: minimum 8 x 8, current 0 x 0, maximum 32767 x 32767').replace(
		/current \d+ x \d+/,
		`current ${w} x ${h}`,
	)
	return [header, ...body].join('\n') + '\n'
}

/**
 * The NVIDIA GPU's Xorg BusID from sysfs (`0000:01:00.0` → `PCI:1:0:0`; Xorg wants decimal), or null.
 * @param {string} [root] sysfs root (tests)
 */
function nvidiaBusId(root = '/sys/bus/pci/drivers/nvidia') {
	let names
	try {
		names = fs.readdirSync(root)
	} catch {
		return null
	}
	const m = names.map((n) => n.match(/^([0-9a-f]{4}):([0-9a-f]{2}):([0-9a-f]{2})\.([0-7])$/i)).find(Boolean)
	return m ? `PCI:${parseInt(m[2], 16)}:${parseInt(m[3], 16)}:${parseInt(m[4], 16)}` : null
}

/** Where the generated conf is written before the helper copies it (service user, never a root path). */
function stagedConfPath() {
	return path.join(process.env.HOME || '/home/casparcg', '.highascg', 'run', '98-highascg-screens.conf')
}

module.exports = {
	FLAG_KEY,
	confPath,
	HELPER,
	PLAYOUT_DISPLAY,
	isPlayoutXScreen,
	splitScreens,
	playoutOrigin,
	buildXorgScreensConf,
	installedScreens,
	screenOfOutput,
	isOperatorPickable,
	mergeScreensXrandrText,
	nvidiaBusId,
	stagedConfPath,
}
