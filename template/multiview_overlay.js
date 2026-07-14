		// Setup live states
		let ws = null;
		let oscState = { channels: {}, updatedAt: 0 };
		let lastWsMessageAt = 0;
		let resyncRequestedAt = 0;
		let channelMap = { programChannels: [], programResolutions: [] };
		let sceneLive = {};
		let programLayerBankByChannel = {};
		
		let cellsConfig = [];
		let showTimersUnderLabels = false;
		let timerScale = 100;
		let highlightTopTimer = true;

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
					lastWsMessageAt = Date.now();
					const msg = JSON.parse(ev.data);
					if (msg.type === 'state') {
						if (msg.data?.osc?.channels) {
							oscState.channels = msg.data.osc.channels;
							if (msg.data.osc.updatedAt) oscState.updatedAt = msg.data.osc.updatedAt;
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
							if (msg.data.updatedAt) oscState.updatedAt = msg.data.updatedAt;
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

		// WS liveness watchdog — server pushes `osc` every ~50 ms while Caspar runs; long silence
		// means a stalled/half-open socket (frozen timers, WO-151 B151.2). Resync at 12 s, reconnect at 30 s.
		setInterval(() => {
			if (!ws || ws.readyState !== WebSocket.OPEN || !lastWsMessageAt) return;
			const silentMs = Date.now() - lastWsMessageAt;
			if (silentMs > 30000) {
				try { ws.close(); } catch (e) { /* onclose reconnects */ }
			} else if (silentMs > 12000 && Date.now() - resyncRequestedAt > 12000) {
				resyncRequestedAt = Date.now();
				try { ws.send(JSON.stringify({ type: 'osc_resync' })); } catch (e) { /* watchdog will close */ }
			}
		}, 5000);

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

		// Check if a source path matches the pip template family (WO-195.1)
		function isPipTemplateSource(sourceValue) {
			if (!sourceValue) return false;
			const src = String(sourceValue).toLowerCase();
			// Match pip_border/pip-border, pip_shadow/pip-shadow, etc.
			return /\b(pip_border|pip-border|pip_shadow|pip-shadow|pip_edge_strip|pip-edge-strip|pip_glow|pip-glow|pip_router|pip-router)\b/i.test(src);
		}

		// Extract basename without extension from a source path
		function getSourceBasename(sourceValue) {
			if (!sourceValue) return '';
			const src = String(sourceValue);
			const parts = src.split(/[/\\]/);
			const last = parts[parts.length - 1] || '';
			return last.replace(/\.[^.]*$/, ''); // Remove extension
		}

		// WO-212: Build playlist-aware row label (current -> next) when autoplay enabled
		// keep in parity with template/multiview_master.html
		function buildPlaylistRowLabel(num, layer, oscPlayingName, getSourceBasename) {
			if (layer.sourceMode !== 'list' || !Array.isArray(layer.playlist) || layer.playlist.length <= 1 || layer.playlistAdvance === 'manual') {
				const basename = getSourceBasename(layer.source?.value);
				return basename ? `L${num} ${basename}` : `L${num}`;
			}
			// Playlist with autoplay: compute current -> next
			const testName = String(oscPlayingName || getSourceBasename(layer.playlist[0]?.value) || '').toLowerCase();
			let idxOfCurrent = 0;
			for (let i = 0; i < layer.playlist.length; i++) {
				const itemBase = getSourceBasename(layer.playlist[i]?.value);
				if (itemBase && testName && itemBase.toLowerCase() === testName) {
					idxOfCurrent = i;
					break;
				}
			}
			// If no match found, fallback to first item
			const current = getSourceBasename(layer.playlist[idxOfCurrent]?.value);
			const isLastItem = idxOfCurrent === layer.playlist.length - 1;
			const hasNext = !(isLastItem && layer.playlistLoop === false);
			let label = `L${num} ${current}`;
			if (hasNext) {
				const nextIdx = (idxOfCurrent + 1) % layer.playlist.length;
				const next = getSourceBasename(layer.playlist[nextIdx]?.value);
				label += ` -> ${next}`;
			}
			return label;
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

				let innerBlocks = '';

				// Layer timers stack (PGM and PRV) (WO-195)
				const activeScenes = getActiveScenes();
				const layerRows = [];

				activeScenes.forEach((scene) => {
					if (Array.isArray(scene.layers)) {
						scene.layers.forEach((layer) => {
							const num = Number(layer.layerNumber);
							const sourceValue = layer.source?.value;

							// Skip playback_timers template
							if (sourceValue && sourceValue.includes('playback_timers.html')) return;

							// Skip pip decoration templates (WO-195.1)
							if (isPipTemplateSource(sourceValue)) return;

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
							let pLayer;
							if (isPgm) {
								// PGM: apply bank offset
								const bank = programLayerBankByChannel?.[String(chNum)] || 'a';
								pLayer = bank === 'b' ? num + 100 : num;
							} else {
								// PRV: physical = logical (no bank offset) (WO-195.4)
								pLayer = num;
							}

							const chOsc = oscState.channels[String(resolvedChNum)] || oscState.channels[resolvedChNum];
							let layerOsc = chOsc?.layers?.[pLayer] || chOsc?.layers?.[String(pLayer)];
							const isStale = layerOsc && window.mvPlaybackOsc?.isStaleOscPlaybackLayer?.(layerOsc, oscState.updatedAt);
							if (isStale) layerOsc = null;
							let lFile = layerOsc?.file || {};

							const elapsed = lFile.elapsed ?? 0;
							const duration = lFile.duration ?? 0;
							// Strict runtime guard: digits+bar only when Number.isFinite(duration) && duration > 0 && !stale (WO-195.3)
							const hasRuntime = Number.isFinite(duration) && duration > 0 && !isStale;

							// WO-212: Playlist-aware label, OSC playing file available here
							const oscPlayingName = lFile.name || lFile.path ? getSourceBasename(lFile.name || lFile.path) : null;
							const layerLabel = buildPlaylistRowLabel(num, layer, oscPlayingName, getSourceBasename);

							layerRows.push({
								num,
								hasRuntime,
								elapsed,
								duration,
								label: layerLabel
							});
						});
					}
				});

				// Sort descending by layer number
				layerRows.sort((a, b) => b.num - a.num);

				// Find the top (highest layer number) row with runtime
				let topRuntimeNum = -1;
				if (highlightTopTimer) {
					for (const row of layerRows) {
						if (row.hasRuntime) {
							topRuntimeNum = row.num;
							break;
						}
					}
				}

				if (layerRows.length > 0) {
					const layerItems = layerRows.map((row) => {
						const isTopRuntime = highlightTopTimer && row.num === topRuntimeNum;
						const rowClass = isTopRuntime ? ' label-layer-row--highlight' : '';
						if (row.hasRuntime) {
							const rem = Number.isFinite(row.duration) && row.duration > 0 ? Math.max(0, row.duration - row.elapsed) : 0;
							return `
								<div class="label-layer-row${rowClass}">
									<span class="label-layer-num">${row.label}</span>
									<span class="label-layer-time">${formatMmSs(row.elapsed)} / ${formatMmSs(row.duration)} ${Number.isFinite(rem) ? `(-${formatMmSs(rem)})` : ''}</span>
									<div class="label-layer-progress-bar-bg">
										<div class="label-layer-progress-bar-fill" style="width: ${row.duration > 0 ? Math.min(100, Math.max(0, (row.elapsed / row.duration) * 100)) : 0}%"></div>
									</div>
								</div>
							`;
						} else {
							return `
								<div class="label-layer-row${rowClass}">
									<span class="label-layer-num">${row.label}</span>
								</div>
							`;
						}
					});
					innerBlocks = `<div class="label-layers-list">${layerItems.join('')}</div>`;
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
			timerScale = Math.max(50, Math.min(300, Number(data?.timerScale) || 100));
			highlightTopTimer = data?.highlightTopTimer !== false;

			const c = document.getElementById('container');
			c.style.setProperty('--timer-scale', timerScale / 100);
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
