/**
 * Single timeline clip drawing (thumbnail, waveform, keyframes, resize handles).
 */

import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import { roundRect } from './timeline-canvas-utils.js'

const CLIP_PALETTE = ['#1f6b36', '#0c5d8c', '#5a1e87', '#8c1a44', '#7a3100', '#005c54']

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} clip
 * @param {number} layerIdx
 * @param {number} trackY
 * @param {number} fps
 * @param {object} env
 */
export function drawTimelineClip(ctx, clip, layerIdx, trackY, _fps, env) {
	const {
		xAt,
		canvas,
		HEADER_W,
		TRACK_H,
		thumbCache,
		waveformCache,
		schedDraw,
		getThumbnailUrl,
		getWaveformUrl,
		drag,
		selection,
		activeTimelineId,
	} = env

	if (!clip.source?.value) return
	const x = xAt(clip.startTime)
	const w = Math.max(3, clip.duration * env.pxPerMs)
	const h = TRACK_H - 8
	const y = trackY + 4

	if (x + w < HEADER_W + 1 || x > canvas.width) return

	const visX = Math.max(x, HEADER_W + 1)
	const visW = Math.min(x + w, canvas.width) - visX

	const col = CLIP_PALETTE[layerIdx % CLIP_PALETTE.length]
	const isDragSelected =
		(drag?.type === 'clip-move' && drag.clipId === clip.id) ||
		(drag?.type === 'clip-resize' && drag.clipId === clip.id)
	const isSelStatic =
		selection &&
		activeTimelineId &&
		selection.timelineId === activeTimelineId &&
		selection.clipId === clip.id &&
		selection.layerIdx === layerIdx
	const isSelected = isDragSelected || isSelStatic

	ctx.save()
	ctx.beginPath()
	roundRect(ctx, x, y, w, h, 3)
	ctx.fillStyle = col
	ctx.fill()
	ctx.restore()

	const hasAudio = clip.hasAudio ?? (clip.source?.type === 'media')
	const thumbUrl = getThumbnailUrl?.(clip.source)
	if (thumbUrl && w >= 36 && h >= 20) {
		const thumbSize = Math.min(36, h - 4, w - 10)
		const tx = x + 5
		const ty = y + (h - thumbSize) / 2
		let img = thumbCache.get(thumbUrl)
		if (img === undefined) {
			thumbCache.set(thumbUrl, 'loading')
			const im = new Image()
			im.crossOrigin = 'anonymous'
			im.onload = () => {
				thumbCache.set(thumbUrl, im)
				schedDraw()
			}
			im.onerror = () => {
				thumbCache.set(thumbUrl, 'error')
			}
			im.src = thumbUrl
		} else if (img && img !== 'loading' && img !== 'error') {
			ctx.save()
			ctx.beginPath()
			roundRect(ctx, tx, ty, thumbSize, thumbSize, 2)
			ctx.clip()
			if (hasAudio) ctx.globalAlpha = 0.5
			ctx.drawImage(img, tx, ty, thumbSize, thumbSize)
			ctx.globalAlpha = 1
			ctx.restore()
			if (hasAudio) {
				const waveformUrl = getWaveformUrl?.(clip.source)
				let peaks = null
				if (waveformUrl) {
					const cached = waveformCache.get(waveformUrl)
					if (cached === undefined) {
						waveformCache.set(waveformUrl, 'loading')
						fetch(waveformUrl)
							.then((r) => r.ok ? r.json() : null)
							.then((d) => {
								waveformCache.set(waveformUrl, Array.isArray(d?.peaks) ? d.peaks : 'error')
								schedDraw()
							})
							.catch(() => {
								waveformCache.set(waveformUrl, 'error')
								schedDraw()
							})
					} else if (Array.isArray(cached)) {
						peaks = cached
					}
				}
				ctx.save()
				ctx.beginPath()
				roundRect(ctx, tx, ty, thumbSize, thumbSize, 2)
				ctx.clip()
				const nBars = peaks ? peaks.length : 10
				const barW = Math.max(1, (thumbSize - (nBars - 1) * 1) / nBars)
				const gap = 1
				const cy = ty + thumbSize / 2
				ctx.fillStyle = 'rgba(255,255,255,0.6)'
				for (let i = 0; i < nBars; i++) {
					const barH = peaks
						? (0.2 + 0.6 * (peaks[i] ?? 0)) * (thumbSize / 2 - 2)
						: (0.2 + 0.6 * Math.abs(Math.sin(((clip.id || clip.source?.value || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)) * 0.1 + (i / (nBars - 1) || 0) * Math.PI * 2 * 2)) * Math.sin((i / (nBars - 1) || 0) * Math.PI * 3)) * (thumbSize / 2 - 2)
					const bx = tx + 2 + i * (barW + gap)
					ctx.fillRect(bx, cy - barH, barW, barH * 2)
				}
				ctx.restore()
			}
		}
	}

	ctx.save()
	ctx.beginPath()
	ctx.rect(visX, y, visW, h)
	ctx.clip()
	ctx.fillStyle = 'rgba(255,255,255,0.88)'
	ctx.font = `11px ${UI_FONT_FAMILY}`
	ctx.textAlign = 'left'
	ctx.fillText(clip.source.label || clip.source.value, visX + 5, y + h / 2 + 4)
	ctx.restore()

	const KF_COLORS = { opacity: '#ffd700', volume: '#4ec9b0', fill_x: '#569cd6', fill_y: '#569cd6', scale_x: '#c586c0', scale_y: '#c586c0' }
	if (clip.keyframes?.length) {
		for (const kf of clip.keyframes) {
			const kx = xAt(clip.startTime + kf.time)
			if (kx < HEADER_W || kx > canvas.width) continue
			const ky = y + h - 7
			ctx.fillStyle = KF_COLORS[kf.property] || '#ffd700'
			ctx.beginPath()
			ctx.moveTo(kx, ky - 5); ctx.lineTo(kx + 4, ky)
			ctx.lineTo(kx, ky + 5); ctx.lineTo(kx - 4, ky)
			ctx.closePath(); ctx.fill()
		}
	}

	ctx.fillStyle = 'rgba(255,255,255,0.25)'
	ctx.fillRect(x, y, 4, h)
	ctx.fillRect(x + w - 4, y, 4, h)

	if (isSelected) {
		ctx.save()
		ctx.beginPath()
		roundRect(ctx, x, y, w, h, 3)
		ctx.strokeStyle = '#58a6ff'
		ctx.lineWidth = 2
		ctx.stroke()
		ctx.restore()
	}
}
