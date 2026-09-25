/**
 * Renderização VIRTUAL do Recibo/Extrato do Assistente Beta — nunca imprime.
 * Documento de pre-conta-beta.js → print-beta.ps1 -DebugPng, com %TEMP% e cache de logo
 * exclusivos do teste (isolamento-teste.cjs). Devolve o PNG e as linhas de log do
 * renderizador (posição do TOTAL, logo, sobreposição).
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const RAIZ = resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
export const PS1_BETA = join(RAIZ, 'printer-agent', 'src', 'print-beta.ps1')
const { montarPreContaBeta, textoDoDocumento } = require(join(RAIZ, 'printer-agent', 'src', 'pre-conta-beta.js'))
const { exigirIsolamento } = require('./isolamento-teste.cjs')

const TEMP = mkdtempSync(join(tmpdir(), 'menuzia-render-beta-'))
export const CACHE_LOGO = join(TEMP, 'logos')
exigirIsolamento({ temp: TEMP, pastas: [CACHE_LOGO], rotulo: 'render-beta' })

let n = 0
/** snapshot → PNG. { paperMm, pontos, logo (caminho), saida } */
export function renderizarBeta(snapshot, { paperMm = 80, pontos = null, logo = '', saida }) {
  const doc = montarPreContaBeta(snapshot)
  const json = join(TEMP, `doc-${process.pid}-${++n}.json`)
  writeFileSync(json, JSON.stringify({ ...doc, texto: textoDoDocumento(doc) }), 'utf8')
  const log = join(TEMP, 'menuzia-beta-print.log')
  const antes = existsSync(log) ? readFileSync(log, 'utf8').length : 0
  mkdirSync(resolve(saida, '..'), { recursive: true })
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1_BETA, '-FilePath', json, '-PrinterName', 'Microsoft Print to PDF',
      '-PaperWidthMm', String(paperMm), ...(pontos ? ['-LarguraPontos', String(pontos)] : []), ...(logo ? ['-LogoPath', logo] : []),
      '-LogoCacheDir', CACHE_LOGO, '-DebugPng', saida], { stdio: 'pipe', env: { ...process.env, TEMP, TMP: TEMP } })
  } finally {
    rmSync(json, { force: true })
  }
  const linhas = readFileSync(log, 'utf8').slice(antes).split(/\r?\n/)
  const t = /TOTAL: valor='([^']*)' x=(-?\d+)\.\.(\d+) papel=(\d+)/.exec(linhas.find((l) => l.includes('TOTAL:')) ?? '')
  return {
    png: saida,
    doc,
    texto: textoDoDocumento(doc),
    total: t ? { valor: t[1], de: Number(t[2]), ate: Number(t[3]), papel: Number(t[4]) } : null,
    logo: (linhas.findLast((l) => /LOGO: (\d+x\d+|loja sem|arquivo sem|falhou)/.test(l)) ?? '').replace(/^.*LOGO: /, ''),
    sobreposicao: linhas.some((l) => l.includes('SOBREPOSICAO')),
  }
}
