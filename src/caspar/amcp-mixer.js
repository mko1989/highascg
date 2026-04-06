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

	mixerKeyer(channel, layer, keyer) {
		if (keyer === undefined) return this._mixer(channel, layer, 'KEYER')
		return this._mixer(channel, layer, `KEYER ${keyer ? 1 : 0}`)
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
		return this._mixer(channel, layer, `BLEND ${param(mode)}`)
	}

	mixerInvert(channel, layer, invert) {
		if (invert === undefined) return this._mixer(channel, layer, 'INVERT')
		return this._mixer(channel, layer, `INVERT ${invert ? 1 : 0}`)
	}

	mixerOpacity(channel, layer, opacity, duration, tween, defer) {
		if (opacity === undefined) return this._mixer(channel, layer, 'OPACITY')
		let p = String(opacity)
		if (duration != null) p += ` ${duration}`
		if (tween) p += ` ${param(tween)}`
		if (defer) p += ' DEFER'
		return this._mixer(channel, layer, `OPACITY ${p}`)
	}

	mixerBrightness(channel, layer, val, duration, tween, defer) {
		if (val === undefined) return this._mixer(channel, layer, 'BRIGHTNESS')
		let p = String(val)
		if (duration != null) p += ` ${duration}`
		if (tween) p += ` ${param(tween)}`
		if (defer) p += ' DEFER'
		return this._mixer(channel, layer, `BRIGHTNESS ${p}`)
	}

	mixerSaturation(channel, layer, val, duration, tween, defer) {
		if (val === undefined) return this._mixer(channel, layer, 'SATURATION')
		let p = String(val)
		if (duration != null) p += ` ${duration}`
		if (tween) p += ` ${param(tween)}`
		if (defer) p += ' DEFER'
		return this._mixer(channel, layer, `SATURATION ${p}`)
	}

	mixerContrast(channel, layer, val, duration, tween, defer) {
		if (val === undefined) return this._mixer(channel, layer, 'CONTRAST')
		let p = String(val)
		if (duration != null) p += ` ${duration}`
		if (tween) p += ` ${param(tween)}`
		if (defer) p += ' DEFER'
		return this._mixer(channel, layer, `CONTRAST ${p}`)
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
		return this._send(`MIXER ${parseInt(channel, 10)} COMMIT`, 'MIXER')
	}

	mixerClear(channel, layer) {
		return this._mixer(channel, layer, 'CLEAR')
	}

	channelGrid() {
		return this._send('CHANNEL_GRID', 'CHANNEL_GRID')
	}
}

module.exports = { AmcpMixer }
