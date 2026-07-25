const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../');

function masterScriptSource() {
	return (
		fs.readFileSync(path.join(repoRoot, 'template/multiview_master.js'), 'utf8') +
		fs.readFileSync(path.join(repoRoot, 'template/multiview_master-labels.js'), 'utf8')
	);
}

test('WO-223: Multiview route-label friendly names smoke tests', async (t) => {
	await t.test('T223.1a: Master template contains friendlyRouteLabel function', async () => {
		const content = masterScriptSource();

		// Must contain the function definition
		assert.match(content, /function friendlyRouteLabel\(sourceValue, channelMap\)/, 'Master should have friendlyRouteLabel function');
		assert.match(content, /route:\/\//, 'Master should check for route:// protocol');
		assert.match(content, /programChannels/, 'Master should check programChannels');
		assert.match(content, /previewChannels/, 'Master should check previewChannels');
	});

	await t.test('T223.1b: Overlay template contains friendlyRouteLabel function', async () => {
		const overlayFile = path.join(repoRoot, 'template/multiview_overlay.js');
		const content = fs.readFileSync(overlayFile, 'utf8');

		// Must contain the function definition
		assert.match(content, /function friendlyRouteLabel\(sourceValue, channelMap\)/, 'Overlay should have friendlyRouteLabel function');
		assert.match(content, /route:\/\//, 'Overlay should check for route:// protocol');
		assert.match(content, /programChannels/, 'Overlay should check programChannels');
		assert.match(content, /previewChannels/, 'Overlay should check previewChannels');
	});

	await t.test('T223.2a: Parity check - friendlyRouteLabel function bodies match', async () => {
		const overlayFile = path.join(repoRoot, 'template/multiview_overlay.js');

		const masterContent = masterScriptSource();
		const overlayContent = fs.readFileSync(overlayFile, 'utf8');

		// Extract friendlyRouteLabel functions from both files
		const masterMatch = masterContent.match(/function friendlyRouteLabel\(sourceValue, channelMap\)\s*\{[\s\S]*?\n\t\t\}/);
		const overlayMatch = overlayContent.match(/function friendlyRouteLabel\(sourceValue, channelMap\)\s*\{[\s\S]*?\n\t\t\}/);

		assert(masterMatch && masterMatch[0], 'Master should have extractable friendlyRouteLabel function');
		assert(overlayMatch && overlayMatch[0], 'Overlay should have extractable friendlyRouteLabel function');

		const masterFunc = masterMatch[0];
		const overlayFunc = overlayMatch[0];

		assert.strictEqual(masterFunc, overlayFunc, 'friendlyRouteLabel functions must be byte-identical in master and overlay');
	});

	await t.test('T223.2b: Parity check - buildPlaylistRowLabel calls use friendlyRouteLabel', async () => {
		const overlayFile = path.join(repoRoot, 'template/multiview_overlay.js');

		const masterContent = masterScriptSource();
		const overlayContent = fs.readFileSync(overlayFile, 'utf8');

		// Check that both have updated buildPlaylistRowLabel signature
		assert.match(masterContent, /function buildPlaylistRowLabel\(num, layer, oscPlayingName, getSourceBasename, friendlyRouteLabel, channelMap\)/, 'Master buildPlaylistRowLabel must have new signature');
		assert.match(overlayContent, /function buildPlaylistRowLabel\(num, layer, oscPlayingName, getSourceBasename, friendlyRouteLabel, channelMap\)/, 'Overlay buildPlaylistRowLabel must have new signature');

		// Check that both call buildPlaylistRowLabel with the new parameters
		assert.match(masterContent, /buildPlaylistRowLabel\(num, layer, oscPlayingName, getSourceBasename, friendlyRouteLabel, channelMap\)/, 'Master must call buildPlaylistRowLabel with friendlyRouteLabel');
		assert.match(overlayContent, /buildPlaylistRowLabel\(num, layer, oscPlayingName, getSourceBasename, friendlyRouteLabel, channelMap\)/, 'Overlay must call buildPlaylistRowLabel with friendlyRouteLabel');
	});

	await t.test('T223.3: friendlyRouteLabel function logic - unit tests', async () => {
		const scriptContent = masterScriptSource();

		const funcMatch = scriptContent.match(/function friendlyRouteLabel\(sourceValue, channelMap\)\s*\{[\s\S]*?\n\t\t\}/);
		assert(funcMatch && funcMatch[0], 'Function should be extractable from master template');

		const funcCode = funcMatch[0];

		// Use Function constructor to create and test the function
		const testFunc = new Function(`
${funcCode}
return friendlyRouteLabel;
		`);

		const friendlyRouteLabel = testFunc();

		// Test 1: Non-route source
		const result1 = friendlyRouteLabel('some_template.html', {});
		assert.strictEqual(result1, '', 'Non-route source should return empty string');

		// Test 2: Empty source
		const result2 = friendlyRouteLabel('', {});
		assert.strictEqual(result2, '', 'Empty source should return empty string');

		// Test 3: route source in programChannels
		const channelMap3 = {
			programChannels: [1, 2, 3],
			screenLabels: ['Main', 'Secondary', 'Tertiary']
		};
		const result3 = friendlyRouteLabel('route://2', channelMap3);
		assert.strictEqual(result3, 'Secondary', 'route://2 should map to screenLabels[1] = Secondary');

		// Test 4: route source in programChannels without screenLabels
		const channelMap4 = {
			programChannels: [1, 2, 3]
		};
		const result4 = friendlyRouteLabel('route://2', channelMap4);
		assert.strictEqual(result4, 'PGM2', 'route://2 should fallback to PGM2 when screenLabels absent');

		// Test 5: route source in previewChannels
		const channelMap5 = {
			programChannels: [1, 2],
			previewChannels: [5, 6, 7]
		};
		const result5 = friendlyRouteLabel('route://6', channelMap5);
		assert.strictEqual(result5, 'PRV2', 'route://6 should map to PRV2 (index 1 in previewChannels)');

		// Test 6: Unknown route channel (fallback)
		const channelMap6 = {
			programChannels: [1, 2],
			previewChannels: [5, 6]
		};
		const result6 = friendlyRouteLabel('route://99', channelMap6);
		assert.strictEqual(result6, 'Route ch 99', 'Unknown channel should fallback to Route ch 99');

		// Test 7: route with layer (should still parse N correctly)
		const channelMap7 = {
			programChannels: [1, 2, 3]
		};
		const result7 = friendlyRouteLabel('route://1-10', channelMap7);
		assert.strictEqual(result7, 'PGM1', 'route://1-10 should extract channel 1 and return PGM1');

		// Test 8: Invalid route format (non-numeric)
		const result8 = friendlyRouteLabel('route://abc', {});
		assert.strictEqual(result8, '', 'Non-numeric route should return empty string');
	});

	await t.test('T223.4: Master template script syntax check', async () => {
		const scriptContent = masterScriptSource();

		// Write to temp file for syntax checking
		const tempFile = path.join(require('os').tmpdir(), 'master_script_check.js');
		fs.writeFileSync(tempFile, scriptContent);

		try {
			const { execSync } = require('child_process');
			execSync(`node --check "${tempFile}"`, { encoding: 'utf8' });
		} catch (e) {
			assert.fail('Master template script has syntax errors: ' + e.message);
		} finally {
			try { fs.unlinkSync(tempFile); } catch (e) { /* ignore */ }
		}
	});
});
