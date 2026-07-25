		const W = 1920;
		const H = 1080;
		const canvas = document.getElementById('cv');
		const ctx = canvas.getContext('2d', { alpha: true });

		let ws = null;
		let oscState = { channels: {}, updatedAt: 0 };
		let lastWsMessageAt = 0;
		let resyncRequestedAt = 0;
		let channelMap = { programChannels: [], programResolutions: [] };
		let sceneLive = {};
		let programLayerBankByChannel = {};
		let cellsConfig = [];
		let showTimersUnderLabels = false;
		let timerScale = 1; // WO-203: timerScale/100 from CG payload
		let highlightTopTimer = true; // WO-203 §5

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

		function connect() {
			const host = window.location.hostname || '127.0.0.1';
			const port = window.location.port || '4200';
			const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			ws = new WebSocket(proto + '//' + host + ':' + port + '/api/ws');
			ws.onclose = () => setTimeout(connect, 2000);
			ws.onmessage = (ev) => {
				try {
					lastWsMessageAt = Date.now();
					const msg = JSON.parse(ev.data);
					if (msg.type === 'state') {
						if (msg.data?.osc?.channels) {
							oscState.channels = msg.data.osc.channels;
							if (msg.data.osc.updatedAt) oscState.updatedAt = msg.data.osc.updatedAt;
						}
						if (msg.data?.channelMap) channelMap = msg.data.channelMap;
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
						if (msg.data?.path === 'scene.live') sceneLive = msg.data.value || {};
						else if (msg.data?.path === 'scene.programLayerBankByChannel') {
							programLayerBankByChannel = msg.data.value || {};
						}
					}
				} catch (e) {
					console.error('Multiview master WS:', e);
				}
			};
		}
		connect();

		/**
		 * WS liveness watchdog: the server pushes `osc` at least every ~50 ms while Caspar emits OSC,
		 * so silence means a stalled/half-open socket (server restart, network blip) — the exact
		 * "timers frozen at an old state" failure (WO-151 B151.2). Ask for a resync after 12 s;
		 * force-reconnect after 30 s (onclose triggers connect()).
		 */
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

		function formatMmSs(sec) {
			if (!Number.isFinite(sec) || sec < 0) return '0:00';
			const m = Math.floor(sec / 60);
			const s = Math.floor(sec % 60);
			return `${m}:${String(s).padStart(2, '0')}`;
		}

		function getScreenLabelForChannel(chNum) {
			if (channelMap && Array.isArray(channelMap.programChannels)) {
				const idx = channelMap.programChannels.indexOf(chNum);
				if (idx !== -1) return `Screen ${idx + 1}`;
			}
			return `Ch ${chNum}`;
		}


		function getActiveScenes() {
			const list = [];
			if (channelMap && Array.isArray(channelMap.programChannels)) {
				channelMap.programChannels.forEach((chNum) => {
					const entry = sceneLive[String(chNum)] || sceneLive[chNum];
					if (entry?.scene) list.push(entry.scene);
				});
			}
			return list;
		}

		function getDynamicCellLabel(cell) {
			if ((cell.type === 'pgm' || cell.type === 'prv') && typeof cell.screenIdx === 'number') {
				if (channelMap && channelMap.virtualMainChannels && channelMap.virtualMainChannels[cell.screenIdx] && channelMap.virtualMainChannels[cell.screenIdx].name) {
					const name = channelMap.virtualMainChannels[cell.screenIdx].name;
					return `${cell.type === 'pgm' ? 'PGM' : 'PRV'} · ${name}`;
				}
			}
			return cell.label || '';
		}

		function colorsForType(t) {
			if (t === 'pgm') return { border: '#e63946', solid: '#c92a2a', prog: '#ffffff' };
			if (t === 'prv') return { border: '#2a9d8f', solid: '#0d9488', prog: '#a7f3d0' };
			return { border: '#457b9d', solid: '#2563eb', prog: '#ffffff' };
		}

		function cellRectPx(cell) {
			return {
				x: (cell.x || 0) * W,
				y: (cell.y || 0) * H,
				w: Math.max(1, (cell.w || 0) * W),
				h: Math.max(1, (cell.h || 0) * H),
			};
		}

		function resolvePlaybackCh(cell) {
			const chNum = cell.channelNum;
			const screenIdx = cell.screenIdx;
			let resolvedChNum = chNum;
			if (cell.type === 'pgm') {
				const bank = programLayerBankByChannel?.[String(chNum)] || 'a';
				const activeCh =
					channelMap.transitionModel === 'switcher_bus'
						? bank === 'b'
							? channelMap.switcherBusChannels?.[screenIdx]
							: channelMap.switcherBus1Channels?.[screenIdx]
						: chNum;
				resolvedChNum = activeCh || chNum;
			}
			return resolvedChNum;
		}

		function fillTruncatedLine(text, x, y, maxW, padL, padR, font) {
			const max = maxW - padL - padR;
			let t = String(text);
			ctx.font = font || '500 10px Rewir, system-ui, sans-serif';
			ctx.textBaseline = 'middle';
			while (t.length > 3 && ctx.measureText(t).width > max) t = t.slice(0, -2) + '…';
			ctx.fillText(t, x + padL, y);
		}

		function drawCenteredTitle(text, x, y, w, h) {
			ctx.font = '600 11px Rewir, system-ui, sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			let t = String(text || '');
			while (t.length > 3 && ctx.measureText(t).width > w - 12) t = t.slice(0, -2) + '…';
			ctx.fillStyle = '#fff';
			ctx.fillText(t, x + w / 2, y + h / 2);
			ctx.textAlign = 'left';
			ctx.textBaseline = 'alphabetic';
		}

		function roundRectPath(x, y, rw, rh, r) {
			const rr = Math.min(r, rw / 2, rh / 2);
			ctx.beginPath();
			ctx.moveTo(x + rr, y);
			ctx.arcTo(x + rw, y, x + rw, y + rh, rr);
			ctx.arcTo(x + rw, y + rh, x, y + rh, rr);
			ctx.arcTo(x, y + rh, x, y, rr);
			ctx.arcTo(x, y, x + rw, y, rr);
			ctx.closePath();
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

		// WO-223: Map route:// sources to friendly channel/screen labels
		// keep in parity with template/multiview_overlay.js
		function friendlyRouteLabel(sourceValue, channelMap) {
			if (!sourceValue) return '';
			const src = String(sourceValue);
			// Check if this is a route:// source
			if (!src.startsWith('route://')) return '';

			// Parse route://N or route://N-L
			const routePart = src.substring(8); // Remove 'route://'
			const parts = routePart.split('-');
			const channelNum = parseInt(parts[0], 10);
			const layerNum = parts.length > 1 ? parseInt(parts[1], 10) : null;

			if (!Number.isFinite(channelNum)) return '';

			// Check if channelNum is in programChannels
			if (channelMap && Array.isArray(channelMap.programChannels)) {
				const idx = channelMap.programChannels.indexOf(channelNum);
				if (idx !== -1) {
					const screenLabel = channelMap.screenLabels?.[idx] || `PGM${idx + 1}`;
					return screenLabel;
				}
			}

			// Check if channelNum is in previewChannels
			if (channelMap && Array.isArray(channelMap.previewChannels)) {
				const idx = channelMap.previewChannels.indexOf(channelNum);
				if (idx !== -1) {
					return `PRV${idx + 1}`;
				}
			}

			// Fallback: return 'Route ch N'
			return `Route ch ${channelNum}`;
		}

		// WO-212: Build playlist-aware row label (current -> next) when autoplay enabled
		// keep in parity with template/multiview_overlay.js
		function buildPlaylistRowLabel(num, layer, oscPlayingName, getSourceBasename, friendlyRouteLabel, channelMap) {
			if (layer.sourceMode !== 'list' || !Array.isArray(layer.playlist) || layer.playlist.length <= 1 || layer.playlistAdvance === 'manual') {
				const sourceValue = layer.source?.value;
				let basename = friendlyRouteLabel(sourceValue, channelMap) || getSourceBasename(sourceValue);
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
			const currentValue = layer.playlist[idxOfCurrent]?.value;
			const current = friendlyRouteLabel(currentValue, channelMap) || getSourceBasename(currentValue);
			const isLastItem = idxOfCurrent === layer.playlist.length - 1;
			const hasNext = !(isLastItem && layer.playlistLoop === false);
			let label = `L${num} ${current}`;
			if (hasNext) {
				const nextIdx = (idxOfCurrent + 1) % layer.playlist.length;
				const nextValue = layer.playlist[nextIdx]?.value;
				const next = friendlyRouteLabel(nextValue, channelMap) || getSourceBasename(nextValue);
				label += ` -> ${next}`;
			}
			return label;
		}
