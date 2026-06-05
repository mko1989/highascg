/**
 * Local media: safe paths, ffprobe, ffmpeg thumbnails/waveform, GET /api/local-media/...
 * @see companion-module-casparcg-server/src/local-media.js
 */

'use strict'

const {
	probeMedia,
	extractWaveform,
	extractThumbnailPng,
	tryLocalThumbnailPng,
	ensureLocalThumbnailCacheForMediaIds,
	getWaveformCacheDir,
	WAVEFORM_VERSION,
} = require('./local-media-ffmpeg')
const {
	resolveSafe,
	getMediaIngestBasePath,
	normalizeMediaIdKey,
	resolveMediaFileOnDisk,
	scanMediaRecursiveForBrowser,
} = require('./local-media-paths')
const {
	handleLocalMedia,
	handleDeleteLocalMedia,
	unlinkMediaById,
	createMediaFolder,
	moveMediaFile,
} = require('./local-media-api')

module.exports = {
	handleLocalMedia,
	handleDeleteLocalMedia,
	unlinkMediaById,
	createMediaFolder,
	moveMediaFile,
	resolveMediaFileOnDisk,
	probeMedia,
	resolveSafe,
	extractThumbnailPng,
	tryLocalThumbnailPng,
	ensureLocalThumbnailCacheForMediaIds,
	extractWaveform,
	getMediaIngestBasePath,
	getWaveformCacheDir,
	scanMediaRecursiveForBrowser,
	normalizeMediaIdKey,
	WAVEFORM_VERSION,
}
