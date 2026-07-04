'use strict'

module.exports = function initRendererNav(ctx) {
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

  ctx.activeTab = 'simulation'

  function switchTab(tabId) {
    ctx.activeTab = tabId
    navItems.forEach((item) => {
      if (item.getAttribute('data-tab') === tabId) {
        item.classList.add('active')
      } else {
        item.classList.remove('active')
      }
    })

    tabPanes.forEach((pane) => {
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

    if (typeof ctx.scheduleUsbPolling === 'function') {
      ctx.scheduleUsbPolling()
    }
  }

  ctx.switchTab = switchTab

  navItems.forEach((item) => {
    item.addEventListener('click', () => {
      switchTab(item.getAttribute('data-tab'))
    })
  })

  const innerTabs = document.querySelectorAll('.inner-tab')
  const osGuides = document.querySelectorAll('.os-guide')

  innerTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      innerTabs.forEach((t) => t.classList.remove('active'))
      tab.classList.add('active')

      const targetOs = tab.getAttribute('data-os')
      osGuides.forEach((guide) => {
        if (guide.id === `guide-${targetOs}`) {
          guide.classList.add('active')
        } else {
          guide.classList.remove('active')
        }
      })
    })
  })
}
