'use strict'

const { param, chLayer } = require('./amcp-utils')

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
		let cmd = `LOADBG ${chLayer(channel, layer)}`
		if (clip) cmd += ' ' + param(clip)
		if (opts.loop) cmd += ' LOOP'
		if (opts.transition && opts.transition !== 'CUT') {
			cmd += ` ${opts.transition} ${opts.duration || 0} ${param(opts.tween || 'linear')}`
			if (opts.direction) cmd += ` ${opts.direction}`
		}
		if (opts.seek != null) cmd += ` SEEK ${opts.seek}`
		if (opts.length != null) cmd += ` LENGTH ${opts.length}`
		if (opts.filter) cmd += ` FILTER ${param(opts.filter)}`
		if (opts.audioFilter) cmd += ` AF ${param(opts.audioFilter)}`
		if (opts.auto) cmd += ' AUTO'
		if (opts.parameters) cmd += ' ' + opts.parameters
		return this._send(cmd, 'LOADBG')
	}

	/**
	 * @param {number} channel
	 * @param {number} [layer]
	 * @param {string} [clip]
	 * @param {import('./amcp-types').PlayOptions} [opts]
	 */
	load(channel, layer, clip, opts = {}) {
		let cmd = `LOAD ${chLayer(channel, layer)}`
		if (clip) cmd += ' ' + param(clip)
		if (opts.loop) cmd += ' LOOP'
		if (opts.transition && opts.transition !== 'CUT') {
			cmd += ` ${opts.transition} ${opts.duration || 0} ${param(opts.tween || 'linear')}`
			if (opts.direction) cmd += ` ${opts.direction}`
		}
		if (opts.seek != null) cmd += ` SEEK ${opts.seek}`
		if (opts.length != null) cmd += ` LENGTH ${opts.length}`
		if (opts.filter) cmd += ` FILTER ${param(opts.filter)}`
		if (opts.audioFilter) cmd += ` AF ${param(opts.audioFilter)}`
		if (opts.auto) cmd += ' AUTO'
		if (opts.parameters) cmd += ' ' + opts.parameters
		return this._send(cmd, 'LOAD')
	}

	/**
	 * @param {number} channel
	 * @param {number} [layer]
	 * @param {string} [clip]
	 * @param {import('./amcp-types').PlayOptions} [opts]
	 */
	play(channel, layer, clip, opts = {}) {
		let cmd = `PLAY ${chLayer(channel, layer)}`
		if (clip) cmd += ' ' + param(clip)
		if (opts.loop) cmd += ' LOOP'
		if (opts.transition && opts.transition !== 'CUT') {
			if (opts.transition === 'STING') {
				// Syntax: STING <mask_file> <overlay_file> <duration> [...audio/audio_delay]
				cmd += ` STING ${param(opts.parameters)}` // simplify STING parameters for now via parameters field
			} else {
				cmd += ` ${opts.transition} ${opts.duration || 0} ${param(opts.tween || 'linear')}`
				if (opts.direction) cmd += ` ${opts.direction}`
			}
		}
		if (opts.seek != null) cmd += ` SEEK ${opts.seek}`
		if (opts.length != null) cmd += ` LENGTH ${opts.length}`
		if (opts.filter) cmd += ` FILTER ${param(opts.filter)}`
		if (opts.audioFilter) cmd += ` AF ${param(opts.audioFilter)}`
		if (opts.auto) cmd += ' AUTO'
		if (opts.transition !== 'STING' && opts.parameters) cmd += ' ' + opts.parameters
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
