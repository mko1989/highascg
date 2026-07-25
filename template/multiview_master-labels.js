		function collectLayerLines(cell, resolvedChNum, screenIdx, chNum, isPgm) {
			const rows = [];
			const activeScenes = getActiveScenes();
			for (const scene of activeScenes) {
				if (!Array.isArray(scene.layers)) continue;
				for (const layer of scene.layers) {
					const num = Number(layer.layerNumber);
					const sourceValue = layer.source?.value;
					if (sourceValue && sourceValue.includes('playback_timers.html')) continue;
					// Skip pip decoration templates (WO-195.1)
					if (isPipTemplateSource(sourceValue)) continue;
					let lookScreenIdx = 0;
					if (/^[0-3]$/.test(String(scene.mainScope))) lookScreenIdx = parseInt(scene.mainScope, 10);
					else if (channelMap.programChannels) {
						for (let i = 0; i < channelMap.programChannels.length; i++) {
							const entry = sceneLive[String(channelMap.programChannels[i])] || sceneLive[channelMap.programChannels[i]];
							if (entry?.sceneId === scene.id) {
								lookScreenIdx = i;
								break;
							}
						}
					}
					if (lookScreenIdx !== screenIdx) continue;
					// PGM: bank-mapped physical; PRV has no banks — logical = physical (WO-195.4)
					const bank = programLayerBankByChannel?.[String(chNum)] || 'a';
					const pLayer = isPgm && bank === 'b' ? num + 100 : num;
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
					const layerLabel = buildPlaylistRowLabel(num, layer, oscPlayingName, getSourceBasename, friendlyRouteLabel, channelMap);
					rows.push({
						num,
						hasRuntime,
						elapsed,
						duration,
						label: layerLabel
					});
				}
			}
			// Sort descending by layer number
			rows.sort((a, b) => b.num - a.num);
			return rows;
		}

		function redraw() {
			ctx.clearRect(0, 0, W, H);
			ctx.save();
			for (const cell of cellsConfig) {
				if (cell.type === 'timers') continue;
				const r = cellRectPx(cell);
				const c = colorsForType(cell.type);
				ctx.lineWidth = 3;
				ctx.strokeStyle = c.border;
				ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);

				const lx = (cell.labelX ?? cell.x) * W;
				const ly = (cell.labelY ?? (cell.y + cell.h)) * H;
				const lw = (cell.labelW ?? cell.w) * W;
				const lh = (cell.labelH ?? 0) * H;

				const frac = typeof cell.chromeBottomFrac === 'number' && cell.chromeBottomFrac > 0 ? cell.chromeBottomFrac : 0.035;
				const chromeH = lh > 0 ? lh : r.h * frac;
				const titleBarH = Math.min(34, Math.max(22, Math.floor(chromeH * 0.36)));

				const isScreen = cell.type === 'pgm' || cell.type === 'prv';
				const useTimers = isScreen && showTimersUnderLabels && cell.channelNum != null;

				if (!useTimers) {
					const solidH = lh > 0 ? lh : titleBarH;
					ctx.fillStyle = c.solid;
					ctx.fillRect(lx, ly, lw, solidH);
					drawCenteredTitle(getDynamicCellLabel(cell), lx, ly, lw, solidH);
					continue;
				}

				const resolvedChNum = resolvePlaybackCh(cell);
				const isPgm = cell.type === 'pgm';

				ctx.fillStyle = c.solid;
				ctx.fillRect(lx, ly, lw, titleBarH);
				drawCenteredTitle(getDynamicCellLabel(cell), lx, ly, lw, titleBarH);

				const pad = 8;
				const dockW = Math.max(80, lw - 2 * pad);
				const dockX = lx + pad;
				const dockY = ly + titleBarH;
				const dockH = chromeH - titleBarH;
				if (dockH > 12) {
					let ty = dockY + 14;
					ctx.textBaseline = 'middle';
					ctx.fillStyle = '#f1f5f9';
					ctx.font = '500 9px Rewir, system-ui, sans-serif';
					const layerRows = collectLayerLines(cell, resolvedChNum, cell.screenIdx, cell.channelNum, isPgm);
					const maxY = ly + chromeH - 4;
					// WO-203/204: scale row typography/bars; §5 highlight the top running-media row
					const rowFont = Math.round(18 * timerScale);
					const timeFont = Math.round(16 * timerScale);
					const barH = Math.max(2, Math.round(6 * timerScale));
					const textRowH = Math.round(22 * timerScale);
					const topRuntimeNum = highlightTopTimer
						? (layerRows.find((r) => r.hasRuntime && Number(r.duration) > 0)?.num ?? null)
						: null;
					for (const row of layerRows) {
						// T250.2 (WO-250): the bar for a runtime row is reserved INSIDE this row's own
						// budget (text + bar + gap), not a further `textRowH` below it — that used to
						// draw the bar into the NEXT row's space, so on short docks / >=2 rows the bar
						// silently clipped (`ty + 2 <= maxY` failed) even though the digits above it
						// still fit under `maxY`. Gating on the full per-row step up front means a row
						// is only started when its bar (if it has one) will also fit — digits and bar
						// always render together.
						const hasBar = row.hasRuntime && Number(row.duration) > 0;
						const rowStep = hasBar ? textRowH + barH + 2 : textRowH;
						if (ty + rowStep > maxY) break;
						const isTop = topRuntimeNum != null && row.num === topRuntimeNum;

						// WO-204.1: Draw highlight chip background for top row
						if (isTop) {
							ctx.globalAlpha = 0.28;
							ctx.fillStyle = '#e63946';
							ctx.fillRect(dockX + pad - 3, ty, dockW - pad * 2 + 6, rowFont + 4);
							ctx.globalAlpha = 1;
						}

						ctx.fillStyle = '#fff';
						ctx.font = `${isTop ? 700 : 600} ${rowFont}px Rewir, system-ui, sans-serif`;
						ctx.textBaseline = 'middle';
						ctx.textAlign = 'left';

						// WO-204.4: Measure time text and truncate label
						let labelText = row.label;
						if (hasBar) {
							const rem = Number.isFinite(row.duration) && row.duration > 0 ? Math.max(0, row.duration - row.elapsed) : 0;
							const timeText = `${formatMmSs(row.elapsed)}/${formatMmSs(row.duration)} (-${formatMmSs(rem)})`;
							ctx.font = `500 ${timeFont}px Rewir, system-ui, sans-serif`;
							const timeW = ctx.measureText(timeText).width;
							const maxLabelW = dockW - pad * 2 - timeW - 6;

							// Truncate label if needed
							ctx.font = `${isTop ? 700 : 600} ${rowFont}px Rewir, system-ui, sans-serif`;
							while (labelText.length > 3 && ctx.measureText(labelText).width > maxLabelW) {
								labelText = labelText.slice(0, -2) + '…';
							}
						} else {
							// No time text, label can use most of the width
							const maxLabelW = dockW - pad * 2 - 6;
							while (labelText.length > 3 && ctx.measureText(labelText).width > maxLabelW) {
								labelText = labelText.slice(0, -2) + '…';
							}
						}

						ctx.fillText(labelText, dockX + pad, ty + 8);

						if (hasBar) {
							const rem = Number.isFinite(row.duration) && row.duration > 0 ? Math.max(0, row.duration - row.elapsed) : 0;
							const timeText = `${formatMmSs(row.elapsed)}/${formatMmSs(row.duration)} (-${formatMmSs(rem)})`;
							ctx.font = `500 ${timeFont}px Rewir, system-ui, sans-serif`;
							ctx.textAlign = 'right';
							ctx.fillText(timeText, dockX + dockW - pad, ty + 8);
							// Bar sits immediately under the text, INSIDE the row's own reserved height
							// (`rowStep` above already accounts for it) — not a further `textRowH` below.
							const barY = ty + textRowH;
							const thisBarH = isTop ? barH + 1 : barH;
							ctx.fillStyle = 'rgba(255,255,255,0.25)';
							ctx.fillRect(dockX + pad, barY, dockW - pad * 2, thisBarH);
							const pct = Number(row.duration) > 0 ? Math.min(100, Math.max(0, (row.elapsed / row.duration) * 100)) : 0;
							ctx.fillStyle = isTop ? '#ffc078' : c.prog;
							ctx.fillRect(dockX + pad, barY, ((dockW - pad * 2) * pct) / 100, thisBarH);
						}
						ty += rowStep;
					}
					ctx.textBaseline = 'alphabetic';
				}
			}
			ctx.restore();
		}

		setInterval(redraw, 150);

		window['play'] = function () {};

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
				console.error('Multiview master update:', e);
				return;
			}
			cellsConfig = data?.cells || [];
			showTimersUnderLabels = !!data?.showTimersUnderLabels;
			{
				const tsRaw = Number(data?.timerScale);
				timerScale = Number.isFinite(tsRaw) ? Math.min(300, Math.max(50, tsRaw)) / 100 : 1; // WO-203
				highlightTopTimer = data?.highlightTopTimer !== false; // WO-203 §5 default true
			}
			redraw();
		}
		window['update'] = update;

		if (document.fonts && document.fonts.ready) {
			document.fonts.ready.then(redraw).catch(() => redraw());
		}
