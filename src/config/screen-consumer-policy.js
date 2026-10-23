'use strict'

/**
 * WO-716 / WO-717 — the screen-consumer policy, the ONE place it lives: every Caspar `<screen>` consumer
 * runs with vsync OFF and gpu-texture ON. Neither is a setting (owner 23.10.26: "vsync and GPU texture
 * always follow best practice, and don't change even on the template iso").
 *
 * - vsync off: NVIDIA spin-waits in glXSwapBuffers on the consumer thread (~78 % of a core per consumer,
 *   WO-715 A/B); frame pacing is GL sync (CASPAR_GL_SYNC_DISPLAY, WO-407/444).
 * - gpu-texture on: the consumer binds the mixer's texture instead of a per-frame host copy + re-upload on
 *   Caspar's single shared GL thread (WO-502: 93.6 % → 100.3 % of realtime).
 *
 * The generator writes both lines itself (config-generator-screen-xml.js). {@link enforceScreenConsumerPolicy}
 * is the backstop for every XML that did NOT come from the generator: the config editor's one-shot XML, a
 * saved casparConfigOverride, a project bundle's stored casparcg.config, the ISO template, a stick restore, a
 * hand edit — run.sh applies it to the file before every Caspar launch
 * (tools/runtime/enforce-screen-consumer-policy.js).
 */

const SCREEN_VSYNC_XML = '<vsync>false</vsync>'
const SCREEN_GPU_TEXTURE_XML = '<gpu-texture>true</gpu-texture>'

/**
 * @param {string} block one `<screen>…</screen>` element
 * @param {string} tag
 * @param {string} line the policy line for that tag
 */
function forceTag(block, tag, line) {
	const re = new RegExp(`<${tag}\\s*>[^<]*</${tag}\\s*>|<${tag}\\s*/>`, 'g')
	if (block.match(re)) return block.replace(re, line)
	// Missing: insert before </screen>, indented like the element's last child line.
	const indent = (block.match(/\n([ \t]*)<[^/][^\n]*\n[ \t]*<\/screen>\s*$/) || [])[1]
	return indent == null
		? block.replace(/<\/screen>\s*$/, `${line}</screen>`)
		: block.replace(/(\n)([ \t]*)<\/screen>\s*$/, `$1${indent}${line}$1$2</screen>`)
}

/**
 * Force the policy onto every `<screen>` consumer in a Caspar config. XML comments are left alone (a
 * commented-out consumer is not a consumer). Idempotent; everything outside `<screen>` is byte-identical.
 * @param {string} xml
 * @returns {{ xml: string, changed: boolean, screens: number }}
 */
function enforceScreenConsumerPolicy(xml) {
	if (typeof xml !== 'string' || !xml.includes('<screen')) return { xml, changed: false, screens: 0 }
	let screens = 0
	const out = xml.replace(/<!--[\s\S]*?-->|<screen\s*>[\s\S]*?<\/screen\s*>/g, (m) => {
		if (m.startsWith('<!--')) return m
		screens++
		return forceTag(forceTag(m, 'vsync', SCREEN_VSYNC_XML), 'gpu-texture', SCREEN_GPU_TEXTURE_XML)
	})
	return { xml: out, changed: out !== xml, screens }
}

module.exports = { SCREEN_VSYNC_XML, SCREEN_GPU_TEXTURE_XML, enforceScreenConsumerPolicy }
