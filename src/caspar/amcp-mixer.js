'use strict'

const { param, chLayer } = require('./amcp-utils')

class AmcpMixer {
	/**
	 * @param {import('./amcp-client').AmcpClient} client
	 */
	constructor(client) {
		this._client = client
	}

	_send(cmd, responseKey) {
		return this._client._send(cmd, responseKey)
	}

	_mixer(channel, layer, subcmd, key = 'MIXER') {
		const cl = chLayer(channel, layer)
		return this._send(`MIXER ${cl} ${subcmd}`, key)
	}

	/**
	 * @param {string} method - casparcg-connection method (e.g. mixerOpacity)
	 * @param {string} keyword - AMCP subcommand (e.g. OPACITY)
	 * @param {number} channel
	 * @param {number} [layer]
	 * @param {number} val
	 * @param {number} [duration]
	 * @param {string} [tween]
	 * @param {boolean} [defer]
	 */
	_mixerDeferNumber(method, keyword, channel, layer, val, duration, tween, defer) {
		if (val === undefined) return this._mixer(channel, layer, keyword)
		const cl = chLayer(channel, layer)
		let cmd = `MIXER ${cl} ${keyword} ${val}`
		if (duration != null) cmd += ` ${duration}`
		if (tween) cmd += ` ${param(tween)}`
		if (defer) cmd += ' DEFER'
		const typed = {
			channel: Number(channel),
			layer: Number(layer),
			value: Number(val),
			...(duration != null ? { duration: Number(duration) } : {}),
			...(tween ? { tween } : {}),
			...(defer ? { defer: true } : {}),
		}
		return this._client._invokeTyped(method, typed, cmd, 'MIXER')
	}

	mixerKeyer(channel, layer, keyer) {
		if (keyer === undefined) return this._mixer(channel, layer, 'KEYER')
		const cl = chLayer(channel, layer)
		return this._client._invokeTyped(
			'mixerKeyer',
			{ channel: Number(channel), layer: Number(layer), keyer: !!keyer },
			`MIXER ${cl} KEYER ${keyer ? 1 : 0}`,
			'MIXER',
		)
	}

	/**
	 * @param {number} channel
	 * @param {number} [layer]
	 * @param {import('./amcp-types').MixerChromaOptions} [opts]
	 */
	mixerChroma(channel, layer, opts) {
		if (opts === undefined) return this._mixer(channel, layer, 'CHROMA')
		let p = opts.enable ? opts.enable : '0' // wait, chroma param is 'color' (or 'green' / 'blue') or target hue etc. Actually CasparCG 2.2 chroma is CHROMA enable target_hue ... wait, the wiki says MIXER CHROMA.
		// Wiki typically says: MIXER ch-layer CHROMA [enable:0,1] [target_hue] [hue_width] [min_saturation] [min_brightness] [softness] [spill_suppress] [spill_suppress_saturation] [show_mask:0,1]
		if (opts.enable !== undefined) p = opts.enable ? '1' : '0'
		const args = []
		if (opts.targetHue !== undefined) args.push(opts.targetHue)
		if (opts.hueWidth !== undefined) args.push(opts.hueWidth)
		if (opts.minSaturation !== undefined) args.push(opts.minSaturation)
		if (opts.minBrightness !== undefined) args.push(opts.minBrightness)
		if (opts.softness !== undefined) args.push(opts.softness)
		if (opts.spillSuppress !== undefined) args.push(opts.spillSuppress)
		if (opts.spillSuppressSaturation !== undefined) args.push(opts.spillSuppressSaturation)
		if (opts.showMask !== undefined) args.push(opts.showMask ? '1' : '0')
		
		if (args.length > 0) p += ' ' + args.join(' ')
		return this._mixer(channel, layer, `CHROMA ${p}`)
	}

	mixerBlend(channel, layer, mode) {
		if (mode === undefined) return this._mixer(channel, layer, 'BLEND')
		const cl = chLayer(channel, layer)
		return this._client._invokeTyped(
			'mixerBlend',
			{ channel: Number(channel), layer: Number(layer), value: mode },
			`MIXER ${cl} BLEND ${param(mode)}`,
			'MIXER',
		)
	}

	mixerInvert(channel, layer, invert) {
		if (invert === undefined) return this._mixer(channel, layer, 'INVERT')
		const cl = chLayer(channel, layer)
		return this._client._invokeTyped(
			'mixerInvert',
			{ channel: Number(channel), layer: Number(layer), value: !!invert },
			`MIXER ${cl} INVERT ${invert ? 1 : 0}`,
			'MIXER',
		)
	}

	mixerOpacity(channel, layer, opacity, duration, tween, defer) {
		return this._mixerDeferNumber('mixerOpacity', 'OPACITY', channel, layer, opacity, duration, tween, defer)
	}

	mixerBrightness(channel, layer, val, duration, tween, defer) {
		return this._mixerDeferNumber('mixerBrightness', 'BRIGHTNESS', channel, layer, val, duration, tween, defer)
	}

	mixerSaturation(channel, layer, val, duration, tween, defer) {
		return this._mixerDeferNumber('mixerSaturation', 'SATURATION', channel, layer, val, duration, tween, defer)
	}

	mixerContrast(channel, layer, val, duration, tween, defer) {
		return this._mixerDeferNumber('mixerContrast', 'CONTRAST', channel, layer, val, duration, tween, defer)
	}

	/**
	 * @param {number} channel
	 * @param {number} [layer]
	 * @param {import('./amcp-types').MixerLevelsOptions} [opts]
	 */
	mixerLevels(channel, layer, opts) {
		if (opts === undefined) return this._mixer(channel, layer, 'LEVELS')
		let p = `${opts.minInput} ${opts.maxInput} ${opts.gamma} ${opts.minOutput} ${opts.maxOutput}`
		if (opts.duration != null) p += ` ${opts.duration}`
		if (opts.tween) p += ` ${param(opts.tween)}`
		if (opts.defer) p += ' DEFER'
		return this._mixer(channel, layer, `LEVELS ${p}`)
	}

	mixerFill(channel, layer, x, y, xScale, yScale, duration, tween, defer) {
		if (x === undefined) return this._mixer(channel, layer, 'FILL')
		let p = `${x} ${y} ${xScale} ${yScale}`
		if (duration != null) p += ` ${duration}`
		if (tween) p += ` ${param(tween)}`
		if (defer) p += ' DEFER'
		return this._mixer(channel, layer, `FILL ${p}`)
	}

	mixerClip(channel, layer, x, y, xScale, yScale, duration, tween, defer) {
		if (x === undefined) return this._mixer(channel, layer, 'CLIP')
		let p = `${x} ${y} ${xScale} ${yScale}`
		if (duration != null) p += ` ${duration}`
		if (tween) p += ` ${param(tween)}`
		if (defer) p += ' DEFER'
		return this._mixer(channel, layer, `CLIP ${p}`)
	}

	mixerAnchor(channel, layer, x, y, duration, tween, defer) {
		if (x === undefined) return this._mixer(channel, layer, 'ANCHOR')
		let p = `${x} ${y}`
		if (duration != null) p += ` ${duration}`
		if (tween) p += ` ${param(tween)}`
		if (defer) p += ' DEFER'
		return this._mixer(channel, layer, `ANCHOR ${p}`)
	}

	mixerCrop(channel, layer, left, top, right, bottom, duration, tween, defer) {
		if (left === undefined) return this._mixer(channel, layer, 'CROP')
		let p = `${left} ${top} ${right} ${bottom}`
		if (duration != null) p += ` ${duration}`
		if (tween) p += ` ${param(tween)}`
		if (defer) p += ' DEFER'
		return this._mixer(channel, layer, `CROP ${p}`)
	}

	mixerRotation(channel, layer, degrees, duration, tween, defer) {
		if (degrees === undefined) return this._mixer(channel, layer, 'ROTATION')
		let p = String(degrees)
		if (duration != null) p += ` ${duration}`
		if (tween) p += ` ${param(tween)}`
		if (defer) p += ' DEFER'
		return this._mixer(channel, layer, `ROTATION ${p}`)
	}

	mixerPerspective(channel, layer, nwX, nwY, neX, neY, swX, swY, seX, seY, duration, tween, defer) {
		if (nwX === undefined) return this._mixer(channel, layer, 'PERSPECTIVE')
		let p = `${nwX} ${nwY} ${neX} ${neY} ${swX} ${swY} ${seX} ${seY}`
		if (duration != null) p += ` ${duration}`
		if (tween) p += ` ${param(tween)}`
		if (defer) p += ' DEFER'
		return this._mixer(channel, layer, `PERSPECTIVE ${p}`)
	}

	mixerMipmap(channel, layer, enabled) {
		if (enabled === undefined) return this._mixer(channel, layer, 'MIPMAP')
		return this._mixer(channel, layer, `MIPMAP ${enabled ? 1 : 0}`)
	}

	mixerVolume(channel, layer, volume, duration, tween, defer) {
		if (volume === undefined) return this._mixer(channel, layer, 'VOLUME')
		let p = String(volume)
		if (duration != null) p += ` ${duration}`
		if (tween) p += ` ${param(tween)}`
		if (defer) p += ' DEFER'
		return this._mixer(channel, layer, `VOLUME ${p}`)
	}

	mixerMastervolume(channel, volume, duration, tween, defer) {
		if (volume === undefined) return this._send(`MIXER ${parseInt(channel, 10)} MASTERVOLUME`, 'MIXER')
		let p = String(volume)
		if (duration != null) p += ` ${duration}`
		if (tween) p += ` ${param(tween)}`
		if (defer) p += ' DEFER'
		return this._send(`MIXER ${parseInt(channel, 10)} MASTERVOLUME ${p}`, 'MIXER')
	}

	mixerStraightAlphaOutput(channel, enable) {
		if (enable === undefined) return this._send(`MIXER ${parseInt(channel, 10)} STRAIGHT_ALPHA_OUTPUT`, 'MIXER')
		return this._send(`MIXER ${parseInt(channel, 10)} STRAIGHT_ALPHA_OUTPUT ${enable ? 1 : 0}`, 'MIXER')
	}

	mixerGrid(channel, resolution, duration, tween, defer) {
		let p = String(parseInt(resolution, 10))
		if (duration != null) p += ` ${duration}`
		if (tween) p += ` ${param(tween)}`
		if (defer) p += ' DEFER'
		return this._send(`MIXER ${parseInt(channel, 10)} GRID ${p}`, 'MIXER')
	}

	mixerCommit(channel) {
		const ch = parseInt(channel, 10)
		return this._client._invokeTyped('mixerCommit', { channel: ch }, `MIXER ${ch} COMMIT`, 'MIXER')
	}

	mixerClear(channel, layer) {
		if (layer === undefined || layer === null || layer === '') {
			return this._mixer(channel, layer, 'CLEAR')
		}
		const cl = chLayer(channel, layer)
		return this._client._invokeTyped(
			'mixerClear',
			{ channel: Number(channel), layer: Number(layer) },
			`MIXER ${cl} CLEAR`,
			'MIXER',
		)
	}

	channelGrid() {
		return this._client._invokeTyped('channelGrid', {}, 'CHANNEL_GRID', 'CHANNEL_GRID')
	}
}

module.exports = { AmcpMixer }
