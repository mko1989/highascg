import {
	InstanceBase,
	InstanceStatus,
	runEntrypoint,
	combineRgb,
} from '@companion-module/base'
import fs from 'fs'
import path from 'path'
import os from 'os'

export class CountdownTimer extends InstanceBase {
	
	constructor(internal) {
		super(internal)
	}

	async init(config) {
		this.log('debug', 'init')
		this.updateStatus(InstanceStatus.Ok)
		await this.configUpdated(config)

		this.timer_state = 'stopped'
		this.timer_remaining = 0
		this.last_set_time = 0
		this.timer_interval = null
		this.top_aux_text = ''
		this.bottom_aux_text = ''
		this.middle_aux_text = ''

		this.init_actions()
		this.init_feedbacks()
		this.init_presets()
		this.init_variables()
	}

	async destroy() {
		this.log('debug', 'destroy')
		if (this.timer_interval) {
			clearInterval(this.timer_interval)
			this.timer_interval = null
		}
		this.log('debug', 'destroy')
	}

	async configUpdated(config) {
		this.config = config
	}

	// HTTP Handler for Companion's built-in web server
	handleHttpRequest(request) {
		// Extract the filename from the path (e.g., "/instance/countdown/Rewir-Light.ttf" -> "Rewir-Light.ttf")
		const pathParts = request.path.split('/').filter(part => part.length > 0)
		const filename = pathParts[pathParts.length - 1] || ''
		const endpoint = filename.toLowerCase()
		
		this.log('debug', `HTTP request: path="${request.path}", filename="${filename}", endpoint="${endpoint}"`)

		// API endpoints
		if (request.method === 'GET') {
			// State endpoint - returns current timer state as JSON
			if (endpoint === 'state') {
				return {
					status: 200,
					body: JSON.stringify(this.getFullState()),
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': 'no-cache',
					},
				}
			}

			// Config endpoint - returns current configuration as JSON
			if (endpoint === 'config') {
				return {
					status: 200,
					body: JSON.stringify(this.config),
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': 'no-cache',
					},
				}
			}


			// Voices endpoint - returns available speech voices
			if (endpoint === 'voices') {
				// This will be handled by the web interface
				return {
					status: 200,
					body: JSON.stringify({ message: 'Voices available via web interface' }),
					headers: {
						'Content-Type': 'application/json',
					},
				}
			}

			// Control endpoint - handles timer control via GET parameters
			if (endpoint === 'control') {
				const action = request.query.action
				if (action === 'start') {
					this.start_timer()
				} else if (action === 'pause') {
					this.pause_timer()
				} else if (action === 'stop') {
					this.stop_timer()
				}
				return {
					status: 200,
					body: JSON.stringify({ success: true, action }),
					headers: {
						'Content-Type': 'application/json',
					},
				}
			}

			// Set timer endpoint
			if (endpoint === 'set') {
				const time = request.query.time
				if (time) {
					const parts = time.split(':').map(Number)
					if (parts.length === 3) {
						const seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
						this.set_timer(seconds)
						return {
							status: 200,
							body: JSON.stringify({ success: true, time: seconds }),
							headers: {
								'Content-Type': 'application/json',
							},
						}
					}
				}
				return {
					status: 400,
					body: JSON.stringify({ error: 'Invalid time format. Use HH:MM:SS' }),
					headers: {
						'Content-Type': 'application/json',
					},
				}
			}

			// Add/Subtract time endpoints
			if (endpoint === 'add' || endpoint === 'subtract') {
				const time = request.query.time
				if (time) {
					const parts = time.split(':').map(Number)
					if (parts.length === 3) {
						const seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
						if (endpoint === 'add') {
							this.timer_remaining += seconds
						} else {
							this.timer_remaining -= seconds
						}
						this.update_variables()
						return {
							status: 200,
							body: JSON.stringify({ success: true, action: endpoint, time: seconds }),
							headers: {
								'Content-Type': 'application/json',
							},
						}
					}
				}
				return {
					status: 400,
					body: JSON.stringify({ error: 'Invalid time format. Use HH:MM:SS' }),
					headers: {
						'Content-Type': 'application/json',
					},
				}
			}

			// Set aux text endpoints
			if (endpoint === 'setaux') {
				const field = request.query.field
				const text = request.query.text || ''
				
				if (field === 'top') {
					this.top_aux_text = text
				} else if (field === 'bottom') {
					this.bottom_aux_text = text
				} else if (field === 'middle') {
					this.middle_aux_text = text
				} else {
					return {
						status: 400,
						body: JSON.stringify({ error: 'Invalid field. Use top, bottom, or middle' }),
						headers: {
							'Content-Type': 'application/json',
						},
					}
				}
				
				return {
					status: 200,
					body: JSON.stringify({ success: true, field, text }),
					headers: {
						'Content-Type': 'application/json',
					},
				}
			}

			// Speak endpoint
			if (endpoint === 'speak') {
				const field = request.query.field
				const custom_text = request.query.custom_text
				
				// Store speech request for the web interface to pick up
				this.pending_speech_request = {
					field: field || 'timer',
					custom_text: custom_text || null,
					timestamp: Date.now()
				}
				
				return {
					status: 200,
					body: JSON.stringify({ success: true, action: 'speak' }),
					headers: {
						'Content-Type': 'application/json',
					},
				}
			}

			// Clear speech request endpoint
			if (endpoint === 'clear_speech_request') {
				this.pending_speech_request = null
				return {
					status: 200,
					body: JSON.stringify({ success: true, action: 'clear_speech_request' }),
					headers: {
						'Content-Type': 'application/json',
					},
				}
			}

			// Serve static files
			if (endpoint === '' || endpoint === 'index.html') {
				return this.serveStaticFile('index.html', 'text/html')
			}

			// Serve other static files
			const staticFiles = ['script.js', 'style.css', 'favicon.ico', 'icon.png', 'rewir-light.ttf']
			if (staticFiles.includes(endpoint)) {
				this.log('debug', `Static file requested: ${filename}`)
				const contentType = this.getContentType(filename)
				return this.serveStaticFile(filename, contentType)
			}

			// Socket.IO client (if needed for compatibility)
			if (endpoint.startsWith('socket.io/')) {
				return {
					status: 404,
					body: JSON.stringify({ error: 'WebSocket connections not supported in HTTP handler mode' }),
					headers: {
						'Content-Type': 'application/json',
					},
				}
			}
		}

		// POST endpoints for more complex operations
		if (request.method === 'POST') {
			if (endpoint === 'control') {
				try {
					const body = JSON.parse(request.body || '{}')
					const action = body.action
					
					if (action === 'start') {
						this.start_timer()
					} else if (action === 'pause') {
						this.pause_timer()
					} else if (action === 'stop') {
						this.stop_timer()
					} else if (action === 'set') {
						const time = body.time
						if (time) {
							const parts = time.split(':').map(Number)
							if (parts.length === 3) {
								const seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
								this.set_timer(seconds)
							}
						}
					}
					
					return {
						status: 200,
						body: JSON.stringify({ success: true, action }),
						headers: {
							'Content-Type': 'application/json',
						},
					}
				} catch (error) {
					return {
						status: 400,
						body: JSON.stringify({ error: 'Invalid JSON body' }),
						headers: {
							'Content-Type': 'application/json',
						},
					}
				}
			}
		}

		// Default 404 response
		return {
			status: 404,
			body: JSON.stringify({ 
				status: 404, 
				error: `API endpoint ${endpoint} for connection ${this.label} not found`,
				available_endpoints: [
					'GET /state - Get current timer state',
					'GET /config - Get current configuration',
					'GET /control?action=start|pause|stop - Control timer',
					'GET /set?time=HH:MM:SS - Set timer',
					'GET /add?time=HH:MM:SS - Add time',
					'GET /subtract?time=HH:MM:SS - Subtract time',
					'GET /setaux?field=top|bottom|middle&text=... - Set aux text',
					'GET /speak?field=timer|top_aux|bottom_aux|middle_aux|custom&custom_text=... - Trigger speech',
					'GET /clear_speech_request - Clear pending speech request',
					'GET / - Web interface'
				]
			}),
			headers: {
				'Content-Type': 'application/json',
			},
		}
	}

	serveStaticFile(filename, contentType) {
		// Find the module directory - in production, files are in the same directory as main.js
		// In development, they're in the public/ directory relative to src/
		let staticDir = process.cwd()
		
		// Try to detect if we're in a packaged module by checking for main.js
		try {
			// Check if main.js exists in current directory (production)
			if (fs.existsSync(path.join(process.cwd(), 'main.js'))) {
				staticDir = process.cwd()
				this.log('debug', 'Detected production environment - serving from module root')
			} else {
				// Development mode - serve from public directory
				staticDir = path.join(process.cwd(), 'public')
				this.log('debug', 'Detected development environment - serving from public/')
			}
		} catch (error) {
			this.log('warn', `Error detecting environment: ${error.message}`)
			staticDir = process.cwd()
		}
		
		this.log('debug', `Static directory: ${staticDir}`)

		// Special handling for font files - try multiple locations
		if (filename === 'Rewir-Light.ttf') {
			this.log('debug', `Looking for font file: ${filename}`)
			this.log('debug', `Static dir: ${staticDir}`)
			this.log('debug', `Current working directory: ${process.cwd()}`)
			
			const possiblePaths = [
				path.join(staticDir, filename),
				path.join(staticDir, 'public', filename),
				path.join(process.cwd(), 'public', filename),
				path.join(process.cwd(), filename)
			]
			
			this.log('debug', `Checking paths: ${possiblePaths.join(', ')}`)
			
			for (const filePath of possiblePaths) {
				if (fs.existsSync(filePath)) {
					this.log('debug', `Found font file at: ${filePath}`)
					try {
						const content = fs.readFileSync(filePath)
						this.log('debug', `Font file loaded successfully, size: ${content.length} bytes`)
						return {
							status: 200,
							body: content,
							headers: {
								'Content-Type': 'font/ttf',
								'Cache-Control': 'public, max-age=86400',
							},
						}
					} catch (error) {
						this.log('error', `Error reading font file: ${error.message}`)
					}
				} else {
					this.log('debug', `Font file not found at: ${filePath}`)
				}
			}
			
			this.log('warn', `Font file not found in any location: ${filename}`)
			return {
				status: 404,
				body: JSON.stringify({ error: `Font file ${filename} not found` }),
				headers: {
					'Content-Type': 'application/json',
				},
			}
		}

		const filePath = path.join(staticDir, filename)
		
		try {
			if (fs.existsSync(filePath)) {
				const content = fs.readFileSync(filePath)
				
				// For binary files, return content as-is. For text files, convert to string
				const isBinaryFile = ['.ico', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ttf', '.woff', '.woff2'].includes(path.extname(filename).toLowerCase())
				
				return {
					status: 200,
					body: isBinaryFile ? content : content.toString(),
					headers: {
						'Content-Type': contentType,
						'Cache-Control': 'public, max-age=3600',
					},
				}
			} else {
				this.log('debug', `File not found at: ${filePath}`)
				return {
					status: 404,
					body: JSON.stringify({ error: `File ${filename} not found` }),
					headers: {
						'Content-Type': 'application/json',
					},
				}
			}
		} catch (error) {
			this.log('error', `Error serving file ${filename}: ${error.message}`)
			return {
				status: 500,
				body: JSON.stringify({ error: 'Internal server error' }),
				headers: {
					'Content-Type': 'application/json',
				},
			}
		}
	}

	getContentType(filename) {
		const ext = path.extname(filename).toLowerCase()
		const contentTypes = {
			'.html': 'text/html',
			'.js': 'application/javascript',
			'.css': 'text/css',
			'.ico': 'image/x-icon',
			'.png': 'image/png',
			'.jpg': 'image/jpeg',
			'.jpeg': 'image/jpeg',
			'.gif': 'image/gif',
			'.svg': 'image/svg+xml',
			'.ttf': 'font/ttf',
			'.woff': 'font/woff',
			'.woff2': 'font/woff2',
		}
		return contentTypes[ext] || 'application/octet-stream'
	}

	getAvailableIPs() {
		const interfaces = os.networkInterfaces()
		const ips = []
		
		for (const name of Object.keys(interfaces)) {
			for (const iface of interfaces[name]) {
				// Skip internal (localhost) and non-IPv4 addresses
				if (iface.family === 'IPv4' && !iface.internal) {
					ips.push(iface.address)
				}
			}
		}
		
		return ips
	}

	getCurrentPort() {
		// Just use the default port 8000
		return 8000
	}

	getAccessLinks() {
		const ips = this.getAvailableIPs()
		const instanceName = this.label || 'countdown'
		const links = []
		const port = this.getCurrentPort()
		
		for (const ip of ips) {
			links.push(`http://${ip}:${port}/instance/${instanceName}/`)
		}
		
		return links
	}

	getHttpInfoText() {
		const links = this.getAccessLinks()
		const instanceName = this.label || 'countdown'
		
		let text = `This module uses Companion's built-in HTTP handler.\n\n`
		
		if (links.length > 0) {
			text += `Access the web display at:\n`
			links.forEach(link => {
				text += `${link}\n`
			})
		} else {
			text += `Access via: /instance/${instanceName}/\n`
		}
		
		text += `\nIf Companion is not using the default port 8000, change the port number in the URL above to match your Companion configuration.`
		
		return text
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'http_info',
				label: 'HTTP Handler Information',
				width: 12,
				value: this.getHttpInfoText(),
			},
			{
				type: 'checkbox',
				id: 'show_internal_time',
				label: 'Show Internal Time',
				default: false,
			},
			{
				type: 'dropdown',
				id: 'time_corner',
				label: 'Time Corner',
				width: 12,
				default: 'top-left',
				choices: [
					{ id: 'top-left', label: 'Top Left' },
					{ id: 'top-middle', label: 'Top Middle' },
					{ id: 'top-right', label: 'Top Right' },
					{ id: 'bottom-left', label: 'Bottom Left' },
					{ id: 'bottom-middle', label: 'Bottom Middle' },
					{ id: 'bottom-right', label: 'Bottom Right' },
				],
			},
			{
				type: 'checkbox',
				id: 'hide_timer',
				label: 'Hide Timer (Show Third Aux Field Instead)',
				default: false,
			},
			{
				type: 'number',
				id: 'amber_time',
				label: 'Amber Time (seconds)',
				width: 6,
				default: 180,
				min: 1,
				max: 7200,
			},
			{
				type: 'number',
				id: 'red_time',
				label: 'Red Time (seconds)',
				width: 6,
				default: 60,
				min: 1,
				max: 7200,
			},
			{
				type: 'number',
				id: 'timer_fontsize',
				label: 'Timer Font Size (vw)',
				width: 6,
				default: 15,
				min: 1,
				max: 100,
			},
			{
				type: 'number',
				id: 'aux_fontsize',
				label: 'Aux Font Size (vw)',
				width: 6,
				default: 5,
				min: 1,
				max: 50,
			},
			{
				type: 'static-text',
				id: 'speech_section',
				label: 'Speech Synthesis Settings',
				width: 12,
				value: '',
			},
			{
				type: 'checkbox',
				id: 'enable_speech',
				label: 'Enable Speech Synthesis',
				default: false,
			},
			{
				type: 'dropdown',
				id: 'speech_field',
				label: 'Field to Read Aloud',
				width: 12,
				default: 'timer',
				choices: [
					{ id: 'timer', label: 'Timer' },
					{ id: 'top_aux', label: 'Top Aux Text' },
					{ id: 'bottom_aux', label: 'Bottom Aux Text' },
					{ id: 'middle_aux', label: 'Middle Aux Text' },
				],
				isVisible: (options) => options.enable_speech === true,
			},


			{
				type: 'number',
				id: 'speech_rate',
				label: 'Speech Rate',
				width: 4,
				default: 1,
				min: 0.1,
				max: 3,
				step: 0.1,
				isVisible: (options) => options.enable_speech === true,
			},
			{
				type: 'number',
				id: 'speech_pitch',
				label: 'Speech Pitch',
				width: 4,
				default: 1,
				min: 0,
				max: 2,
				step: 0.1,
				isVisible: (options) => options.enable_speech === true,
			},
			{
				type: 'number',
				id: 'speech_volume',
				label: 'Speech Volume',
				width: 4,
				default: 1,
				min: 0,
				max: 1,
				step: 0.1,
				isVisible: (options) => options.enable_speech === true,
			},
			{
				type: 'dropdown',
				id: 'speech_voice',
				label: 'Speech Voice',
				width: 12,
				default: 'auto',
				choices: [
					{ id: 'auto', label: 'Auto-select (English)' },
					{ id: 'samantha', label: 'Samantha (en-US)' },
					{ id: 'aaron', label: 'Aaron (en-US)' },
					{ id: 'albert', label: 'Albert (en-US)' },
					{ id: 'alex', label: 'Alex (en-US)' },
					{ id: 'arthur', label: 'Arthur (en-GB)' },
					{ id: 'daniel', label: 'Daniel (en-GB)' },
					{ id: 'fred', label: 'Fred (en-US)' },
					{ id: 'gordon', label: 'Gordon (en-AU)' },
					{ id: 'juni', label: 'Junior (en-US)' },
					{ id: 'karen', label: 'Karen (en-AU)' },
					{ id: 'kathy', label: 'Kathy (en-US)' },
					{ id: 'martha', label: 'Martha (en-GB)' },
					{ id: 'moira', label: 'Moira (en-IE)' },
					{ id: 'nicky', label: 'Nicky (en-US)' },
					{ id: 'ralph', label: 'Ralph (en-US)' },
					{ id: 'rishi', label: 'Rishi (en-IN)' },
					{ id: 'tessa', label: 'Tessa (en-ZA)' },
					{ id: 'thomas', label: 'Thomas (fr-FR)' },
					{ id: 'victoria', label: 'Victoria (en-GB)' },
					{ id: 'google_us', label: 'Google US English (en-US)' },
					{ id: 'google_uk_female', label: 'Google UK English Female (en-GB)' },
					{ id: 'google_uk_male', label: 'Google UK English Male (en-GB)' },
					{ id: 'custom', label: 'Custom (enter below)' },
				],
				isVisible: (options) => options.enable_speech === true,
			},
			{
				type: 'textinput',
				id: 'speech_voice_custom',
				label: 'Custom Voice Name',
				width: 12,
				default: '',
				isVisible: (options) => options.enable_speech === true && options.speech_voice === 'custom',
			},
		]
	}

	init_actions() {
		this.setActionDefinitions({
			set_timer: {
				name: 'Set Timer',
				options: [
					{
						type: 'textinput',
						id: 'time',
						label: 'Time (HH:MM:SS)',
						default: '00:05:00',
						regex: '/^\\d{2}:\\d{2}:\\d{2}$/',
					},
				],
				callback: async (action) => {
					const time = action.options.time
					const parts = time.split(':').map(Number)
					if (parts.length === 3) {
						const seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
						this.set_timer(seconds)
					}
				},
			},
			control: {
				name: 'Control Timer',
				options: [
					{
						type: 'dropdown',
						id: 'action',
						label: 'Action',
						default: 'start',
						choices: [
							{ id: 'start', label: 'Start' },
							{ id: 'pause', label: 'Pause' },
							{ id: 'stop', label: 'Stop' },
						],
					},
				],
				callback: async (action) => {
					if (action.options.action === 'start') {
						this.start_timer()
					} else if (action.options.action === 'pause') {
						this.pause_timer()
					} else if (action.options.action === 'stop') {
						this.stop_timer()
					}
				},
			},
			add_time: {
				name: 'Add Time',
				options: [
					{
						type: 'textinput',
						id: 'time',
						label: 'Time (HH:MM:SS)',
						default: '00:01:00',
						regex: '/^\\d{2}:\\d{2}:\\d{2}$/',
					},
				],
				callback: async (action) => {
					const time = action.options.time
					const parts = time.split(':').map(Number)
					if (parts.length === 3) {
						const seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
						this.timer_remaining += seconds
						this.update_variables()
						this.broadcastState()
					}
				},
			},
			subtract_time: {
				name: 'Subtract Time',
				options: [
					{
						type: 'textinput',
						id: 'time',
						label: 'Time (HH:MM:SS)',
						default: '00:01:00',
						regex: '/^\\d{2}:\\d{2}:\\d{2}$/',
					},
				],
				callback: async (action) => {
					const time = action.options.time
					const parts = time.split(':').map(Number)
					if (parts.length === 3) {
						const seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
						this.timer_remaining -= seconds
						this.update_variables()
						this.broadcastState()
					}
				},
			},
			set_top_aux: {
				name: 'Set Top Aux Text',
				options: [
					{
						type: 'textinput',
						id: 'text',
						label: 'Text',
						default: '',
						useVariables: true,
					},
				],
				callback: async (action) => {
					const text = await this.parseVariablesInString(action.options.text)
					this.top_aux_text = text
					this.broadcastState()
				},
			},
			set_bottom_aux: {
				name: 'Set Bottom Aux Text',
				options: [
					{
						type: 'textinput',
						id: 'text',
						label: 'Text',
						default: '',
						useVariables: true,
					},
				],
				callback: async (action) => {
					const text = await this.parseVariablesInString(action.options.text)
					this.bottom_aux_text = text
					this.broadcastState()
				},
			},
			set_middle_aux: {
				name: 'Set Middle Aux Text',
				options: [
					{
						type: 'textinput',
						id: 'text',
						label: 'Text',
						default: '',
						useVariables: true,
					},
				],
				callback: async (action) => {
					const text = await this.parseVariablesInString(action.options.text)
					this.middle_aux_text = text
					this.broadcastState()
				},
			},
			speak_text: {
				name: 'Speak Text',
				options: [
					{
						type: 'dropdown',
						id: 'field',
						label: 'Field to Speak',
						default: 'timer',
						choices: [
							{ id: 'timer', label: 'Timer' },
							{ id: 'top_aux', label: 'Top Aux Text' },
							{ id: 'bottom_aux', label: 'Bottom Aux Text' },
							{ id: 'middle_aux', label: 'Middle Aux Text' },
							{ id: 'custom', label: 'Custom Text' },
						],
					},
					{
						type: 'textinput',
						id: 'custom_text',
						label: 'Custom Text',
						default: '',
						useVariables: true,
						isVisible: (options) => options.field === 'custom',
					},
				],
				callback: async (action) => {
					// Store speech request in instance state for the web interface to pick up
					const field = action.options.field
					const custom_text = action.options.field === 'custom' ? await this.parseVariablesInString(action.options.custom_text) : null
					
					// Store the speech request
					this.pending_speech_request = {
						field: field,
						custom_text: custom_text,
						timestamp: Date.now()
					}
					
					this.log('debug', `Speech request stored: ${field}`)
				},
			},
		})
	}

	init_feedbacks() {
		const feedbacks = {
			state_color: {
				type: 'advanced',
				name: 'Timer State Color',
				description: 'Change color based on timer state',
				options: [],
				callback: ({ options }) => {
					let style = {
						color: combineRgb(255, 255, 255),
						bgcolor: combineRgb(0, 0, 0),
					}

					if (this.timer_state === 'running') {
						if (this.timer_remaining <= 0 || (this.config.red_time && this.timer_remaining <= this.config.red_time)) {
							style.bgcolor = combineRgb(204, 0, 0) // Red
						} else if (this.config.amber_time && this.timer_remaining <= this.config.amber_time) {
							style.bgcolor = combineRgb(255, 128, 0) // Amber
						} else {
							style.bgcolor = combineRgb(0, 204, 0) // Green
						}
					} else if (this.timer_state === 'paused') {
						style.bgcolor = combineRgb(255, 128, 0) // Amber
					}

					return style
				},
			},
			selected_time: {
				type: 'boolean',
				name: 'Is Selected Time',
				description: 'Change style if the time is the last one set',
				defaultStyle: {
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(0, 0, 255), // Blue
				},
				options: [
					{
						type: 'number',
						id: 'time',
						label: 'Time (seconds)',
						default: 300,
					},
				],
				callback: (feedback) => {
					return this.last_set_time === feedback.options.time
				},
			},
		}
		this.setFeedbackDefinitions(feedbacks)
	}

	init_presets() {
		const presets = {}
		const foregroundColor = combineRgb(255, 255, 255)
		const backgroundColor = combineRgb(0, 0, 0)

		presets['timer_display'] = {
			type: 'button',
			category: 'Timer Display',
			name: 'Timer Display with State Colors',
			style: {
				text: `$(internal:timer_hms)`,
				size: '18',
				color: foregroundColor,
				bgcolor: backgroundColor,
			},
			steps: [
				{
					down: [{ actionId: 'control', options: { action: 'start' } }],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'state_color',
					options: {},
				},
			],
		}

		presets['start_timer'] = {
			type: 'button',
			category: 'Timer Control',
			name: 'Start Timer',
			style: {
				text: 'START',
				size: '18',
				color: foregroundColor,
				bgcolor: combineRgb(0, 204, 0),
			},
			steps: [
				{
					down: [{ actionId: 'control', options: { action: 'start' } }],
					up: [],
				},
			],
			feedbacks: [],
		}

		presets['pause_timer'] = {
			type: 'button',
			category: 'Timer Control',
			name: 'Pause Timer',
			style: {
				text: 'PAUSE',
				size: '18',
				color: foregroundColor,
				bgcolor: combineRgb(255, 128, 0),
			},
			steps: [
				{
					down: [{ actionId: 'control', options: { action: 'pause' } }],
					up: [],
				},
			],
			feedbacks: [],
		}

		presets['stop_timer'] = {
			type: 'button',
			category: 'Timer Control',
			name: 'Stop Timer',
			style: {
				text: 'STOP',
				size: '18',
				color: foregroundColor,
				bgcolor: combineRgb(204, 0, 0),
			},
			steps: [
				{
					down: [{ actionId: 'control', options: { action: 'stop' } }],
					up: [],
				},
			],
			feedbacks: [],
		}

		const set_times = [60, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000, 3300, 3600, 3900, 4200, 4500, 4800, 5100, 5400, 5700, 6000, 6300, 6600, 6900, 7200]
		for (const time of set_times) {
			const h = Math.floor(time / 3600)
			const m = Math.floor((time % 3600) / 60)
			const s = time % 60
			const time_hms = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
			const name = `${h > 0 ? `${h}h` : ''}${m > 0 ? `${m}m` : ''}${s > 0 ? `${s}s` : ''}`

			presets[`set_${time}s`] = {
				type: 'button',
				category: 'Set Timer',
				name: `Set timer to ${name}`,
				style: {
					text: `${name}`,
					size: '18',
					color: foregroundColor,
					bgcolor: backgroundColor,
				},
				steps: [
					{
						down: [{ actionId: 'set_timer', options: { time: time_hms } }],
						up: [],
					},
				],
				feedbacks: [
					{
						feedbackId: 'selected_time',
						options: {
							time: time,
						},
						style: {
							bgcolor: combineRgb(0, 0, 255), // Blue
						}
					},
				],
			}
		}
		
		presets['add_minute'] = {
			type: 'button',
			category: 'Adjust Time',
			name: 'Add 1 Minute',
			style: {
				text: '+1 MIN',
				size: '18',
				color: foregroundColor,
				bgcolor: backgroundColor,
			},
			steps: [
				{
					down: [{ actionId: 'add_time', options: { time: '00:01:00' } }],
					up: [],
				},
			],
			feedbacks: [],
		}

		presets['subtract_minute'] = {
			type: 'button',
			category: 'Adjust Time',
			name: 'Subtract 1 Minute',
			style: {
				text: '-1 MIN',
				size: '18',
				color: foregroundColor,
				bgcolor: backgroundColor,
			},
			steps: [
				{
					down: [{ actionId: 'subtract_time', options: { time: '00:01:00' } }],
					up: [],
				},
			],
			feedbacks: [],
		}



		this.setPresetDefinitions(presets)
	}

	init_variables() {
		const variables = [
			{ variableId: 'timer_hms', name: 'Timer (HH:MM:SS)' },
			{ variableId: 'timer_hm', name: 'Timer (HH:MM)' },
			{ variableId: 'timer_ms', name: 'Timer (MM:SS)' },
			{ variableId: 'timer_s', name: 'Timer (seconds)' },
			{ variableId: 'top_aux_text', name: 'Top Aux Text' },
			{ variableId: 'bottom_aux_text', name: 'Bottom Aux Text' },
			{ variableId: 'middle_aux_text', name: 'Middle Aux Text' },
		]
		this.setVariableDefinitions(variables)
		this.update_variables()
	}

	getFullState() {
		return {
			remaining: this.timer_remaining,
			state: this.timer_state,
			top_aux: this.top_aux_text,
			bottom_aux: this.bottom_aux_text,
			middle_aux: this.middle_aux_text,
			pending_speech_request: this.pending_speech_request,
			current_time: new Date().toLocaleTimeString(), // Add current time to state
			config: {
				amber: this.config.amber_time,
				red: this.config.red_time,
				show_internal_time: this.config.show_internal_time,
				time_corner: this.config.time_corner,
				timer_fontsize: this.config.timer_fontsize,
				aux_fontsize: this.config.aux_fontsize,
				hide_timer: this.config.hide_timer,
				enable_speech: this.config.enable_speech,
				speech_field: this.config.speech_field,
				speech_rate: this.config.speech_rate,
				speech_pitch: this.config.speech_pitch,
				speech_volume: this.config.speech_volume,
				speech_voice: this.config.speech_voice,
				speech_voice_custom: this.config.speech_voice_custom,
			},
		}
	}

	broadcastState() {
		// In HTTP handler mode, we don't need to broadcast state
		// The web interface will poll for updates
		this.log('debug', 'State updated - web interface will poll for changes')
	}





	update_variables() {
		const seconds = Math.abs(this.timer_remaining)
		const sign = this.timer_remaining < 0 ? '-' : ''
		const h = Math.floor(seconds / 3600)
		const m = Math.floor((seconds % 3600) / 60)
		const s = seconds % 60

		const hms = `${sign}${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
		const hm = `${sign}${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
		const ms = `${sign}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`

		this.setVariableValues({
			timer_hms: hms,
			timer_hm: hm,
			timer_ms: ms,
			timer_s: this.timer_remaining.toString(),
			top_aux_text: this.top_aux_text,
			bottom_aux_text: this.bottom_aux_text,
			middle_aux_text: this.middle_aux_text,
		})
	}

	set_timer(seconds) {
		this.log('debug', `set_timer: ${seconds}s`)
		if (this.timer_interval) {
			clearInterval(this.timer_interval)
			this.timer_interval = null
		}
		this.timer_remaining = seconds
		this.last_set_time = seconds
		this.timer_state = 'stopped'
		this.update_variables()
		this.broadcastState()
		this.checkFeedbacks('state_color', 'selected_time')
	}

	start_timer() {
		this.log('debug', `start_timer. state: ${this.timer_state}, interval: ${this.timer_interval}`)
		if (this.timer_state !== 'running') {
					this.timer_state = 'running'
		this.timer_interval = setInterval(() => this.tick(), 1000)
		this.log('debug', `start_timer: new interval ${this.timer_interval}`)
		this.broadcastState()
		this.checkFeedbacks('state_color')
		}
	}

	pause_timer() {
		this.log('debug', `pause_timer. state: ${this.timer_state}, interval: ${this.timer_interval}`)
		if (this.timer_state === 'running') {
			this.timer_state = 'paused'
			if (this.timer_interval) {
				clearInterval(this.timer_interval)
				this.log('debug', `pause_timer: cleared interval ${this.timer_interval}`)
				this.timer_interval = null
			}
			this.broadcastState()
			this.checkFeedbacks('state_color')
		}
	}

	stop_timer() {
		this.log('debug', `stop_timer. state: ${this.timer_state}, interval: ${this.timer_interval}`)
		this.timer_state = 'stopped'
		if (this.timer_interval) {
			clearInterval(this.timer_interval)
			this.log('debug', `stop_timer: cleared interval ${this.timer_interval}`)
			this.timer_interval = null
		}
		this.timer_remaining = this.last_set_time
		this.update_variables()
		this.broadcastState()
		this.checkFeedbacks('state_color')
	}

	tick() {
		if (this.timer_state === 'running') {
			this.timer_remaining--

			this.update_variables()
			this.checkFeedbacks('state_color')
			this.broadcastState()
		}
	}
} 