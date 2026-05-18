/**
 * POST /api/system/gpu-ports-reset — xrandr HDMI/DP pair hints for GPU inspector (WO-39).
 */

'use strict'

const { execSync } = require('child_process')

const { JSON_HEADERS, jsonBody } = require('./response')
const { getXAuthority } = require('../utils/hardware-info')

function handleGpuPortsReset() {
	let raw = ''
	try {
		raw = execSync('xrandr --query', {
			env: { ...process.env, DISPLAY: ':0', XAUTHORITY: getXAuthority() },
			stdio: ['ignore', 'pipe', 'ignore'],
		}).toString()
	} catch {
		raw = ''
	}

	const lines = raw.split('\n')
	const outputs = []
	for (const line of lines) {
		const m = line.match(/^(\S+)\s+(connected|disconnected)\b/)
		if (m) {
			const name = m[1].replace(/^card\d+-/i, '')
			if (/^(DP|HDMI)/i.test(name)) {
				outputs.push(name)
			}
		}
	}

	function getCanonicalPair(port) {
		const match = port.match(/^(DP|HDMI)-(\d+)/i)
		if (!match) return [port]
		const prefix = match[1].toUpperCase()
		const num = parseInt(match[2], 10)
		const isEven = num % 2 === 0
		const first = isEven ? num : num - 1
		const second = first + 1
		return [`${prefix}-${first}`, `${prefix}-${second}`]
	}

	const pairs = []
	const seenPairs = new Set()

	for (const out of outputs) {
		const pArr = getCanonicalPair(out)
		const key = pArr.join(',')
		if (!seenPairs.has(key)) {
			seenPairs.add(key)
			const prefix = pArr[0].split('-')[0]
			const nums = pArr.map(x => x.split('-')[1]).join('/')
			const idx = pairs.length * 2
			pairs.push({
				id: `gpu_p${idx}_${idx+1}`,
				label: `${prefix} ${nums}`,
				pairs: pArr,
				type: prefix.toLowerCase() === 'hdmi' ? 'hdmi' : 'dp'
			})
		}
		if (pairs.length >= 4) break
	}

	while (pairs.length < 4) {
		const idx = pairs.length * 2
		pairs.push({
			id: `gpu_p${idx}_${idx+1}`,
			label: `None ${idx}/${idx+1}`,
			pairs: [],
			type: 'dp'
		})
	}

	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, pairs }) }
}

module.exports = {
	handleGpuPortsReset,
}
