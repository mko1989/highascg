/**
 * The join address as a QR code (WO-1074). The matrix comes from the vendored `qrcode-generator` (MIT, Kazuhiko Arase,
 * vendor/qrcode-generator.mjs — no network needed, the venue may be offline); this file only draws it. The code is drawn
 * on a canvas inside the host panel — like everything else in the game, it never reaches a screen by itself.
 */
import qrcode from './vendor/qrcode-generator.mjs'

export const QR_QUIET = 4 // quiet zone, modules (the QR standard asks for 4)

/** `text` → square matrix of booleans (true = dark), error correction M, smallest version that fits. */
export function qrMatrix(text) {
	const qr = qrcode(0, 'M')
	qr.addData(String(text), 'Byte')
	qr.make()
	const n = qr.getModuleCount()
	return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)))
}

/** Draw `matrix` black on white with its quiet zone; `px` = canvas pixels per module. */
export function drawQr(canvas, matrix, px = 8) {
	const size = (matrix.length + QR_QUIET * 2) * px
	canvas.width = canvas.height = size
	const g = canvas.getContext('2d')
	g.fillStyle = '#fff'
	g.fillRect(0, 0, size, size)
	g.fillStyle = '#000'
	matrix.forEach((row, r) =>
		row.forEach((dark, c) => {
			if (dark) g.fillRect((c + QR_QUIET) * px, (r + QR_QUIET) * px, px, px)
		})
	)
}
