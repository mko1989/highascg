'use strict'

const { chLayer, param } = require('./amcp-utils')

function shouldAppendClipVerbFields(commandName, clip) {
	return commandName !== 'PLAY' || (clip != null && String(clip).trim() !== '')
}

function buildClipCommandPlan(commandName, channel, layer, clip, opts = {}) {
	return {
		commandName,
		channel: parseInt(channel, 10),
		layer: layer === undefined || layer === null || layer === '' ? undefined : parseInt(layer, 10),
		clip: clip == null ? '' : String(clip),
		opts: opts || {},
	}
}

function serializeClipCommandPlan(plan) {
	const commandName = String(plan.commandName || '').toUpperCase()
	const base = `${commandName} ${chLayer(plan.channel, plan.layer)}`
	const clip = plan.clip || ''
	const opts = getEffectiveClipCommandOpts(plan)
	const withClipFields = shouldAppendClipVerbFields(commandName, clip)
	let cmd = base

	if (clip) {
		if (clip.startsWith('[HTML] ')) {
			cmd += ' [HTML] ' + param(clip.substring(7))
		} else if (clip.startsWith('ndi://')) {
			cmd += ' ' + clip
		} else if (clip.startsWith('http://') || clip.startsWith('https://')) {
			const ext = clip.split('?')[0].split('.').pop().toLowerCase()
			const videoExts = ['mp4', 'm4v', 'mov', 'avi', 'mkv', 'webm', 'm3u8', 'ts']
			if (!videoExts.includes(ext)) {
				cmd += ' [HTML] ' + param(clip)
			} else {
				cmd += ' ' + param(clip)
			}
		} else {
			cmd += ' ' + param(clip)
		}
	}
	if (opts.loop) cmd += ' LOOP'

	if (withClipFields && opts.transition && opts.transition !== 'CUT') {
		if (opts.transition === 'STING') {
			cmd += ` STING ${param(opts.parameters)}`
		} else {
			cmd += ` ${opts.transition} ${opts.duration || 0} ${param(opts.tween || 'linear')}`
			if (opts.direction) cmd += ` ${opts.direction}`
		}
	}
	if (withClipFields && opts.seek != null) cmd += ` SEEK ${opts.seek}`
	if (withClipFields && opts.length != null) cmd += ` LENGTH ${opts.length}`
	if (opts.filter) cmd += ` FILTER ${param(opts.filter)}`
	if (opts.audioFilter) cmd += ` AF ${param(opts.audioFilter)}`
	if (opts.auto) cmd += ' AUTO'
	if ((opts.transition !== 'STING' || !withClipFields) && opts.parameters) cmd += ' ' + opts.parameters

	return cmd
}

function getEffectiveClipCommandOpts(plan) {
	const commandName = String(plan?.commandName || '').toUpperCase()
	const clip = plan?.clip || ''
	const withClipFields = shouldAppendClipVerbFields(commandName, clip)
	const opts = { ...(plan?.opts || {}) }
	if (!withClipFields) {
		delete opts.transition
		delete opts.duration
		delete opts.tween
		delete opts.direction
		delete opts.seek
		delete opts.length
	}
	return opts
}

function describeClipCommandPlan(plan) {
	const commandName = String(plan?.commandName || '').toUpperCase()
	const clip = plan?.clip || ''
	const opts = getEffectiveClipCommandOpts(plan)
	return {
		commandName,
		channel: plan?.channel,
		layer: plan?.layer,
		clip: clip || undefined,
		loop: !!opts.loop,
		transition: opts.transition || undefined,
		duration: opts.duration,
		tween: opts.tween,
		direction: opts.direction,
		seek: opts.seek,
		length: opts.length,
	}
}

module.exports = {
	buildClipCommandPlan,
	serializeClipCommandPlan,
	describeClipCommandPlan,
	getEffectiveClipCommandOpts,
}
