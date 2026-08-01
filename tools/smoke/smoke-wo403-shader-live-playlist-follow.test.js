/**
 * WO-403 — Shader Live editor vs playlists (issues_01.08.26 item 1).
 *
 * scene.live keeps a playlist layer's AUTHORED source.value across engine-side hops, so the
 * editor listed the first shader forever and its 403→CG ADD re-host visibly replayed it over
 * whatever was actually on air. liveShaderInstances now resolves playlist layers through a
 * `playlistNow` map (active item per live playlist layer, polled from GET /api/playlist/state).
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

function fakeStore() {
	return {
		getState: () => ({
			channelMap: { previewChannels: [2] },
			scene: {
				live: {
					1: {
						scene: {
							id: 'look-1',
							name: 'Shader loop',
							layers: [
								{
									layerNumber: 10,
									sourceMode: 'list',
									playlist: [
										{ value: 'templates/shaders/sh-alpha', duration: 5 },
										{ value: 'templates/shaders/sh-beta', duration: 5 },
									],
									source: { value: 'templates/shaders/sh-alpha' },
								},
							],
						},
					},
				},
				programLayerBankByChannel: {},
			},
		}),
	}
}

test('WO-403: a playlist layer resolves to the item actually on air', async () => {
	const { liveShaderInstances } = await import('../../client/lib/shader-live-instances.js')

	// Without playlistNow the authored value stands (pre-hop / poll not landed yet).
	const before = liveShaderInstances(fakeStore())
	assert.equal(before.length, 1)
	assert.equal(before[0].shaderId, 'sh-alpha')

	// After a hop the tracker map points the layer at item 2 — the instance (and the cgName the
	// 403→CG ADD re-host replays) must follow, or an edit replays sh-alpha over sh-beta on air.
	const after = liveShaderInstances(fakeStore(), { '1-10': 'templates/shaders/sh-beta' })
	assert.equal(after.length, 1)
	assert.equal(after[0].shaderId, 'sh-beta')
	assert.equal(after[0].cgName, 'templates/shaders/sh-beta')
	assert.equal(after[0].channel, 1)
	assert.equal(after[0].pLayer, 10)
})

test('WO-403: a non-shader active item withdraws the instance; other keys do not leak', async () => {
	const { liveShaderInstances } = await import('../../client/lib/shader-live-instances.js')
	// The playlist hopped onto a video — no shader is live on that layer now.
	assert.equal(liveShaderInstances(fakeStore(), { '1-10': 'AMB.mp4' }).length, 0)
	// A map entry for a DIFFERENT layer must not override this one.
	assert.equal(liveShaderInstances(fakeStore(), { '1-20': 'templates/shaders/sh-beta' })[0].shaderId, 'sh-alpha')
})

test('WO-403: the editor wires the tracker and follows the layer across hops (source asserts)', () => {
	const editor = read('client/components/shader-live-editor.js')
	assert.match(editor, /createPlaylistNowTracker\(api, \(\) => onLiveChanged\(\)\)/, 'tracker change feeds the same re-render path as state ticks')
	assert.match(editor, /liveShaderInstances\(stateStore, _plNow\.now\(\)\)/, 'instances resolve through the tracker map')
	assert.match(editor, /_plNow\.start\(\)[\s\S]{0,200}_plNow\.stop\(\)/, 'poll runs only while the overlay is open')
	assert.match(editor, /keyOf\(i\)\.endsWith\(`@\$\{tail\}`\)/, 'selection follows the channel-layer, never snaps to list[0] on a hop')

	const lib = read('client/lib/shader-live-instances.js')
	assert.match(lib, /\/api\/playlist\/state/, 'the tracker polls the same endpoint as the Playlists panel')
})
