'use strict'

/**
 * WO-1106 B67 — the ISO verifier (tools/eggs/live-usb/verify-iso-redistribution.sh) fails an image that carries a
 * NonCommercial shader template:
 *   - by path: the withdrawn ids, needle built from template/shaders/LICENSES/withdrawn-nc.json (one list, not two);
 *   - by content: any template whose attribution header names an NC licence, under any id (the store's own rule via
 *     tools/shaders/check-shipped-templates.js — a dual-licensed helper snippet lower down does not count);
 *   - the shipped templates pass. With mksquashfs installed the checks run against real squashfs images.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const VERIFY = path.join(ROOT, 'tools/eggs/live-usb/verify-iso-redistribution.sh')
const lic = require('../../src/shaderfx/shader-licence')
const { buildShaderTemplateHtml } = require('../../src/shaderfx/shader-template-export')
const { normalizeShaderConfig } = require('../../src/shaderfx/shader-store')

const SHADERS = 'home/casparcg/highascg/template/shaders'
const SRC = 'void mainImage(out vec4 o, in vec2 f) { o = vec4(1.0); }'
const ncHtml = (id) =>
	buildShaderTemplateHtml(
		normalizeShaderConfig({
			id,
			name: id,
			passes: {
				image: {
					source:
						lic.buildShaderHeader({ title: 't', author: 'a', url: 'https://www.shadertoy.com/view/x', licence: 'CC-BY-NC-4.0' }) + SRC,
				},
			},
			audio: { enabled: false },
		})
	)

describe('WO-1106 B67: NonCommercial shader templates on an ISO', () => {
	const sh = fs.readFileSync(VERIFY, 'utf8')

	it('the needle is built from the withdrawn record and both checks run in redistribution_check', () => {
		assert.match(sh, /SHADER_NC_RECORD=.*template\/shaders\/LICENSES\/withdrawn-nc\.json/)
		assert.match(sh, /^\tshader_nc_check "\$listing"$/m)
		assert.match(sh, /tools\/shaders\/check-shipped-templates\.js/)
		const needle = execFileSync('bash', ['-c', `source "${VERIFY}"; shader_nc_needle`], { encoding: 'utf8' })
		const re = new RegExp(needle)
		for (const e of JSON.parse(fs.readFileSync(lic.WITHDRAWN_NC_FILE, 'utf8')).withdrawn)
			assert.ok(re.test(`home/casparcg/highascg/template/shaders/${e.id}.html`), e.id)
		assert.equal(re.test(`${SHADERS}/sh-triangle.html`), false, 'a shipped shader is not a needle hit')
		assert.equal(re.test(`${SHADERS}/sh-sa-ribbons.html.bak`), false)
	})

	const haveMksquashfs = spawnSync('mksquashfs', ['-version']).status === 0
	it('a squashed image with the shipped templates passes; withdrawn or NC ones fail', { skip: !haveMksquashfs && 'no mksquashfs' }, () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1106-b67-'))
		try {
			const tree = path.join(dir, 'tree')
			const tpl = path.join(tree, SHADERS)
			fs.mkdirSync(tpl, { recursive: true })
			for (const f of ['sh-triangle.html', 'sh-fft-test.html', 'player.js'])
				fs.copyFileSync(path.join(ROOT, 'template/shaders', f), path.join(tpl, f))
			const sq = (out) => execFileSync('mksquashfs', [tree, out, '-quiet', '-noappend', '-no-progress'])
			const b67 = (img) => {
				const r = spawnSync('bash', [VERIFY, img], { encoding: 'utf8' })
				return `${r.stdout}\n${r.stderr}`.split('\n').filter((l) => /B67/.test(l))
			}
			sq(path.join(dir, 'good.sq'))
			const good = b67(path.join(dir, 'good.sq'))
			assert.ok(good.length >= 2, good.join('\n'))
			assert.ok(good.every((l) => l.startsWith('OK:')), good.join('\n'))
			assert.ok(good.some((l) => /none of the 2 shader templates is NonCommercial/.test(l)), good.join('\n'))

			fs.writeFileSync(path.join(tpl, 'sh-sa-ribbons.html'), '<html>stale</html>')
			sq(path.join(dir, 'withdrawn.sq'))
			const w = b67(path.join(dir, 'withdrawn.sq'))
			assert.ok(w.some((l) => /^FAIL: .*withdrawn NonCommercial shader templates: .*sh-sa-ribbons\.html/.test(l)), w.join('\n'))
			fs.rmSync(path.join(tpl, 'sh-sa-ribbons.html'))

			fs.writeFileSync(path.join(tpl, 'sh-my-import.html'), ncHtml('sh-my-import'))
			sq(path.join(dir, 'nc.sq'))
			const n = b67(path.join(dir, 'nc.sq'))
			assert.ok(n.some((l) => /^FAIL: .*must not ship: .*sh-my-import\.html:non-commercial licence CC-BY-NC-4\.0/.test(l)), n.join('\n'))
			assert.ok(!n.some((l) => /sh-triangle/.test(l)), 'the dual-licensed helper snippet in sh-triangle is no hit')
			assert.ok(n.some((l) => /^OK: absent \(WO-1106 B67\): withdrawn/.test(l)), 'an unlisted id is caught by content only')
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})
})
