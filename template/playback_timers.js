// Setup WebSocket
const wsUrl = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/api/ws';
let ws = null;
let oscState = { channels: {} };
let sceneLive = {};
let programLayerBankByChannel = {};
let channelMap = { programChannels: [], programResolutions: [] };

// Default Configuration (Overridden by active scene)
let config = {
	showLayers: true,
	showScreens: true,
	columns: 2,
	compact: false
};

const dot = document.getElementById('status-dot');
const txt = document.getElementById('status-text');

function connect() {
	ws = new WebSocket(wsUrl);
	
	ws.onopen = () => {
		if (dot) dot.classList.add('connected');
		if (txt) txt.textContent = 'CONNECTED';
	};
	
	ws.onclose = () => {
		if (dot) dot.classList.remove('connected');
		if (txt) txt.textContent = 'OFFLINE';
		setTimeout(connect, 3000);
	};

	ws.onmessage = (ev) => {
		try {
			const msg = JSON.parse(ev.data);
			if (msg.type === 'state') {
				if (msg.data?.osc?.channels) {
					oscState.channels = msg.data.osc.channels;
				}
				if (msg.data?.channelMap) {
					channelMap = msg.data.channelMap;
				}
				if (msg.data?.scene) {
					sceneLive = msg.data.scene.live || {};
					programLayerBankByChannel = msg.data.scene.programLayerBankByChannel || {};
					updateConfigFromScene();
				}
				render();
			} else if (msg.type === 'osc') {
				if (msg.data?.channels) {
					if (msg.data.delta) {
						for (const k of Object.keys(msg.data.channels)) {
							oscState.channels[k] = mergeChannel(oscState.channels[k], msg.data.channels[k]);
						}
					} else {
						oscState.channels = msg.data.channels;
					}
				}
				render();
			} else if (msg.type === 'change') {
				if (msg.data?.path === 'scene.live') {
					sceneLive = msg.data.value || {};
					updateConfigFromScene();
					render();
				} else if (msg.data?.path === 'scene.programLayerBankByChannel') {
					programLayerBankByChannel = msg.data.value || {};
					render();
				} else if (msg.data?.path === 'channels') {
					render();
				}
			}
		} catch (e) {
			console.error('WS Error:', e);
		}
	};
}

function updateConfigFromScene() {
	let found = false;
	const activeScenes = getActiveScenes(channelMap, sceneLive);
	if (Array.isArray(activeScenes)) {
		for (const scene of activeScenes) {
			if (Array.isArray(scene.layers)) {
				for (const layer of scene.layers) {
					if (layer.source && layer.source.value && layer.source.value.includes('playback_timers.html')) {
						if (layer.source.timersConfig) {
							config = { ...config, ...layer.source.timersConfig };
							found = true;
						}
					}
				}
			}
		}
	}
	if (!found) {
		// Revert to defaults
		config = {
			showLayers: true,
			showScreens: true,
			columns: 2,
			compact: false,
			titleFontSize: 28,
			clipFontSize: 20,
			timeFontSize: 28,
			elapsedFontSize: 20,
			showLabels: true,
			showProgress: true,
			showElapsed: true
		};
	}
	
	// Apply config to layout variables
	document.documentElement.style.setProperty('--columns', config.columns || 2);
	const app = document.getElementById('app');
	if (app) {
		app.classList.toggle('compact-mode', !!config.compact);
		app.classList.toggle('hide-labels', config.showLabels === false);
		app.classList.toggle('hide-progress', config.showProgress === false);
		app.classList.toggle('hide-elapsed', config.showElapsed === false);
	}
	
	const screensSec = document.getElementById('screens-sec');
	if (screensSec) screensSec.style.display = config.showScreens ? 'flex' : 'none';
	
	const layersSec = document.getElementById('layers-sec');
	if (layersSec) layersSec.style.display = config.showLayers ? 'flex' : 'none';

	// Dynamic Font Sizes
	document.documentElement.style.setProperty('--title-font-size', (config.titleFontSize ?? 28) + 'px');
	document.documentElement.style.setProperty('--clip-font-size', (config.clipFontSize ?? 20) + 'px');
	document.documentElement.style.setProperty('--time-font-size', (config.timeFontSize ?? 28) + 'px');
	document.documentElement.style.setProperty('--elapsed-font-size', (config.elapsedFontSize ?? 20) + 'px');
}

function render() {
	const screensGrid = document.getElementById('screens-grid');
	const layersGrid = document.getElementById('layers-grid');
	if (!screensGrid || !layersGrid) return;
	
	screensGrid.innerHTML = '';
	layersGrid.innerHTML = '';

	let screensCount = 0;
	let layersCount = 0;

	// 1. Render Program Screens
	if (config.showScreens && Array.isArray(channelMap.programChannels)) {
		channelMap.programChannels.forEach((chNum, index) => {
			screensCount++;
			
			// PGM State
			const bank = programLayerBankByChannel?.[String(chNum)] || 'a';
			const activeCh = channelMap.transitionModel === 'switcher_bus'
				? (bank === 'b' ? channelMap.switcherBusChannels?.[index] : channelMap.switcherBus1Channels?.[index])
				: chNum;
			const resolvedChNum = activeCh || chNum;
			
			const lyState = getTopLayerForPlayback(resolvedChNum, oscState, channelMap);
			const file = lyState?.file || {};
			const elapsed = file.elapsed ?? 0;
			const dur = file.duration ?? 0;
			const rem = Number.isFinite(dur) && dur > 0 ? Math.max(0, dur - elapsed) : null;
			const pct = dur > 0 ? Math.min(100, Math.max(0, (elapsed / dur) * 100)) : 0;
			const tier = getTier(rem);
			let fileName = file.name || (file.path ? file.path.split(/[/\\]/).pop() : '');
			if (lyState?.isRoute) {
				const subName = file.name && !file.name.toLowerCase().startsWith('route://') ? file.name : '';
				fileName = lyState.routeLabel + (subName ? ` - ${subName}` : '');
			}

			// PRV State
			const prvCh = channelMap.previewChannels?.[index] || (index + 2); // Default fallback
			const prvLyState = getTopLayerForPlayback(prvCh, oscState, channelMap);
			const prvFile = prvLyState?.file || {};
			const prvElapsed = prvFile.elapsed ?? 0;
			const prvDur = prvFile.duration ?? 0;
			const prvRem = Number.isFinite(prvDur) && prvDur > 0 ? Math.max(0, prvDur - prvElapsed) : null;
			const prvPct = prvDur > 0 ? Math.min(100, Math.max(0, (prvElapsed / prvDur) * 100)) : 0;
			let prvFileName = prvFile.name || (prvFile.path ? prvFile.path.split(/[/\\]/).pop() : '');
			if (prvLyState?.isRoute) {
				const subName = prvFile.name && !prvFile.name.toLowerCase().startsWith('route://') ? prvFile.name : '';
				prvFileName = prvLyState.routeLabel + (subName ? ` - ${subName}` : '');
			}

			const card = document.createElement('div');
			card.className = `screen-card ${tier}`;
			card.innerHTML = `
				<div class="screen-header">
					<span class="screen-title">Screen ${index + 1}</span>
				</div>
				
				<!-- PGM Group -->
				<div class="timer-group">
					<div class="timer-group-header">
						<span class="group-label group-label--pgm">PGM</span>
						<span class="screen-file" title="${fileName || 'No active clip'}">${fileName || 'No active clip'}</span>
					</div>
					<div class="timer-row">
						<span class="time-elapsed">${formatMmSs(elapsed)} / ${formatMmSs(dur)}</span>
						<span class="time-remaining">${Number.isFinite(rem) ? `-${formatMmSs(rem)}` : ''}</span>
					</div>
					<div class="progress-container">
						<div class="progress-bar" style="width: ${pct}%"></div>
					</div>
				</div>
				
				<!-- PRV Group -->
				<div class="timer-group" style="margin-top: 10px;">
					<div class="timer-group-header">
						<span class="group-label group-label--prv">PRV</span>
						<span class="screen-file" title="${prvFileName || 'No preview clip'}">${prvFileName || 'No preview clip'}</span>
					</div>
					<div class="timer-row">
						<span class="time-elapsed">${formatMmSs(prvElapsed)} / ${formatMmSs(prvDur)}</span>
						<span class="time-remaining" style="color: #34d399;">${Number.isFinite(prvRem) ? `-${formatMmSs(prvRem)}` : ''}</span>
					</div>
					<div class="progress-container">
						<div class="progress-bar progress-bar--prv" style="width: ${prvPct}%"></div>
					</div>
				</div>
			`;
			screensGrid.appendChild(card);
		});
	}

	// 2. Render Layers across Active Looks
	const activeScenes = getActiveScenes(channelMap, sceneLive);
	if (config.showLayers && activeScenes.length > 0) {
		const activeLayersMap = new Map();
		activeScenes.forEach((scene) => {
			if (Array.isArray(scene.layers)) {
				scene.layers.forEach((layer) => {
					const key = `${scene.id}-${layer.layerNumber}`;
					activeLayersMap.set(key, { layer, scene });
				});
			}
		});

		activeLayersMap.forEach(({ layer, scene }) => {
			const num = Number(layer.layerNumber);
			const isTimersTemplate = layer.source && layer.source.value && layer.source.value.includes('playback_timers.html');
			if (isTimersTemplate) return;

			let screenIdx = 0;
			if (/^[0-3]$/.test(String(scene.mainScope))) {
				screenIdx = parseInt(scene.mainScope, 10);
			} else {
				if (channelMap.programChannels) {
					for (let i = 0; i < channelMap.programChannels.length; i++) {
						const chNum = channelMap.programChannels[i];
						const entry = sceneLive[String(chNum)] || sceneLive[chNum];
						if (entry?.sceneId === scene.id) {
							screenIdx = i;
							break;
						}
					}
				}
			}
			
			const pgmCh = channelMap.programChannels?.[screenIdx] || 1;
			const bank = programLayerBankByChannel?.[String(pgmCh)] || 'a';
			const activeCh = channelMap.transitionModel === 'switcher_bus'
				? (bank === 'b' ? channelMap.switcherBusChannels?.[screenIdx] : channelMap.switcherBus1Channels?.[screenIdx])
				: pgmCh;
			const resolvedChNum = activeCh || pgmCh;
			const pLayer = bank === 'b' ? num + 100 : num;

			const chOsc = oscState.channels[String(resolvedChNum)] || oscState.channels[resolvedChNum];
			const layerOsc = chOsc?.layers?.[pLayer] || chOsc?.layers?.[String(pLayer)];
			let file = layerOsc?.file || {};

			let isLayerRoute = false;
			let layerRouteLabel = '';
			let layerRouteTarget = null;
			const lName = String(file.name || file.path || '');
			if (lName.toLowerCase().startsWith('route://')) {
				const match = lName.match(/route:\/\/(\d+)/i);
				if (match) {
					const targetCh = parseInt(match[1], 10);
					isLayerRoute = true;
					layerRouteTarget = targetCh;
					layerRouteLabel = `Route (${getScreenLabelForChannel(targetCh, channelMap)})`;
					const targetOsc = oscState.channels[String(targetCh)]?.layers?.[num] || oscState.channels[String(targetCh)]?.layers?.[String(num)];
					if (targetOsc?.file) {
						file = targetOsc.file;
					}
				}
			}

			const elapsed = file.elapsed ?? 0;
			const dur = file.duration ?? 0;
			const rem = Number.isFinite(dur) && dur > 0 ? Math.max(0, dur - elapsed) : null;
			const pct = dur > 0 ? Math.min(100, Math.max(0, (elapsed / dur) * 100)) : 0;
			const tier = getTier(rem);
			let fileName = file.name || (file.path ? file.path.split(/[/\\]/).pop() : '');
			if (isLayerRoute) {
				const subName = file.name && !file.name.toLowerCase().startsWith('route://') ? file.name : '';
				fileName = layerRouteLabel + (subName ? ` - ${subName}` : '');
			}

			const prvCh = channelMap.previewChannels?.[screenIdx] || 2;
			const prvChOsc = oscState.channels[String(prvCh)] || oscState.channels[prvCh];
			const prvLayerOsc = prvChOsc?.layers?.[num] || prvChOsc?.layers?.[String(num)];
			let prvFile = prvLayerOsc?.file || {};

			let isPrvRoute = false;
			let prvRouteLabel = '';
			let prvRouteTarget = null;
			const prvName = String(prvFile.name || prvFile.path || '');
			if (prvName.toLowerCase().startsWith('route://')) {
				const match = prvName.match(/route:\/\/(\d+)/i);
				if (match) {
					const targetCh = parseInt(match[1], 10);
					isPrvRoute = true;
					prvRouteTarget = targetCh;
					prvRouteLabel = `Route (${getScreenLabelForChannel(targetCh, channelMap)})`;
					const targetPrvOsc = oscState.channels[String(targetCh)]?.layers?.[num] || oscState.channels[String(targetCh)]?.layers?.[String(num)];
					if (targetPrvOsc?.file) {
						prvFile = targetPrvOsc.file;
					}
				}
			}

			const prvElapsed = prvFile.elapsed ?? 0;
			const prvDur = prvFile.duration ?? 0;
			const prvRem = Number.isFinite(prvDur) && prvDur > 0 ? Math.max(0, prvDur - prvElapsed) : null;
			const prvPct = prvDur > 0 ? Math.min(100, Math.max(0, (prvElapsed / prvDur) * 100)) : 0;
			let prvFileName = prvFile.name || (prvFile.path ? prvFile.path.split(/[/\\]/).pop() : '');
			if (isPrvRoute) {
				const subName = prvFile.name && !prvFile.name.toLowerCase().startsWith('route://') ? prvFile.name : '';
				prvFileName = prvRouteLabel + (subName ? ` - ${subName}` : '');
			}

			if (!fileName && !prvFileName) return;

			layersCount++;
			const card = document.createElement('div');
			card.className = `layer-card ${tier}`;
			card.innerHTML = `
				<div class="layer-header">
					<div class="layer-title-badge">
						<span class="layer-num">L${num}</span>
						<span class="layer-name">${layer.label || `Layer ${num}`}</span>
					</div>
				</div>
				
				<!-- PGM Group -->
				<div class="timer-group">
					<div class="timer-group-header">
						<span class="group-label group-label--pgm">PGM</span>
						<span class="layer-file" title="${fileName || 'No active clip'}">${fileName || 'No active clip'}</span>
					</div>
					<div class="timer-row">
						<span class="time-elapsed">${formatMmSs(elapsed)} / ${formatMmSs(dur)}</span>
						<span class="time-remaining">${Number.isFinite(rem) ? `-${formatMmSs(rem)}` : ''}</span>
					</div>
					<div class="progress-container">
						<div class="progress-bar" style="width: ${pct}%"></div>
					</div>
				</div>
				
				<!-- PRV Group -->
				<div class="timer-group" style="margin-top: 8px;">
					<div class="timer-group-header">
						<span class="group-label group-label--prv">PRV</span>
						<span class="layer-file" title="${prvFileName || 'No preview clip'}">${prvFileName || 'No preview clip'}</span>
					</div>
					<div class="timer-row">
						<span class="time-elapsed">${formatMmSs(prvElapsed)} / ${formatMmSs(prvDur)}</span>
						<span class="time-remaining" style="color: #34d399;">${Number.isFinite(prvRem) ? `-${formatMmSs(prvRem)}` : ''}</span>
					</div>
					<div class="progress-container">
						<div class="progress-bar progress-bar--prv" style="width: ${prvPct}%"></div>
					</div>
				</div>
			`;
			layersGrid.appendChild(card);
		});
	}

	// Empty placeholders
	if (config.showScreens && screensCount === 0) {
		screensGrid.innerHTML = '<div class="no-timers">No active program screens detected</div>';
	}
	if (config.showLayers && layersCount === 0) {
		layersGrid.innerHTML = '<div class="no-timers">No active layers playing video clips</div>';
	}
}

// Initial connection
connect();
