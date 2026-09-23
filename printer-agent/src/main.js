const { app, BrowserWindow, ipcMain, Menu, safeStorage } = require('electron')
// Remove a barra de menu nativa (File/Edit/View/Window/Help) — deixa a janela limpa.
Menu.setApplicationMenu(null)
const path = require('path')
const fs = require('fs')
const os = require('os')
const { carregarConfig, salvarConfig, carregarImpressos, marcarImpressoLocal, esquecerImpressoLocal, instanciaAgente } = require('./store')
const { listarImpressorasWindows, imprimirTexto } = require('./printer')
const { montarRecibo } = require('./recibo')
const { montarPreConta, montarTeste, colsPreConta } = require('./pre-conta')
const { FilasPorDispositivo } = require('./fila-dispositivos')

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
//
// Variante de TESTE LOCAL (build `npm run dist:teste-local`): o electron-builder grava
// `menuziaAmbiente` no package.json empacotado. Só ela aponta para outro servidor — e só
// para loopback —, com identidade, pastas e configuração próprias, sem início automático.
// O build normal não tem esse campo: produção, exatamente como sempre.
const AMBIENTE = (() => {
  try {
    return require('../package.json').menuziaAmbiente || null
  } catch {
    return null
  }
})()
const EH_TESTE_LOCAL = AMBIENTE?.variante === 'teste-local'
const API_BASE_URL = EH_TESTE_LOCAL ? AMBIENTE.apiBaseUrl : 'https://app.menuzia.com.br'
if (EH_TESTE_LOCAL) {
  // Trava dura: a variante de teste nunca fala com nada fora desta máquina.
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(String(API_BASE_URL))) {
    app.quit()
    process.exit(1)
  }
  // Pasta de dados própria ANTES de qualquer leitura de configuração: não enxerga a do
  // Assistente instalado na loja (token, impressora escolhida, pedidos já impressos).
  app.setPath('userData', path.join(app.getPath('appData'), 'menuzia-impressao-teste-local'))
}

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
    height: 760,
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

/**
 * Avisa o servidor que o pedido saiu no papel. `true` só quando o servidor
 * confirma — erro de rede e resposta de erro contam como "não avisado", para
 * que a memória local segure o pedido em vez de deixá-lo voltar para a fila.
 */
/**
 * Diagnóstico (testar pareamento, buscar impressoras, testar impressora): só lê a
 * configuração da loja e NUNCA consome a fila — antes esses botões chamavam
 * /api/agente/pedidos e podiam reservar pedidos reais (B1). Servidor antigo sem a rota
 * (404): cai na rota de sempre, que nele não reserva nada.
 */
async function consultarDiagnostico(token) {
  const headers = { Authorization: `Bearer ${token}` }
  const res = await fetch(`${API_BASE_URL}/api/agente/diagnostico`, { headers })
  if (res.status !== 404) return res
  return fetch(`${API_BASE_URL}/api/agente/pedidos`, { headers })
}

async function avisarImpresso(pedidoId, auth) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/agente/pedidos/${pedidoId}/imprimir`, { method: 'POST', headers: auth })
    return res.ok
  } catch {
    return false
  }
}

async function cicloDePolling() {
  const config = carregarConfig()
  const credencial = lerCredencial()
  if (!config.token && !credencial) return
  // Se um ciclo anterior ainda está imprimindo (impressora lenta), não começa outro —
  // senão dois ciclos veriam impresso=false e imprimiriam o mesmo pedido em duplicidade.
  if (cicloRodando) return
  cicloRodando = true

  // Computador pareado (0.1.26+) usa a própria credencial; senão, o token antigo da loja.
  const auth = { Authorization: `Bearer ${credencial || config.token}`, 'X-Agente-Versao': app.getVersion() }
  // Heartbeat: informa ao servidor qual impressora (config do painel) está em uso,
  // pra o painel acender ela como "conectada". Vai junto da consulta de pedidos (5s).
  // X-Agente-Instancia: o servidor reserva o pedido para esta instalação (0086) —
  // outro Assistente da loja não recebe o mesmo pedido enquanto a reserva vale.
  const headers = { ...auth, 'X-Impressora-Id': config.impressoraCloudId || '', 'X-Agente-Instancia': instanciaAgente() }

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
    // Roteamento da cozinha por função (opção da loja): o servidor diz em QUAL impressora
    // deste computador a ficha sai. Sem isso, o modo de sempre: a impressora escolhida aqui.
    const destino = data.destinoCozinha || null
    if (!destino && !config.impressoraWindows) return
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
    // Com destino da função Cozinha, largura/fonte/cópias vêm da impressora atribuída.
    const larguraBase = destino ? (Number(destino.larguraMm) <= 58 ? 32 : 48) : (impressoraCfg?.largura ?? 48)
    const cols = colsParaFonte(destino ? destino.tamanhoFonte : impressoraCfg?.tamanhoFonte, larguraBase)
    const paperMm = larguraBase <= 40 ? 58 : 80
    const copias = destino ? (destino.copias ?? 1) : (impressoraCfg?.copias ?? 1)
    const impressoraAlvo = destino ? destino.nomeSistema : config.impressoraWindows
    logArquivo(`CICLO: impressora='${impressoraCfg?.nome ?? '(nenhuma cadastrada)'}' tamanhoFonte='${impressoraCfg?.tamanhoFonte}' largura=${larguraBase} (${paperMm}mm) -> cols=${cols}; imprimirLogo=${configImpressao.imprimirLogo}`)

    // Logo: baixa uma vez por ciclo (vale pra todos os pedidos da rodada).
    const logoUrl = data.loja?.logoUrl
    let logoPath = null
    if (configImpressao.imprimirLogo && logoUrl) logoPath = await baixarLogo(logoUrl)
    else logArquivo(`LOGO: nao baixada (imprimirLogo=${configImpressao.imprimirLogo}, logoUrl=${logoUrl ? 'presente' : 'AUSENTE'})`)

    try {
      const jaImpressos = carregarImpressos()
      for (const pedido of pedidos) {
        // Saiu no papel num ciclo anterior e o servidor não chegou a saber: só
        // reavisa. Sem isto, o pedido voltava na consulta e imprimia de novo.
        if (jaImpressos.includes(pedido.id)) {
          if (await avisarImpresso(pedido.id, auth)) {
            esquecerImpressoLocal(pedido.id)
            log(`Pedido #${pedido.numero}: já tinha saído no papel, agora registrado.`)
          } else {
            log(`Pedido #${pedido.numero}: já saiu no papel; ainda não consegui avisar o servidor.`)
          }
          continue
        }

        const recibo = montarRecibo(pedido, configImpressao, cols, lojaNome, Boolean(logoPath))
        const saida = await imprimirTexto(impressoraAlvo, recibo, copias, cols, logoPath, paperMm, Boolean(configImpressao.fonteMaiorProducao))
        mostrarDiagnostico(saida)

        // A partir daqui o papel pode já ter saído: registra local ANTES de
        // avisar o servidor, porque é a falha do aviso que causava a duplicata.
        marcarImpressoLocal(pedido.id)

        if (await avisarImpresso(pedido.id, auth)) {
          esquecerImpressoLocal(pedido.id)
          log(`Pedido #${pedido.numero} impresso.`)
        } else {
          log(`Pedido #${pedido.numero} impresso, mas não consegui avisar o servidor — aviso na próxima rodada, sem reimprimir.`)
        }
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

// ─── Computador pareado (0.1.26+): credencial própria, várias impressoras ────
//
// A credencial deste computador vem do pareamento por código (Ajustes › Impressão) e
// fica no config.json CIFRADA pelo Windows (safeStorage/DPAPI, amarrada ao usuário do
// PC). Nunca vai para log nem para a tela.

function lerCredencial() {
  const cfg = carregarConfig()
  if (!cfg.credencialCifrada) return null
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(Buffer.from(cfg.credencialCifrada, 'base64'))
  } catch {
    return null
  }
}

function salvarCredencial(credencial, nome) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('O Windows não liberou a proteção de dados deste usuário.')
  salvarConfig({ credencialCifrada: safeStorage.encryptString(credencial).toString('base64'), agenteNome: nome })
}

function apagarCredencial() {
  salvarConfig({ credencialCifrada: '', agenteNome: '' })
}

function cabecalhosAgente() {
  const credencial = lerCredencial()
  return credencial ? { Authorization: `Bearer ${credencial}`, 'X-Agente-Versao': app.getVersion() } : null
}

let trabalhosTimer = null
let descobertaTimer = null
let consultandoTrabalhos = false

async function informarResultado(id, ok, erro) {
  const headers = cabecalhosAgente()
  if (!headers) return
  await fetch(`${API_BASE_URL}/api/agente/trabalhos/${id}/resultado`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok, erro }),
  })
}

// Uma fila por impressora do Windows: a do caixa travada não segura a da cozinha.
const filas = new FilasPorDispositivo(
  async (t) => {
    const largura = Number(t.larguraMm) <= 58 ? 58 : 80
    const texto = t.tipo === 'pre_conta' ? montarPreConta(t.snapshot) : montarTeste(t.snapshot)
    const saida = await imprimirTexto(t.nomeSistema, texto, 1, colsPreConta(largura), null, largura, false)
    mostrarDiagnostico(saida)
    log(`${t.tipo === 'pre_conta' ? `Pré-conta (${t.via}ª via)` : 'Teste'} enviado para "${t.nomeSistema}" — aceito pela fila do Windows.`)
  },
  async (id, ok, erro) => {
    if (!ok) log(`Falha ao enviar trabalho para a impressora: ${erro}`)
    await informarResultado(id, ok, erro)
  },
)

async function consultarTrabalhos() {
  const headers = cabecalhosAgente()
  if (!headers || consultandoTrabalhos) return
  consultandoTrabalhos = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/agente/trabalhos`, { headers })
    if (res.status === 401) {
      log('Este computador foi desconectado da loja (credencial revogada). Pareie de novo em Ajustes › Impressão.')
      return
    }
    if (!res.ok) return
    const data = await res.json()
    if (Array.isArray(data.trabalhos) && data.trabalhos.length) filas.receber(data.trabalhos)
  } catch (err) {
    logArquivo(`TRABALHOS: ${descreverErro(err)}`)
  } finally {
    consultandoTrabalhos = false
  }
}

/** Manda ao servidor as impressoras instaladas neste Windows (ficam ligadas a este computador). */
async function informarImpressoras() {
  const headers = cabecalhosAgente()
  if (!headers) return
  try {
    const nomes = await listarImpressorasWindows()
    await fetch(`${API_BASE_URL}/api/agente/impressoras`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ impressoras: nomes }),
    })
  } catch (err) {
    logArquivo(`DESCOBERTA: ${descreverErro(err)}`)
  }
}

function iniciarTrabalhos() {
  if (trabalhosTimer) return
  trabalhosTimer = setInterval(consultarTrabalhos, 3000)
  descobertaTimer = setInterval(informarImpressoras, 60_000)
  informarImpressoras()
  consultarTrabalhos()
}

function pararTrabalhos() {
  if (trabalhosTimer) clearInterval(trabalhosTimer)
  if (descobertaTimer) clearInterval(descobertaTimer)
  trabalhosTimer = null
  descobertaTimer = null
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
  // A variante de teste local nunca se registra para abrir com o Windows.
  if (app.isPackaged && !EH_TESTE_LOCAL) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })
  }
  criarJanela()
  iniciarPolling()
  iniciarTrabalhos()
})

app.on('before-quit', () => { app.isQuitting = true })
app.on('window-all-closed', () => { /* mantém rodando em segundo plano */ })

ipcMain.handle('versao', () => app.getVersion())
ipcMain.handle('ambiente', () => ({ testeLocal: EH_TESTE_LOCAL, servidor: API_BASE_URL }))
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
  if (!token && !lerCredencial()) return { ok: false, erro: 'Cole o token de pareamento antes de testar.' }
  try {
    const res = await consultarDiagnostico(token || lerCredencial())
    if (res.status === 401) return { ok: false, erro: 'Token inválido — copie de novo em Ajustes > Impressão no painel.' }
    if (!res.ok) return { ok: false, erro: `O servidor respondeu HTTP ${res.status}.` }
    return { ok: true }
  } catch (err) {
    return { ok: false, erro: `Sem conexão com ${API_BASE_URL} (${descreverErro(err)}).` }
  }
})

ipcMain.handle('buscar-impressoras-cloud', async (_e, { token }) => {
  try {
    const res = await consultarDiagnostico(token || lerCredencial())
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
    let paperMm = 80
    let cfgLoja = { imprimirLogo: false, mostrarNumeroItem: true, mostrarNomeComplementos: true, mostrarPrecoComplementos: true, multiplicarOpcoesQtd: false, fonteMaiorProducao: false }
    let lojaNome = ''
    let logoPath = null
    try {
      const res = await consultarDiagnostico(config.token || lerCredencial())
      if (res.ok) {
        const data = await res.json()
        const impressoras = data.impressoras ?? []
        const cfg =
          impressoras.find((i) => i.id === config.impressoraCloudId) ||
          impressoras.find((i) => i.ativa) ||
          impressoras[0]
        const larg = cfg?.largura ?? 48
        cols = colsParaFonte(cfg?.tamanhoFonte, larg)
        paperMm = larg <= 40 ? 58 : 80
        if (data.config) cfgLoja = data.config
        lojaNome = data.loja?.nome ?? ''
        if (cfgLoja.imprimirLogo && data.loja?.logoUrl) logoPath = await baixarLogo(data.loja.logoUrl)
      }
    } catch {}
    // Pedido-exemplo pra o teste sair com o MESMO visual de um pedido real (barras, logo, total).
    const pedidoTeste = {
      numero: 0, tipo: 'entrega', clienteNome: 'Cliente Teste', clienteTelefone: '(00) 00000-0000',
      enderecoRua: 'Rua Exemplo', enderecoNumero: '100', enderecoComplemento: 'Apto 12', enderecoBairro: 'Centro', enderecoCep: '00000-000',
      formaPagamento: 'dinheiro', trocoPara: 50, pago: false, origem: 'cardapio', mesa: null,
      observacao: 'Impressao de teste', criadoEm: new Date().toISOString(),
      subtotal: 40, taxaEntrega: 5, total: 45,
      itens: [{ quantidade: 1, nome: 'Item de Teste', precoUnitario: 40, tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '', complementos: [{ nome: 'Adicional', preco: 5 }], observacao: 'Sem observacoes' }],
    }
    const recibo = montarRecibo(pedidoTeste, cfgLoja, cols, lojaNome, Boolean(logoPath))
    const saida = await imprimirTexto(impressoraWindows, recibo, 1, cols, logoPath, paperMm, Boolean(cfgLoja.fonteMaiorProducao))
    if (logoPath) fs.unlink(logoPath, () => {})
    mostrarDiagnostico(saida)
    return { ok: true }
  } catch (err) {
    return { ok: false, erro: err.message }
  }
})

// ─── pareamento por código (0.1.26+) ─────────────────────────────────────────
ipcMain.handle('estado-agente', () => {
  const cfg = carregarConfig()
  return { pareado: Boolean(lerCredencial()), nome: cfg.agenteNome || '', sugestaoNome: os.hostname() }
})

ipcMain.handle('parear-codigo', async (_e, { codigo, nome }) => {
  const c = String(codigo || '').trim()
  if (!c) return { ok: false, erro: 'Digite o código de pareamento.' }
  try {
    const res = await fetch(`${API_BASE_URL}/api/agente/parear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo: c, nome: String(nome || os.hostname()).slice(0, 60), versao: app.getVersion() }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, erro: data.error || `O servidor respondeu HTTP ${res.status}.` }
    salvarCredencial(data.credencial, data.nome)
    log(`Computador pareado como "${data.nome}". As impressoras deste Windows serão informadas ao painel.`)
    pararTrabalhos()
    iniciarTrabalhos()
    pararPolling()
    iniciarPolling()
    return { ok: true, nome: data.nome }
  } catch (err) {
    return { ok: false, erro: `Sem conexão com ${API_BASE_URL} (${descreverErro(err)}).` }
  }
})

ipcMain.handle('desparear', () => {
  apagarCredencial()
  pararTrabalhos()
  log('Este computador saiu do modo de várias impressoras. Continua no modo antigo (token), se houver.')
  return { ok: true }
})
