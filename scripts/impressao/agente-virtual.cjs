/**
 * AGENTE VIRTUAL — roda o printer-agent/src/main.js DE VERDADE (mesmo código do
 * instalador), com:
 *   · Electron simulado (sem janela; safeStorage de mentira; config num diretório temp);
 *   · fetch apontado para o servidor LOCAL (nunca produção);
 *   · impressoras VIRTUAIS no lugar do print.ps1: cada trabalho vira uma linha JSON em
 *     <saida>/impressos.jsonl e, com RENDER=1, um PNG pelo print.ps1 -DebugPng.
 *
 * Nada chega a spooler nem a impressora física.
 *
 * Variáveis:
 *   BASE            servidor local (padrão http://127.0.0.1:3999) — recusa não-loopback
 *   AGENTE_DIR      diretório de dados deste "computador" (config.json)
 *   AGENTE_SAIDA    onde gravar impressos.jsonl e PNGs
 *   AGENTE_IMPRESSORAS  nomes das impressoras do "Windows", separados por |
 *   AGENTE_REMOVIDAS    impressoras que "sumiram" (erro de não encontrada), separadas por |
 *   RENDER=1        renderiza PNG de cada impressão
 *
 * Comandos (uma linha JSON por comando no stdin; respostas "<<RESP>> {json}" no stdout):
 *   {"cmd":"parear","codigo":"XXXX-XXXX","nome":"PC Caixa"}
 *   {"cmd":"config","patch":{...}}          (salvar-config: token, impressoraWindows…)
 *   {"cmd":"impressoras","lista":["A","B"]} (troca a lista do Windows)
 *   {"cmd":"remover","lista":["B"]}          (impressora passa a "não existir")
 *   {"cmd":"sair"}
 */
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')

const BASE = process.env.BASE || 'http://127.0.0.1:3999'
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error('agente virtual só fala com servidor local')
const DIR = process.env.AGENTE_DIR
const SAIDA = process.env.AGENTE_SAIDA
if (!DIR || !SAIDA) throw new Error('defina AGENTE_DIR e AGENTE_SAIDA')
fs.mkdirSync(DIR, { recursive: true })
fs.mkdirSync(SAIDA, { recursive: true })

let impressorasWindows = (process.env.AGENTE_IMPRESSORAS || '').split('|').filter(Boolean)
let removidas = new Set((process.env.AGENTE_REMOVIDAS || '').split('|').filter(Boolean))
const RAIZ = path.resolve(__dirname, '..', '..')
const PS1 = path.join(RAIZ, 'printer-agent', 'src', 'print.ps1')

// ── fetch: produção → servidor local + LOG DE ROTEAMENTO ─────────────────────
// O log é tirado do protocolo (o que o servidor entregou e o que o agente respondeu),
// nunca dos cabeçalhos: credencial e token não entram em arquivo nenhum.
const fetchReal = global.fetch
const trabalhos = new Map() // job_id → { tipo, destino, tentativa }
const fichas = new Map() // pedido_id → { destino }
const artefatosPendentes = new Map() // destino → [artefato] (fila por impressora: ordem garantida)
const logRoteamento = (o) => fs.appendFileSync(path.join(SAIDA, 'roteamento.jsonl'), JSON.stringify({ horario: new Date().toISOString(), agente: path.basename(path.dirname(SAIDA)), ...o }) + '\n')
const pegarArtefato = (destino) => (artefatosPendentes.get(destino) ?? []).shift() ?? null
global.fetch = async (url, init) => {
  const u = String(url).replace('https://app.menuzia.com.br', BASE)
  const metodo = (init && init.method) || 'GET'
  const res = await fetchReal(u, init)
  try {
    if (metodo === 'GET' && /\/api\/agente\/trabalhos$/.test(u) && res.ok) {
      const j = await res.clone().json()
      for (const t of j.trabalhos ?? []) trabalhos.set(t.id, { tipo: t.tipo, destino: t.nomeSistema, tentativa: t.tentativas })
    } else if (metodo === 'GET' && /\/api\/agente\/pedidos$/.test(u) && res.ok) {
      const j = await res.clone().json()
      const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'))
      const destino = j.destinoCozinha?.nomeSistema ?? cfg.impressoraWindows ?? '?'
      for (const p of j.pedidos ?? []) fichas.set(p.id, { destino })
    } else if (metodo === 'POST' && /\/api\/agente\/trabalhos\/[^/]+\/resultado$/.test(u)) {
      const id = u.split('/').slice(-2)[0]
      const corpo = JSON.parse(init.body)
      const t = trabalhos.get(id) ?? {}
      logRoteamento({ job_id: id, tipo: t.tipo === 'teste_impressora' ? 'teste' : t.tipo, destino: t.destino, tentativa: t.tentativa,
        resultado: corpo.ok ? 'aceito_pelo_spooler' : `falha: ${corpo.erro}`, artefato: corpo.ok ? pegarArtefato(t.destino) : null })
    } else if (metodo === 'POST' && /\/api\/agente\/pedidos\/[^/]+\/imprimir$/.test(u)) {
      const id = u.split('/').slice(-2)[0]
      const f = fichas.get(id) ?? {}
      logRoteamento({ job_id: id, tipo: 'ficha_cozinha', destino: f.destino, tentativa: 1, resultado: res.ok ? 'impresso_confirmado' : `falha HTTP ${res.status}`, artefato: pegarArtefato(f.destino) })
    }
  } catch { /* log é observação: nunca derruba o agente */ }
  return res
}

// ── Electron simulado ───────────────────────────────────────────────────────
const handlers = {}
const electron = {
  app: {
    requestSingleInstanceLock: () => true,
    quit: () => process.exit(0),
    whenReady: () => Promise.resolve(),
    on: () => {},
    getVersion: () => JSON.parse(fs.readFileSync(path.join(RAIZ, 'printer-agent', 'package.json'), 'utf8')).version,
    getPath: () => DIR,
    isPackaged: false,
    setLoginItemSettings: () => {},
  },
  BrowserWindow: class {
    constructor() {
      this.webContents = { send: (_c, p) => console.log(`[agente] ${p.mensagem}`) }
    }
    loadFile() {}
    on() {}
    hide() {}
    show() {}
    focus() {}
    restore() {}
    isVisible() { return true }
    isMinimized() { return false }
  },
  ipcMain: { handle: (nome, fn) => { handlers[nome] = fn } },
  Menu: { setApplicationMenu: () => {} },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`VIRTUAL:${Buffer.from(s).toString('base64')}`),
    decryptString: (b) => Buffer.from(b.toString().slice(8), 'base64').toString(),
  },
}

// ── impressoras virtuais (no lugar de printer.js) ───────────────────────────
// Cada impressão vira, na pasta da impressora: <n>-<tipo>-<mm>mm.txt (texto legível) e
// .png (o bitmap exato do print.ps1 -DebugPng). O PDF sai no fim, pelo script da demo.
let seq = 0
const textoLegivel = (t) => t.split('\n').map((l) => {
  const m = l.match(/^\x01(\w)(?:\x02(.*))?$/)
  if (!m) return l
  const campos = (m[2] ?? '').split('\x02')
  if (m[1] === 'R') return '-'.repeat(32)
  if (m[1] === 'H') return `==== ${campos[0]} ====`
  return campos.join('   ')
}).join('\n')
const impressoraVirtual = {
  listarImpressorasWindows: async () => impressorasWindows.filter((n) => !removidas.has(n)),
  imprimirTexto: async (nome, texto, copias, cols, _logo, paperMm, fonteMaior) => {
    if (!impressorasWindows.includes(nome) || removidas.has(nome)) throw new Error(`Impressora '${nome}' nao encontrada no Windows.`)
    const tipo = texto.includes('PRÉ-CONTA') ? 'pre_conta' : texto.includes('TESTE DE IMPRESSORA') ? 'teste' : 'ficha_cozinha'
    const n = ++seq
    const pasta = path.join(SAIDA, nome.replace(/[^A-Za-z0-9]+/g, '_'))
    fs.mkdirSync(pasta, { recursive: true })
    const base = path.join(pasta, `${String(n).padStart(2, '0')}-${tipo}-${paperMm}mm`)
    fs.writeFileSync(`${base}.txt`, textoLegivel(texto), 'utf8')
    const bruto = `${base}.marcado.tmp`
    fs.writeFileSync(bruto, texto, 'utf8')
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-FilePath', bruto, '-PrinterName', 'Microsoft Print to PDF',
      '-Cols', String(cols), '-PaperWidthMm', String(paperMm), ...(fonteMaior ? ['-FonteMaior', '1'] : []), '-DebugPng', `${base}.png`], { stdio: 'pipe' })
    fs.unlinkSync(bruto)
    const registro = { n, em: new Date().toISOString(), impressora: nome, tipo, copias, cols, paperMm, fonteMaior: Boolean(fonteMaior), texto, png: `${base}.png`, txt: `${base}.txt` }
    fs.appendFileSync(path.join(SAIDA, 'impressos.jsonl'), JSON.stringify(registro) + '\n')
    const fila = artefatosPendentes.get(nome) ?? []
    fila.push(`${base}.png`)
    artefatosPendentes.set(nome, fila)
    return 'MENUZIA: virtual ok'
  },
}

const loadOriginal = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electron
  if (request === './printer' && parent && parent.filename.includes(`printer-agent${path.sep}src`)) return impressoraVirtual
  return loadOriginal.apply(this, arguments)
}

require(path.join(RAIZ, 'printer-agent', 'src', 'main.js'))
console.log('<<PRONTO>>')

// ── comandos ────────────────────────────────────────────────────────────────
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', async (chunk) => {
  buffer += chunk
  let i
  while ((i = buffer.indexOf('\n')) >= 0) {
    const linha = buffer.slice(0, i).trim()
    buffer = buffer.slice(i + 1)
    if (!linha) continue
    const c = JSON.parse(linha)
    let r = null
    if (c.cmd === 'parear') r = await handlers['parear-codigo']({}, { codigo: c.codigo, nome: c.nome })
    else if (c.cmd === 'config') r = await handlers['salvar-config']({}, c.patch)
    else if (c.cmd === 'impressoras') { impressorasWindows = c.lista; r = { ok: true } }
    else if (c.cmd === 'remover') { for (const n of c.lista) removidas.add(n); r = { ok: true } }
    else if (c.cmd === 'recolocar') { for (const n of c.lista) removidas.delete(n); r = { ok: true } }
    else if (c.cmd === 'diagnostico') r = await handlers['testar-pareamento']({}, { token: c.token || '' })
    else if (c.cmd === 'estado') r = await handlers['estado-agente']()
    else if (c.cmd === 'sair') process.exit(0)
    // Nunca devolve a credencial: o estado diz só se está pareado e o nome.
    console.log(`<<RESP>> ${JSON.stringify(r)}`)
  }
})
