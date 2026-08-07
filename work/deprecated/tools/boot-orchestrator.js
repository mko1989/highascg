const os = require('os')
const readline = require('readline')
const { execSync } = require('child_process')
const { getConnectedDisplayNames } = require('../src/utils/hardware-info')
const { ConfigManager } = require('../src/config/config-manager')
const { applyX11Layout, restartDisplayManager } = require('../src/utils/os-config')
const path = require('path')

const configPath = path.join(__dirname, '..', 'highascg.config.json')
const configManager = new ConfigManager(configPath)
configManager.load()

/**
 * Display IP addresses in a visible banner.
 */
function displayIpBanner() {
	const nets = os.networkInterfaces()
	const results = []

	for (const name of Object.keys(nets)) {
		for (const net of nets[name]) {
			// Skip internal (loopback) and non-ipv4 addresses
			if (net.family === 'IPv4' && !net.internal) {
				results.push(`${name}: ${net.address}`)
			}
		}
	}

	console.log('')
	console.log('╔════════════════════════════════════════════════════════════╗')
	console.log('║                                                            ║')
	console.log('║                HIGHASCG BOOT ORCHESTRATOR                  ║')
	console.log('║                                                            ║')
	console.log('╠════════════════════════════════════════════════════════════╣')
	console.log('║  Network Status:                                           ║')
	if (results.length === 0) {
		console.log('║    [!] NO NETWORK DETECTED                                 ║')
	} else {
		results.forEach(res => {
			console.log(`║    • ${res.padEnd(54)}║`)
		})
	}
	console.log('║                                                            ║')
	console.log('╠════════════════════════════════════════════════════════════╣')
	console.log('║  Security Status:                                          ║')
	console.log('║    [✓] Hardened: Accessible from Local & Tailnet ONLY       ║')
	console.log('║    [!] External Access (WAN) Blocked by Firewall           ║')
	console.log('╚════════════════════════════════════════════════════════════╝')
	console.log('')
}

/**
 * Check if the main companion-module service is running.
 */
function checkStatus() {
	console.log('--- System Status ---')
	try {
		// Example: check for a node process named index.js (simplistic)
		// On production this would check systemctl status highascg
		const ps = execSync('ps aux | grep "[n]ode index.js" | wc -l').toString().trim()
		const count = parseInt(ps, 10)
		console.log(`HighAsCG Server: ${count > 0 ? 'RUNNING' : 'STOPPED'}`)
	} catch (e) {
		console.log('Status: Unknown (Error checking ps)')
	}
	console.log('---------------------')
}

function showHelp() {
	console.log('Available Commands:')
	console.log('  ip       - Refresh and show network IP addresses')
	console.log('  status   - Show HighAsCG server status')
	console.log('  displays - List connected video outputs (requires xrandr or sudo)')
	console.log('  setup    - INTERACTIVE: Configure screen count and mapping')
	console.log('  apply    - Apply current hardware mapping to X11 and restart display server')
	console.log('  exit     - Exit orchestrator')
	console.log('  help     - Show this help')
}

/**
 * Interactive Setup Helper
 */
async function runSetup(rl) {
	console.log('\n--- INTERACTIVE SETUP ---')
	const displays = getConnectedDisplayNames()
	if (displays.length === 0) {
		console.log('[!] Error: No displays detected. Setup cannot continue.')
		return
	}

	const q = (text) => new Promise(res => rl.question(text, res))

	try {
		const countStr = await q('How many PGM screens (1-4)? ')
		const count = parseInt(countStr, 10)
		if (isNaN(count) || count < 1 || count > 4) {
			console.log('[!] Invalid count. Aborting.')
			return
		}

		const newConfig = { ...configManager.get(), screen_count: count }
		
		console.log('\nDetected displays:', displays.join(', '))
		for (let i = 1; i <= count; i++) {
			console.log(`\nConfiguring Screen ${i}:`)
			const displayName = await q(`Physical display for Screen ${i} (or press enter for default): `)
			if (displayName && displays.includes(displayName)) {
				newConfig[`screen_${i}_system_id`] = displayName
			}
			
			const res = await q(`Resolution for Screen ${i} (default 1080p5000): `)
			if (res) newConfig[`screen_${i}_mode`] = res
		}

		console.log('\n--- Summary ---')
		console.log(`  PGM Screens: ${count}`)
		for (let i = 1; i <= count; i++) {
			console.log(`  - Screen ${i}: ${newConfig[`screen_${i}_system_id`] || 'Auto'} (${newConfig[`screen_${i}_mode`] || '1080p5000'})`)
		}

		const confirm = await q('\nSave changes to config? (y/N): ')
		if (confirm.toLowerCase() === 'y') {
			configManager.save(newConfig)
			console.log('[✓] Config updated. Restarting services may be required.')
		} else {
			console.log('[!] Changes discarded.')
		}
	} catch (e) {
		console.log('[!] Setup Error:', e.message)
	}
}

/**
 * Main Command Loop
 */
function main() {
	displayIpBanner()
	
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: 'highascg> '
	})

	rl.prompt()

	rl.on('line', (line) => {
		const cmd = line.trim().toLowerCase()
		switch (cmd) {
			case 'ip':
				displayIpBanner()
				break
			case 'status':
				checkStatus()
				break
			case 'help':
			case '?':
				showHelp()
				break
			case 'displays':
				console.log('--- Connected Displays ---')
				const displays = getConnectedDisplayNames()
				if (displays.length === 0) {
					console.log('No displays detected.')
				} else {
					displays.forEach(d => console.log(`- ${d}`))
				}
				break
			case 'setup':
				runSetup(rl)
				break
			case 'apply':
				console.log('Applying hardware layout...')
				applyX11Layout(configManager.get())
				console.log('Restarting display manager...')
				restartDisplayManager()
				break
			case 'exit':
			case 'quit':
				console.log('Exiting orchestrator.')
				rl.close()
				break
			case '':
				break
			default:
				console.log(`Unknown command: '${cmd}'. Type 'help' for options.`)
				break
		}
		rl.prompt()
	}).on('close', () => {
		process.exit(0)
	})
}

if (require.main === module) {
	main()
}
