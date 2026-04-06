'use strict'

/**
 * @typedef {Object} PlayOptions
 * @property {boolean} [loop]
 * @property {'CUT'|'MIX'|'PUSH'|'WIPE'|'SLIDE'|'STING'} [transition]
 * @property {number} [duration] - Transition duration in frames
 * @property {string} [tween] - Tween function name
 * @property {'LEFT'|'RIGHT'} [direction]
 * @property {number} [seek] - Start frame
 * @property {number} [length] - Number of frames
 * @property {string} [filter] - FFmpeg video filter
 * @property {string} [audioFilter] - FFmpeg audio filter (AF)
 * @property {boolean} [auto] - Auto-play when FG ends
 * @property {string} [parameters] - Extra raw parameters
 */

/**
 * @typedef {Object} MixerChromaOptions
 * @property {boolean} [enable]
 * @property {number} [targetHue]
 * @property {number} [hueWidth]
 * @property {number} [minSaturation]
 * @property {number} [minBrightness]
 * @property {number} [softness]
 * @property {number} [spillSuppress]
 * @property {number} [spillSuppressSaturation]
 * @property {number} [showMask]
 */

/**
 * @typedef {Object} MixerLevelsOptions
 * @property {number} minInput
 * @property {number} maxInput
 * @property {number} gamma
 * @property {number} minOutput
 * @property {number} maxOutput
 * @property {number} [duration]
 * @property {string} [tween]
 */

module.exports = {}
