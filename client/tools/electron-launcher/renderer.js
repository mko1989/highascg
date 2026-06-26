const { ipcRenderer } = require('electron')
const path = require('path')
const fs = require('fs')

function loadWebuiPort() {
  const candidates = [
    path.join(__dirname, 'lib/webui-port.cjs'),
    path.join(__dirname, '../../lib/webui-port.cjs'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return require(c).WEBUI_PORT
    }
  }
  return 4350
}

const WEBUI_PORT = loadWebuiPort()

// Tab Navigation
const navItems = document.querySelectorAll('.nav-menu .nav-item')
const tabPanes = document.querySelectorAll('.tab-pane')
const pageTitle = document.getElementById('page-title')
const pageSubtitle = document.getElementById('page-subtitle')

const pageMeta = {
  flash: { title: 'Flashing Guide', subtitle: 'How to flash the bootable live ISO image' },
  partition: { title: 'Partitioning & exFAT Guide', subtitle: 'Create the exFAT HIGHASCGEXF storage partition' },
  simulation: { title: 'Simulation Center', subtitle: 'Run HighAsCG locally in simulated offline mode' },
  modules: { title: 'Modules', subtitle: 'Enable optional Web UI features loaded from this launcher' },
}

let isSimRunning = false
let activeTab = 'simulation'
let usbPollTimer = null

function switchTab(tabId) {
  activeTab = tabId
  navItems.forEach(item => {
    if (item.getAttribute('data-tab') === tabId) {
      item.classList.add('active')
    } else {
      item.classList.remove('active')
    }
  })

  tabPanes.forEach(pane => {
    if (pane.id === `tab-${tabId}`) {
      pane.classList.add('active')
    } else {
      pane.classList.remove('active')
    }
  })

  if (pageMeta[tabId]) {
    pageTitle.textContent = pageMeta[tabId].title
    pageSubtitle.textContent = pageMeta[tabId].subtitle
  }

  scheduleUsbPolling()
}

navItems.forEach(item => {
  item.addEventListener('click', () => {
    switchTab(item.getAttribute('data-tab'))
  })
})



// Inner OS Tab Navigation (Partition Tab)
const innerTabs = document.querySelectorAll('.inner-tab')
const osGuides = document.querySelectorAll('.os-guide')

innerTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    innerTabs.forEach(t => t.classList.remove('active'))
    tab.classList.add('active')

    const targetOs = tab.getAttribute('data-os')
    osGuides.forEach(guide => {
      if (guide.id === `guide-${targetOs}`) {
        guide.classList.add('active')
      } else {
        guide.classList.remove('active')
      }
    })
  })
})

// USB Drive & Payload Status Polling
const usbIndicator = document.getElementById('usb-indicator')
const usbLabelText = document.getElementById('usb-label-text')
const usbDescText = document.getElementById('usb-desc-text')

const checkUsb = document.getElementById('check-usb')
const checkUsbDetails = document.getElementById('check-usb-details')
const checkPayload = document.getElementById('check-payload')
const checkPayloadDetails = document.getElementById('check-payload-details')

async function pollUsbStatus() {
  try {
    const status = await ipcRenderer.invoke('check-usb-status')
    if (status.mounted) {
      if (usbIndicator) usbIndicator.className = 'indicator-dot status-success'
      if (usbLabelText) usbLabelText.textContent = 'HIGHASCGEXF Connected'
      if (usbDescText) usbDescText.textContent = `Mounted at ${status.path}`

      if (checkUsb) {
        checkUsb.classList.add('checked')
        const cb = checkUsb.querySelector('.check-box')
        if (cb) cb.textContent = '✓'
      }
      if (checkUsbDetails) {
        checkUsbDetails.textContent = `USB stick detected exFAT volume mounted at: ${status.path}`
      }

      if (status.hasPayload) {
        if (checkPayload) {
          checkPayload.classList.add('checked')
          const cb = checkPayload.querySelector('.check-box')
          if (cb) cb.textContent = '✓'
        }
        if (checkPayloadDetails) {
          checkPayloadDetails.textContent = `Payload package.json verified at: ${status.payloadPath}`
        }
      } else {
        if (checkPayload) {
          checkPayload.classList.remove('checked')
          const cb = checkPayload.querySelector('.check-box')
          if (cb) cb.textContent = '!'
        }
        if (checkPayloadDetails) {
          checkPayloadDetails.textContent = `Payload folder 'sim/highascg/' not found. Place the extracted release files on the stick.`
        }
      }
    } else {
      if (usbIndicator) usbIndicator.className = 'indicator-dot status-warning'
      if (usbLabelText) usbLabelText.textContent = 'USB Stick Offline'
      if (usbDescText) usbDescText.textContent = 'HIGHASCGEXF volume not detected'

      if (checkUsb) {
        checkUsb.classList.remove('checked')
        const cb = checkUsb.querySelector('.check-box')
        if (cb) cb.textContent = '!'
      }
      if (checkUsbDetails) {
        checkUsbDetails.textContent = `USB drive with exFAT partition not detected. Connect stick or run in local dev mode.`
      }

      if (checkPayload) {
        checkPayload.classList.remove('checked')
        const cb = checkPayload.querySelector('.check-box')
        if (cb) cb.textContent = '!'
      }
      if (checkPayloadDetails) {
        checkPayloadDetails.textContent = `Application payload not verified. Please configure your exFAT stick.`
      }
    }
  } catch (e) {
    console.error('Probing USB status error:', e)
  }
}

function setUsbSidebarIdle() {
  if (usbIndicator) usbIndicator.className = 'indicator-dot status-warning'
  if (usbLabelText) usbLabelText.textContent = 'USB check paused'
  if (usbDescText) {
    usbDescText.textContent = 'Open Flashing or Partition tab to probe HIGHASCGEXF (optional for simulation).'
  }
}

function scheduleUsbPolling() {
  if (usbPollTimer) {
    clearInterval(usbPollTimer)
    usbPollTimer = null
  }
  if (activeTab === 'flash' || activeTab === 'partition') {
    pollUsbStatus()
    usbPollTimer = setInterval(pollUsbStatus, 8000)
  } else {
    setUsbSidebarIdle()
  }
}

// Simulation controls & Global Header bindings
const serverIpInput = document.getElementById('server-ip')
const simPortInput = document.getElementById('sim-port')
const simOfflineToggle = document.getElementById('sim-offline')
const btnStartSim = document.getElementById('btn-start-sim')
const btnStopSim = document.getElementById('btn-stop-sim')
const btnOpenWebui = document.getElementById('btn-open-webui')
const terminalOutput = document.getElementById('terminal-output-text')
const terminalBody = document.getElementById('terminal-body-box')
const btnClearTerminal = document.getElementById('btn-clear-terminal')
const btnCopyTerminal = document.getElementById('btn-copy-terminal')
const simRuntimeHint = document.getElementById('sim-runtime-hint')

// New Global Header elements
const headerIpInput = document.getElementById('header-server-ip')
const headerPortInput = document.getElementById('header-server-port')
const headerBtnOpenWebui = document.getElementById('header-btn-open-webui')
const headerBtnOpenCgStudio = document.getElementById('header-btn-open-cg-studio')
const btnOpenCgStudio = document.getElementById('btn-open-cg-studio')
const headerStatusDot = document.getElementById('header-status-dot')
const headerStatusText = document.getElementById('header-status-text')

const LS_SERVER_IP = 'highascg.launcher.serverIp'
const LS_SERVER_PORT = 'highascg.launcher.serverPort'

function loadServerPrefs() {
  try {
    const ip = localStorage.getItem(LS_SERVER_IP)
    if (ip != null && String(ip).trim() !== '') {
      headerIpInput.value = String(ip).trim()
      if (serverIpInput) serverIpInput.value = headerIpInput.value
    }
    const portRaw = localStorage.getItem(LS_SERVER_PORT)
    if (portRaw != null && String(portRaw).trim() !== '') {
      const port = parseInt(portRaw, 10)
      if (port >= 80 && port <= 65535) {
        headerPortInput.value = String(port)
        if (simPortInput) simPortInput.value = String(port)
      }
    }
  } catch (e) {
    console.warn('Could not load launcher server prefs:', e)
  }
}

function saveServerPrefs() {
  try {
    const ip = (headerIpInput.value || '127.0.0.1').trim()
    const port = parseInt(headerPortInput.value, 10) || 4200
    localStorage.setItem(LS_SERVER_IP, ip)
    localStorage.setItem(LS_SERVER_PORT, String(Math.max(80, Math.min(65535, port))))
  } catch (e) {
    console.warn('Could not save launcher server prefs:', e)
  }
}

loadServerPrefs()

const optionalModulesList = document.getElementById('optional-modules-list')
const LS_OPTIONAL_MODULES = 'highascg.launcher.enabledModules'

async function loadOptionalModulesUi() {
	if (!optionalModulesList) return
	try {
		const { registry, enabled } = await ipcRenderer.invoke('get-optional-modules')
		optionalModulesList.innerHTML = ''
		if (!Array.isArray(registry) || registry.length === 0) {
			optionalModulesList.innerHTML = '<p class="field-hint">No optional modules in registry.</p>'
			return
		}
		const enabledSet = new Set(Array.isArray(enabled) ? enabled : [])
		for (const mod of registry) {
			const row = document.createElement('label')
			row.className = 'optional-module-row'
			const checked = enabledSet.has(mod.id)
			row.innerHTML = `
				<span class="optional-module-row__switch toggle-switch">
					<input type="checkbox" data-module-id="${mod.id}" ${checked ? 'checked' : ''} />
					<span class="slider" aria-hidden="true"></span>
				</span>
				<span class="optional-module-row__body">
					<span class="optional-module-row__title">${mod.label || mod.id}</span>
					<span class="optional-module-row__desc">${mod.description || ''}</span>
				</span>
			`
			const input = row.querySelector('input')
			input.addEventListener('change', () => {
				void saveOptionalModulesFromUi()
			})
			optionalModulesList.appendChild(row)
		}
		try {
			localStorage.setItem(LS_OPTIONAL_MODULES, JSON.stringify([...enabledSet]))
		} catch {
			/* ignore */
		}
	} catch (e) {
		console.error('Optional modules UI failed:', e)
		optionalModulesList.innerHTML = '<p class="field-hint">Could not load module settings.</p>'
	}
}

async function saveOptionalModulesFromUi() {
	if (!optionalModulesList) return
	const enabled = []
	optionalModulesList.querySelectorAll('input[data-module-id]:checked').forEach((input) => {
		enabled.push(input.getAttribute('data-module-id'))
	})
	try {
		const result = await ipcRenderer.invoke('set-optional-modules', enabled)
		localStorage.setItem(LS_OPTIONAL_MODULES, JSON.stringify(enabled))
		await updateCgStudioButtons()
		if (result && result.cgStudio) {
			if (result.cgStudio.running && result.cgStudio.url) {
				appendLog(`[Launcher] CG Studio server running at ${result.cgStudio.url}\n`)
			} else if (result.cgStudio.error) {
				appendLog(`[Launcher] CG Studio: ${result.cgStudio.error}\n`)
			} else if (!enabled.includes('cg-studio')) {
				appendLog('[Launcher] CG Studio stopped\n')
			}
		}
	} catch (e) {
		console.error('Save optional modules failed:', e)
	}
}

async function updateCgStudioButtons() {
	let show = false
	try {
		const state = await ipcRenderer.invoke('cg-studio-is-enabled')
		show = Boolean(state && state.enabled)
	} catch (e) {
		console.warn('CG Studio module state check failed:', e)
	}
	for (const el of [headerBtnOpenCgStudio, btnOpenCgStudio]) {
		if (!el) continue
		el.classList.toggle('hidden', !show)
	}
}

async function openCgStudio() {
	for (const btn of [headerBtnOpenCgStudio, btnOpenCgStudio]) {
		if (btn) btn.disabled = true
	}
	try {
		const result = await ipcRenderer.invoke('open-cg-studio')
		if (!result.ok) {
			appendLog(`[Launcher] CG Studio: ${result.error}\n`)
			window.alert(result.error)
		} else {
			appendLog(`[Launcher] CG Studio opened at ${result.url}\n`)
		}
	} catch (e) {
		const msg = e && e.message ? e.message : String(e)
		appendLog(`[Launcher] CG Studio failed: ${msg}\n`)
		window.alert(msg)
	} finally {
		for (const btn of [headerBtnOpenCgStudio, btnOpenCgStudio]) {
			if (btn) btn.disabled = false
		}
	}
}

void loadOptionalModulesUi().then(() => updateCgStudioButtons())

function getTargetUrl() {
  const ip = (headerIpInput.value || '127.0.0.1').trim()
  const port = headerPortInput.value || 4200
  return `http://${ip}:${port}/`
}

function getWebuiUrl() {
  return `http://localhost:${WEBUI_PORT}/`
}

function updateWebuiButton() {
  if (btnOpenWebui) {
    btnOpenWebui.textContent = `Open Web UI (${getWebuiUrl()})`
  }
}

// Bidirectional Input Sync
function syncInputs(source, target) {
  if (source && target) {
    const handleInput = () => {
      if (target.value !== source.value) {
        target.value = source.value
        updateWebuiButton()
        saveServerPrefs()
        ipcRenderer.send('update-api-origin', getTargetUrl())
      }
    }
    source.addEventListener('input', handleInput)
    source.addEventListener('change', handleInput)
  }
}

syncInputs(headerIpInput, serverIpInput)
syncInputs(serverIpInput, headerIpInput)
syncInputs(headerPortInput, simPortInput)
syncInputs(simPortInput, headerPortInput)

// Live Connection Polling
async function checkServerConnection() {
  const ip = (headerIpInput.value || '127.0.0.1').trim()
  const port = headerPortInput.value || 4200
  const url = `http://${ip}:${port}/api/settings`

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2500)

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    
    clearTimeout(timeoutId)
    
    if (response.ok) {
      headerStatusDot.className = 'status-dot connected'
      headerStatusText.textContent = 'Connected'
    } else {
      headerStatusDot.className = 'status-dot disconnected'
      headerStatusText.textContent = 'Disconnected'
    }
  } catch (err) {
    headerStatusDot.className = 'status-dot disconnected'
    headerStatusText.textContent = 'Disconnected'
  }
}

// Start polling
checkServerConnection()
setInterval(checkServerConnection, 3000)

// Initial update to reflect default inputs
updateWebuiButton()
ipcRenderer.send('update-api-origin', getTargetUrl())

function appendLog(text) {
  if (terminalOutput.textContent === '[Idle] Simulation has not been started. Select configurations and hit \'Start Simulation\'.' || 
      terminalOutput.textContent === '') {
    terminalOutput.textContent = text
  } else {
    terminalOutput.textContent += text
  }
  // Auto-scroll
  terminalBody.scrollTop = terminalBody.scrollHeight

  // Check for successful express listener bind to update button text
  if (text.includes('listening on') || text.includes('HTTP Server') || text.includes('Server running') || text.includes('Express')) {
    updateWebuiButton()
  }
}

btnStartSim.addEventListener('click', () => {
  const port = parseInt(simPortInput.value, 10) || 4200
  const offlineMode = simOfflineToggle ? simOfflineToggle.checked : true
  if (headerIpInput) headerIpInput.value = '127.0.0.1'
  if (serverIpInput) serverIpInput.value = '127.0.0.1'
  ipcRenderer.send('update-api-origin', getTargetUrl())

  terminalOutput.textContent = ''
  appendLog(`[Launcher] Starting HighAsCG in simulation mode on port ${port}...\n`)

  btnStartSim.disabled = true
  serverIpInput.disabled = true
  simPortInput.disabled = true
  headerIpInput.disabled = true
  headerPortInput.disabled = true
  if (simOfflineToggle) simOfflineToggle.disabled = true

  ipcRenderer.send('start-sim', { port, offlineMode })
})

btnStopSim.addEventListener('click', () => {
  appendLog('[Launcher] Dispatching shutdown signal to simulator process...\n')
  ipcRenderer.send('stop-sim')
})

btnClearTerminal.addEventListener('click', () => {
  terminalOutput.textContent = ''
})

if (btnCopyTerminal) {
  btnCopyTerminal.addEventListener('click', async () => {
    const text = terminalOutput.textContent || ''
    try {
      await navigator.clipboard.writeText(text)
      btnCopyTerminal.textContent = 'Copied'
      setTimeout(() => {
        btnCopyTerminal.textContent = 'Copy log'
      }, 2000)
    } catch (err) {
      console.error('Copy log failed:', err)
      btnCopyTerminal.textContent = 'Failed'
      setTimeout(() => {
        btnCopyTerminal.textContent = 'Copy log'
      }, 2000)
    }
  })
}

async function pollSimRuntime() {
  if (!simRuntimeHint) return
  try {
    const rt = await ipcRenderer.invoke('check-sim-runtime')
    if (rt.ready) {
      const nm = rt.hasNodeModules ? 'ready' : 'run npm run launcher:sim-install from repo root'
      simRuntimeHint.textContent = `Sim runtime: ${rt.source} — ${nm}`
      simRuntimeHint.classList.remove('sim-runtime-warn')
    } else {
      simRuntimeHint.textContent =
        'Sim runtime not ready — from repo root: npm run launcher:prepare, then npm run launcher:sim-install'
      simRuntimeHint.classList.add('sim-runtime-warn')
    }
  } catch (e) {
    console.warn('Sim runtime check failed:', e)
  }
}

pollSimRuntime()
setInterval(pollSimRuntime, 5000)

function onSimLogMaybeReady(text) {
  if (
    /listening on|HTTP Server|Server running|HighAsCG.*started|127\.0\.0\.1:\d+/i.test(text)
  ) {
    setTimeout(() => {
      checkServerConnection()
      ipcRenderer.send('update-api-origin', getTargetUrl())
    }, 600)
  }
}

ipcRenderer.on('sim-log', (event, text) => {
  appendLog(text)
  onSimLogMaybeReady(text)
})

ipcRenderer.on('sim-status', (event, status) => {
  isSimRunning = status.running
  if (isSimRunning) {
    btnStartSim.disabled = true
    btnStopSim.disabled = false
    headerIpInput.disabled = true
    headerPortInput.disabled = true
  } else {
    btnStartSim.disabled = false
    btnStopSim.disabled = true
    serverIpInput.disabled = false
    simPortInput.disabled = false
    headerIpInput.disabled = false
    headerPortInput.disabled = false
    if (simOfflineToggle) simOfflineToggle.disabled = false
    updateWebuiButton()

    if (status.error) {
      appendLog(`[Launcher Error] Simulator error: ${status.error}\n`)
    }
  }
})

// Web UI opener trigger
if (btnOpenWebui) {
  btnOpenWebui.addEventListener('click', () => {
    ipcRenderer.send('open-external-url', getWebuiUrl())
  })
}
if (headerBtnOpenWebui) {
  headerBtnOpenWebui.addEventListener('click', () => {
    ipcRenderer.send('open-external-url', getWebuiUrl())
  })
}
if (headerBtnOpenCgStudio) {
  headerBtnOpenCgStudio.addEventListener('click', () => {
    void openCgStudio()
  })
}
if (btnOpenCgStudio) {
  btnOpenCgStudio.addEventListener('click', () => {
    void openCgStudio()
  })
}

document.getElementById('btn-open-github').addEventListener('click', () => {
  ipcRenderer.send('open-external-url', 'https://github.com/mko1989/highascg')
})

document.getElementById('btn-open-logs').addEventListener('click', () => {
  // Open commits of the repo
  ipcRenderer.send('open-external-url', 'https://github.com/mko1989/highascg/commits')
})

// Partition guide: copy-to-clipboard for runnable Terminal commands only
function initGuideCopyButtons() {
  document.querySelectorAll('.cmd-copy').forEach(block => {
    const pre = block.querySelector('.cmd-copy-pre')
    const btn = block.querySelector('.cmd-copy-btn')
    if (!pre || !btn || btn.dataset.bound === '1') return
    btn.dataset.bound = '1'
    const text = pre.textContent.trim()
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text)
        btn.textContent = 'Copied'
        btn.classList.add('copied')
        setTimeout(() => {
          btn.textContent = 'Copy'
          btn.classList.remove('copied')
        }, 2000)
      } catch (err) {
        btn.textContent = 'Failed'
        console.error('Copy failed:', err)
        setTimeout(() => {
          btn.textContent = 'Copy'
        }, 2000)
      }
    })
  })
}

initGuideCopyButtons()
