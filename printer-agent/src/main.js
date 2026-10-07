const { app, BrowserWindow, ipcMain, Menu, safeStorage } = require('electron')
// Remove a barra de menu nativa (File/Edit/View/Window/Help) — deixa a janela limpa.
Menu.setApplicationMenu(null)
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const { carregarConfig, salvarConfig, carregarImpressos, marcarImpressoLocal, esquecerImpressoLocal, instanciaAgente } = require('./store')
const { listarImpressorasWindows, imprimirTexto, diagnosticarImpressoras, imprimirDocumentoBeta, aquecerImpressao, encerrarServidores } = require('./printer')
const { montarRecibo } = require('./recibo')
const { montarPreConta, montarTeste, colsPreConta } = require('./pre-conta')
const { FilasPorDispositivo } = require('./fila-dispositivos')
const { montarCalibracao, montarTesteLargura } = require('./calibracao')
// Modelo oficial v3 (0.2.0-beta.9): comanda, pré-conta e via da cozinha.
const { montarComandaV3, montarPreContaV3, textoDoV3 } = require('./v3')
const { conviteDosArgumentos, conviteNosDownloads } = require('./convite')

// Variante do build (electron-builder grava `menuziaAmbiente` no package.json empacotado):
//   · sem o campo   → o Assistente de sempre, exatamente como sempre;
//   · 'teste-local' → build de teste que só fala com 127.0.0.1;
//   · 'beta'        → Assistente Menuzia Beta: outro app (nome, pasta, dados, log,
//                     início automático), só computador pareado, sem token da loja.
const AMBIENTE = (() => {
  try {
    return require('../package.json').menuziaAmbiente || null
  } catch {
    return null
  }
})()
const EH_TESTE_LOCAL = AMBIENTE?.variante === 'teste-local'
const EH_BETA = AMBIENTE?.variante === 'beta'
// O Beta grava no próprio log: o do Assistente antigo (%TEMP%\menuzia-print.log) fica só dele.
const LOG_NOME = EH_BETA ? 'menuzia-beta-print.log' : 'menuzia-print.log'
const PERFIL_LOG = EH_BETA ? { logNome: LOG_NOME, prefixoTmp: 'menuzia-beta' } : null
/** Como a impressora recebe (0.2.0-beta.7): intensidade, envio direto e modo texto. */
const perfilEnvio = (x) => ({
  intensidade: x?.intensidade ?? 'normal',
  envio: x?.envio ?? 'driver',
  modoImpressao: x?.modoImpressao ?? 'imagem',
  redeIp: x?.redeIp ?? null,
  redePorta: x?.redePorta ?? 9100,
})

// Diagnóstico: grava no MESMO arquivo que o print.ps1 (%TEMP%\menuzia-print.log; no Beta, o dele).
function logArquivo(msg) {
  try {
    fs.appendFileSync(path.join(os.tmpdir(), LOG_NOME), `[${new Date().toLocaleTimeString()}] [agente] ${msg}\n`)
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
const PRODUCAO = 'https://app.menuzia.com.br'
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/
const API_BASE_URL = (EH_TESTE_LOCAL || EH_BETA) && AMBIENTE.apiBaseUrl ? AMBIENTE.apiBaseUrl : PRODUCAO
if (EH_BETA) {
  // Beta: produção ou, no build de teste do Beta, só esta máquina. Nada mais.
  if (API_BASE_URL !== PRODUCAO && !LOOPBACK.test(String(API_BASE_URL))) {
    app.quit()
    process.exit(1)
  }
  // Pasta de dados própria ANTES de qualquer leitura de configuração: credencial,
  // impressos e trava de instância única separados dos do Assistente antigo.
  app.setPath('userData', path.join(app.getPath('appData'), AMBIENTE.pastaDados || 'menuzia-assistente-beta'))
  if (typeof app.setAppUserModelId === 'function') app.setAppUserModelId(AMBIENTE.appUserModelId || 'com.menuzia.assistente.beta')
}
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
let ultimoCicloPedidos = { longo: false, erro: false, semSucesso: false }
const aquecidas = new Set()

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
  // O Beta nunca usa o token da loja (esse é do Assistente antigo).
  if (EH_BETA && !credencial) return
  if (!config.token && !credencial) return
  // Se um ciclo anterior ainda está imprimindo (impressora lenta), não começa outro —
  // senão dois ciclos veriam impresso=false e imprimiriam o mesmo pedido em duplicidade.
  if (cicloRodando) return
  cicloRodando = true
  ultimoCicloPedidos = { longo: false, erro: false, semSucesso: false }

  // Computador pareado (0.1.26+) usa a própria credencial; senão, o token antigo da loja.
  const auth = { Authorization: `Bearer ${credencial || config.token}`, 'X-Agente-Versao': app.getVersion() }
  // Heartbeat: informa ao servidor qual impressora (config do painel) está em uso,
  // pra o painel acender ela como "conectada". Vai junto da consulta de pedidos (5s).
  // X-Agente-Instancia: o servidor reserva o pedido para esta instalação (0086) —
  // outro Assistente da loja não recebe o mesmo pedido enquanto a reserva vale.
  const headers = { ...auth, 'X-Impressora-Id': config.impressoraCloudId || '', 'X-Agente-Instancia': instanciaAgente() }

  try {
    const url = `${API_BASE_URL}/api/agente/pedidos${EH_BETA ? '?esperar=20' : ''}`
    const res = await fetch(url, { headers, ...(EH_BETA ? { signal: AbortSignal.timeout(35_000) } : {}) })
    if (!res.ok) {
      ultimoCicloPedidos.erro = true
      log(`Erro ao consultar pedidos (HTTP ${res.status}). Verifique o token em Ajustes > Impressão.`)
      return
    }
    const recebidoEm = Date.now()
    const data = await res.json()
    ultimoCicloPedidos.longo = data.esperaAte === 20
    const { config: configImpressao, pedidos } = data
    const lojaNome = data.loja?.nome ?? ''

    if (!configImpressao?.impressaoAutomatica) return
    // Roteamento da cozinha por função (opção da loja): o servidor diz em QUAL impressora
    // deste computador a ficha sai. Sem isso, o modo de sempre: a impressora escolhida aqui.
    const destino = data.destinoCozinha || null
    // Beta: só imprime a cozinha quando o servidor diz onde ("Cozinha e Caixa").
    if (EH_BETA && !destino) return
    if (!destino && !config.impressoraWindows) return
    // Servidor de impressão da Cozinha já aberto antes do primeiro pedido.
    if (EH_BETA && destino?.nomeSistema && !aquecidas.has(destino.nomeSistema)) {
      aquecidas.add(destino.nomeSistema)
      void aquecerImpressao([destino.nomeSistema], LOG_NOME)
    }
    if (!pedidos || pedidos.length === 0) return
    let impressosNesteCiclo = 0

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

        const perfilCozinha = EH_BETA && destino
          ? { ...PERFIL_LOG, ...perfilEnvio(destino), diagnostico: diagnosticos[impressoraAlvo] || null, tempos: { _t0: Date.now() }, pausaFaixasMs: config.pausaFaixasMs ?? 0, larguraPontos: destino.larguraPontos ?? null, deslocamentoPontos: destino.deslocamentoPontos ?? 0, tamanhoFonte: destino.tamanhoFonte, imprimirLogo: configImpressao.imprimirLogo !== false }
          : null
        let saida
        if (perfilCozinha) {
          // Beta: comanda no modelo oficial v3 (v3.js, desenhada pelo ticket-canvas.js), com o
          // desconto/horários, o QR e os dados da loja que o servidor manda só para o Beta.
          const beta = data.cozinhaBeta || {}
          // Item 59 (beta.10): QR por pedido — entrega = QR da rota; retirada/balcão/mesa = cardápio.
          const opcoesV3 = { config: configImpressao, lojaNome, loja: beta.loja, extras: beta.extras?.[pedido.id], qr: (beta.qrPorPedido && beta.qrPorPedido[pedido.id]) || beta.qr }
          const doc = montarComandaV3(pedido, opcoesV3)
          // Pedido aguardando pagamento (Pix online) nunca imprime — nem chega na fila; aqui
          // é a segunda trava. Não avisa "impresso": sai quando o pagamento for confirmado.
          if (!doc) { log(`Pedido #${pedido.numero}: aguardando pagamento, não imprimi.`); continue }
          const tLogo = Date.now()
          const logo = perfilCozinha.imprimirLogo ? await logoParaDesenho(data.loja ? (data.loja.logoUrl ?? null) : undefined) : null
          perfilCozinha.tempos.logoMs = Date.now() - tLogo
          perfilCozinha.tempos._t0 = Date.now()
          saida = await imprimirDocumentoBeta(impressoraAlvo, { ...doc, texto: textoDoV3(doc) }, paperMm, { ...perfilCozinha, copias, logo })
          // Via da cozinha (opção da loja, 0150, desligada por padrão): sem valores, na mesma
          // impressora, logo depois. Falhar aqui não segura a comanda (que já saiu).
          if (configImpressao.viaCozinha === true) {
            try {
              const via = montarComandaV3(pedido, { ...opcoesV3, via: 'cozinha' })
              if (via) await imprimirDocumentoBeta(impressoraAlvo, { ...via, texto: textoDoV3(via) }, paperMm, { ...perfilCozinha, tempos: { _t0: Date.now() }, copias: 1, logo })
            } catch (e) {
              log(`Pedido #${pedido.numero}: a via da cozinha falhou (${descreverErro(e)}).`)
            }
          }
          // Comanda de entrega (0158, beta.10): pedido de ENTREGA ganha uma via a mais na
          // impressora da função "Comanda de entrega" (deste computador). Falhar aqui não segura
          // a comanda, que já saiu.
          const dEntrega = data.destinoEntrega
          if (dEntrega && dEntrega.nomeSistema && pedido.tipo === 'entrega') {
            try {
              const perfilEntrega = { ...PERFIL_LOG, ...perfilEnvio(dEntrega), diagnostico: diagnosticos[dEntrega.nomeSistema] || null, tempos: { _t0: Date.now() }, pausaFaixasMs: config.pausaFaixasMs ?? 0, larguraPontos: dEntrega.larguraPontos ?? null, deslocamentoPontos: dEntrega.deslocamentoPontos ?? 0, tamanhoFonte: dEntrega.tamanhoFonte, imprimirLogo: perfilCozinha.imprimirLogo }
              await imprimirDocumentoBeta(dEntrega.nomeSistema, { ...doc, texto: textoDoV3(doc) }, Number(dEntrega.larguraMm) <= 58 ? 58 : 80, { ...perfilEntrega, copias: 1, logo })
              informarCaminho(dEntrega.nomeSistema, perfilEntrega.tempos)
            } catch (e) {
              log(`Pedido #${pedido.numero}: a comanda de entrega falhou (${descreverErro(e)}).`)
            }
          }
        } else {
          const recibo = montarRecibo(pedido, configImpressao, cols, lojaNome, Boolean(logoPath))
          saida = await imprimirTexto(impressoraAlvo, recibo, copias, cols, logoPath, paperMm, Boolean(configImpressao.fonteMaiorProducao))
        }
        mostrarDiagnostico(saida)
        impressosNesteCiclo++
        if (perfilCozinha?.tempos) {
          perfilCozinha.tempos.totalMs = Date.now() - recebidoEm
          registrarTempos('comanda', pedido.id, perfilCozinha.tempos)
          informarCaminho(impressoraAlvo, perfilCozinha.tempos)
        }

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
    if (impressosNesteCiclo === 0) ultimoCicloPedidos.semSucesso = true
  } catch (err) {
    ultimoCicloPedidos.erro = true
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

async function informarResultado(id, ok, erro, tempos) {
  const headers = cabecalhosAgente()
  if (!headers) return
  await fetch(`${API_BASE_URL}/api/agente/trabalhos/${id}/resultado`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(tempos ? { ok, erro, tempos } : { ok, erro }),
  })
}

// ─── caminho usado por impressora (0.2.0-beta.10, 0157) ───────────────────────
// Depois de imprimir, conta ao servidor por onde saiu (direto pela fila/rede ou driver) — é o
// que o painel mostra em Impressão › Avançado. Só quando muda (ou a cada 15 min), sem esperar.
const caminhoInformado = new Map()
function informarCaminho(nomeSistema, tempos) {
  if (!EH_BETA || !nomeSistema || !tempos || !tempos.via) return
  const chave = `${tempos.via}|${tempos.obs || ''}`
  const antes = caminhoInformado.get(nomeSistema)
  if (antes && antes.chave === chave && Date.now() - antes.em < 15 * 60_000) return
  const headers = cabecalhosAgente()
  if (!headers) return
  caminhoInformado.set(nomeSistema, { chave, em: Date.now() })
  fetch(`${API_BASE_URL}/api/agente/caminho`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nomeSistema, caminho: tempos.via, obs: tempos.obs || null }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => caminhoInformado.delete(nomeSistema))
}

// ─── tempos da impressão (0.2.0-beta.7) ──────────────────────────────────────
// Cada impressão mede: logo, desenho, envio e o total (do recebimento até o Windows /
// a impressora aceitar). Vai para o servidor (trabalhos) e para %TEMP%\menuzia-beta-tempos.jsonl.
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms))
function registrarTempos(tipo, id, tempos) {
  if (!EH_BETA || !tempos) return null
  const limpo = {}
  for (const [k, v] of Object.entries(tempos)) if (!k.startsWith('_')) limpo[k] = v
  try { fs.appendFileSync(path.join(os.tmpdir(), 'menuzia-beta-tempos.jsonl'), JSON.stringify({ em: new Date().toISOString(), tipo, id, ...limpo }) + '\n') } catch { /* só diagnóstico */ }
  return limpo
}

// ─── logo da loja (Recibo/Extrato do Beta) ───────────────────────────────────
// Nunca de uma URL qualquer: só pela rota do servidor, com a credencial deste computador;
// o servidor entrega apenas o arquivo do Storage da própria loja. Guardada pelo hash na
// pasta de dados do Beta. Falhou? Usa a que já tem; sem nenhuma, sai o nome da loja.
const PASTA_LOGOS = () => path.join(app.getPath('userData'), 'logos')
const EXTENSAO_LOGO = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' }
let logoAtual = null
async function obterLogo() {
  const headers = cabecalhosAgente()
  if (!headers) return null
  const guardada = () => (logoAtual && fs.existsSync(logoAtual.caminho) ? logoAtual.caminho : null)
  try {
    const res = await fetch(`${API_BASE_URL}/api/agente/logo${logoAtual ? `?sha=${logoAtual.sha}` : ''}`, { headers, signal: AbortSignal.timeout(8000) })
    if (res.status === 304) return guardada()
    if (res.status === 204) { logoAtual = null; return null }
    if (res.status !== 200) return guardada()
    const sha = String(res.headers.get('x-logo-sha256') || '')
    const ext = EXTENSAO_LOGO[String(res.headers.get('content-type') || '').split(';')[0].trim()]
    const bytes = Buffer.from(await res.arrayBuffer())
    if (!/^[0-9a-f]{64}$/.test(sha) || !ext || crypto.createHash('sha256').update(bytes).digest('hex') !== sha) return guardada()
    const dir = PASTA_LOGOS()
    fs.mkdirSync(dir, { recursive: true })
    const caminho = path.join(dir, `loja-${sha.slice(0, 16)}.${ext}`)
    fs.writeFileSync(caminho, bytes)
    // Só a logo atual e o que foi preparado a partir dela.
    for (const f of fs.readdirSync(dir)) if (!f.includes(sha.slice(0, 16))) fs.unlink(path.join(dir, f), () => {})
    logoAtual = { sha, caminho }
    return caminho
  } catch (err) {
    logArquivo(`LOGO: ${descreverErro(err)}`)
    return guardada()
  }
}

// A logo vai ao desenho (ticket.html) como data URL — arquivo local "sujaria" o canvas.
const MIME_LOGO = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' }
// Logo em memória (0.2.0-beta.7): antes era uma ida ao servidor e uma leitura do arquivo a
// CADA impressão. Agora: o servidor manda a "versão" da logo (muda quando a loja troca a
// logo) — mudou, busca na hora; igual, usa a guardada (reconfere a cada 5 min; "sem logo"
// a cada 30 s, porque a versão de impressão pode ficar pronta um pouco depois).
let logoDataUrl = null
let logoDataUrlDe = null
let logoConferidaEm = 0
let logoVersaoAtual
async function logoParaDesenho(versao) {
  const validade = logoDataUrl ? 5 * 60_000 : 30_000
  const mesmaVersao = versao === undefined || versao === logoVersaoAtual
  if (logoDataUrl !== null && mesmaVersao && Date.now() - logoConferidaEm < validade) return logoDataUrl || null
  if (versao !== undefined) logoVersaoAtual = versao
  const caminho = await obterLogo()
  logoConferidaEm = Date.now()
  if (!caminho) { logoDataUrl = ''; logoDataUrlDe = null; return null }
  if (logoDataUrl && logoDataUrlDe === caminho) return logoDataUrl
  try {
    const mime = MIME_LOGO[path.extname(caminho).slice(1).toLowerCase()]
    logoDataUrl = mime ? `data:${mime};base64,${fs.readFileSync(caminho).toString('base64')}` : ''
    logoDataUrlDe = caminho
    return logoDataUrl || null
  } catch { logoDataUrl = ''; return null }
}

// Uma fila por impressora do Windows: a do caixa travada não segura a da cozinha.
const filas = new FilasPorDispositivo(
  async (t) => {
    t.tempos = { _t0: Date.now() }
    const largura = Number(t.larguraMm) <= 58 ? 58 : 80
    const calibracao = t.tipo === 'teste_impressora' && t.snapshot?.calibracao === true
    // Recibo/Extrato de teste: o MESMO renderizador e o MESMO perfil do Recibo/Extrato real.
    const reciboTeste = t.tipo === 'teste_impressora' && t.snapshot?.recibo_teste === true
    // Comanda da cozinha de teste (Beta): o MESMO modelo da comanda real, com dados de demonstração.
    const cozinhaTeste = EH_BETA && t.tipo === 'teste_impressora' && t.snapshot?.cozinha_teste === true && t.snapshot?.pedido
    const texto = t.tipo === 'pre_conta' || reciboTeste
      ? montarPreConta(t.snapshot)
      : calibracao
        ? montarCalibracao(t.snapshot, diagnosticos[t.nomeSistema] || {})
        : montarTeste(t.snapshot)
    // Perfil da impressora (Beta). A calibração usa o perfil gravado no pedido de impressão,
    // para a régua mostrar exatamente o que está escrito nela.
    const perfil = EH_BETA
      ? {
          ...PERFIL_LOG,
          ...perfilEnvio(t),
          diagnostico: diagnosticos[t.nomeSistema] || null,
          tempos: t.tempos,
          pausaFaixasMs: carregarConfig().pausaFaixasMs ?? 0,
          larguraPontos: calibracao ? (t.snapshot.largura_pontos ?? null) : (t.larguraPontos ?? null),
          deslocamentoPontos: calibracao ? (t.snapshot.deslocamento_pontos ?? 0) : (t.deslocamentoPontos ?? 0),
          tamanhoFonte: t.tamanhoFonte,
          imprimirLogo: t.imprimirLogo !== false,
        }
      : null
    // Recibo/Extrato no Beta: layout próprio (pre-conta-beta.js + ticket-canvas.js), o MESMO
    // para a conta real e para o teste. Calibração e teste simples seguem no print.ps1.
    let saida
    if (EH_BETA && calibracao) {
      // Teste de largura: pelo MESMO caminho da comanda (driver, fila RAW ou rede).
      const doc = montarTesteLargura(t.snapshot, diagnosticos[t.nomeSistema] || {}, perfil)
      saida = await imprimirDocumentoBeta(t.nomeSistema, doc, largura, perfil)
    } else if (cozinhaTeste) {
      const doc = montarComandaV3(t.snapshot.pedido, { config: {}, lojaNome: t.snapshot.loja, loja: t.loja, extras: t.snapshot.extras, qr: t.snapshot.qr || t.qr, teste: true })
      const tLogo = Date.now()
      const logo = perfil.imprimirLogo ? await logoParaDesenho(t.logoVersao) : null
      if (perfil.tempos) { perfil.tempos.logoMs = Date.now() - tLogo; perfil.tempos._t0 = Date.now() }
      saida = await imprimirDocumentoBeta(t.nomeSistema, { ...doc, texto: textoDoV3(doc) }, largura, { ...perfil, logo })
    } else if (EH_BETA && (t.tipo === 'pre_conta' || reciboTeste)) {
      // QR do rodapé: o do snapshot ou o que o servidor manda com o trabalho (Instagram/cardápio).
      const doc = montarPreContaV3({ ...t.snapshot, qr: t.snapshot.qr || t.qr || null, loja_dados: t.loja || null })
      const tLogo = Date.now()
      const logo = perfil.imprimirLogo ? await logoParaDesenho(t.logoVersao) : null
      if (perfil.tempos) { perfil.tempos.logoMs = Date.now() - tLogo; perfil.tempos._t0 = Date.now() }
      saida = await imprimirDocumentoBeta(t.nomeSistema, { ...doc, texto: textoDoV3(doc) }, largura, { ...perfil, logo })
    } else {
      saida = perfil
        ? await imprimirTexto(t.nomeSistema, texto, 1, colsPreConta(largura), null, largura, false, perfil)
        : await imprimirTexto(t.nomeSistema, texto, 1, colsPreConta(largura), null, largura, false)
    }
    mostrarDiagnostico(saida)
    informarCaminho(t.nomeSistema, t.tempos)
    const rotulo = t.tipo === 'pre_conta' ? `Recibo/Extrato (${t.via}ª via)` : reciboTeste ? 'Recibo/Extrato de teste' : cozinhaTeste ? 'Comanda de teste' : calibracao ? (EH_BETA ? 'Teste de largura' : 'Página de calibração') : 'Teste'
    const via = t.tempos?.via || (perfil?.envio === 'raw_rede' ? 'raw_rede' : perfil && (perfil.envio === 'raw_fila' || perfil.modoImpressao === 'texto') ? 'raw_fila' : 'driver')
    const pela = via === 'raw_rede' ? `pela rede (${perfil.redeIp}:${perfil.redePorta})` : via === 'raw_fila' ? 'direto pela fila (ESC/POS)' : 'o Windows aceitou'
    log(`${rotulo} enviado para "${t.nomeSistema}" — ${pela} (confira se o papel saiu).`)
  },
  async (id, ok, erro, t) => {
    if (!ok) log(`Falha ao enviar trabalho para a impressora: ${erro}`)
    if (t?.tempos) t.tempos.totalMs = Date.now() - (t.recebidoEm || t.tempos._t0)
    await informarResultado(id, ok, erro, registrarTempos(t?.tipo || 'trabalho', id, t?.tempos))
  },
)

/**
 * Busca os trabalhos (pré-conta, testes). Beta 0.2.0-beta.7: pede com espera longa — o
 * servidor segura a resposta até entrar um trabalho (aviso em tempo real) ou 20 s.
 * Devolve { longo, erro } para o laço decidir se pergunta de novo na hora.
 */
async function consultarTrabalhos() {
  const headers = cabecalhosAgente()
  if (!headers || consultandoTrabalhos) return { longo: false, erro: !headers }
  consultandoTrabalhos = true
  try {
    const url = `${API_BASE_URL}/api/agente/trabalhos${EH_BETA ? '?esperar=20' : ''}`
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(35_000) })
    if (res.status === 401) {
      log('Este computador foi desconectado da loja (credencial revogada). Pareie de novo em Ajustes › Impressão.')
      return { longo: false, erro: true }
    }
    if (!res.ok) return { longo: false, erro: true }
    const longo = res.headers.get('x-menuzia-espera') === '20'
    const data = await res.json()
    if (Array.isArray(data.trabalhos) && data.trabalhos.length) {
      const agora = Date.now()
      for (const t of data.trabalhos) t.recebidoEm = agora
      // Diagnóstico do driver para o teste de largura: o guardado (até 10 min) já serve.
      if (data.trabalhos.some((t) => t.snapshot?.calibracao === true)) await atualizarDiagnosticos(Object.keys(diagnosticos).length === 0)
      filas.receber(data.trabalhos)
    }
    return { longo, erro: false }
  } catch (err) {
    logArquivo(`TRABALHOS: ${descreverErro(err)}`)
    return { longo: false, erro: true }
  } finally {
    consultandoTrabalhos = false
  }
}

let trabalhosAtivo = false
/** Laço dos trabalhos: espera longa quando o servidor aceita; senão, a cada 3 s (como antes). */
async function lacoTrabalhos() {
  let erros = 0
  while (trabalhosAtivo) {
    const inicio = Date.now()
    const r = await consultarTrabalhos()
    if (!trabalhosAtivo) break
    erros = r.erro ? erros + 1 : 0
    if (r.erro) await esperar(Math.min(30_000, 2000 * erros))
    else if (!r.longo) await esperar(3000)
    else if (Date.now() - inicio < 250) await esperar(500) // servidor respondeu vazio na hora: sem laço quente
  }
}

// O que o driver de cada impressora informa (Beta). Coletar leva alguns segundos, então
// é refeito só a cada 10 minutos — e sempre antes de uma página de calibração.
let diagnosticos = {}
let diagnosticoEm = 0
async function atualizarDiagnosticos(forcar = false) {
  if (!EH_BETA) return
  if (!forcar && Date.now() - diagnosticoEm < 10 * 60_000) return
  try {
    diagnosticos = await diagnosticarImpressoras()
    diagnosticoEm = Date.now()
  } catch (err) {
    logArquivo(`DIAGNOSTICO: ${descreverErro(err)}`)
  }
}

/** Manda ao servidor as impressoras instaladas neste Windows (ficam ligadas a este computador). */
async function informarImpressoras() {
  const headers = cabecalhosAgente()
  if (!headers) return
  try {
    const nomes = await listarImpressorasWindows()
    await atualizarDiagnosticos()
    const corpo = EH_BETA ? { impressoras: nomes, diagnosticos } : { impressoras: nomes }
    await fetch(`${API_BASE_URL}/api/agente/impressoras`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    })
  } catch (err) {
    logArquivo(`DESCOBERTA: ${descreverErro(err)}`)
  }
}

function iniciarTrabalhos() {
  if (trabalhosAtivo || trabalhosTimer) return
  descobertaTimer = setInterval(informarImpressoras, 60_000)
  informarImpressoras()
  if (EH_BETA) {
    // Espera longa (0.2.0-beta.7): o trabalho chega na hora em que é criado.
    trabalhosAtivo = true
    trabalhosTimer = true
    void lacoTrabalhos()
    // Deixa pronto o desenho (fontes) para a primeira impressão não pagar o "frio".
    setTimeout(() => { void aquecerImpressao([], LOG_NOME) }, 2000)
  } else {
    trabalhosTimer = setInterval(consultarTrabalhos, 3000)
    consultarTrabalhos()
  }
}

function pararTrabalhos() {
  trabalhosAtivo = false
  if (trabalhosTimer && trabalhosTimer !== true) clearInterval(trabalhosTimer)
  if (descobertaTimer) clearInterval(descobertaTimer)
  trabalhosTimer = null
  descobertaTimer = null
}

function iniciarPolling() {
  if (polling) return
  polling = true
  const config = carregarConfig()
  const intervaloMs = Math.max(2, config.intervaloSegundos || 3) * 1000
  if (EH_BETA) {
    void lacoPedidos(intervaloMs)
  } else {
    pollTimer = setInterval(cicloDePolling, intervaloMs)
    cicloDePolling()
  }
  log('Assistente de Impressão ativo — verificando pedidos novos periodicamente.')
}

/**
 * Beta 0.2.0-beta.7: pedidos da cozinha com espera longa — o servidor responde quando
 * entra um pedido. Sem espera (servidor antigo, erro, loja fora de "Cozinha e Caixa"):
 * o intervalo de sempre. Pedido que volta sem conseguir imprimir: pausa, sem laço quente.
 */
async function lacoPedidos(intervaloMs) {
  let erros = 0
  while (polling) {
    const inicio = Date.now()
    await cicloDePolling()
    if (!polling) break
    const u = ultimoCicloPedidos
    erros = u.erro ? erros + 1 : 0
    if (u.erro) await esperar(Math.min(30_000, intervaloMs * erros))
    else if (!u.longo || u.semSucesso) await esperar(intervaloMs)
    else if (Date.now() - inicio < 250) await esperar(500)
  }
}

function pararPolling() {
  polling = false
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

// Se já há uma instância rodando, traz a janela dela pra frente em vez de abrir outra.
// Beta 0.2.0-beta.10: o link menuzia://parear?c=… do painel chega aqui (o Windows abre uma
// segunda instância com o link no argv) — conecta sem código.
app.on('second-instance', (_e, argv) => {
  const convite = EH_BETA ? conviteDosArgumentos(argv) : null
  if (convite) void parearComConvite(convite, 'link do painel')
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
  // O Beta registra com NOME PRÓPRIO: não toca na entrada do Assistente antigo.
  if (app.isPackaged && EH_BETA && AMBIENTE.iniciarComWindows !== false) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'], name: AMBIENTE.nomeInicio || 'Assistente Menuzia Beta' })
  } else if (app.isPackaged && !EH_TESTE_LOCAL && !EH_BETA) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })
  }
  // Pareamento sem código (beta.10): registra o link menuzia:// (só no app empacotado) e, se
  // este computador ainda não está conectado, usa o convite do link ou do nome do instalador.
  if (EH_BETA && app.isPackaged && !EH_TESTE_LOCAL) {
    try { app.setAsDefaultProtocolClient('menuzia') } catch { /* sem o link: o código continua valendo */ }
  }
  criarJanela()
  iniciarPolling()
  iniciarTrabalhos()
  if (EH_BETA && !lerCredencial()) {
    const doLink = conviteDosArgumentos(process.argv)
    const doInstalador = doLink ? null : conviteNosDownloads(app.getPath('downloads'))
    if (doLink || doInstalador) setTimeout(() => void parearComConvite(doLink || doInstalador, doLink ? 'link do painel' : 'instalador da loja'), 1500)
  }
  if (EH_BETA) log(`Assistente Menuzia Beta ${app.getVersion()} — convive com o Assistente de Impressão atual, que continua funcionando.`)
})

app.on('before-quit', () => { app.isQuitting = true; encerrarServidores() })
app.on('window-all-closed', () => { /* mantém rodando em segundo plano */ })

ipcMain.handle('versao', () => app.getVersion())
ipcMain.handle('ambiente', () => ({ testeLocal: EH_TESTE_LOCAL || (EH_BETA && API_BASE_URL !== PRODUCAO), beta: EH_BETA, servidor: API_BASE_URL }))
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

/** Troca código (8) ou convite (24, beta.10) pela credencial deste computador. */
async function parearNoServidor(corpo, nome) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/agente/parear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...corpo, nome: String(nome || os.hostname()).slice(0, 60), versao: app.getVersion() }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, erro: data.error || `O servidor respondeu HTTP ${res.status}.` }
    salvarCredencial(data.credencial, data.nome)
    log(`Computador pareado como "${data.nome}". As impressoras deste Windows serão informadas ao painel.`)
    pararTrabalhos()
    iniciarTrabalhos()
    pararPolling()
    iniciarPolling()
    try { if (mainWindow) mainWindow.webContents.send('estado-mudou', { mensagem: '' }) } catch { /* só a tela */ }
    return { ok: true, nome: data.nome }
  } catch (err) {
    return { ok: false, erro: `Sem conexão com ${API_BASE_URL} (${descreverErro(err)}).` }
  }
}

/** Convite do link menuzia:// ou do nome do instalador (beta.10): conecta sem código. */
let pareandoConvite = false
async function parearComConvite(convite, origem) {
  if (pareandoConvite) return
  if (lerCredencial()) { log(`Este computador já está conectado à loja (convite do ${origem} ignorado).`); return }
  pareandoConvite = true
  try {
    log(`Conectando à loja pelo ${origem}…`)
    const r = await parearNoServidor({ convite }, os.hostname())
    if (!r.ok) log(`Não deu para conectar pelo ${origem}: ${r.erro} Peça um link novo no painel (Impressão) ou use o código.`)
  } finally {
    pareandoConvite = false
  }
}

ipcMain.handle('parear-codigo', async (_e, { codigo, nome }) => {
  const c = String(codigo || '').trim()
  if (!c) return { ok: false, erro: 'Digite o código de pareamento.' }
  return parearNoServidor({ codigo: c }, nome)
})

ipcMain.handle('desparear', () => {
  apagarCredencial()
  pararTrabalhos()
  log('Este computador saiu do modo de várias impressoras. Continua no modo antigo (token), se houver.')
  return { ok: true }
})
