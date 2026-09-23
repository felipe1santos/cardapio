/**
 * Renderização VIRTUAL de recibos — nunca toca impressora física.
 *
 * Usa o próprio print.ps1 do Assistente com `-DebugPng`: ele monta o MESMO bitmap que
 * mandaria ao spooler e salva em PNG em vez de imprimir (a impressora nomeada só é
 * conferida, nunca recebe trabalho). Depois o Chromium gera um PDF com a largura real do
 * papel (58 ou 80 mm). Saída fora do Git.
 *
 *   node scripts/impressao/renderizar-virtual.mjs <pasta-saida> [baseline|pre-conta|tudo]
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const RAIZ = resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const PS1 = join(RAIZ, 'printer-agent', 'src', 'print.ps1')
const IMPRESSORA_VIRTUAL = 'Microsoft Print to PDF'

export function colsParaFonte(tamanho, largura) {
  // Cópia de printer-agent/src/main.js (colsParaFonte) — mesma regra do agente.
  const t = String(tamanho || '').toLowerCase()
  const base = Number(largura) > 0 ? Number(largura) : 48
  if (t.includes('grand')) return Math.max(14, Math.round(base * 0.55))
  if (t.includes('med') || t.includes('norm')) return Math.max(16, Math.round(base * 0.72))
  return base
}

export const sha256 = (b) => createHash('sha256').update(b).digest('hex')

/** Texto marcado → PNG pelo print.ps1 (sem imprimir). Retorna { png, sha256 }. */
export function renderizarPng(texto, { cols, paperMm, fonteMaior = false, saida }) {
  const tmp = join(tmpdir(), `menuzia-virtual-${process.pid}-${Date.now()}.txt`)
  writeFileSync(tmp, texto, 'utf-8')
  try {
    execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1,
      '-FilePath', tmp, '-PrinterName', IMPRESSORA_VIRTUAL, '-Cols', String(cols),
      '-PaperWidthMm', String(paperMm), ...(fonteMaior ? ['-FonteMaior', '1'] : []), '-DebugPng', saida,
    ], { stdio: 'pipe' })
  } finally {
    try { unlinkSync(tmp) } catch { /* ok */ }
  }
  if (!existsSync(saida)) throw new Error(`PNG não gerado: ${saida}`)
  return { png: saida, sha256: sha256(readFileSync(saida)) }
}

/** PNGs → um PDF por arquivo, na largura real do papel (Chromium). */
export async function pngsParaPdf(itens) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  const page = await browser.newPage()
  for (const { png, pdf, paperMm } of itens) {
    const b64 = readFileSync(png).toString('base64')
    await page.setContent(`<html><body style="margin:0"><img src="data:image/png;base64,${b64}" style="width:${paperMm}mm;display:block"></body></html>`)
    const alturaPx = await page.evaluate(() => document.querySelector('img').getBoundingClientRect().height)
    await page.pdf({ path: pdf, width: `${paperMm}mm`, height: `${Math.ceil(alturaPx) + 2}px`, printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } })
  }
  await browser.close()
}

const LARGURAS = [
  { paperMm: 80, largura: 48 },
  { paperMm: 58, largura: 32 },
]

export async function baselineRecibo(dir) {
  const { FIXTURES, CONFIGS } = require(join(RAIZ, 'printer-agent', 'test', 'fixtures-recibo.cjs'))
  const { montarRecibo } = require(join(RAIZ, 'printer-agent', 'src', 'recibo.js'))
  mkdirSync(dir, { recursive: true })
  const registro = {}
  const pdfs = []
  for (const [nome, pedido] of Object.entries(FIXTURES)) {
    for (const [nc, config] of Object.entries(CONFIGS)) {
      for (const { paperMm, largura } of LARGURAS) {
        for (const fonte of ['grande', 'pequena']) {
          const cols = colsParaFonte(fonte, largura)
          const chave = `${nome}.${nc}.${paperMm}mm.${fonte}`
          const texto = montarRecibo(pedido, config, cols, 'Cantina Demonstração', false)
          const png = join(dir, `cozinha-${chave}.png`)
          const r = renderizarPng(texto, { cols, paperMm, fonteMaior: config.fonteMaiorProducao, saida: png })
          registro[chave] = { texto_sha256: sha256(texto), png_sha256: r.sha256 }
          if (fonte === 'grande' && nc === 'padrao') pdfs.push({ png, pdf: png.replace(/\.png$/, '.pdf'), paperMm })
        }
      }
    }
  }
  await pngsParaPdf(pdfs)
  return registro
}

if (process.argv[1]?.endsWith('renderizar-virtual.mjs')) {
  const dir = process.argv[2]
  const modo = process.argv[3] ?? 'baseline'
  if (!dir) {
    console.error('uso: node scripts/impressao/renderizar-virtual.mjs <pasta-saida> [baseline]')
    process.exit(1)
  }
  if (modo === 'baseline' || modo === 'tudo') {
    const reg = await baselineRecibo(join(dir, 'cozinha'))
    writeFileSync(join(dir, 'cozinha', 'baseline.json'), JSON.stringify(reg, null, 2))
    console.log(`cozinha: ${Object.keys(reg).length} renderizações; baseline em ${join(dir, 'cozinha', 'baseline.json')}`)
  }
}

/** Compara pares de PNG pixel a pixel (Chromium). Retorna [{ a, b, diferentes, total, mesmoTamanho }]. */
export async function compararPngs(pares) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const out = []
  for (const [a, b] of pares) {
    const r = await page.evaluate(
      async ([da, db]) => {
        const carregar = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src })
        const [ia, ib] = await Promise.all([carregar(da), carregar(db)])
        if (ia.width !== ib.width || ia.height !== ib.height) return { mesmoTamanho: false, diferentes: -1, total: ia.width * ia.height }
        const px = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, img.width, img.height).data }
        const pa = px(ia), pb = px(ib)
        let d = 0
        for (let i = 0; i < pa.length; i += 4) if (pa[i] !== pb[i] || pa[i + 1] !== pb[i + 1] || pa[i + 2] !== pb[i + 2]) d++
        return { mesmoTamanho: true, diferentes: d, total: ia.width * ia.height }
      },
      [`data:image/png;base64,${readFileSync(a).toString('base64')}`, `data:image/png;base64,${readFileSync(b).toString('base64')}`],
    )
    out.push({ a, b, ...r })
  }
  await browser.close()
  return out
}

/** Pré-conta em 58 e 80 mm: mesa completa (cancelados, pagamentos, acentos, nomes longos) e balcão. */
export async function renderizarPreConta(dir) {
  const { montarPreConta, montarTeste, colsPreConta } = require(join(RAIZ, 'printer-agent', 'src', 'pre-conta.js'))
  mkdirSync(dir, { recursive: true })
  const mesa = {
    versao: 1, loja: 'Cantina Demonstração', tipo: 'mesa', mesa: 'Varanda 02', comanda_numero: 57, senha: null, cliente_nome: null,
    aberta_em: '2026-09-23T22:02:00Z', impresso_em: '2026-09-23T22:40:00Z', operador: 'Conceição Atendente', via: 1,
    itens: [
      { quantidade: 2, nome: 'X-Burguer Artesanal com Queijo Coalho Grelhado e Cebola Caramelizada', tamanho: null, sabor: null, borda: null, massa: null,
        complementos: [{ nome: 'Bacon', preco: 4 }, { nome: 'Bacon', preco: 4 }, { nome: 'Ovo', preco: 0 }], preco_unitario: 40, subtotal: 80 },
      { quantidade: 1, nome: 'Pizza', tamanho: 'Média', sabor: 'Calabresa / Frango com Catupiry', borda: 'Cheddar', massa: 'Fina', complementos: [], preco_unitario: 55.9, subtotal: 55.9 },
      { quantidade: 3, nome: 'Água com Gás', tamanho: null, sabor: null, borda: null, massa: null, complementos: [], preco_unitario: 7, subtotal: 21 },
    ],
    cancelados: [{ quantidade: 1, nome: 'Suco de Maçã' }, { quantidade: 2, nome: 'Pão de Queijo' }],
    subtotal: 156.9, taxa_percentual: 10, taxa: 15.69, desconto: 12.5, total: 160.09, pago: 60, restante: 100.09,
    pagamentos: [{ forma: 'dinheiro', valor: 40 }, { forma: 'pix', valor: 20 }],
  }
  const balcao = { ...mesa, tipo: 'balcao', mesa: null, comanda_numero: 12, senha: 128, cliente_nome: 'João da Conceição', via: 2,
    itens: mesa.itens.slice(1), cancelados: [], subtotal: 76.9, taxa_percentual: 0, taxa: 0, desconto: 0, total: 76.9, pago: 0, restante: 76.9, pagamentos: [] }
  const teste = { loja: 'Cantina Demonstração', impressora: 'Caixa 02', nome_sistema: 'ELGIN i9 (USB)', computador: 'PC Caixa', largura_mm: 58, operador: 'Gerente Demo', impresso_em: '2026-09-23T22:40:00Z' }
  const pdfs = []
  const saidas = []
  for (const paperMm of [58, 80]) {
    for (const [nome, texto] of [['mesa', montarPreConta(mesa)], ['balcao', montarPreConta(balcao)], ['teste', montarTeste({ ...teste, largura_mm: paperMm })]]) {
      const png = join(dir, `pre-conta-${nome}-${paperMm}mm.png`)
      renderizarPng(texto, { cols: colsPreConta(paperMm), paperMm, saida: png })
      pdfs.push({ png, pdf: png.replace(/\.png$/, '.pdf'), paperMm })
      saidas.push(png)
    }
  }
  await pngsParaPdf(pdfs)
  return saidas
}

/** Renderiza o baseline de novo e compara com um anterior (texto idêntico; pixel dentro do ruído do GDI). */
export async function compararComBaseline(dirAntes, dirDepois, tolerancia = 20) {
  const antes = JSON.parse(readFileSync(join(dirAntes, 'baseline.json'), 'utf8'))
  const depois = await baselineRecibo(dirDepois)
  writeFileSync(join(dirDepois, 'baseline.json'), JSON.stringify(depois, null, 2))
  const textoDiferente = Object.keys(antes).filter((k) => antes[k].texto_sha256 !== depois[k]?.texto_sha256)
  const pares = Object.keys(antes).map((k) => [join(dirAntes, `cozinha-${k}.png`), join(dirDepois, `cozinha-${k}.png`)])
  const px = await compararPngs(pares)
  const foraDaTolerancia = px.filter((r) => !r.mesmoTamanho || r.diferentes > tolerancia)
  return { total: pares.length, textoDiferente, foraDaTolerancia, maxPixels: Math.max(...px.map((r) => r.diferentes)) }
}

if (process.argv[1]?.endsWith('renderizar-virtual.mjs') && process.argv[3] === 'pre-conta') {
  const s = await renderizarPreConta(join(process.argv[2], 'pre-conta'))
  console.log(`pré-conta: ${s.length} renderizações (PNG + PDF) em ${join(process.argv[2], 'pre-conta')}`)
}
if (process.argv[1]?.endsWith('renderizar-virtual.mjs') && process.argv[3] === 'comparar') {
  const r = await compararComBaseline(join(process.argv[4], 'cozinha'), join(process.argv[2], 'cozinha'))
  console.log(JSON.stringify(r))
  process.exit(r.textoDiferente.length || r.foraDaTolerancia.length ? 1 : 0)
}
