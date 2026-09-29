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
const { imagemEscpos, textoEscpos } = require('./escpos')
const { enviarRede } = require('./envio-direto')
const { larguraEmPontos } = require('./ticket-canvas')

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
function janelaDoDesenho() {
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
  if (envio === 'raw_rede') {
    if (!perfil.redeIp) throw new Error('Envio pela rede sem o IP da impressora (Impressão › Calibrar impressora).')
    const porta = Number(perfil.redePorta) || 9100
    await enviarRede(perfil.redeIp, porta, bytes)
    return `MENUZIA: RAW REDE OK ${perfil.redeIp}:${porta} ${bytes.length} bytes, ${largura} pontos (${como}).`
  }
  const arquivo = path.join(os.tmpdir(), `${prefixo}-raw-${Date.now()}.bin`)
  fs.writeFileSync(arquivo, bytes)
  try {
    const args = ['-File', PRINT_RAW_SCRIPT, '-PrinterName', nomeImpressora, '-Arquivo', arquivo]
    if (perfil.logNome) args.push('-LogNome', perfil.logNome)
    args.push('-Titulo', doc.modelo === 'cozinha' ? 'Menuzia - Comanda' : doc.modelo === 'largura' ? 'Menuzia - Teste de largura' : 'Menuzia - Pre-conta')
    const saida = await runPowershell(args, { timeout: 60_000, windowsHide: true })
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
async function imprimirDocumentoBeta(nomeImpressora, doc, paperWidthMm = 80, perfil = {}) {
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
  const envio = perfil.envio === 'raw_fila' || perfil.envio === 'raw_rede' ? perfil.envio : 'driver'
  const modo = perfil.modoImpressao === 'texto' ? 'texto' : 'imagem'
  if (envio !== 'driver' || modo === 'texto') {
    return imprimirDireto(nomeImpressora, doc, opcoes, perfil, envio === 'driver' ? 'raw_fila' : envio, modo, prefixo)
  }
  let png = null
  let txt = null
  let erroDesenho = null
  try {
    png = await desenharTicket(doc, opcoes, prefixo)
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
    args.push('-Titulo', doc.modelo === 'cozinha' ? 'Menuzia - Comanda' : 'Menuzia - Pre-conta')
    const saida = await runPowershell(args, { timeout: 60_000, windowsHide: true })
    return erroDesenho ? `MENUZIA: DESENHO FALHOU (${erroDesenho.message}); saiu em texto\n${saida || ''}` : saida
  } finally {
    if (png) fs.unlink(png, () => {})
    if (txt) fs.unlink(txt, () => {})
  }
}

module.exports = { listarImpressorasWindows, imprimirTexto, diagnosticarImpressoras, imprimirDocumentoBeta, desenharTicket, desenharBits }
