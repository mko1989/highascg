'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { assessFollowerCasparOutputReadiness } = require('../../src/replication/follower-caspar-output')

test('follower caspar output warns when DeckLink device set but SDI format unresolved', () => {
	const tmpCaspar = path.join(os.tmpdir(), `caspar-test-${process.pid}.config`)
	fs.writeFileSync(
		tmpCaspar,
		`<!-- Caspar channel 1: Screen 1 program output (PGM) -->
        <channel>
            <consumers><screen/></consumers>
        </channel>`,
	)

	const mod = require('../../src/replication/follower-caspar-output')
	const origPath = mod.CASPAR_CONFIG_PATH
	Object.defineProperty(mod, 'CASPAR_CONFIG_PATH', { value: tmpCaspar, configurable: true })

	const ctx = {
		config: {
			screen_count: 1,
			casparServer: {
				screen_count: 1,
				screen_1_decklink_device: 3,
				screen_1_decklink_replace_screen: true,
				screen_1_mode: 'custom',
				screen_1_width: 3072,
				screen_1_height: 1728,
				screen_1_fps: 50,
			},
			screenDestinations: [{ id: 'm1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: 'custom', width: 3072, height: 1728, fps: 50 }],
			deviceGraph: {
				connectors: [
					{
						id: 'dlsdi_3',
						externalRef: 3,
						caspar: { ioDirection: 'out', outputBinding: { type: 'screen', index: 1 } },
					},
				],
				edges: [],
			},
			replication: { enabled: true, role: 'follower' },
		},
		_replication: { roleState: { getRole: () => 'follower' } },
	}

	try {
		const st = assessFollowerCasparOutputReadiness(ctx)
		assert.equal(st.ok, false)
		assert.ok(
			st.warnings.some(
				(w) => w.code === 'decklink_sdi_format_missing' || w.code === 'decklink_missing_from_caspar_config',
			),
		)
	} finally {
		Object.defineProperty(mod, 'CASPAR_CONFIG_PATH', { value: origPath, configurable: true })
		fs.unlinkSync(tmpCaspar)
	}
})
