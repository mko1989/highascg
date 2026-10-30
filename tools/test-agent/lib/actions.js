'use strict'

/**
 * WO-836 Part 3c — the label-level commands: ask the Godot eyes where a label is on screen, then use the real X hands
 * on that spot. Each returns a plain object (printed as JSON by `ui`); a failure throws an Error whose message is the
 * explicit, helpful reason (never "false").
 */

const fs = require('fs')
const path = require('path')
const remote = require('./remote')
const xi = require('./xinput')
const { normalizeKey } = require('./keys')

const settle = (ms) => xi.sleepMs(ms)

async function ask(st, cmd) {
	const r = await remote.send(st.port, cmd)
	if (!r.ok) throw new Error(r.error || 'the client answered ok:false')
	return r.result
}

/** Find one control by label; returns {hit, warning?}. */
async function locate(st, label, flags = {}) {
	const q = { cmd: 'find', label, kind: flags.kind || '', under: flags.under || '', contains: !!flags.contains }
	const res = await ask(st, q)
	// `ui tab X` means the workspace tab strip (topmost): a second tab called X in a panel further down is not what is meant
	if (flags.prefer === 'top') res.matches.sort((a, b) => a.cy - b.cy)
	const nth = flags.nth ? Math.max(1, Number(flags.nth)) : 1
	const hit = res.matches[nth - 1]
	if (!hit) throw new Error(`only ${res.matches.length} control(s) labelled '${label}' — --nth ${nth} does not exist`)
	let warning
	const rivals = flags.prefer === 'top' ? res.matches.filter((m) => Math.abs(m.cy - hit.cy) < 6).length : res.count
	if (rivals > 1 && !flags.nth) {
		warning = `${res.count} controls match '${label}' (used the first: ${hit.cls} at ${hit.cx},${hit.cy}); narrow it with --under "<container>" or pick --nth N`
	}
	if (!hit.enabled && !flags.force) throw new Error(`${hit.cls} '${hit.label}' is DISABLED (greyed out) — a person could not press it either`)
	return { hit, warning }
}

/** Real pointer onto the control, then ask the client whether it is really what is under the pointer. */
async function hoverCheck(st, hit, flags) {
	if (flags.force || hit.kind === 'tab' || hit.kind === 'row' || hit.kind === 'item') {
		xi.move(st.display, hit.cx, hit.cy)
		await settle(150)
		return
	}
	let cov
	for (let i = 0; i < 3; i++) {
		// the client learns what is under the pointer from motion events: the first one after a long jump can be late
		xi.move(st.display, hit.cx + (i % 2), hit.cy + (i > 0 ? 1 : 0))
		await settle(150 + i * 100)
		cov = await ask(st, { cmd: 'covered', path: hit.path })
		if (!cov.covered || !/nothing is under/.test(cov.why)) break
	}
	if (cov.covered) throw new Error(`${cov.why} — close or move whatever is on top first (see: ui shot, ui state)`)
}

async function click(st, label, flags) {
	const { hit, warning } = await locate(st, label, flags)
	if (hit.kind === 'menuitem') {
		const p = await aimAtMenuItem(st, hit, label)
		await xi.click(st.display, p.x, p.y)
		await settle(Number(flags.settle || 0.35) * 1000)
		return { clicked: brief(hit), ...(warning ? { warning } : {}) }
	}
	await hoverCheck(st, hit, flags)
	await xi.click(st.display, hit.cx, hit.cy, { button: flags.right ? 3 : 1, double: !!flags.double })
	await settle(Number(flags.settle || 0.35) * 1000)
	return { clicked: brief(hit), ...(warning ? { warning } : {}) }
}

function brief(h) {
	return { kind: h.kind, cls: h.cls, label: h.label || h.tip, at: [h.cx, h.cy] }
}

async function tab(st, title, flags) {
	return click(st, title, { ...flags, kind: 'tab', prefer: flags.under ? undefined : 'top' })
}

async function type(st, field, text, flags) {
	const { hit, warning } = await locate(st, field, { ...flags, kind: 'fields' })
	await hoverCheck(st, hit, flags)
	await xi.click(st.display, hit.cx, hit.cy)
	await settle(150)
	xi.key(st.display, 'ctrl+a') // select what is there, so the typing replaces it
	await settle(80)
	xi.key(st.display, 'BackSpace')
	await settle(80)
	if (text !== '') xi.typeText(st.display, text)
	await settle(150)
	if (!flags['no-submit']) xi.key(st.display, 'Return')
	await settle(Number(flags.settle || 0.4) * 1000)
	const now = (await ask(st, { cmd: 'find', label: field, kind: 'fields', under: flags.under || '', contains: !!flags.contains })).matches[0]
	return { typed: text, field: hit.label, now_shows: now ? now.text : null, submitted: !flags['no-submit'], ...(warning ? { warning } : {}) }
}

/** PopupMenu has no item-rect API: aim at the estimate, then nudge until the client says that row is the focused one. */
async function aimAtMenuItem(st, hit, item) {
	const x = hit.cx
	let y = hit.cy
	let focused = -2
	const probe = async () => {
		xi.move(st.display, x, y)
		await settle(180)
		let now = (await ask(st, { cmd: 'popups' })).slice(-1)[0]
		if (now && now.focused < 0) {
			await settle(250) // the popup updates its hovered row a frame or two after the motion event
			now = (await ask(st, { cmd: 'popups' })).slice(-1)[0]
		}
		return now ? now.focused : -2
	}
	for (let i = 0; i < 8; i++) {
		focused = await probe()
		if (focused === hit.idx) return { x, y }
		// on another row: step by the row gap toward the wanted row; on none: wiggle around the estimate
		if (focused >= 0) y += (hit.idx - focused) * hit.row_h * 0.9 + Math.sign(hit.idx - focused)
		else y = hit.cy + [-4, 4, -8, 8, -12, 12, 0][i % 7]
	}
	xi.key(st.display, 'Escape')
	throw new Error(`could not point at '${item}' in the open list (pointer ended on row ${focused}) — screenshot with ui shot and report UNCLEAR`)
}

async function choose(st, caption, item, flags) {
	const { hit } = await locate(st, caption, { ...flags, kind: 'options' })
	await hoverCheck(st, hit, flags)
	await xi.click(st.display, hit.cx, hit.cy)
	await settle(350)
	const pops = await ask(st, { cmd: 'popups' })
	if (!pops.length) throw new Error(`clicking '${hit.label}' did not open a list (items it should have: ${JSON.stringify(hit.items)})`)
	const pop = pops[pops.length - 1]
	const want = flags.contains ? (t) => t.toLowerCase().includes(item.toLowerCase()) : (t) => t.trim() === item
	const it = pop.items.find((i) => !i.separator && want(i.text))
	if (!it) {
		xi.key(st.display, 'Escape')
		throw new Error(`the list has no item '${item}' — items: ${pop.items.filter((i) => !i.separator).map((i) => `'${i.text}'`).join(', ')}`)
	}
	if (it.disabled) {
		xi.key(st.display, 'Escape')
		throw new Error(`item '${item}' is disabled`)
	}
	const { x, y } = await aimAtMenuItem(st, { cx: Math.round(pop.x + pop.w / 2), cy: Math.round(pop.y + (it.idx + 0.5) * pop.row_h), idx: it.idx, row_h: pop.row_h }, item)
	await xi.click(st.display, x, y)
	await settle(400)
	const after = (await ask(st, { cmd: 'find', label: caption, kind: 'options', under: flags.under || '', contains: !!flags.contains })).matches
	return { chose: item, option_now_shows: after[0] ? after[0].label : null }
}

async function drag(st, from, to, flags) {
	const a = await locate(st, from, { ...flags, nth: flags['from-nth'] })
	const b = await locate(st, to, { ...flags, under: flags['to-under'] || flags.under, nth: flags['to-nth'], kind: flags['to-kind'] })
	await xi.drag(st.display, a.hit.cx, a.hit.cy, b.hit.cx, b.hit.cy, { steps: Number(flags.steps || 14) })
	await settle(500)
	return { dragged: brief(a.hit), onto: brief(b.hit), ...(a.warning || b.warning ? { warning: a.warning || b.warning } : {}) }
}

async function shot(st, name) {
	const safe = String(name || 'shot').replace(/^\d+_/, '').replace(/[^\w.-]+/g, '_').slice(0, 60)
	const dir = path.join(st.out, 'shots')
	fs.mkdirSync(dir, { recursive: true })
	const n = String(fs.readdirSync(dir).filter((f) => f.endsWith('.png')).length + 1).padStart(2, '0')
	const file = path.join(dir, `${n}_${safe}.png`)
	xi.screenshot(st.display, file, st.size)
	return { png: file, note: 'view it with the Read tool on this path' }
}

module.exports = { ask, locate, click, tab, type, choose, drag, shot, normalizeKey }
