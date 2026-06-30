import { defineConfig } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const repoDir = path.dirname(fileURLToPath(import.meta.url))
const clientDir = path.join(repoDir, 'client')

function copyMapDataPlugin() {
	return {
		name: 'highascg-copy-map-data',
		closeBundle() {
			const outDir = path.join(repoDir, 'dist-map', 'assets')
			const src = path.join(clientDir, 'assets', 'map-data.json')
			if (fs.existsSync(src)) {
				fs.mkdirSync(outDir, { recursive: true })
				fs.copyFileSync(src, path.join(outDir, 'map-data.json'))
			}
		}
	}
}

export default defineConfig({
	root: 'client',
	base: './',
	plugins: [copyMapDataPlugin()],
	build: {
		outDir: '../dist-map',
		emptyOutDir: true,
		rollupOptions: {
			input: {
				map: path.join(clientDir, 'map.html')
			}
		}
	}
})
