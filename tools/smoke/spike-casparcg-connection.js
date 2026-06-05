'use strict'
// If require() fails, try dynamic import — see ESM note above
let CasparCG
try {
  CasparCG = require('casparcg-connection').CasparCG
  console.log('require() works!')
} catch (e) {
  console.error('require() failed:', e.message)
  console.log('Trying dynamic import()...')
  // Dynamic import in CJS
  ;(async () => {
    const mod = await import('casparcg-connection')
    CasparCG = mod.CasparCG
    console.log('import() works!')
    runTest(CasparCG)
  })()
}
if (CasparCG) runTest(CasparCG)

async function runTest(CasparCGClass) {
  const conn = new CasparCGClass({
    host: process.env.CASPAR_HOST || '127.0.0.1',
    port: parseInt(process.env.CASPAR_PORT || '5250', 10),
    autoConnect: true,
  })
  // Wait for connect event
  conn.on('connect', async () => {
    console.log('✅ Connected to CasparCG')
    try {
      const result = await conn.version({})
      console.log('VERSION result:', JSON.stringify(result, null, 2))
      const clsResult = await conn.cls({})
      console.log('CLS result type:', typeof clsResult, 'data length:', clsResult?.request?.data?.length)
    } catch (e) {
      console.error('Error in commands:', e.message)
    }
    conn.disconnect()
    process.exit(0)
  })
  conn.on('error', (err) => console.error('Connection error:', err.message))
  setTimeout(() => { console.error('Timeout — no connection'); process.exit(1) }, 5000)
}
