'use strict'

/**
 * WO-836 Part 3c — the agent's HANDS: real X input (xdotool) on the test instance's own Xvfb display, exactly what a
 * person does with mouse and keyboard. NEVER the operator's :0 — refused here, whatever DISPLAY says.
 */

const { spawnSync, execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))

function guardDisplay(display) {
	if (!display || !/^:\d+$/.test(display) || display === ':0' || display.startsWith(':0.')) {
		throw new Error(`refusing to send X input to display '${display}' — only the driver's own Xvfb (never :0)`)
	}
	return display
}

function xdo(display, args) {
	guardDisplay(display)
	const r = spawnSync('xdotool', args, { env: { ...process.env, DISPLAY: display }, encoding: 'utf8' })
	if (r.error) throw new Error(`xdotool failed to run: ${r.error.message} (apt install xdotool?)`)
	if (r.status !== 0) throw new Error(`xdotool ${args.slice(0, 3).join(' ')} failed: ${(r.stderr || '').trim()}`)
	return (r.stdout || '').trim()
}

const r0 = (n) => Math.round(Number(n))

function move(display, x, y) {
	xdo(display, ['mousemove', String(r0(x)), String(r0(y))])
}

/** Hover first (the client needs a motion event to know what is under the pointer), then press and release. */
async function click(display, x, y, { button = 1, double = false, hoverMs = 140, holdMs = 70 } = {}) {
	move(display, x, y)
	await sleepMs(hoverMs)
	for (let i = 0; i < (double ? 2 : 1); i++) {
		xdo(display, ['mousedown', String(button)])
		await sleepMs(holdMs)
		xdo(display, ['mouseup', String(button)])
		await sleepMs(double ? 90 : 0)
	}
}

/** Press at A, glide to B in `steps` motion events (a drag needs a few frames to start), release at B. */
async function drag(display, x1, y1, x2, y2, { steps = 14, stepMs = 30, button = 1 } = {}) {
	move(display, x1, y1)
	await sleepMs(160)
	xdo(display, ['mousedown', String(button)])
	await sleepMs(120)
	for (let i = 1; i <= steps; i++) {
		move(display, x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps)
		await sleepMs(stepMs)
	}
	await sleepMs(200) // hover the drop target so it can highlight / accept
	xdo(display, ['mouseup', String(button)])
}

/** Wheel: button 4 = up, 5 = down. */
async function scroll(display, x, y, dir, n = 3) {
	move(display, x, y)
	await sleepMs(120)
	for (let i = 0; i < n; i++) {
		xdo(display, ['click', dir === 'up' ? '4' : '5'])
		await sleepMs(60)
	}
}

function typeText(display, text, delay = 35) {
	xdo(display, ['type', '--delay', String(delay), '--', text])
}

function key(display, spec) {
	xdo(display, ['key', '--delay', '60', spec])
}

/** Whole-screen PNG of the Xvfb display (popups and dialogs included — what a person sees). */
function screenshot(display, file, size = '1920x1080') {
	guardDisplay(display)
	fs.mkdirSync(path.dirname(file), { recursive: true })
	execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'x11grab', '-draw_mouse', '1', '-video_size', size, '-i', display, '-frames:v', '1', file], {
		env: { ...process.env, DISPLAY: display },
		stdio: ['ignore', 'ignore', 'pipe'],
	})
	return file
}

module.exports = { sleepMs, guardDisplay, move, click, drag, scroll, typeText, key, screenshot, xdo }
