const { ipcRenderer } = require('electron')

// Tab Navigation
const navItems = document.querySelectorAll('.nav-menu .nav-item')
const tabPanes = document.querySelectorAll('.tab-pane')
const pageTitle = document.getElementById('page-title')
const pageSubtitle = document.getElementById('page-subtitle')

const pageMeta = {
  dashboard: { title: 'Operator Dashboard', subtitle: 'Quick overview of system preparation state' },
  flash: { title: 'Flashing Guide', subtitle: 'How to flash the bootable live ISO image' },
  partition: { title: 'Partitioning & exFAT Guide', subtitle: 'Create the exFAT HIGHASCGEXF storage partition' },
  simulation: { title: 'Simulation Center', subtitle: 'Run HighAsCG locally in simulated offline mode' }
}

let isSimRunning = false

function switchTab(tabId) {
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
}

navItems.forEach(item => {
  item.addEventListener('click', () => {
    switchTab(item.getAttribute('data-tab'))
  })
})

// Shortcut navigation in Dashboard
document.querySelectorAll('[data-go-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    switchTab(btn.getAttribute('data-go-tab'))
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
      usbIndicator.className = 'indicator-dot status-success'
      usbLabelText.textContent = 'HIGHASCGEXF Connected'
      usbDescText.textContent = `Mounted at ${status.path}`

      checkUsb.classList.add('checked')
      checkUsb.querySelector('.check-box').textContent = '✓'
      checkUsbDetails.textContent = `USB stick detected exFAT volume mounted at: ${status.path}`

      if (status.hasPayload) {
        checkPayload.classList.add('checked')
        checkPayload.querySelector('.check-box').textContent = '✓'
        checkPayloadDetails.textContent = `Payload package.json verified at: ${status.payloadPath}`
      } else {
        checkPayload.classList.remove('checked')
        checkPayload.querySelector('.check-box').textContent = '!'
        checkPayloadDetails.textContent = `Server drop folder 'drop-update/' not found. Extract highascg-server_*.tar.gz there for playout updates.`
      }
    } else {
      usbIndicator.className = 'indicator-dot status-warning'
      usbLabelText.textContent = 'USB Stick Offline'
      usbDescText.textContent = 'HIGHASCGEXF volume not detected'

      checkUsb.classList.remove('checked')
      checkUsb.querySelector('.check-box').textContent = '!'
      checkUsbDetails.textContent = `USB drive with exFAT partition not detected. Connect stick or run in local dev mode.`

      checkPayload.classList.remove('checked')
      checkPayload.querySelector('.check-box').textContent = '!'
      checkPayloadDetails.textContent = `Application payload not verified. Please configure your exFAT stick.`
    }
  } catch (e) {
    console.error('Probing USB status error:', e)
  }
}

// Run initial status check and poll every 3 seconds
pollUsbStatus()
setInterval(pollUsbStatus, 3000)

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

// New Global Header elements
const headerIpInput = document.getElementById('header-server-ip')
const headerPortInput = document.getElementById('header-server-port')
const headerBtnOpenWebui = document.getElementById('header-btn-open-webui')
const headerStatusDot = document.getElementById('header-status-dot')
const headerStatusText = document.getElementById('header-status-text')

function getTargetUrl() {
  const ip = (headerIpInput.value || 'localhost').trim()
  const port = headerPortInput.value || 4200
  return `http://${ip}:${port}/`
}

function getWebuiUrl() {
  return 'http://localhost:3000/'
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
  const ip = (headerIpInput.value || 'localhost').trim()
  const port = headerPortInput.value || 4200
  const url = `http://${ip}:${port}/api/settings`
  
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 1000)
    
    const response = await fetch(url, { 
      method: 'GET',
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
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
  const offlineMode = simOfflineToggle.checked

  terminalOutput.textContent = ''
  appendLog(`[Launcher] Starting HighAsCG in simulation mode on port ${port}...\n`)

  btnStartSim.disabled = true
  serverIpInput.disabled = true
  simPortInput.disabled = true
  headerIpInput.disabled = true
  headerPortInput.disabled = true
  simOfflineToggle.disabled = true

  ipcRenderer.send('start-sim', { port, offlineMode })
})

btnStopSim.addEventListener('click', () => {
  appendLog('[Launcher] Dispatching shutdown signal to simulator process...\n')
  ipcRenderer.send('stop-sim')
})

btnClearTerminal.addEventListener('click', () => {
  terminalOutput.textContent = ''
})

ipcRenderer.on('sim-log', (event, text) => {
  appendLog(text)
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
    simOfflineToggle.disabled = false
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

// Quick Simulation Button on Dashboard
document.getElementById('btn-quick-sim').addEventListener('click', () => {
  switchTab('simulation')
  // Autotrigger start if not running
  if (!isSimRunning) {
    setTimeout(() => {
      btnStartSim.click()
    }, 100)
  }
})

// Quick links
document.getElementById('btn-open-readme').addEventListener('click', () => {
  switchTab('flash')
})

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
