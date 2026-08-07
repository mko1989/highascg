/**
 * Identify displays: flash xrandr output names on each connected screen.
 *
 * Uses override-redirect xterm windows so the overlay appears above fullscreen
 * apps (CasparCG screen-consumer, etc.).  Each window auto-closes after a
 * configurable duration (default 4 s).
 *
 * Endpoint:  POST /api/system/identify-displays   { durationMs?: number }
 */

'use strict'

const { spawn } = require('child_process')
const { getDisplaysXrandrDetailed, getXAuthority } = require('../utils/hardware-info')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

/** @type {Set<import('child_process').ChildProcess>} */
const _activeOverlays = new Set()

/** Colours assigned per-display index (fg, bg as ANSI 256-colour IDs). */
const COLOUR_PAIRS = [
	{ fg: '33',  bg: '0' },   // blue on black
	{ fg: '196', bg: '0' },   // red on black
	{ fg: '46',  bg: '0' },   // green on black
	{ fg: '214', bg: '0' },   // orange on black
	{ fg: '201', bg: '0' },   // magenta on black
	{ fg: '51',  bg: '0' },   // cyan on black
]

/** How many xterm columns/rows per pixel (rough, for geometry sizing). */
const CHAR_W = 10
const CHAR_H = 20

/**
 * Build the bash one-liner that flashes text in an xterm.
 * The script alternates between bright and dim for the output name, showing
 * the resolution underneath, then exits after `durationMs`.
 *
 * @param {string} name      e.g. "DP-0"
 * @param {string} info      e.g. "1920x1080+2560+0"
 * @param {number} durationMs
 * @param {{ fg: string, bg: string }} colour
 */
function buildFlashScript(name, info, durationMs, colour) {
	const cycles = Math.max(1, Math.floor(durationMs / 400))
	// figlet-style big text using bash printf — keep it simple with a centered banner
	return [
		'#!/bin/bash',
		`FG="\\033[38;5;${colour.fg}m"`,
		`DIM="\\033[2m"`,
		`BRIGHT="\\033[1m"`,
		`RST="\\033[0m"`,
		`BG="\\033[48;5;${colour.bg}m"`,
		// Clear screen, hide cursor
		'printf "\\033[2J\\033[?25l"',
		'tput civis 2>/dev/null',
		// Calculate vertical centering — leave some space
		'ROWS=$(tput lines 2>/dev/null || echo 24)',
		'COLS=$(tput cols 2>/dev/null || echo 80)',
		'HALF=$(( (ROWS / 2) - 2 ))',
		'for i in $(seq 1 $HALF); do echo; done',
		// Flash loop
		`for i in $(seq 1 ${cycles}); do`,
		// Bright phase
		'  printf "\\033[2J"',
		'  for j in $(seq 1 $HALF); do echo; done',
		`  NAME="${name}"`,
		`  INFO="${info}"`,
		'  NAME_PAD=$(( (COLS - ${#NAME}) / 2 ))',
		'  INFO_PAD=$(( (COLS - ${#INFO}) / 2 ))',
		'  [ $NAME_PAD -lt 0 ] && NAME_PAD=0',
		'  [ $INFO_PAD -lt 0 ] && INFO_PAD=0',
		'  printf "%${NAME_PAD}s" ""',
		'  printf "${BG}${FG}${BRIGHT}%s${RST}\\n" "$NAME"',
		'  echo',
		'  printf "%${INFO_PAD}s" ""',
		'  printf "${BG}${FG}${DIM}%s${RST}\\n" "$INFO"',
		'  sleep 0.4',
		// Dim phase
		'  printf "\\033[2J"',
		'  for j in $(seq 1 $HALF); do echo; done',
		'  printf "%${NAME_PAD}s" ""',
		'  printf "${BG}${FG}${DIM}%s${RST}\\n" "$NAME"',
		'  echo',
		'  printf "%${INFO_PAD}s" ""',
		'  printf "${BG}${FG}${DIM}%s${RST}\\n" "$INFO"',
		'  sleep 0.4',
		'done',
		// Restore cursor, exit
		'tput cnorm 2>/dev/null',
		'exit 0',
	].join('\n')
}

/**
 * Kill any previously spawned overlay windows.
 */
function killActiveOverlays() {
	for (const proc of _activeOverlays) {
		try {
			proc.kill('SIGTERM')
		} catch { /* already dead */ }
	}
	_activeOverlays.clear()
}

/**
 * Spawn an xterm overlay window on a specific display output.
 *
 * @param {{ name: string, resolution: string, x: number, y: number }} display
 * @param {number} durationMs
 * @param {number} colourIndex
 */
function spawnOverlay(display, durationMs, colourIndex) {
	const colour = COLOUR_PAIRS[colourIndex % COLOUR_PAIRS.length]
	const info = `${display.resolution}  +${display.x}+${display.y}`
	const script = buildFlashScript(display.name, info, durationMs, colour)

	// Parse resolution for window sizing
	const resParts = display.resolution.match(/(\d+)x(\d+)/)
	const resW = resParts ? parseInt(resParts[1], 10) : 1920
	const resH = resParts ? parseInt(resParts[2], 10) : 1080

	// Size the xterm to roughly 60% of the display, centered
	const cols = Math.max(40, Math.floor((resW * 0.6) / CHAR_W))
	const rows = Math.max(12, Math.floor((resH * 0.5) / CHAR_H))
	const offsetX = display.x + Math.floor(resW * 0.2)
	const offsetY = display.y + Math.floor(resH * 0.25)

	const env = {
		...process.env,
		DISPLAY: ':0',
		XAUTHORITY: getXAuthority(),
	}

	const proc = spawn('xterm', [
		'+sb',                          // no scrollbar
		'-bc',                          // no blinking cursor
		'-bg', 'black',
		'-fg', 'white',
		'-fa', 'Monospace',
		'-fs', '48',                    // large font
		'-geometry', `${cols}x${rows}+${offsetX}+${offsetY}`,
		'-T', `Identify: ${display.name}`,
		'+ah',                          // allow override-redirect hints
		'-e', 'bash', '-c', script,
	], {
		env,
		detached: true,
		stdio: 'ignore',
	})

	proc.unref()

	proc.on('exit', () => {
		_activeOverlays.delete(proc)
	})

	_activeOverlays.add(proc)
	return proc
}

/**
 * POST /api/system/identify-displays
 *
 * @param {string} body
 * @param {*} ctx
 */
async function handleIdentifyDisplaysPost(body, _ctx) {
	// Kill any running overlays first
	killActiveOverlays()

	const b = parseBody(body)
	const durationMs = Math.min(
		Math.max(Number(b?.durationMs) || 4000, 1000),
		15000
	)

	const xr = getDisplaysXrandrDetailed()
	const displays = xr?.displays
	if (!displays || displays.length === 0) {
		return {
			status: 404,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'No connected displays detected via xrandr.' }),
		}
	}

	const spawned = []
	for (let i = 0; i < displays.length; i++) {
		const d = displays[i]
		try {
			spawnOverlay(d, durationMs, i)
			spawned.push({ name: d.name, resolution: d.resolution, x: d.x, y: d.y })
		} catch (e) {
			spawned.push({ name: d.name, error: e instanceof Error ? e.message : String(e) })
		}
	}

	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			ok: true,
			durationMs,
			displays: spawned,
		}),
	}
}

module.exports = {
	handleIdentifyDisplaysPost,
	killActiveOverlays,
}
