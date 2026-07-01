const { app, BrowserWindow, ipcMain, Menu } = require('electron')
// Remove a barra de menu nativa (File/Edit/View/Window/Help) — deixa a janela limpa.
Menu.setApplicationMenu(null)
const path = require('path')
const fs = require('fs')
const os = require('os')
const { carregarConfig, salvarConfig } = require('./store')
const { listarImpressorasWindows, imprimirTexto } = require('./printer')
const { montarRecibo } = require('./recibo')

// Diagnóstico: grava no MESMO arquivo que o print.ps1 (%TEMP%\menuzia-print.log).
function logArquivo(msg) {
  try {
    fs.appendFileSync(path.join(os.tmpdir(), 'menuzia-print.log'), `[${new Date().toLocaleTimeString()}] [agente] ${msg}\n`)
  } catch {}
}

// Mostra na JANELA do agente as linhas "MENUZIA:" que o print.ps1 emitiu — assim o
// lojista vê se a impressão usou o render gráfico (fonte grande + logo) ou caiu no
// texto pequeno, e o motivo, sem precisar abrir arquivo de log no PC.
function mostrarDiagnostico(saidaPs) {
  if (!saidaPs) return
  for (const linha of String(saidaPs).split(/\r?\n/)) {
    const m = linha.match(/MENUZIA:\s*(.*)$/)
    if (m && m[1].trim()) log(`impressão › ${m[1].trim()}`)
  }
}

/** Baixa a logo da loja pra um arquivo temporário (pra desenhar como imagem no recibo).
 * Retorna o caminho, ou null se falhar (o recibo segue sem imagem). */
async function baixarLogo(url) {
  try {
    const res = await fetch(url)
    if (!res.ok) { logArquivo(`LOGO: download falhou HTTP ${res.status} (${url})`); return null }
    const buf = Buffer.from(await res.arrayBuffer())
    const ext = (String(url).split('?')[0].split('.').pop() || 'png').slice(0, 4).replace(/[^a-z0-9]/gi, '') || 'png'
    const file = path.join(os.tmpdir(), `menuzia-logo-${Date.now()}.${ext}`)
    fs.writeFileSync(file, buf)
    logArquivo(`LOGO: baixada ok -> ${file} (${buf.length} bytes)`)
    return file
  } catch (err) {
    logArquivo(`LOGO: excecao no download: ${err && err.message}`)
    return null
  }
}

// URL fixa do Menuzia — a mesma para todas as lojas. A loja é identificada pelo token
// de pareamento, não pela URL. Só mude isto se o domínio do sistema mudar.
const API_BASE_URL = 'https://app.menuzia.com.br'

// Trava de instância única: sem isto, abrir o atalho várias vezes acumula vários
// processos rodando ao mesmo tempo — e durante uma atualização eles travam os
// arquivos do app, fazendo o instalador NSIS "instalar" sem conseguir sobrescrever
// o app.asar (a versão antiga continua no ar). Também é o sinal que o instalador
// usa pra fechar o app rodando antes de atualizar.
const obtevePrimazia = app.requestSingleInstanceLock()
if (!obtevePrimazia) {
  app.quit()
}

let mainWindow = null
let pollTimer = null
let polling = false
let cicloRodando = false // trava de reentrância: impede dois ciclos imprimirem o mesmo pedido

function log(mensagem) {
  if (mainWindow) mainWindow.webContents.send('log', { ts: new Date().toISOString(), mensagem })
}

// Tamanho da fonte (config da impressora) -> nº de colunas do recibo. A fonte é
// dimensionada pra PREENCHER o papel nesse nº de colunas: menos colunas = fonte maior.
// 'grande' encolhe a largura (fonte bem maior), 'média' intermediária, 'pequena' usa a
// largura cheia configurada.
function colsParaFonte(tamanho, largura) {
  const t = String(tamanho || '').toLowerCase()
  const base = Number(largura) > 0 ? Number(largura) : 48
  // Fonte é RELATIVA à largura do papel (nº de colunas base): menos colunas = fonte
  // maior. Percentuais em vez de cortes fixos pra funcionar tanto em 80mm (base 48)
  // quanto em 58mm (base 32). Em 48: grande=30, média=38, pequena=48 (igual ao antigo).
  if (t.includes('grand')) return Math.max(14, Math.round(base * 0.55))
  if (t.includes('med') || t.includes('norm')) return Math.max(16, Math.round(base * 0.72))
  return base
}

// Quando o Windows inicia o agente sozinho (auto-start), ele sobe oculto pra não
// abrir uma janela na cara do operador — fica imprimindo em segundo plano. O atalho
// da área de trabalho abre normal (sem --hidden), e clicar nele de novo traz a
// janela oculta pra frente (ver second-instance).
const abrirOculto = process.argv.includes('--hidden')

function criarJanela() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    resizable: false,
    show: !abrirOculto,
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
  if (!config.token) return
  // Se um ciclo anterior ainda está imprimindo (impressora lenta), não começa outro —
  // senão dois ciclos veriam impresso=false e imprimiriam o mesmo pedido em duplicidade.
  if (cicloRodando) return
  cicloRodando = true

  const auth = { Authorization: `Bearer ${config.token}` }
  // Heartbeat: informa ao servidor qual impressora (config do painel) está em uso,
  // pra o painel acender ela como "conectada". Vai junto da consulta de pedidos (5s).
  const headers = { ...auth, 'X-Impressora-Id': config.impressoraCloudId || '' }

  try {
    const res = await fetch(`${API_BASE_URL}/api/agente/pedidos`, { headers })
    if (!res.ok) {
      log(`Erro ao consultar pedidos (HTTP ${res.status}). Verifique o token em Ajustes > Impressão.`)
      return
    }
    const data = await res.json()
    const { config: configImpressao, pedidos } = data
    const lojaNome = data.loja?.nome ?? ''

    if (!configImpressao?.impressaoAutomatica) return
    if (!config.impressoraWindows) return
    if (!pedidos || pedidos.length === 0) return

    const impressoras = data.impressoras ?? []
    // Impressora do painel (largura/fonte/cópias). Se o usuário não escolheu uma explícita
    // no agente, cai pra ativa / primeira cadastrada — MESMO fallback do preview do painel,
    // pra a impressão bater com a prévia. Antes caía num 48 fixo, ignorando a largura
    // configurada no painel (era o "configurava a largura e nada acontecia").
    const impressoraCfg =
      impressoras.find((i) => i.id === config.impressoraCloudId) ||
      impressoras.find((i) => i.ativa) ||
      impressoras[0]
    const cols = colsParaFonte(impressoraCfg?.tamanhoFonte, impressoraCfg?.largura ?? 48)
    const copias = impressoraCfg?.copias ?? 1
    logArquivo(`CICLO: impressora='${impressoraCfg?.nome ?? '(nenhuma cadastrada)'}' tamanhoFonte='${impressoraCfg?.tamanhoFonte}' largura=${impressoraCfg?.largura} -> cols=${cols}; imprimirLogo=${configImpressao.imprimirLogo}`)

    // Logo: baixa uma vez por ciclo (vale pra todos os pedidos da rodada).
    const logoUrl = data.loja?.logoUrl
    let logoPath = null
    if (configImpressao.imprimirLogo && logoUrl) logoPath = await baixarLogo(logoUrl)
    else logArquivo(`LOGO: nao baixada (imprimirLogo=${configImpressao.imprimirLogo}, logoUrl=${logoUrl ? 'presente' : 'AUSENTE'})`)

    try {
      for (const pedido of pedidos) {
        const recibo = montarRecibo(pedido, configImpressao, cols, lojaNome, Boolean(logoPath))
        const saida = await imprimirTexto(config.impressoraWindows, recibo, copias, cols, logoPath)
        mostrarDiagnostico(saida)
        await fetch(`${API_BASE_URL}/api/agente/pedidos/${pedido.id}/imprimir`, {
          method: 'POST',
          headers: auth,
        })
        log(`Pedido #${pedido.numero} impresso.`)
      }
    } finally {
      if (logoPath) fs.unlink(logoPath, () => {})
    }
  } catch (err) {
    log(`Falha na consulta/impressão: ${descreverErro(err)}`)
  } finally {
    cicloRodando = false
  }
}

function iniciarPolling() {
  if (polling) return
  polling = true
  const config = carregarConfig()
  const intervaloMs = Math.max(2, config.intervaloSegundos || 3) * 1000
  pollTimer = setInterval(cicloDePolling, intervaloMs)
  cicloDePolling()
  log('Assistente de Impressão ativo — verificando pedidos novos periodicamente.')
}

function pararPolling() {
  polling = false
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

// Se já há uma instância rodando, traz a janela dela pra frente em vez de abrir outra.
app.on('second-instance', () => {
  if (mainWindow) {
    if (!mainWindow.isVisible()) mainWindow.show()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(() => {
  // Auto-start: registra o agente pra abrir junto com o Windows (oculto), assim a loja
  // não precisa lembrar de abrir o programa toda vez que liga o PC. Só no app empacotado
  // — em dev não queremos sujar a inicialização do sistema.
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })
  }
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
    return { ok: true, lista: await listarImpressorasWindows() }
  } catch (err) {
    return { ok: false, erro: err.message }
  }
})

function descreverErro(err) {
  return err.cause ? `${err.message} (causa: ${err.cause.code || err.cause.message || err.cause})` : err.message
}

ipcMain.handle('testar-pareamento', async (_e, { token }) => {
  if (!token) return { ok: false, erro: 'Cole o token de pareamento antes de testar.' }
  try {
    const res = await fetch(`${API_BASE_URL}/api/agente/pedidos`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.status === 401) return { ok: false, erro: 'Token inválido — copie de novo em Ajustes > Impressão no painel.' }
    if (!res.ok) return { ok: false, erro: `O servidor respondeu HTTP ${res.status}.` }
    return { ok: true }
  } catch (err) {
    return { ok: false, erro: `Sem conexão com ${API_BASE_URL} (${descreverErro(err)}).` }
  }
})

ipcMain.handle('buscar-impressoras-cloud', async (_e, { token }) => {
  try {
    const res = await fetch(`${API_BASE_URL}/api/agente/pedidos`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return { erro: `HTTP ${res.status}` }
    const data = await res.json()
    return data.impressoras ?? []
  } catch (err) {
    return { erro: descreverErro(err) }
  }
})

ipcMain.handle('testar-impressora', async (_e, { impressoraWindows }) => {
  try {
    // Usa as MESMAS colunas (= tamanho de fonte) que um pedido real usaria, pra o teste
    // refletir a impressão de verdade. Antes era fixo em 32 e "mentia" (teste grande,
    // pedido real pequeno). Best-effort: se não conseguir a config, cai em 48.
    const config = carregarConfig()
    let cols = 48
    try {
      const res = await fetch(`${API_BASE_URL}/api/agente/pedidos`, { headers: { Authorization: `Bearer ${config.token}` } })
      if (res.ok) {
        const data = await res.json()
        const impressoras = data.impressoras ?? []
        const cfg =
          impressoras.find((i) => i.id === config.impressoraCloudId) ||
          impressoras.find((i) => i.ativa) ||
          impressoras[0]
        cols = colsParaFonte(cfg?.tamanhoFonte, cfg?.largura ?? 48)
      }
    } catch {}
    const saida = await imprimirTexto(impressoraWindows, 'TESTE DE IMPRESSAO\nAssistente de Impressao Menuzia\nFonte no tamanho real do pedido\n\n\n', 1, cols)
    mostrarDiagnostico(saida)
    return { ok: true }
  } catch (err) {
    return { ok: false, erro: err.message }
  }
})
