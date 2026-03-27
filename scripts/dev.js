// Wrapper to ensure ELECTRON_RUN_AS_NODE is not set when launching electron-vite dev.
// VS Code terminals set ELECTRON_RUN_AS_NODE=1 which causes electron.exe to run as
// plain Node.js, breaking require('electron') in the main process.
delete process.env.ELECTRON_RUN_AS_NODE

const { spawn } = require('child_process')
const p = spawn('npx', ['electron-vite', 'dev'], {
  stdio: 'inherit',
  env: process.env,
  shell: true
})
p.on('exit', (code) => process.exit(code || 0))
