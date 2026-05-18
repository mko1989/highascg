// Playback Timers State and Format Helpers

// Helper to standardize array of active scenes
function getActiveScenes(channelMap, sceneLive) {
	const list = [];
	if (channelMap && Array.isArray(channelMap.programChannels)) {
		channelMap.programChannels.forEach((chNum) => {
			const entry = sceneLive[String(chNum)] || sceneLive[chNum];
			if (entry?.scene) {
				list.push(entry.scene);
			}
		});
	}
	return list;
}

function mergeChannel(a, b) {
	if (!b) return a;
	if (!a) return b;
	const o = { ...a, ...b };
	if (b.layers || a.layers) {
		o.layers = { ...(a.layers || {}) };
		for (const k of Object.keys(b.layers || {})) {
			const aL = a.layers && a.layers[k] ? a.layers[k] : {};
			const bL = b.layers[k];
			const merged = { ...aL, ...bL };
			if (aL.file && bL.file && typeof aL.file === 'object' && typeof bL.file === 'object') {
				merged.file = { ...aL.file, ...bL.file };
			}
			o.layers[k] = merged;
		}
	}
	return o;
}

function formatMmSs(sec) {
	if (!Number.isFinite(sec) || sec < 0) return '0:00';
	const m = Math.floor(sec / 60);
	const s = Math.floor(sec % 60);
	return `${m}:${String(s).padStart(2, '0')}`;
}

function getTier(rem) {
	if (rem == null || !Number.isFinite(rem)) return 'tier-muted';
	if (rem > 10) return 'tier-green';
	if (rem > 5) return 'tier-orange';
	return 'tier-red';
}

function getScreenLabelForChannel(chNum, channelMap) {
	if (channelMap && Array.isArray(channelMap.programChannels)) {
		const idx = channelMap.programChannels.indexOf(chNum);
		if (idx !== -1) {
			return `Screen ${idx + 1}`;
		}
	}
	return `Ch ${chNum}`;
}

function getTopLayerForPlayback(chNum, oscState, channelMap, seen = new Set()) {
	if (seen.has(chNum)) return null;
	seen.add(chNum);

	const ch = oscState.channels[String(chNum)] || oscState.channels[chNum];
	const layers = ch?.layers;
	if (!layers) return null;
	let bestN = -1;
	let bestState = null;
	for (const key of Object.keys(layers)) {
		const n = parseInt(key, 10);
		if (!Number.isFinite(n)) continue;
		const ly = layers[key];
		const f = ly?.file;
		if (f && (f.name || f.path)) {
			if (n > bestN) {
				bestN = n;
				bestState = ly;
			}
		}
	}

	if (bestState) {
		const f = bestState.file || {};
		const name = String(f.name || f.path || '');
		if (name.toLowerCase().startsWith('route://')) {
			const match = name.match(/route:\/\/(\d+)/i);
			if (match) {
				const targetCh = parseInt(match[1], 10);
				if (targetCh !== chNum) {
					const targetState = getTopLayerForPlayback(targetCh, oscState, channelMap, seen);
					if (targetState) {
						return {
							...targetState,
							file: {
								...targetState.file,
								name: targetState.file?.name || '',
								path: targetState.file?.path || '',
							},
							isRoute: true,
							routeTarget: targetCh,
							routeLabel: `Route (${getScreenLabelForChannel(targetCh, channelMap)})`
						};
					} else {
						return {
							file: { name: `Route (${getScreenLabelForChannel(targetCh, channelMap)})` },
							isRoute: true,
							routeTarget: targetCh,
							routeLabel: `Route (${getScreenLabelForChannel(targetCh, channelMap)})`
						};
					}
				}
			}
		}
	}

	return bestState;
}

function truncateLabel(s, max = 24) {
	if (!s) return '';
	if (s.length <= max) return s;
	return s.slice(0, max - 1) + '…';
}
