const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawn, execFileSync } = require('child_process')
const http = require('http')
const url = require('url')

let webuiApiOrigin = 'http://127.0.0.1:4200' // Default fallback

// IPC Handler to keep track of the active connection API origin
ipcMain.on('update-api-origin', (event, origin) => {
  webuiApiOrigin = origin
  console.log('[Electron Main] WebUI API Origin updated to:', webuiApiOrigin)
})

// WebUI Static Server served directly by client/launcher backend
const PORT = 3000
const distWebPath = path.resolve(__dirname, 'dist-web')

function mapInstanceStaticPath(requestPath) {
  const m = String(requestPath || '/').match(/^\/instance\/[^/]+(\/.*)?$/)
  if (!m) return requestPath
  const rest = m[1]
  if (!rest || rest === '/') return '/'
  return rest
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url)
  let pathname = parsedUrl.pathname
  
  // Transparent proxy for backend-hosted assets & APIs to prevent missing functionality (supporting Companion prefixes)
  const isProxyPath = /^\/(instance\/[^/]+\/)?(api|vendor|template|templates)\b/.test(pathname)
  if (isProxyPath) {
    try {
      const targetUrl = new URL(req.url, webuiApiOrigin)
      const proxyReq = http.request({
        hostname: targetUrl.hostname,
        port: targetUrl.port || 80,
        path: targetUrl.pathname + (parsedUrl.search || ''),
        method: req.method,
        headers: {
          ...req.headers,
          host: targetUrl.host
        }
      }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers)
        proxyRes.pipe(res)
      })
      
      proxyReq.on('error', (err) => {
        res.statusCode = 502
        res.end(`Proxy error: ${err.message}`)
      })
      
      req.pipe(proxyReq)
    } catch (err) {
      res.statusCode = 500
      res.end(`Proxy failed: ${err.message}`)
    }
    return
  }
  
  // Map Companion-style prefix to local static folder root
  let cleanPath = mapInstanceStaticPath(pathname)
  if (cleanPath === '/' || cleanPath === '') {
    cleanPath = '/index.html'
  }
  
  let filePath = path.join(distWebPath, cleanPath)
  if (!filePath.startsWith(distWebPath)) {
    res.statusCode = 403
    res.end('Forbidden')
    return
  }
  
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Single Page App routing fallback
      filePath = path.join(distWebPath, 'index.html')
    }
    
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.statusCode = 500
        res.end(`Error reading file: ${err.message}`)
        return
      }
      
      const ext = path.extname(filePath).toLowerCase()
      let contentType = 'text/plain'
      if (ext === '.html') contentType = 'text/html'
      else if (ext === '.js') contentType = 'application/javascript'
      else if (ext === '.css') contentType = 'text/css'
      else if (ext === '.json') contentType = 'application/json'
      else if (ext === '.png') contentType = 'image/png'
      else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg'
      else if (ext === '.svg') contentType = 'image/svg+xml'
      else if (ext === '.ico') contentType = 'image/x-icon'
      else if (ext === '.woff') contentType = 'font/woff'
      else if (ext === '.woff2') contentType = 'font/woff2'
      else if (ext === '.ttf') contentType = 'font/ttf'
      
      res.setHeader('Content-Type', contentType)
      
      if (ext === '.html') {
        let htmlContent = data.toString('utf8')
        // Dynamically inject the active API server origin into meta tag
        htmlContent = htmlContent.replace(
          /<meta name="highascg-api-origin" content="[^"]*">/,
          `<meta name="highascg-api-origin" content="${webuiApiOrigin}">`
        )
        res.end(htmlContent)
      } else {
        res.end(data)
      }
    })
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Electron Main] WebUI Static Server listening on http://localhost:${PORT}`)
})

// Transparent WebSocket Upgrade Proxy to route real-time client traffic under same-origin mapping
server.on('upgrade', (req, socket, head) => {
  const parsedUrl = url.parse(req.url)
  const pathname = parsedUrl.pathname
  
  const isWsPath = /^\/(instance\/[^/]+\/)?api\/ws\b/.test(pathname)
  if (isWsPath) {
    try {
      const targetUrl = new URL(webuiApiOrigin)
      const targetHost = targetUrl.hostname
      const targetPort = targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80)
      
      const net = require('net')
      const targetSocket = net.connect(targetPort, targetHost, () => {
        let rawHeaders = `${req.method} ${req.url} HTTP/1.1\r\n`
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const key = req.rawHeaders[i]
          const val = req.rawHeaders[i+1]
          if (key.toLowerCase() === 'host') {
            rawHeaders += `Host: ${targetUrl.host}\r\n`
          } else {
            rawHeaders += `${key}: ${val}\r\n`
          }
        }
        rawHeaders += '\r\n'
        
        targetSocket.write(rawHeaders)
        if (head && head.length > 0) {
          targetSocket.write(head)
        }
        
        targetSocket.pipe(socket)
        socket.pipe(targetSocket)
      })
      
      targetSocket.on('error', (err) => {
        console.error('[Electron Main] WebSocket Proxy target error:', err.message)
        socket.destroy()
      })
      
      socket.on('error', (err) => {
        console.error('[Electron Main] WebSocket Proxy client error:', err.message)
        targetSocket.destroy()
      })
    } catch (err) {
      console.error('[Electron Main] WebSocket Proxy upgrade failed:', err.message)
      socket.destroy()
    }
  } else {
    socket.destroy()
  }
})

let mainWindow = null
let simProcess = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    title: 'HighAsCG Operator Panel & Launcher',
    icon: path.join(__dirname, 'icon.svg'), // Svg icon copied from client
    frame: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: true
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'index.html'))

  mainWindow.on('closed', () => {
    mainWindow = null
    cleanupSimulation()
  })
}

function cleanupSimulation() {
  if (simProcess) {
    console.log('[Electron Main] Killing active simulation process...')
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', simProcess.pid, '/f', '/t'])
      } else {
        simProcess.kill('SIGINT')
        setTimeout(() => {
          if (simProcess) {
            simProcess.kill('SIGKILL')
          }
        }, 1000)
      }
    } catch (e) {
      console.error('[Electron Main] Error killing sim process:', e)
    }
    simProcess = null
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  cleanupSimulation()
  server.close()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// IPC Handlers
ipcMain.on('open-external-url', (event, url) => {
  shell.openExternal(url)
})

ipcMain.on('start-sim', (event, { port, offlineMode }) => {
  if (simProcess) {
    event.reply('sim-log', '[Launcher] Simulation is already running!\n')
    return
  }

  event.reply('sim-log', '[Launcher] Preparing to launch simulation...\n')

  const repoRoot = path.resolve(__dirname, '../../..')
  const launcherScript = path.join(repoRoot, 'client/tools/portable-desktop/launch-sim-from-exfat.js')

  event.reply('sim-log', `[Launcher] App root detected: ${repoRoot}\n`)
  event.reply('sim-log', `[Launcher] Simulation helper: ${launcherScript}\n`)

  const env = {
    ...process.env,
    HIGHASCG_LAUNCH_NO_BROWSER: '1', // We want Electron launcher to control browser open
    HIGHASCG_OFFLINE_MODE: offlineMode ? '1' : '0',
    HTTP_PORT: String(port)
  }

  try {
    simProcess = spawn(process.execPath, [launcherScript], {
      cwd: repoRoot,
      env: env
    })

    simProcess.stdout.on('data', (data) => {
      if (mainWindow) {
        mainWindow.webContents.send('sim-log', data.toString())
      }
    })

    simProcess.stderr.on('data', (data) => {
      if (mainWindow) {
        mainWindow.webContents.send('sim-log', data.toString())
      }
    })

    simProcess.on('error', (err) => {
      if (mainWindow) {
        mainWindow.webContents.send('sim-log', `[Launcher Error] Spawn failed: ${err.message}\n`)
        mainWindow.webContents.send('sim-status', { running: false, error: err.message })
      }
      simProcess = null
    })

    simProcess.on('exit', (code, signal) => {
      if (mainWindow) {
        mainWindow.webContents.send('sim-log', `[Launcher] Simulation process exited with code ${code} ${signal ? `(signal: ${signal})` : ''}\n`)
        mainWindow.webContents.send('sim-status', { running: false, code })
      }
      simProcess = null
    })

    event.reply('sim-status', { running: true })
  } catch (err) {
    event.reply('sim-log', `[Launcher Error] Exception: ${err.message}\n`)
    event.reply('sim-status', { running: false, error: err.message })
    simProcess = null
  }
})

ipcMain.on('stop-sim', (event) => {
  cleanupSimulation()
  event.reply('sim-status', { running: false })
  event.reply('sim-log', '[Launcher] Simulation stopped by user.\n')
})

function checkWindowsVolume(label) {
  const esc = String(label).replace(/'/g, "''")
  const ps = `Get-Volume | Where-Object FileSystemLabel -eq '${esc}' | Select-Object -First 1 | ForEach-Object { $_.DriveLetter }`
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    }).trim()
    const letter = out.split(/\s+/).filter(Boolean)[0]
    if (letter && /^[A-Za-z]$/.test(letter)) {
      return `${letter.toUpperCase()}:`
    }
  } catch (_) {}
  return null
}

ipcMain.handle('check-usb-status', async () => {
  const label = 'HIGHASCGEXF'
  const platform = process.platform
  let mountedPath = null

  if (platform === 'darwin') {
    const vol = path.join('/Volumes', label)
    if (fs.existsSync(vol) && fs.statSync(vol).isDirectory()) mountedPath = vol
  } else if (platform === 'win32') {
    mountedPath = checkWindowsVolume(label)
  } else if (platform === 'linux') {
    const u = os.userInfo().username
    const tries = [
      path.join('/media', u, label),
      path.join('/run/media', u, label),
      path.join('/mnt', label),
    ]
    for (const t of tries) {
      if (fs.existsSync(t) && fs.statSync(t).isDirectory()) {
        mountedPath = t
        break
      }
    }
    if (!mountedPath) {
      try {
        const out = execFileSync('findmnt', ['-n', '-o', 'TARGET', `-L${label}`], {
          encoding: 'utf8',
          timeout: 2000,
        }).trim()
        if (out && fs.existsSync(out)) mountedPath = out
      } catch (_) {}
    }
  }

  if (mountedPath) {
    const dropDir = path.join(mountedPath, 'drop-update')
    const legacyDir = path.join(mountedPath, 'update/server')
    const hasDrop =
      (fs.existsSync(dropDir) && fs.existsSync(path.join(dropDir, 'package.json'))) ||
      (fs.existsSync(legacyDir) && fs.existsSync(path.join(legacyDir, 'package.json')))
    const payloadPath = fs.existsSync(path.join(dropDir, 'package.json')) ? dropDir : legacyDir
    return {
      mounted: true,
      path: mountedPath,
      hasPayload: hasDrop,
      payloadPath: hasDrop ? payloadPath : dropDir
    }
  }

  return {
    mounted: false
  }
})
