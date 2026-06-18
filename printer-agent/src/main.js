const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { carregarConfig, salvarConfig } = require('./store')
const { listarImpressorasWindows, imprimirTexto } = require('./printer')
const { montarRecibo } = require('./recibo')

let mainWindow = null
let pollTimer = null
let polling = false

function log(mensagem) {
  if (mainWindow) mainWindow.webContents.send('log', { ts: new Date().toISOString(), mensagem })
}

function criarJanela() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  })
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  // Fechar a janela só esconde — o agente continua rodando e imprimindo em segundo plano.
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
}

async function cicloDePolling() {
  const config = carregarConfig()
  if (!config.token || !config.apiBaseUrl) return

  try {
    const res = await fetch(`${config.apiBaseUrl}/api/agente/pedidos?token=${encodeURIComponent(config.token)}`)
    if (!res.ok) {
      log(`Erro ao consultar pedidos (HTTP ${res.status}). Verifique o token e a URL do Menuzia.`)
      return
    }
    const data = await res.json()
    const { config: configImpressao, pedidos } = data

    if (!configImpressao?.impressaoAutomatica) return
    if (!config.impressoraWindows) return
    if (!pedidos || pedidos.length === 0) return

    const impressoras = data.impressoras ?? []
    const impressoraCfg = impressoras.find((i) => i.id === config.impressoraCloudId)
    const largura = impressoraCfg?.largura ?? 48
    const copias = impressoraCfg?.copias ?? 1

    for (const pedido of pedidos) {
      const recibo = montarRecibo(pedido, configImpressao, largura)
      await imprimirTexto(config.impressoraWindows, recibo, copias)
      await fetch(`${config.apiBaseUrl}/api/agente/pedidos/${pedido.id}/imprimir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: config.token }),
      })
      log(`Pedido #${pedido.numero} impresso.`)
    }
  } catch (err) {
    log(`Falha na consulta/impressão: ${descreverErro(err)}`)
  }
}

function iniciarPolling() {
  if (polling) return
  polling = true
  const config = carregarConfig()
  const intervaloMs = Math.max(3, config.intervaloSegundos || 5) * 1000
  pollTimer = setInterval(cicloDePolling, intervaloMs)
  cicloDePolling()
  log('Assistente de Impressão ativo — verificando pedidos novos periodicamente.')
}

function pararPolling() {
  polling = false
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

app.whenReady().then(() => {
  criarJanela()
  iniciarPolling()
})

app.on('before-quit', () => { app.isQuitting = true })
app.on('window-all-closed', () => { /* mantém rodando em segundo plano */ })

ipcMain.handle('carregar-config', () => carregarConfig())

ipcMain.handle('salvar-config', (_e, patch) => {
  const novo = salvarConfig(patch)
  pararPolling()
  iniciarPolling()
  return novo
})

ipcMain.handle('listar-impressoras-windows', async () => {
  try {
    return await listarImpressorasWindows()
  } catch (err) {
    return { erro: err.message }
  }
})

function descreverErro(err) {
  return err.cause ? `${err.message} (causa: ${err.cause.code || err.cause.message || err.cause})` : err.message
}

ipcMain.handle('testar-pareamento', async (_e, { apiBaseUrl, token }) => {
  try {
    const res = await fetch(`${apiBaseUrl}/api/agente/pedidos?token=${encodeURIComponent(token)}`)
    if (!res.ok) return { ok: false, erro: `HTTP ${res.status}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, erro: descreverErro(err) }
  }
})

ipcMain.handle('buscar-impressoras-cloud', async (_e, { apiBaseUrl, token }) => {
  try {
    const res = await fetch(`${apiBaseUrl}/api/agente/pedidos?token=${encodeURIComponent(token)}`)
    if (!res.ok) return { erro: `HTTP ${res.status}` }
    const data = await res.json()
    return data.impressoras ?? []
  } catch (err) {
    return { erro: descreverErro(err) }
  }
})

ipcMain.handle('testar-impressora', async (_e, { impressoraWindows }) => {
  try {
    await imprimirTexto(impressoraWindows, 'TESTE DE IMPRESSAO\nAssistente de Impressao Menuzia\n\n\n', 1)
    return { ok: true }
  } catch (err) {
    return { ok: false, erro: err.message }
  }
})
