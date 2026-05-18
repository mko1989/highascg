		// Setup live states
		let ws = null;
		let oscState = { channels: {} };
		let channelMap = { programChannels: [], programResolutions: [] };
		let sceneLive = {};
		let programLayerBankByChannel = {};
		
		let cellsConfig = [];
		let showTimersUnderLabels = false;

		// WS connection
		function connect() {
			const host = window.location.hostname || '127.0.0.1';
			const port = window.location.port || '4200';
			const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			
			ws = new WebSocket(proto + '//' + host + ':' + port + '/api/ws');
			
			ws.onopen = () => {
				console.log('Multiview overlay connected to live WS');
			};
			
			ws.onclose = () => {
				setTimeout(connect, 2000);
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
						}
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
					} else if (msg.type === 'change') {
						if (msg.data?.path === 'scene.live') {
							sceneLive = msg.data.value || {};
						} else if (msg.data?.path === 'scene.programLayerBankByChannel') {
							programLayerBankByChannel = msg.data.value || {};
						}
					}
				} catch (e) {
					console.error('WS parse error:', e);
				}
			};
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

		connect();

		// Helper formatters
		function formatMmSs(sec) {
			if (!Number.isFinite(sec) || sec < 0) return '0:00';
			const m = Math.floor(sec / 60);
			const s = Math.floor(sec % 60);
			return `${m}:${String(s).padStart(2, '0')}`;
		}

		function escAttr(s) {
			return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
		}
		function escHtml(s) {
			return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		}

		function getScreenLabelForChannel(chNum) {
			if (channelMap && Array.isArray(channelMap.programChannels)) {
				const idx = channelMap.programChannels.indexOf(chNum);
				if (idx !== -1) {
					return `Screen ${idx + 1}`;
				}
			}
			return `Ch ${chNum}`;
		}

		function getTopLayerForPlayback(chNum, seen = new Set()) {
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
							const targetState = getTopLayerForPlayback(targetCh, seen);
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
									routeLabel: `Route (${getScreenLabelForChannel(targetCh)})`
								};
							} else {
								return {
									file: { name: `Route (${getScreenLabelForChannel(targetCh)})` },
									isRoute: true,
									routeTarget: targetCh,
									routeLabel: `Route (${getScreenLabelForChannel(targetCh)})`
								};
							}
						}
					}
				}
			}

			return bestState;
		}

		function getActiveScenes() {
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

		// Periodic Ticking Timer Renderer
		function tick() {
			cellsConfig.forEach((cell) => {
				const cellDiv = document.getElementById('cell_' + cell.id);
				if (!cellDiv) return;
				
				const labelDiv = cellDiv.querySelector('.label');
				if (!labelDiv) return;

				const isScreen = cell.type === 'pgm' || cell.type === 'prv';
				if (!isScreen || !showTimersUnderLabels || cell.channelNum == null) {
					// Plain Label Mode
					labelDiv.classList.remove('has-timers');
					labelDiv.innerHTML = `<div class="label-title">${escHtml(cell.label || '')}</div>`;
					return;
				}

				// Live Timers Mode
				labelDiv.classList.add('has-timers');

				const chNum = cell.channelNum;
				const screenIdx = cell.screenIdx;

				let resolvedChNum = chNum;
				let isPgm = cell.type === 'pgm';

				if (isPgm) {
					const bank = programLayerBankByChannel?.[String(chNum)] || 'a';
					const activeCh = channelMap.transitionModel === 'switcher_bus'
						? (bank === 'b' ? channelMap.switcherBusChannels?.[screenIdx] : channelMap.switcherBus1Channels?.[screenIdx])
						: chNum;
					resolvedChNum = activeCh || chNum;
				}

				// Fetch top playback layer
				const lyState = getTopLayerForPlayback(resolvedChNum);
				const file = lyState?.file || {};
				const elapsed = file.elapsed ?? 0;
				const dur = file.duration ?? 0;
				const rem = Number.isFinite(dur) && dur > 0 ? Math.max(0, dur - elapsed) : null;
				const pct = dur > 0 ? Math.min(100, Math.max(0, (elapsed / dur) * 100)) : 0;
				
				let fileName = file.name || (file.path ? file.path.split(/[/\\]/).pop() : '');
				if (lyState?.isRoute) {
					const subName = file.name && !file.name.toLowerCase().startsWith('route://') ? file.name : '';
					fileName = lyState.routeLabel + (subName ? ` - ${subName}` : '');
				}

				// Timers + bars live in transparent stack; channel title only on solid bar at bottom
				const clip = fileName || 'No active clip'
				let innerBlocks = `
					<div class="label-timer-row">
						<span class="label-clip-name" title="${escAttr(clip)}">${escHtml(clip)}</span>
						<span class="label-time-elapsed">${formatMmSs(elapsed)} / ${formatMmSs(dur)}</span>
						<span class="label-time-remaining">${Number.isFinite(rem) ? `-${formatMmSs(rem)}` : ''}</span>
					</div>
					<div class="label-progress-bar-bg">
						<div class="label-progress-bar-fill" style="width: ${pct}%"></div>
					</div>
				`;

				// Layer timers opt-in stack (PGM only)
				if (isPgm) {
					const activeScenes = getActiveScenes();
					const layerItems = [];
					
					activeScenes.forEach((scene) => {
						if (Array.isArray(scene.layers)) {
							scene.layers.forEach((layer) => {
								const num = Number(layer.layerNumber);
								const isTimersTemplate = layer.source?.value && layer.source.value.includes('playback_timers.html');
								if (isTimersTemplate) return;

								// Ensure look is routed to this screen
								let lookScreenIdx = 0;
								if (/^[0-3]$/.test(String(scene.mainScope))) {
									lookScreenIdx = parseInt(scene.mainScope, 10);
								} else if (channelMap.programChannels) {
									for (let i = 0; i < channelMap.programChannels.length; i++) {
										const entry = sceneLive[String(channelMap.programChannels[i])] || sceneLive[channelMap.programChannels[i]];
										if (entry?.sceneId === scene.id) {
											lookScreenIdx = i;
											break;
										}
									}
								}

								if (lookScreenIdx !== screenIdx) return;

								// Fetch Look Layer OSC playback values
								const bank = programLayerBankByChannel?.[String(chNum)] || 'a';
								const pLayer = bank === 'b' ? num + 100 : num;
								const chOsc = oscState.channels[String(resolvedChNum)] || oscState.channels[resolvedChNum];
								const layerOsc = chOsc?.layers?.[pLayer] || chOsc?.layers?.[String(pLayer)];
								let lFile = layerOsc?.file || {};

								let isLayerRoute = false;
								let layerRouteLabel = '';
								const lName = String(lFile.name || lFile.path || '');
								if (lName.toLowerCase().startsWith('route://')) {
									const match = lName.match(/route:\/\/(\d+)/i);
									if (match) {
										const targetCh = parseInt(match[1], 10);
										isLayerRoute = true;
										layerRouteLabel = `Route (${getScreenLabelForChannel(targetCh)})`;
										const targetOsc = oscState.channels[String(targetCh)]?.layers?.[num] || oscState.channels[String(targetCh)]?.layers?.[String(num)];
										if (targetOsc?.file) {
											lFile = targetOsc.file;
										}
									}
								}

								let lFileName = lFile.name || (lFile.path ? lFile.path.split(/[/\\]/).pop() : '');
								if (isLayerRoute) {
									const subName = lFile.name && !lFile.name.toLowerCase().startsWith('route://') ? lFile.name : '';
									lFileName = layerRouteLabel + (subName ? ` - ${subName}` : '');
								}

								if (lFileName) {
									const lElapsed = lFile.elapsed ?? 0;
									const lDur = lFile.duration ?? 0;
									const lRem = Number.isFinite(lDur) && lDur > 0 ? Math.max(0, lDur - lElapsed) : null;
									
									layerItems.push(`
										<div class="label-layer-item">
											L${num} [${escHtml(layer.label || `Layer ${num}`)}]: ${escHtml(lFileName)} - ${formatMmSs(lElapsed)}/${formatMmSs(lDur)} ${Number.isFinite(lRem) ? `(-${formatMmSs(lRem)})` : ''}
										</div>
									`);
								}
							});
						}
					});

					if (layerItems.length > 0) {
						innerBlocks += `<div class="label-layers-list">${layerItems.join('')}</div>`;
					}
				}

				labelDiv.innerHTML = `
					<div class="label-chrome-column">
						<div class="label-solid-bar"><div class="label-title">${escHtml(cell.label || '')}</div></div>
						<div class="label-timers-stack label-timer-dock">
							<div class="label-timers-inner">${innerBlocks}</div>
						</div>
					</div>
				`;
			});
		}

		setInterval(tick, 100);

		// CasparCG CG ADD standard play call
		window['play'] = function() { };

		// Main update receiver
		function update(raw) {
			let data;
			try {
				if (typeof raw === 'string') {
					let s = raw.trim();
					if (!s) return;
					if (s.indexOf('\\"') !== -1) s = s.replace(/\\"/g, '"');
					if (s.charAt(0) === '"' && s.length > 1 && s.charAt(s.length - 1) === '"') s = s.slice(1, -1);
					if (s.charAt(0) === '"') { 
						s = s.slice(1).replace(/\\"/g, '"'); 
						s = s.replace(/"\s*$/, ''); 
					}
					data = JSON.parse(s);
				} else if (raw && typeof raw === 'object') {
					data = raw;
				} else return;
			} catch (e) { 
				console.error('Update parsing error:', e);
				return; 
			}

			const cells = data?.cells || [];
			cellsConfig = cells;
			showTimersUnderLabels = !!data?.showTimersUnderLabels;

			const c = document.getElementById('container');
			c.innerHTML = '';
			
			cells.forEach((cell) => {
				const div = document.createElement('div');
				div.id = 'cell_' + cell.id;
				div.className = 'cell ' + (cell.type || '');
				div.style.left = (100 * (cell.x || 0)) + '%';
				div.style.top = (100 * (cell.y || 0)) + '%';
				div.style.width = (100 * (cell.w || 0)) + '%';
				div.style.height = (100 * (cell.h || 0)) + '%';
				
				const lbl = document.createElement('div');
				lbl.className = 'label';
				const frac = cell.chromeBottomFrac;
				if (typeof frac === 'number' && frac > 0 && frac <= 1) {
					lbl.classList.add('mv-chrome-sized');
					lbl.style.height = (frac * 100) + '%';
				}
				div.appendChild(lbl);
				
				c.appendChild(div);
			});

			// Immediate first tick for seamless loading
			tick();
		}
		
		window['update'] = update;
