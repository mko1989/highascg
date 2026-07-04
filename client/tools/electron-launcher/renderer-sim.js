'use strict'

const { ipcRenderer } = require('electron')

module.exports = function initRendererSim(ctx) {
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

  function getTargetUrl() {
    const ip = (headerIpInput.value || '127.0.0.1').trim()
    const port = headerPortInput.value || 4200
    return `http://${ip}:${port}/`
  }

  function getWebuiUrl() {
    return `http://localhost:${ctx.WEBUI_PORT}/`
  }

  function updateWebuiButton() {
    if (btnOpenWebui) {
      btnOpenWebui.textContent = `Open Web UI (${getWebuiUrl()})`
    }
  }

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

  checkServerConnection()
  setInterval(checkServerConnection, 3000)

  updateWebuiButton()
  ipcRenderer.send('update-api-origin', getTargetUrl())

  function appendLog(text) {
    if (
      terminalOutput.textContent ===
        "[Idle] Simulation has not been started. Select configurations and hit 'Start Simulation'." ||
      terminalOutput.textContent === ''
    ) {
      terminalOutput.textContent = text
    } else {
      terminalOutput.textContent += text
    }
    terminalBody.scrollTop = terminalBody.scrollHeight

    if (
      text.includes('listening on') ||
      text.includes('HTTP Server') ||
      text.includes('Server running') ||
      text.includes('Express')
    ) {
      updateWebuiButton()
    }
  }

  ctx.appendLog = appendLog

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
    if (/listening on|HTTP Server|Server running|HighAsCG.*started|127\.0\.0\.1:\d+/i.test(text)) {
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
    ctx.isSimRunning = status.running
    if (ctx.isSimRunning) {
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
      if (typeof ctx.openCgStudio === 'function') void ctx.openCgStudio()
    })
  }
  if (btnOpenCgStudio) {
    btnOpenCgStudio.addEventListener('click', () => {
      if (typeof ctx.openCgStudio === 'function') void ctx.openCgStudio()
    })
  }

  document.getElementById('btn-open-github').addEventListener('click', () => {
    ipcRenderer.send('open-external-url', 'https://github.com/mko1989/highascg')
  })

  document.getElementById('btn-open-logs').addEventListener('click', () => {
    ipcRenderer.send('open-external-url', 'https://github.com/mko1989/highascg/commits')
  })
}
