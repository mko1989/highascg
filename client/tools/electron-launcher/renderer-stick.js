'use strict'

const { ipcRenderer } = require('electron')

module.exports = function initRendererStick(ctx) {
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
    if (ctx.usbPollTimer) {
      clearInterval(ctx.usbPollTimer)
      ctx.usbPollTimer = null
    }
    if (ctx.activeTab === 'flash' || ctx.activeTab === 'partition') {
      pollUsbStatus()
      ctx.usbPollTimer = setInterval(pollUsbStatus, 8000)
    } else {
      setUsbSidebarIdle()
    }
  }

  ctx.scheduleUsbPolling = scheduleUsbPolling
  scheduleUsbPolling()
}
