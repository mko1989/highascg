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

	_isComplexClip(clip, plan) {
		if (!clip) return false
		if (clip.startsWith('[HTML]') || clip.startsWith('ndi://') || clip.startsWith('route://')) return true
		if (plan && plan.transition === 'STING') return true
		return false
	}

	_buildTypedClipParams(channel, layer, clip, plan, opts) {
		return {
			channel,
			layer,
			clip,
			loop: !!opts.loop,
			transition: plan.transition,
			transitionDuration: plan.duration,
			transitionTween: plan.tween,
			auto: !!opts.auto,
			seek: plan.seek,
			length: plan.length,
			clearOn404: !!opts.clearOn404,
		}
	}

	/**
	 * @param {number} channel
	 * @param {number} [layer]
	 * @param {string} [clip]
	 * @param {import('./amcp-types').PlayOptions} [opts]
	 */
	_resolveClipForAmcp(clip) {
		if (clip == null || clip === '') return clip
		const ctx = this._client._context
		if (!ctx) return clip
		try {
			const { resolveClipForAmcpLoad } = require('../media/caspar-cls-id')
			return resolveClipForAmcpLoad(String(clip), ctx)
		} catch {
			return clip
		}
	}

	loadbg(channel, layer, clip, opts = {}) {
		clip = this._resolveClipForAmcp(clip)
		const plan = buildClipCommandPlan('LOADBG', channel, layer, clip, opts)
		maybeLogPlannedClipCommand(this._client, 'basic-loadbg', plan)
		const cmd = serializeClipCommandPlan(plan)
		if (this._isComplexClip(clip, plan)) return this._send(cmd, 'LOADBG')
		return this._client._invokeTyped('loadbg', this._buildTypedClipParams(channel, layer, clip, plan, opts), cmd, 'LOADBG')
	}

	/**
	 * @param {number} channel
	 * @param {number} [layer]
	 * @param {string} [clip]
	 * @param {import('./amcp-types').PlayOptions} [opts]
	 */
	load(channel, layer, clip, opts = {}) {
		clip = this._resolveClipForAmcp(clip)
		const plan = buildClipCommandPlan('LOAD', channel, layer, clip, opts)
		maybeLogPlannedClipCommand(this._client, 'basic-load', plan)
		const cmd = serializeClipCommandPlan(plan)
		if (this._isComplexClip(clip, plan)) return this._send(cmd, 'LOAD')
		return this._client._invokeTyped('load', this._buildTypedClipParams(channel, layer, clip, plan, opts), cmd, 'LOAD')
	}

	/**
	 * @param {number} channel
	 * @param {number} [layer]
	 * @param {string} [clip]
	 * @param {import('./amcp-types').PlayOptions} [opts]
	 */
	play(channel, layer, clip, opts = {}) {
		clip = this._resolveClipForAmcp(clip)
		const plan = buildClipCommandPlan('PLAY', channel, layer, clip, opts)
		maybeLogPlannedClipCommand(this._client, 'basic-play', plan)
		const cmd = serializeClipCommandPlan(plan)
		if (this._isComplexClip(clip, plan)) return this._send(cmd, 'PLAY')
		return this._client._invokeTyped('play', this._buildTypedClipParams(channel, layer, clip, plan, opts), cmd, 'PLAY')
	}

	pause(channel, layer) {
		return this._client._invokeTyped('pause', { channel, layer }, `PAUSE ${chLayer(channel, layer)}`, 'PAUSE')
	}

	resume(channel, layer) {
		return this._client._invokeTyped('resume', { channel, layer }, `RESUME ${chLayer(channel, layer)}`, 'RESUME')
	}

	stop(channel, layer) {
		return this._client._invokeTyped('stop', { channel, layer }, `STOP ${chLayer(channel, layer)}`, 'STOP')
	}

	clear(channel, layer) {
		return this._client._invokeTyped('clear', { channel, layer }, `CLEAR ${chLayer(channel, layer)}`, 'CLEAR')
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

	print(channel, layer) {
		const ch = parseInt(channel, 10)
		const ly = layer != null && layer !== '' ? parseInt(layer, 10) : NaN
		const hasLayer = Number.isFinite(ly) && ly >= 1
		const cmd = hasLayer ? `PRINT ${ch}-${ly}` : `PRINT ${ch}`
		return this._client._invokeTyped(
			'print',
			hasLayer ? { channel: ch, layer: ly } : { channel: ch },
			cmd,
			'PRINT',
		)
	}

	/**
	 * ADD channel IMAGE basename — fixed PNG path under media (compose preview tick).
	 * @param {number|string} channel
	 * @param {string} basename — no extension, e.g. highascg_preview/ch1
	 * @param {number|null} [consumerIndex] — fixed slot to avoid consumer pile-up (default 700)
	 */
	addImage(channel, basename, consumerIndex = 700) {
		const ch = parseInt(channel, 10)
		const base = String(basename || '').trim()
		if (!base) return Promise.resolve({ ok: false, error: 'basename required' })
		const idx =
			consumerIndex != null && consumerIndex !== '' && Number.isFinite(Number(consumerIndex))
				? `-${parseInt(String(consumerIndex), 10)}`
				: ''
		const cmd = `ADD ${ch}${idx} IMAGE ${base}`
		return this._client._invokeTyped('addImage', { channel: ch, basename: base, consumerIndex }, cmd, 'ADD')
	}

	logLevel(level) {
		return this._client._invokeTyped('logLevel', { level }, `LOG LEVEL ${level}`, 'LOG')
	}

	logCategory(category, enable) {
		return this._client._invokeTyped('logCategory', { category, enable }, `LOG CATEGORY ${category} ${enable ? '1' : '0'}`, 'LOG')
	}

	set(channel, variable, value) {
		return this._client._invokeTyped('set', { channel: parseInt(channel, 10), variable, value }, `SET ${parseInt(channel, 10)} ${variable} ${value}`, 'SET')
	}

	lock(channel, action, phrase) {
		let cmd = `LOCK ${parseInt(channel, 10)} ${action}`
		if (phrase) cmd += ` ${param(phrase)}`
		return this._client._invokeTyped('lock', { channel: parseInt(channel, 10), action, lockPhrase: phrase }, cmd, 'LOCK')
	}

	ping(token) {
		// Ensure token syntax if present; it responds with token if provided.
		const cmd = token != null ? `PING ${param(token)}` : 'PING'
		// Note: casparcg-connection library's ping doesn't take parameters, so we fall back to raw if token is given
		if (token != null) {
			return this._send(cmd, 'PING')
		}
		return this._client._invokeTyped('ping', {}, cmd, 'PING')
	}
}

module.exports = { AmcpBasic }
