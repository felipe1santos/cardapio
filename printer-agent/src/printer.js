const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

// Os .ps1 ficam empacotados, mas o PowerShell -File precisa de um arquivo real no
// disco — e nada dentro do app.asar existe como arquivo de verdade. Por isso eles são
// marcados em "asarUnpack" (package.json), o que os extrai pra app.asar.unpacked. O
// __dirname ainda aponta pra dentro do .asar, então trocamos o segmento pelo caminho
// desempacotado. Em dev (sem asar) o replace é no-op e usa o caminho normal.
function scriptReal(nome) {
  return path.join(__dirname, nome).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}

const LIST_SCRIPT = scriptReal('list-printers.ps1')
const PRINT_SCRIPT = scriptReal('print.ps1')
const DIAG_SCRIPT = scriptReal('diagnostico-impressoras.ps1')
const PRINT_IMAGEM_SCRIPT = scriptReal('print-imagem.ps1')
const PRINT_RAW_SCRIPT = scriptReal('print-raw.ps1')
const SERVIDOR_SCRIPT = scriptReal('servidor-impressao.ps1')
const { PoolServidores } = require('./servidor-ps')
const { LINHAS_POR_FAIXA } = require('./escpos')

// Servidor de impressão residente (0.2.0-beta.7): um PowerShell por impressora, já com
// tudo carregado. Se ele não subir, cai no caminho antigo: um PowerShell por impressão.
// Se travar DEPOIS de receber a impressão, ou se a impressora recusar, sai como erro
// (sem repetir aqui: o papel pode ter saído).
let pool = null
function poolServidores(logNome) {
  if (!pool) pool = new PoolServidores(SERVIDOR_SCRIPT, { logNome })
  return pool
}
async function pelaImpressora(nomeImpressora, pedido, logNome, argsReserva) {
  try {
    const r = await poolServidores(logNome).de(nomeImpressora).pedir(pedido)
    const log = (r.log || []).join('\n')
    if (!r.ok) {
      const e = new Error(r.erro || 'falha ao imprimir')
      e.log = log
      throw e
    }
    return log
  } catch (e) {
    // Caminho antigo SÓ se a impressão não chegou ao servidor residente. Depois de entregue
    // (prazo, queda), repetir aqui poderia imprimir em dobro — sai como erro normal.
    if (!e.doServidor || !e.antesDeEnviar) throw e
    return runPowershell(argsReserva, { timeout: 60_000, windowsHide: true })
  }
}
const { imagemEscpos, textoEscpos } = require('./escpos')
const { enviarRede } = require('./envio-direto')
const { escolherEnvioAuto } = require('./envio-auto')
/** Envio automático: quando o direto falhou em cada impressora (some em 10 min). */
const falhaDireto = new Map()
const { larguraEmPontos } = require('./ticket-canvas')
const { textoAlfa1, larguraDoPapel, colunasDoPapel, caminhoDoEnvio, FAIXA_LINHAS, FAIXA_PAUSA_MS } = require('./alfa1')
const { desenharAlfa1, pngDosBits } = require('./alfa1-render')

function runPowershell(args, opcoesExec = {}) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], opcoesExec, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve(stdout)
    })
  })
}

/** Lista os nomes das impressoras instaladas no Windows (as mesmas que aparecem em "Impressoras e scanners"). */
async function listarImpressorasWindows() {
  const stdout = await runPowershell(['-File', LIST_SCRIPT])
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/**
 * O que o driver de cada impressora informa (Assistente Beta): DPI, papel, área
 * imprimível, margens. Só leitura; limite de tempo para impressora de rede travada.
 * Retorna { [nome]: diagnostico }.
 */
async function diagnosticarImpressoras() {
  const stdout = await runPowershell(['-File', DIAG_SCRIPT], { timeout: 30_000, windowsHide: true })
  const mapa = {}
  for (const linha of stdout.split(/\r?\n/)) {
    const m = linha.match(/^MENUZIA-DIAG:(.*)$/)
    if (!m) continue
    try {
      const d = JSON.parse(m[1])
      if (d && typeof d.nome === 'string') mapa[d.nome] = d
    } catch {
      /* linha quebrada: ignora esta impressora */
    }
  }
  return mapa
}

/** Envia um texto pra impressora do Windows. `cols` (nº de colunas do recibo) dimensiona
 * a fonte pra preencher o papel — menos colunas = fonte maior. `fonteMaior` aumenta a
 * fonte das linhas de item/complemento (toggle "fonte maior na via de produção").
 * `perfil` (só o Assistente Beta manda): largura em pontos, deslocamento e nome do log —
 * sem ele, os argumentos do print.ps1 são exatamente os de sempre. */
async function imprimirTexto(nomeImpressora, texto, copias = 1, cols, logoPath, paperWidthMm = 80, fonteMaior = false, perfil = null) {
  const tmpFile = path.join(os.tmpdir(), `${perfil?.prefixoTmp || 'menuzia-recibo'}-${Date.now()}.txt`)
  fs.writeFileSync(tmpFile, texto, 'utf-8')
  try {
    const args = ['-File', PRINT_SCRIPT, '-FilePath', tmpFile, '-PrinterName', nomeImpressora, '-Copies', String(copias)]
    if (cols && cols > 0) args.push('-Cols', String(cols))
    if (logoPath) args.push('-LogoPath', logoPath)
    args.push('-PaperWidthMm', String(paperWidthMm))
    if (fonteMaior) args.push('-FonteMaior', '1')
    if (perfil) {
      if (Number.isInteger(perfil.larguraPontos) && perfil.larguraPontos > 0) args.push('-LarguraPontos', String(perfil.larguraPontos))
      if (Number.isInteger(perfil.deslocamentoPontos) && perfil.deslocamentoPontos !== 0) args.push('-DeslocamentoPontos', String(perfil.deslocamentoPontos))
      if (perfil.logNome) args.push('-LogNome', perfil.logNome)
    }
    // Retorna o stdout (linhas "MENUZIA: ...") pra o agente mostrar o diagnóstico na janela.
    return await runPowershell(args)
  } finally {
    fs.unlink(tmpFile, () => {})
  }
}

// ─── desenho do Assistente Beta ──────────────────────────────────────────────
// A comanda e a pré-conta do Beta são desenhadas pelo ticket-canvas.js — o MESMO arquivo
// da pré-visualização do painel — numa janela OCULTA do Electron (renderer/ticket.html).
// Sai um PNG, que o print-imagem.ps1 só manda para a impressora.
let janelaDesenho = null
let janelaPronta = null
// PC fraco: a janela de desenho (~60–100 MB) fecha depois de 20 min sem imprimir e
// reabre na próxima impressão (o Assistente a aquece de novo ao iniciar).
let usoDesenhoEm = 0
const OCIOSO_DESENHO_MS = 20 * 60_000
setInterval(() => {
  if (janelaDesenho && !janelaDesenho.isDestroyed() && Date.now() - usoDesenhoEm > OCIOSO_DESENHO_MS) {
    janelaDesenho.destroy()
    janelaDesenho = null
    janelaPronta = null
  }
}, 60_000).unref?.()
function janelaDoDesenho() {
  usoDesenhoEm = Date.now()
  if (janelaPronta && janelaDesenho && !janelaDesenho.isDestroyed()) return janelaPronta
  const { BrowserWindow } = require('electron')
  janelaDesenho = new BrowserWindow({
    show: false,
    width: 900,
    height: 600,
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  })
  janelaDesenho.on('closed', () => { janelaDesenho = null; janelaPronta = null })
  janelaPronta = janelaDesenho.loadFile(path.join(__dirname, 'renderer', 'ticket.html')).catch((e) => {
    janelaPronta = null
    throw e
  })
  return janelaPronta
}

/** doc → linhas em 1 bit (envio direto ESC/POS). */
async function desenharBits(doc, opcoes) {
  await janelaDoDesenho()
  const r = await janelaDesenho.webContents.executeJavaScript(`window.renderizarTicket(${JSON.stringify(doc)}, ${JSON.stringify({ ...opcoes, bits: true })})`, true)
  if (!r || typeof r.bits !== 'string') throw new Error('desenho vazio')
  return { bits: new Uint8Array(Buffer.from(r.bits, 'base64')), largura: r.largura, altura: r.altura, porLinha: r.porLinha }
}

/**
 * Envio DIRETO (0.2.0-beta.7): bytes ESC/POS para a fila do Windows (RAW) ou para IP:porta.
 * Imagem = a MESMA comanda do ticket-canvas.js em 1 bit; texto = comandos nativos.
 * Se o desenho falhar, sai em texto ESC/POS — nunca deixa de sair.
 */
async function imprimirDireto(nomeImpressora, doc, opcoes, perfil, envio, modo, prefixo) {
  const largura = larguraEmPontos(opcoes.larguraMm, opcoes.larguraPontos)
  let bytes
  let como = modo
  if (modo === 'texto') {
    bytes = textoEscpos(doc, { larguraPontos: largura, intensidade: opcoes.intensidade })
  } else {
    try {
      const img = await desenharBits(doc, opcoes)
      bytes = imagemEscpos(img, { intensidade: opcoes.intensidade, deslocamento: perfil.deslocamentoPontos })
    } catch (e) {
      bytes = textoEscpos(doc, { larguraPontos: largura, intensidade: opcoes.intensidade })
      como = `texto (desenho falhou: ${e.message})`
    }
  }
  const copias = Number.isInteger(perfil.copias) && perfil.copias > 1 ? Math.min(perfil.copias, 5) : 1
  if (copias > 1) bytes = Buffer.concat(Array(copias).fill(bytes))
  const tempos = perfil.tempos || {}
  tempos.desenhoMs = Date.now() - (tempos._t0 || Date.now())
  const tEnvio = Date.now()
  // Pausa entre faixas: padrão ZERO (tudo de uma vez). Só para impressora que engasga.
  const pausaMs = Math.max(0, Math.min(500, Number(perfil.pausaFaixasMs) || 0))
  const bloco = pausaMs > 0 ? 8 + Math.ceil(largura / 8) * LINHAS_POR_FAIXA : 0
  if (envio === 'raw_rede') {
    if (!perfil.redeIp) throw new Error('Envio pela rede sem o IP da impressora (Impressão › Calibrar impressora).')
    const porta = Number(perfil.redePorta) || 9100
    await enviarRede(perfil.redeIp, porta, bytes, { bloco, pausaMs })
    tempos.envioMs = Date.now() - tEnvio
    tempos.via = 'raw_rede'
    return `MENUZIA: RAW REDE OK ${perfil.redeIp}:${porta} ${bytes.length} bytes, ${largura} pontos (${como}).`
  }
  const arquivo = path.join(os.tmpdir(), `${prefixo}-raw-${Date.now()}.bin`)
  fs.writeFileSync(arquivo, bytes)
  try {
    const titulo = doc.modelo === 'cozinha' || doc.documento === 'comanda' ? 'Menuzia - Comanda' : doc.modelo === 'largura' ? 'Menuzia - Teste de largura' : 'Menuzia - Pre-conta'
    const args = ['-File', PRINT_RAW_SCRIPT, '-PrinterName', nomeImpressora, '-Arquivo', arquivo, '-Titulo', titulo, '-Bloco', String(bloco), '-PausaMs', String(pausaMs)]
    if (perfil.logNome) args.push('-LogNome', perfil.logNome)
    const saida = await pelaImpressora(nomeImpressora, { acao: 'raw', impressora: nomeImpressora, arquivo, titulo, bloco, pausaMs }, perfil.logNome, args)
    tempos.envioMs = Date.now() - tEnvio
    tempos.via = 'raw_fila'
    return `MENUZIA: RAW FILA ${largura} pontos (${como}).\n${saida || ''}`
  } finally {
    fs.unlink(arquivo, () => {})
  }
}

/** doc → caminho do PNG (no tmp). */
async function desenharTicket(doc, opcoes, prefixo) {
  await janelaDoDesenho()
  const r = await janelaDesenho.webContents.executeJavaScript(`window.renderizarTicket(${JSON.stringify(doc)}, ${JSON.stringify(opcoes)})`, true)
  const cabecalho = 'data:image/png;base64,'
  if (!r || typeof r.png !== 'string' || !r.png.startsWith(cabecalho)) throw new Error('desenho vazio')
  const arquivo = path.join(os.tmpdir(), `${prefixo}-${Date.now()}.png`)
  fs.writeFileSync(arquivo, Buffer.from(r.png.slice(cabecalho.length), 'base64'))
  return arquivo
}

/**
 * Documentos do Assistente Beta — pré-conta (pre-conta-beta.js) e comanda da cozinha
 * (cozinha-beta.js). Desenha o PNG (ticket-canvas.js) e imprime com print-imagem.ps1;
 * se o desenho falhar, imprime o texto do documento — nunca deixa de sair.
 * perfil: larguraPontos, deslocamentoPontos, tamanhoFonte, logo, imprimirLogo, copias, logNome, prefixoTmp
 *         e (0.2.0-beta.7) intensidade, envio (driver | raw_fila | raw_rede), modoImpressao
 *         (imagem | texto), redeIp, redePorta.
 * O Assistente atual não usa isto.
 */
/**
 * ALFA 1 (1.1.0): layout único (alfa1.js). Imagem = o HTML da referência desenhado em pontos (alfa1-render.js);
 * Texto = o mesmo layout com os comandos da impressora. Envio DIRETO (fila RAW ou rede) em faixas com pausa;
 * o Windows só entra de RESERVA quando o direto dá erro (e fica no log) ou quando o suporte força (envio 'driver').
 */
async function imprimirAlfa1(nomeImpressora, doc, paperWidthMm, perfil = {}) {
  const prefixo = perfil.prefixoTmp || 'menuzia-alfa1'
  const tempos = perfil.tempos || {}
  if (!perfil.tempos) perfil.tempos = tempos
  const modo = perfil.modoImpressao === 'texto' ? 'texto' : 'imagem'
  const largura = larguraDoPapel({ larguraMm: paperWidthMm, larguraPontos: perfil.larguraPontos, pontosImprimiveis: perfil.diagnostico?.pontosImprimiveis })
  const intensidade = perfil.intensidade === 'escura' || perfil.intensidade === 'mais_escura' ? perfil.intensidade : 'normal'
  const copias = Number.isInteger(perfil.copias) && perfil.copias > 1 ? Math.min(perfil.copias, 5) : 1
  let caminho
  if (perfil.envio === 'auto' || !perfil.envio) {
    const e = escolherEnvioAuto({ nomeSistema: nomeImpressora, redeIp: perfil.redeIp, diagnostico: perfil.diagnostico, falhouEm: falhaDireto.get(nomeImpressora) })
    caminho = { via: e.envio, reserva: e.envio !== 'driver' }
    tempos.obs = `automático: ${e.motivo}`
  } else {
    caminho = caminhoDoEnvio({ envio: perfil.envio, redeIp: perfil.redeIp })
  }
  // Imagem: desenha uma vez (serve ao direto e à reserva pelo Windows).
  let img = null
  if (modo === 'imagem' || caminho.via === 'driver') {
    img = await desenharAlfa1(doc, { larguraPontos: largura, intensidade })
    tempos.desenhoMs = Date.now() - (tempos._t0 || Date.now())
  }
  const pelaReserva = async (motivo) => {
    if (!img) img = await desenharAlfa1(doc, { larguraPontos: largura, intensidade })
    const png = path.join(os.tmpdir(), `${prefixo}-${Date.now()}.png`)
    fs.writeFileSync(png, pngDosBits(img))
    try {
      const titulo = doc.documento === 'pre_conta' ? 'Menuzia - Pre-conta' : 'Menuzia - Comanda'
      const args = ['-File', PRINT_IMAGEM_SCRIPT, '-PrinterName', nomeImpressora, '-ImagemPng', png, '-Titulo', titulo]
      if (perfil.logNome) args.push('-LogNome', perfil.logNome)
      if (copias > 1) args.push('-Copies', String(copias))
      const tEnvio = Date.now()
      const saida = await pelaImpressora(nomeImpressora, { acao: 'imagem', impressora: nomeImpressora, arquivo: png, copias, desloc: 0, titulo }, perfil.logNome, args)
      tempos.envioMs = Date.now() - tEnvio
      tempos.via = 'driver'
      if (motivo) tempos.obs = `${tempos.obs ? `${tempos.obs}; ` : ''}reserva Windows: ${motivo}`
      return `MENUZIA: ALFA 1 pelo Windows${motivo ? ` (reserva: ${motivo})` : ''} ${largura} pontos.\n${saida || ''}`
    } finally {
      fs.unlink(png, () => {})
    }
  }
  if (caminho.via === 'driver') return pelaReserva(null)

  let bytes = modo === 'texto'
    ? textoAlfa1(doc, { colunas: colunasDoPapel(largura), intensidade })
    : imagemEscpos(img, { intensidade, deslocamento: perfil.deslocamentoPontos, linhasPorFaixa: FAIXA_LINHAS })
  if (copias > 1) bytes = Buffer.concat(Array(copias).fill(bytes))
  // Faixas de FAIXA_LINHAS linhas com pausa entre elas: a impressora fraca termina uma antes da outra.
  const bloco = modo === 'imagem' ? 8 + Math.ceil(largura / 8) * FAIXA_LINHAS : 0
  const pausaMs = modo === 'imagem' ? Math.max(FAIXA_PAUSA_MS, Math.min(500, Number(perfil.pausaFaixasMs) || 0)) : 0
  const tEnvio = Date.now()
  try {
    if (caminho.via === 'raw_rede') {
      if (!perfil.redeIp) throw new Error('impressora de rede sem IP')
      const porta = Number(perfil.redePorta) || 9100
      await enviarRede(perfil.redeIp, porta, bytes, { bloco, pausaMs })
      tempos.via = 'raw_rede'
    } else {
      const arquivo = path.join(os.tmpdir(), `${prefixo}-raw-${Date.now()}.bin`)
      fs.writeFileSync(arquivo, bytes)
      try {
        const titulo = doc.documento === 'pre_conta' ? 'Menuzia - Pre-conta' : 'Menuzia - Comanda'
        const args = ['-File', PRINT_RAW_SCRIPT, '-PrinterName', nomeImpressora, '-Arquivo', arquivo, '-Titulo', titulo, '-Bloco', String(bloco), '-PausaMs', String(pausaMs)]
        if (perfil.logNome) args.push('-LogNome', perfil.logNome)
        await pelaImpressora(nomeImpressora, { acao: 'raw', impressora: nomeImpressora, arquivo, titulo, bloco, pausaMs }, perfil.logNome, args)
      } finally {
        fs.unlink(arquivo, () => {})
      }
      tempos.via = 'raw_fila'
    }
    tempos.envioMs = Date.now() - tEnvio
    falhaDireto.delete(nomeImpressora)
    return `MENUZIA: ALFA 1 direto (${tempos.via}, ${modo}) ${largura} pontos, ${bytes.length} bytes.`
  } catch (e) {
    if (!caminho.reserva) throw e
    falhaDireto.set(nomeImpressora, Date.now())
    return pelaReserva(`o direto falhou (${String(e?.message || e).slice(0, 120)})`)
  }
}

async function imprimirDocumentoBeta(nomeImpressora, doc, paperWidthMm = 80, perfil = {}) {
  if (doc && doc.modelo === 'alfa1') return imprimirAlfa1(nomeImpressora, doc, paperWidthMm, perfil)
  const prefixo = perfil.prefixoTmp || 'menuzia-beta'
  const opcoes = {
    larguraMm: Number(paperWidthMm) <= 58 ? 58 : 80,
    larguraPontos: Number.isInteger(perfil.larguraPontos) && perfil.larguraPontos > 0 ? perfil.larguraPontos : null,
    tamanhoFonte: perfil.tamanhoFonte === 'media' || perfil.tamanhoFonte === 'pequena' ? perfil.tamanhoFonte : 'grande',
    // Logo da loja (data URL) e a opção "Imprimir logo da loja".
    logo: typeof perfil.logo === 'string' && perfil.logo.startsWith('data:image/') ? perfil.logo : null,
    imprimirLogo: perfil.imprimirLogo !== false,
    // Preto e branco de verdade (1 bit) com a intensidade da impressora.
    intensidade: perfil.intensidade === 'escura' || perfil.intensidade === 'mais_escura' ? perfil.intensidade : 'normal',
  }
  // Envio direto: pela fila (RAW) ou pela rede; modo texto é sempre direto (ESC/POS).
  const modo = perfil.modoImpressao === 'texto' ? 'texto' : 'imagem'
  const tempos = perfil.tempos || {}
  if (!perfil.tempos) perfil.tempos = tempos
  // Automático (0.2.0-beta.10): tenta o direto (rede ou fila USB, conforme a impressora) e,
  // se falhar, sai pelo driver logo abaixo. O caminho usado fica em tempos.via/tempos.obs.
  if (perfil.envio === 'auto' && modo !== 'texto') {
    const escolha = escolherEnvioAuto({ nomeSistema: nomeImpressora, redeIp: perfil.redeIp, diagnostico: perfil.diagnostico, falhouEm: falhaDireto.get(nomeImpressora) })
    tempos.obs = `automático: ${escolha.motivo}`
    if (escolha.envio !== 'driver') {
      try {
        const saida = await imprimirDireto(nomeImpressora, doc, opcoes, perfil, escolha.envio, modo, prefixo)
        falhaDireto.delete(nomeImpressora)
        return saida
      } catch (e) {
        falhaDireto.set(nomeImpressora, Date.now())
        tempos.obs = `automático: o direto falhou (${String(e?.message || e).slice(0, 120)}); saiu pelo driver`
        tempos._t0 = Date.now()
      }
    }
  } else {
    const envio = perfil.envio === 'raw_fila' || perfil.envio === 'raw_rede' ? perfil.envio : 'driver'
    if (envio !== 'driver' || modo === 'texto') {
      return imprimirDireto(nomeImpressora, doc, opcoes, perfil, envio === 'driver' ? 'raw_fila' : envio, modo, prefixo)
    }
  }
  let png = null
  let txt = null
  let erroDesenho = null
  try {
    png = await desenharTicket(doc, opcoes, prefixo)
    tempos.desenhoMs = Date.now() - (tempos._t0 || Date.now())
  } catch (e) {
    erroDesenho = e
    txt = path.join(os.tmpdir(), `${prefixo}-texto-${Date.now()}.txt`)
    fs.writeFileSync(txt, String(doc.texto || 'Menuzia'), 'utf-8')
  }
  try {
    const args = ['-File', PRINT_IMAGEM_SCRIPT, '-PrinterName', nomeImpressora]
    if (png) args.push('-ImagemPng', png)
    if (txt) args.push('-TextoArquivo', txt)
    if (Number.isInteger(perfil.deslocamentoPontos) && perfil.deslocamentoPontos !== 0) args.push('-DeslocamentoPontos', String(perfil.deslocamentoPontos))
    if (perfil.logNome) args.push('-LogNome', perfil.logNome)
    if (Number.isInteger(perfil.copias) && perfil.copias > 1) args.push('-Copies', String(Math.min(perfil.copias, 5)))
    const titulo = doc.modelo === 'cozinha' ? 'Menuzia - Comanda' : doc.modelo === 'largura' ? 'Menuzia - Teste de largura' : 'Menuzia - Pre-conta'
    args.push('-Titulo', titulo)
    const copias = Number.isInteger(perfil.copias) && perfil.copias > 1 ? Math.min(perfil.copias, 5) : 1
    const tEnvio = Date.now()
    const pedido = png
      ? { acao: 'imagem', impressora: nomeImpressora, arquivo: png, copias, desloc: Number(perfil.deslocamentoPontos) || 0, titulo }
      : { acao: 'texto', impressora: nomeImpressora, arquivo: txt, copias }
    const saida = await pelaImpressora(nomeImpressora, pedido, perfil.logNome, args)
    tempos.envioMs = Date.now() - tEnvio
    tempos.via = 'driver'
    return erroDesenho ? `MENUZIA: DESENHO FALHOU (${erroDesenho.message}); saiu em texto\n${saida || ''}` : saida
  } finally {
    if (png) fs.unlink(png, () => {})
    if (txt) fs.unlink(txt, () => {})
  }
}

/**
 * Aquece o que a primeira impressão usaria (Beta 0.2.0-beta.7): a janela de desenho com
 * as fontes e o servidor de impressão da impressora. Sem isso, a 1ª comanda do dia leva
 * ~1–2 s a mais. Falhou? Tudo bem: a impressão sobe o que faltar.
 */
async function aquecerImpressao(nomesImpressoras = [], logNome) {
  try {
    await janelaDoDesenho()
    await janelaDesenho.webContents.executeJavaScript(`window.renderizarTicket(${JSON.stringify({ versao: 1, modelo: 'largura', blocos: [], linhas: [], instrucoes: [] })}, { larguraMm: 80 })`, true)
  } catch { /* sobe na primeira impressão */ }
  for (const nome of nomesImpressoras.slice(0, 4)) {
    try { await poolServidores(logNome).de(nome).pedir({ acao: 'ping' }) } catch { /* idem */ }
  }
}

function encerrarServidores() { if (pool) pool.fecharTodos() }

module.exports = { listarImpressorasWindows, imprimirTexto, diagnosticarImpressoras, imprimirDocumentoBeta, imprimirAlfa1, desenharTicket, desenharBits, aquecerImpressao, encerrarServidores }
