// HTTP polling instead of Socket.IO
let pollInterval = null
let currentState = {}
let speechConfig = {}

const timerEl = document.getElementById('timer')
const topAuxEl = document.getElementById('top-aux')
const bottomAuxEl = document.getElementById('bottom-aux')
const middleAuxEl = document.getElementById('middle-aux')
const internalTimeEl = document.getElementById('internal-time')
const speakButton = document.getElementById('speak-button')
const initSpeechButton = document.getElementById('init-speech-button')

// Speech synthesis setup
let speechSynth = null
let currentVoice = null
let speechInitialized = false

if ('speechSynthesis' in window) {
	speechSynth = window.speechSynthesis
	
	// Load voices when available
	const loadVoices = () => {
		const voices = speechSynth.getVoices()
		if (voices.length > 0) {
			console.log('Speech synthesis voices loaded:', voices.length, 'voices available')
			
			// Log available voices for debugging
			voices.forEach((voice, index) => {
				console.log(`Voice ${index}: ${voice.name} (${voice.lang})`)
			})
			
			// Prefer English voices, fallback to first available
			currentVoice = voices.find(voice => voice.lang.startsWith('en')) || voices[0]
			console.log('Selected voice:', currentVoice ? `${currentVoice.name} (${currentVoice.lang})` : 'None')
		}
	}
	
	// Load voices immediately and on voiceschanged event
	loadVoices()
	speechSynth.onvoiceschanged = loadVoices
} else {
	console.warn('Speech synthesis not supported in this browser')
}

function formatTime(totalSeconds) {
	const sign = totalSeconds < 0 ? '-' : ''
	const seconds = Math.abs(totalSeconds)
	const h = Math.floor(seconds / 3600)
	const m = Math.floor((seconds % 3600) / 60)
	const s = seconds % 60
	return `${sign}${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

// Convert \n to actual line breaks for display
function convertNewlines(text) {
	if (!text) return ''
	return text.replace(/\\n/g, '\n')
}

// Convert \n to HTML line breaks for display
function convertNewlinesToHTML(text) {
	if (!text) return ''
	return text.replace(/\\n/g, '<br>')
}

// HTTP API functions
async function apiRequest(endpoint, method = 'GET', data = null) {
	try {
		const url = endpoint.startsWith('http') ? endpoint : endpoint
		const options = {
			method,
			headers: {
				'Content-Type': 'application/json',
			},
		}
		
		if (data && method !== 'GET') {
			options.body = JSON.stringify(data)
		}
		
		const response = await fetch(url, options)
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}
		
		return await response.json()
	} catch (error) {
		console.error('API request failed:', error)
		return null
	}
}

// Poll for state updates
async function pollState() {
	try {
		const state = await apiRequest('state')
		if (state) {
			updateDisplay(state)
		}
	} catch (error) {
		console.error('Failed to poll state:', error)
	}
}


// Start polling
function startPolling() {
	// Initial poll
	pollState()
	
	// Poll every 500ms for real-time updates
	pollInterval = setInterval(pollState, 500)
}

// Stop polling
function stopPolling() {
	if (pollInterval) {
		clearInterval(pollInterval)
		pollInterval = null
	}
}


// Speech synthesis function
function speak(text) {
	if (!speechSynth || !currentVoice) {
		console.warn('Speech synthesis not available')
		return false
	}

	// Check if speech synthesis is initialized (user has interacted)
	if (!speechInitialized) {
		console.warn('Speech synthesis not initialized - user interaction required')
		return false
	}

	// Clean up text for speech
	const cleanText = text.replace(/(…|[._]{2,})/g, '').trim()
	if (!cleanText) return false

	// Cancel any ongoing speech
	if (speechSynth.speaking) {
		speechSynth.cancel()
	}

	const utterance = new SpeechSynthesisUtterance(cleanText)
	
	// Apply speech configuration
	utterance.rate = speechConfig.speech_rate || 1
	utterance.pitch = speechConfig.speech_pitch || 1
	utterance.volume = speechConfig.speech_volume || 1
	
	// Handle voice selection
	if (speechConfig.speech_voice && speechConfig.speech_voice !== 'auto') {
		const voices = speechSynth.getVoices()
		let selectedVoice = null
		
		if (speechConfig.speech_voice === 'custom' && speechConfig.speech_voice_custom) {
			// Custom voice name
			selectedVoice = voices.find(voice => 
				voice.name.toLowerCase().includes(speechConfig.speech_voice_custom.toLowerCase()) ||
				voice.lang.toLowerCase().includes(speechConfig.speech_voice_custom.toLowerCase())
			)
		} else {
			// Predefined voice selection
			const voiceMap = {
				'samantha': 'Samantha',
				'aaron': 'Aaron',
				'albert': 'Albert',
				'alex': 'Alex',
				'arthur': 'Arthur',
				'daniel': 'Daniel',
				'fred': 'Fred',
				'gordon': 'Gordon',
				'juni': 'Junior',
				'karen': 'Karen',
				'kathy': 'Kathy',
				'martha': 'Martha',
				'moira': 'Moira',
				'nicky': 'Nicky',
				'ralph': 'Ralph',
				'rishi': 'Rishi',
				'tessa': 'Tessa',
				'thomas': 'Thomas',
				'victoria': 'Victoria',
				'google_us': 'Google US English',
				'google_uk_female': 'Google UK English Female',
				'google_uk_male': 'Google UK English Male'
			}
			
			const targetName = voiceMap[speechConfig.speech_voice]
			if (targetName) {
				selectedVoice = voices.find(voice => voice.name === targetName)
			}
		}
		
		if (selectedVoice) {
			utterance.voice = selectedVoice
			console.log('Using selected voice:', selectedVoice.name)
		} else {
			utterance.voice = currentVoice
			console.log('Selected voice not found, using default:', currentVoice.name)
		}
	} else {
		utterance.voice = currentVoice
		console.log('Using auto-selected voice:', currentVoice.name)
	}
	
	// Set utterance properties to help with browser compatibility
	utterance.lang = utterance.voice.lang || 'en-US'
	
	// Visual feedback
	speakButton.classList.add('speaking')
	
	utterance.onstart = () => {
		console.log('Speech started:', cleanText)
	}
	
	utterance.onend = () => {
		speakButton.classList.remove('speaking')
		console.log('Speech ended')
	}
	
	utterance.onerror = (event) => {
		speakButton.classList.remove('speaking')
		console.error('Speech synthesis error:', event.error)
		
		// Handle specific error types
		if (event.error === 'not-allowed') {
			console.warn('Speech synthesis not allowed - user interaction required')
			// Reset initialization flag to require new user interaction
			speechInitialized = false
		} else if (event.error === 'network') {
			console.warn('Speech synthesis network error')
		} else if (event.error === 'synthesis-failed') {
			console.warn('Speech synthesis failed')
		}
	}
	
	utterance.onpause = () => {
		console.log('Speech paused')
		speakButton.classList.add('paused')
	}
	
	utterance.onresume = () => {
		console.log('Speech resumed')
		speakButton.classList.remove('paused')
	}
	
	try {
		speechSynth.speak(utterance)
		return true
	} catch (error) {
		console.error('Error starting speech:', error)
		speakButton.classList.remove('speaking')
		return false
	}
}

// Get text content for speech based on field
function getFieldText(field, state) {
	switch (field) {
		case 'timer':
			return formatTime(state.remaining)
		case 'top_aux':
			return (state.top_aux || '').replace(/\\n/g, ', ') // Replace \n with comma for speech
		case 'bottom_aux':
			return (state.bottom_aux || '').replace(/\\n/g, ', ') // Replace \n with comma for speech
		case 'middle_aux':
			return (state.middle_aux || '').replace(/\\n/g, ', ') // Replace \n with comma for speech
		default:
			return ''
	}
}

// Current state for speech
let continuousSpeechInterval = null

// Update continuous speech based on configuration  
function updateContinuousSpeech(config) {
	// Clear existing interval
	if (continuousSpeechInterval) {
		clearInterval(continuousSpeechInterval)
		continuousSpeechInterval = null
	}

	// Start continuous speech if enabled
	if (config.enable_speech && config.speech_trigger === 'continuous') {
		const interval = (config.speech_interval || 5) * 1000 // Convert to milliseconds
		continuousSpeechInterval = setInterval(() => {
			const fieldToSpeak = config.speech_field || 'timer'
			const textToSpeak = getFieldText(fieldToSpeak, currentState)
			if (textToSpeak) {
				speak(textToSpeak)
			}
		}, interval)
	}
}

// Update display with new state
function updateDisplay(state) {
	currentState = state
	speechConfig = state.config
	
	
	// Debug: Log configuration values (uncomment for debugging)
	// console.log('Received config:', {
	// 	timer_fontsize: state.config.timer_fontsize,
	// 	aux_fontsize: state.config.aux_fontsize,
	// 	hide_timer: state.config.hide_timer
	// })

	// Handle hide timer functionality
	if (state.config.hide_timer) {
		document.body.classList.add('timer-hidden')
		timerEl.style.display = 'none'
		middleAuxEl.style.setProperty('font-size', state.config.timer_fontsize + 'vw', 'important')
		middleAuxEl.style.fontWeight = 'bold'
	} else {
		document.body.classList.remove('timer-hidden')
		timerEl.style.display = 'block'
		middleAuxEl.style.setProperty('font-size', state.config.aux_fontsize + 'vw', 'important')
		middleAuxEl.style.fontWeight = 'normal'
		
		// Main timer display
		timerEl.textContent = formatTime(state.remaining)
		timerEl.classList.remove('blinking') // Reset blinking state

		// Set color based on thresholds and state
		if (state.remaining <= 0) {
			timerEl.style.color = 'red'
			if (state.state === 'running') {
				timerEl.classList.add('blinking')
			}
		} else if (state.state === 'running') {
			if (state.config.red && state.remaining <= state.config.red) {
				timerEl.style.color = 'red'
			} else if (state.config.amber && state.remaining <= state.config.amber) {
				timerEl.style.color = 'orange'
			} else {
				timerEl.style.color = 'white'
			}
		} else if (state.state === 'paused') {
			timerEl.style.color = 'orange'
		} else { // stopped
			timerEl.style.color = 'white'
		}

		// Apply timer font size
		timerEl.style.setProperty('font-size', state.config.timer_fontsize + 'vw', 'important')
		// console.log('Applied timer font size:', state.config.timer_fontsize + 'vw')
	}

	// Apply aux font sizes
	topAuxEl.style.setProperty('font-size', state.config.aux_fontsize + 'vw', 'important')
	bottomAuxEl.style.setProperty('font-size', state.config.aux_fontsize + 'vw', 'important')
	if (!state.config.hide_timer) {
		middleAuxEl.style.setProperty('font-size', state.config.aux_fontsize + 'vw', 'important')
	}
	// console.log('Applied aux font sizes:', state.config.aux_fontsize + 'vw')

	// Aux text content - convert \n to HTML line breaks
	topAuxEl.innerHTML = convertNewlinesToHTML(state.top_aux || '')
	bottomAuxEl.innerHTML = convertNewlinesToHTML(state.bottom_aux || '')
	middleAuxEl.innerHTML = convertNewlinesToHTML(state.middle_aux || '')

	// Speech controls visibility
	if (state.config.enable_speech) {
		document.body.classList.remove('speech-disabled')
		speakButton.disabled = false
		
		// Show initialization state
		if (!speechInitialized) {
			speakButton.classList.add('not-initialized')
			speakButton.title = 'Click anywhere to enable speech synthesis'
			initSpeechButton.style.display = 'inline-block'
		} else {
			speakButton.classList.remove('not-initialized')
			speakButton.title = 'Click to speak'
			initSpeechButton.style.display = 'none'
		}
	} else {
		document.body.classList.add('speech-disabled')
		speakButton.disabled = true
		speakButton.classList.remove('not-initialized')
		initSpeechButton.style.display = 'none'
	}


	// Handle continuous speech
	updateContinuousSpeech(state.config)

	// Internal time display
	if (state.config.show_internal_time) {
		internalTimeEl.style.display = 'block'
		// Use the time from the server to ensure consistency
		internalTimeEl.textContent = state.current_time || new Date().toLocaleTimeString()
		// Update class for corner positioning
		internalTimeEl.className = 'corner ' + state.config.time_corner
	} else {
		internalTimeEl.style.display = 'none'
	}

	// Handle pending speech requests from actions
	if (state.pending_speech_request && state.config.enable_speech) {
		const request = state.pending_speech_request
		let textToSpeak = ''
		
		if (request.field === 'custom' && request.custom_text) {
			textToSpeak = request.custom_text
		} else {
			textToSpeak = getFieldText(request.field, state)
		}
		
		if (textToSpeak) {
			speak(textToSpeak)
		}
		
		// Clear the pending request by making a request to clear it
		apiRequest('clear_speech_request')
	}
}

// Speech event handlers
speakButton.addEventListener('click', () => {
	if (currentState.config && currentState.config.enable_speech) {
		const fieldToSpeak = currentState.config.speech_field || 'timer'
		const textToSpeak = getFieldText(fieldToSpeak, currentState)
		if (textToSpeak) {
			speak(textToSpeak)
		}
	}
})

// Init speech button handler
initSpeechButton.addEventListener('click', () => {
	initializeSpeechOnInteraction()
})


// Note: Internal time is now updated via server polling every 500ms
// This ensures consistency between the corner display and any aux fields

// Clean up on page unload
window.addEventListener('beforeunload', () => {
	stopPolling()
	if (continuousSpeechInterval) {
		clearInterval(continuousSpeechInterval)
		continuousSpeechInterval = null
	}
})

// Initialize speech synthesis on user interaction
function initializeSpeechOnInteraction() {
	// Set initialization flag
	speechInitialized = true
	console.log('Speech synthesis initialized via user interaction')
	
	// Resume speech synthesis if it was paused
	if (speechSynth && speechSynth.paused) {
		speechSynth.resume()
	}
	
	// Remove the event listeners after first interaction
	document.removeEventListener('click', initializeSpeechOnInteraction)
	document.removeEventListener('keydown', initializeSpeechOnInteraction)
	document.removeEventListener('touchstart', initializeSpeechOnInteraction)
	document.removeEventListener('mousedown', initializeSpeechOnInteraction)
	document.removeEventListener('mouseup', initializeSpeechOnInteraction)
}

// Also initialize on any mouse movement (some browsers require this)
function initializeSpeechOnMouseMove() {
	if (!speechInitialized) {
		initializeSpeechOnInteraction()
		document.removeEventListener('mousemove', initializeSpeechOnMouseMove)
	}
}

// Handle page visibility changes to manage speech synthesis
document.addEventListener('visibilitychange', () => {
	if (document.hidden) {
		// Page is hidden, pause speech synthesis
		if (speechSynth && speechSynth.speaking) {
			speechSynth.pause()
			speakButton.classList.add('paused')
		}
	} else {
		// Page is visible again, resume speech synthesis
		if (speechSynth && speechSynth.paused) {
			speechSynth.resume()
			speakButton.classList.remove('paused')
		}
	}
})

// Handle window focus/blur events
window.addEventListener('blur', () => {
	// Window lost focus, pause speech synthesis
	if (speechSynth && speechSynth.speaking) {
		speechSynth.pause()
		speakButton.classList.add('paused')
	}
})

window.addEventListener('focus', () => {
	// Window gained focus, resume speech synthesis
	if (speechSynth && speechSynth.paused) {
		speechSynth.resume()
		speakButton.classList.remove('paused')
	}
})

// Start polling when page loads
document.addEventListener('DOMContentLoaded', () => {
	startPolling()
	
	// Add event listeners for user interaction to initialize speech
	document.addEventListener('click', initializeSpeechOnInteraction)
	document.addEventListener('keydown', initializeSpeechOnInteraction)
	document.addEventListener('touchstart', initializeSpeechOnInteraction)
	document.addEventListener('mousedown', initializeSpeechOnInteraction)
	document.addEventListener('mouseup', initializeSpeechOnInteraction)
	document.addEventListener('mousemove', initializeSpeechOnMouseMove)
	
	// Check font loading
	if ('fonts' in document) {
		document.fonts.load('1em Rewir').then(() => {
			console.log('Rewir font loaded successfully')
		}).catch((error) => {
			console.warn('Failed to load Rewir font, using fallback:', error)
		})
	}
}) 