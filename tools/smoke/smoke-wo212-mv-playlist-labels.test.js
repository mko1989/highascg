const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../');

test('WO-212: Multiview playlist labels smoke tests', async (t) => {
	await t.test('T212.1: Editor dock width fixed to full-width (rect.lw - 16)', async () => {
		const editorFile = path.join(repoRoot, 'client/components/multiview-editor-canvas-draw.js');
		const content = fs.readFileSync(editorFile, 'utf8');

		// Must contain the new formula
		assert.match(content, /rect\.lw - 16/, 'Editor should have full-width dock formula (rect.lw - 16)');

		// Should NOT contain the old centered formula with 0.5
		assert.doesNotMatch(content, /rect\.lw \* 0\.5/, 'Editor should not have old centered dock formula (rect.lw * 0.5)');
	});

	await t.test('T212.2a: Master template contains playlist-aware label branch', async () => {
		const masterFile = path.join(repoRoot, 'template/multiview_master.html');
		const content = fs.readFileSync(masterFile, 'utf8');

		// Must have playlistAdvance check and arrow operator
		assert.match(content, /playlistAdvance/, 'Master template should check playlistAdvance');
		assert.match(content, /\s->\s/, 'Master template should have arrow label (-> )');
		assert.match(content, /buildPlaylistRowLabel/, 'Master template should have buildPlaylistRowLabel function');
		// Updated signature includes friendlyRouteLabel and channelMap (WO-223)
		assert.match(content, /function buildPlaylistRowLabel\(num, layer, oscPlayingName, getSourceBasename, friendlyRouteLabel, channelMap\)/, 'Master template should have buildPlaylistRowLabel function with updated signature');
	});

	await t.test('T212.2b: Overlay template contains playlist-aware label branch', async () => {
		const overlayFile = path.join(repoRoot, 'template/multiview_overlay.js');
		const content = fs.readFileSync(overlayFile, 'utf8');

		// Must have playlistAdvance check and arrow operator
		assert.match(content, /playlistAdvance/, 'Overlay template should check playlistAdvance');
		assert.match(content, /\s->\s/, 'Overlay template should have arrow label (-> )');
		assert.match(content, /buildPlaylistRowLabel/, 'Overlay template should have buildPlaylistRowLabel function');
		// Updated signature includes friendlyRouteLabel and channelMap (WO-223)
		assert.match(content, /function buildPlaylistRowLabel\(num, layer, oscPlayingName, getSourceBasename, friendlyRouteLabel, channelMap\)/, 'Overlay template should have buildPlaylistRowLabel function with updated signature');
	});

	await t.test('T212.3: buildPlaylistRowLabel function logic', async () => {
		const masterFile = path.join(repoRoot, 'template/multiview_master.html');
		const masterContent = fs.readFileSync(masterFile, 'utf8');

		// Extract the function from the template script tag
		const scriptMatch = masterContent.match(/<script>([\s\S]*?)<\/script>/);
		assert(scriptMatch && scriptMatch[1], 'Master template should have a <script> tag');

		const scriptContent = scriptMatch[1];
		const funcMatch = scriptContent.match(/function buildPlaylistRowLabel\([\s\S]*?\n\t\t\}/);
		assert(funcMatch && funcMatch[0], 'Function should be extractable from master template');

		// Create a test executor function
		const funcCode = funcMatch[0];

		// Create getSourceBasename and friendlyRouteLabel for the test
		const getSourceBasename = (sourceValue) => {
			if (!sourceValue) return '';
			const src = String(sourceValue);
			const parts = src.split(/[\\/]/);
			const last = parts[parts.length - 1] || '';
			return last.replace(/\.[^.]*$/, '');
		};

		const friendlyRouteLabel = (sourceValue, channelMap) => {
			if (!sourceValue) return '';
			const src = String(sourceValue);
			if (!src.startsWith('route://')) return '';
			const routePart = src.substring(8);
			const parts = routePart.split('-');
			const channelNum = parseInt(parts[0], 10);
			if (!Number.isFinite(channelNum)) return '';
			if (channelMap && Array.isArray(channelMap.programChannels)) {
				const idx = channelMap.programChannels.indexOf(channelNum);
				if (idx !== -1) {
					const screenLabel = channelMap.screenLabels?.[idx] || `PGM${idx + 1}`;
					return screenLabel;
				}
			}
			if (channelMap && Array.isArray(channelMap.previewChannels)) {
				const idx = channelMap.previewChannels.indexOf(channelNum);
				if (idx !== -1) return `PRV${idx + 1}`;
			}
			return `Route ch ${channelNum}`;
		};

		// Use Function constructor to create and test the function
		const testFunc = new Function('getSourceBasename', 'friendlyRouteLabel', `
${funcCode}
return buildPlaylistRowLabel;
		`);

		const buildPlaylistRowLabel = testFunc(getSourceBasename, friendlyRouteLabel);

		// Test 1: Non-playlist layer
		const nonPlaylistLayer = {
			sourceMode: 'normal',
			source: { value: 'some_template.html' }
		};
		const result1 = buildPlaylistRowLabel(5, nonPlaylistLayer, null, getSourceBasename, friendlyRouteLabel, {});
		assert.equal(result1, 'L5 some_template', 'Non-playlist layer should return standard label');

		// Test 2: Playlist with middle item
		const playlistLayer = {
			sourceMode: 'list',
			source: { value: 'file1.mov' },
			playlist: [
				{ value: 'file1.mov' },
				{ value: 'file2.mov' },
				{ value: 'file3.mov' }
			],
			playlistAdvance: 'auto',
			playlistLoop: true
		};
		const result2 = buildPlaylistRowLabel(10, playlistLayer, 'file2', getSourceBasename, friendlyRouteLabel, {});
		assert.equal(result2, 'L10 file2 -> file3', 'Middle item should show arrow to next');

		// Test 3: Last item with loop
		const result3 = buildPlaylistRowLabel(10, playlistLayer, 'file3', getSourceBasename, friendlyRouteLabel, {});
		assert.equal(result3, 'L10 file3 -> file1', 'Last item with loop should wrap to first');

		// Test 4: Last item without loop
		const noLoopLayer = {
			sourceMode: 'list',
			source: { value: 'file1.mov' },
			playlist: [
				{ value: 'file1.mov' },
				{ value: 'file2.mov' },
				{ value: 'file3.mov' }
			],
			playlistAdvance: 'auto',
			playlistLoop: false
		};
		const result4 = buildPlaylistRowLabel(10, noLoopLayer, 'file3', getSourceBasename, friendlyRouteLabel, {});
		assert.equal(result4, 'L10 file3', 'Last item without loop should not show arrow');

		// Test 5: OSC name not in playlist, fallback to first
		const result5 = buildPlaylistRowLabel(10, playlistLayer, 'unknown', getSourceBasename, friendlyRouteLabel, {});
		assert.equal(result5, 'L10 file1 -> file2', 'Unknown OSC name should fallback to first item');

		// Test 6: Manual advance mode (should not use playlist label)
		const manualAdvanceLayer = {
			sourceMode: 'list',
			source: { value: 'file1.mov' },
			playlist: [
				{ value: 'file1.mov' },
				{ value: 'file2.mov' }
			],
			playlistAdvance: 'manual',
			playlistLoop: true
		};
		const result6 = buildPlaylistRowLabel(10, manualAdvanceLayer, 'file1', getSourceBasename, friendlyRouteLabel, {});
		assert.equal(result6, 'L10 file1', 'Manual advance mode should use standard label');
	});
});
