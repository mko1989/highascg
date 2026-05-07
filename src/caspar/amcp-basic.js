'use strict'

const { param, chLayer, amcpVerboseTrace } = require('./amcp-utils')
const { buildClipCommandPlan, serializeClipCommandPlan, describeClipCommandPlan } = require('./amcp-command-plan')

function maybeLogPlannedClipCommand(client, phase, plan) {
	if (!amcpVerboseTrace()) return
	const log = client?._context?.log
	if (typeof log !== 'function') return
	const d = describeClipCommandPlan(plan)
	log(
		'debug',
		`AMCP plan ${phase} ch=${d.channel} layer=${d.layer} cmd=${d.commandName}` +
			(d.clip ? ` clip=${d.clip}` : '') +
			(d.transition ? ` transition=${d.transition} duration=${d.duration || 0} tween=${d.tween || 'linear'}` : '') +
			(d.seek != null ? ` seek=${d.seek}` : '') +
			(d.length != null ? ` length=${d.length}` : '')
	)
}

class AmcpBasic {
	/**
	 * @param {import('./amcp-client').AmcpClient} client
	 */
	constructor(client) {
		this._client = client
	}

	_send(cmd, responseKey) {
		return this._client._send(cmd, responseKey)
	}

	/**
	 * @param {number} channel
	 * @param {number} [layer]
	 * @param {string} [clip]
	 * @param {import('./amcp-types').PlayOptions} [opts]
	 */
	loadbg(channel, layer, clip, opts = {}) {
		const plan = buildClipCommandPlan('LOADBG', channel, layer, clip, opts)
		maybeLogPlannedClipCommand(this._client, 'basic-loadbg', plan)
		const cmd = serializeClipCommandPlan(plan)
		return this._send(cmd, 'LOADBG')
	}

	/**
	 * @param {number} channel
	 * @param {number} [layer]
	 * @param {string} [clip]
	 * @param {import('./amcp-types').PlayOptions} [opts]
	 */
	load(channel, layer, clip, opts = {}) {
		const plan = buildClipCommandPlan('LOAD', channel, layer, clip, opts)
		maybeLogPlannedClipCommand(this._client, 'basic-load', plan)
		const cmd = serializeClipCommandPlan(plan)
		return this._send(cmd, 'LOAD')
	}

	/**
	 * @param {number} channel
	 * @param {number} [layer]
	 * @param {string} [clip]
	 * @param {import('./amcp-types').PlayOptions} [opts]
	 */
	play(channel, layer, clip, opts = {}) {
		const plan = buildClipCommandPlan('PLAY', channel, layer, clip, opts)
		maybeLogPlannedClipCommand(this._client, 'basic-play', plan)
		const cmd = serializeClipCommandPlan(plan)
		return this._send(cmd, 'PLAY')
	}

	pause(channel, layer) {
		return this._send(`PAUSE ${chLayer(channel, layer)}`, 'PAUSE')
	}

	resume(channel, layer) {
		return this._send(`RESUME ${chLayer(channel, layer)}`, 'RESUME')
	}

	stop(channel, layer) {
		return this._send(`STOP ${chLayer(channel, layer)}`, 'STOP')
	}

	clear(channel, layer) {
		return this._send(`CLEAR ${chLayer(channel, layer)}`, 'CLEAR')
	}

	call(channel, layer, fn, paramsStr) {
		let cmd = `CALL ${chLayer(channel, layer)} ${typeof fn === 'string' ? fn : ''}`
		if (paramsStr) cmd += ' ' + paramsStr
		return this._send(cmd, 'CALL')
	}

	swap(channel1, layer1, channel2, layer2, transforms) {
		let cmd = `SWAP ${chLayer(channel1, layer1)} ${chLayer(channel2, layer2)}`
		if (transforms) cmd += ' TRANSFORMS'
		return this._send(cmd, 'SWAP')
	}

	add(channel, consumer, paramsStr, consumerIndex) {
		let cmd = `ADD ${parseInt(channel, 10)}${consumerIndex != null ? '-' + consumerIndex : ''} ${consumer}`
		if (paramsStr) cmd += ' ' + paramsStr
		return this._send(cmd, 'ADD')
	}

	remove(channel, consumer, consumerIndex) {
		let cmd = `REMOVE ${parseInt(channel, 10)}`
		if (consumerIndex != null) {
			cmd += `-${consumerIndex}`
		} else if (consumer) {
			cmd += ` ${consumer}`
		}
		return this._send(cmd, 'REMOVE')
	}

	print(channel) {
		return this._send(`PRINT ${parseInt(channel, 10)}`, 'PRINT')
	}

	logLevel(level) {
		return this._send(`LOG LEVEL ${level}`, 'LOG')
	}

	logCategory(category, enable) {
		return this._send(`LOG CATEGORY ${category} ${enable ? '1' : '0'}`, 'LOG')
	}

	set(channel, variable, value) {
		return this._send(`SET ${parseInt(channel, 10)} ${variable} ${value}`, 'SET')
	}

	lock(channel, action, phrase) {
		let cmd = `LOCK ${parseInt(channel, 10)} ${action}`
		if (phrase) cmd += ` ${param(phrase)}`
		return this._send(cmd, 'LOCK')
	}

	ping(token) {
		// Ensure token syntax if present; it responds with token if provided.
		const cmd = token != null ? `PING ${param(token)}` : 'PING'
		return this._send(cmd, 'PING')
	}
}

module.exports = { AmcpBasic }
