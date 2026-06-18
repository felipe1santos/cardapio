const fs = require('fs')
const path = require('path')
const { app } = require('electron')

const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json')

const DEFAULTS = {
  apiBaseUrl: '',
  token: '',
  impressoraWindows: '',
  impressoraCloudId: '',
  intervaloSegundos: 5,
}

function carregarConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH(), 'utf-8')
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

function salvarConfig(patch) {
  const atual = carregarConfig()
  const novo = { ...atual, ...patch }
  fs.writeFileSync(CONFIG_PATH(), JSON.stringify(novo, null, 2), 'utf-8')
  return novo
}

module.exports = { carregarConfig, salvarConfig }
