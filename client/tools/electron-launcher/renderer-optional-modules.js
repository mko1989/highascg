'use strict'

const { ipcRenderer } = require('electron')

module.exports = function initRendererOptionalModules(ctx) {
  const optionalModulesList = document.getElementById('optional-modules-list')
  const LS_OPTIONAL_MODULES = 'highascg.launcher.enabledModules'

  const headerBtnOpenCgStudio = document.getElementById('header-btn-open-cg-studio')
  const btnOpenCgStudio = document.getElementById('btn-open-cg-studio')

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
      await ipcRenderer.invoke('set-optional-modules', enabled)
      localStorage.setItem(LS_OPTIONAL_MODULES, JSON.stringify(enabled))
      await updateCgStudioButtons()
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

  function getCgStudioUrl() {
    // Same server target as the Simulation tab header inputs (LS_SERVER_IP / LS_SERVER_PORT).
    const ipInput = document.getElementById('header-server-ip')
    const portInput = document.getElementById('header-server-port')
    const ip = ((ipInput && ipInput.value) || '127.0.0.1').trim()
    const port = parseInt(portInput && portInput.value, 10) || 4200
    return `http://${ip}:${port}/cg-studio/index.html`
  }

  async function openCgStudio() {
    for (const btn of [headerBtnOpenCgStudio, btnOpenCgStudio]) {
      if (btn) btn.disabled = true
    }
    try {
      const result = await ipcRenderer.invoke('open-cg-studio', { url: getCgStudioUrl() })
      if (!result.ok) {
        ctx.appendLog(`[Launcher] CG Studio: ${result.error}\n`)
        window.alert(result.error)
      } else {
        ctx.appendLog(`[Launcher] CG Studio opened at ${result.url}\n`)
      }
    } catch (e) {
      const msg = e && e.message ? e.message : String(e)
      ctx.appendLog(`[Launcher] CG Studio failed: ${msg}\n`)
      window.alert(msg)
    } finally {
      for (const btn of [headerBtnOpenCgStudio, btnOpenCgStudio]) {
        if (btn) btn.disabled = false
      }
    }
  }

  ctx.openCgStudio = openCgStudio

  void loadOptionalModulesUi().then(() => updateCgStudioButtons())
}
