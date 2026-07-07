'use strict'

/**
 * Launcher renderer bootstrap (thin aggregator, WO-140).
 *
 * index.html loads this as a classic <script>; the launcher window runs with
 * nodeIntegration enabled, so CommonJS require() works here and each renderer
 * concern lives in a focused sibling module:
 * - renderer-port.js             — Web UI port discovery
 * - renderer-nav.js              — sidebar tab + inner OS-guide navigation
 * - renderer-stick.js            — USB stick / payload status polling
 * - renderer-sim.js              — simulation controls, terminal log, server connection
 * - renderer-optional-modules.js — optional module toggles + CG Studio
 * - renderer-guides.js           — guide copy-to-clipboard buttons
 *
 * Modules communicate through the shared `ctx` object (appendLog, switchTab,
 * scheduleUsbPolling, openCgStudio are attached by their owning module).
 */

const { loadWebuiPort } = require('./renderer-port.js')
const initRendererNav = require('./renderer-nav.js')
const initRendererStick = require('./renderer-stick.js')
const initRendererSim = require('./renderer-sim.js')
const initRendererOptionalModules = require('./renderer-optional-modules.js')
const initRendererGuides = require('./renderer-guides.js')

const ctx = {
  WEBUI_PORT: loadWebuiPort(),
  isSimRunning: false,
  activeTab: 'simulation',
  usbPollTimer: null,
}

initRendererNav(ctx)
initRendererStick(ctx)
initRendererSim(ctx)
initRendererOptionalModules(ctx)
initRendererGuides()
