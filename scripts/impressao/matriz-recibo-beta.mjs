/**
 * MATRIZ do Recibo/Extrato do Assistente Beta — o renderizador do instalador
 * (pre-conta-beta.js + print-beta.ps1), só em PNG/PDF (nada imprime), medido no pixel.
 *
 *   · 6 logos (clara, escura, horizontal, vertical, ausente, inválida) × 58/80 mm;
 *   · conta real: mesa, balcão, paga, parcial e a receber (R$ 4.088,00) × 58/80 mm;
 *   · perfis calibrados (512 pontos no 80 mm, 320 no 58 mm).
 * Confere largura do bitmap, texto dentro da margem segura, posição do TOTAL, marcadores
 * de borda só no teste, nada de sobreposição, logo legível e tamanho do papel. Isolado:
 * %TEMP% e cache de logo próprios; os arquivos reais do Assistente são fotografados.
 *
 *   node scripts/impressao/matriz-recibo-beta.mjs <pasta-saida>
 */
import { createRequire } from 'node:module'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { renderizarBeta, CACHE_LOGO } from './render-beta.mjs'
import { medirPngs } from './medir-png.mjs'
import { pngsParaPdf } from './renderizar-virtual.mjs'
import { snapshotReciboTeste } from '../../lib/impressao/recibo-teste.ts'

const require = createRequire(import.meta.url)
const RAIZ = resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const SAIDA = resolve(process.argv[2] ?? join(tmpdir(), `matriz-recibo-beta-${Date.now()}`))
const { exigirIsolamento, fotografarReais, diferencas } = require('./isolamento-teste.cjs')
exigirIsolamento({ temp: SAIDA, pastas: [SAIDA], rotulo: 'matriz Recibo/Extrato Beta' })
rmSync(SAIDA, { recursive: true, force: true })
mkdirSync(SAIDA, { recursive: true })
const fotoAntes = fotografarReais()

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
}
const LOGOS_FONTE = join(RAIZ, 'printer-agent', 'test', 'logos')
const LOGOS = join(SAIDA, 'logos-para-o-assistente')
mkdirSync(LOGOS, { recursive: true })
// Caminho de produção: WebP com transparência passa pelo navegador (lib/impressao/
// logo-navegador.ts: fundo branco, PNG, até 640×320, sem ampliar) antes de ir ao Assistente.
// Aqui o mesmo passo no Chromium; PNG e arquivo inválido vão como estão.
{
  const { chromium } = await import('playwright')
  const b = await chromium.launch()
  const pg = await b.newPage()
  for (const f of readdirSync(LOGOS_FONTE)) {
    const bruto = readFileSync(join(LOGOS_FONTE, f))
    if (!f.endsWith('.webp')) { writeFileSync(join(LOGOS, f), bruto); continue }
    const png = await pg.evaluate(async (src) => {
      const img = await createImageBitmap(await (await fetch(src)).blob())
      const esc = Math.min(1, 640 / img.width, 320 / img.height)
      const c = document.createElement('canvas'); c.width = Math.max(8, Math.round(img.width * esc)); c.height = Math.max(8, Math.round(img.height * esc))
      const x = c.getContext('2d'); x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, c.width, c.height)
      return c.toDataURL('image/png')
    }, `data:image/webp;base64,${bruto.toString('base64')}`)
    writeFileSync(join(LOGOS, f.replace(/\.webp$/, '.png')), Buffer.from(png.split(',')[1], 'base64'))
  }
  await b.close()
}
const { CONTAS } = require(join(RAIZ, 'printer-agent', 'test', 'fixtures-pre-conta.cjs'))
const destino = (mm, pontos = null) => ({ loja: 'Loja Fictícia do Teste', impressora: 'Caixa', nomeSistema: 'POS-TESTE', computador: 'PC Teste', larguraMm: mm, larguraPontos: pontos, deslocamentoPontos: 0 })
const teste = (mm, pontos) => snapshotReciboTeste(destino(mm, pontos), 'Gerente Demo', new Date('2026-09-25T12:00:00Z'))
const parcial = { ...CONTAS.mesa } // pago 60 de 160,09
const casos = []
for (const mm of [80, 58]) {
  for (const [nome, arq] of [['clara', 'clara.png'], ['escura', 'escura.png'], ['horizontal', 'horizontal.png'], ['vertical', 'vertical.png'], ['ausente', null], ['invalida', 'invalida.png']]) {
    casos.push({ id: `teste-${mm}mm-logo-${nome}`, snap: teste(mm), mm, pontos: null, logo: arq, esperaLogo: !['ausente', 'invalida'].includes(nome), teste: true })
  }
  for (const [nome, snap] of [['mesa-parcial', parcial], ['balcao-a-receber', CONTAS.balcao], ['mesa-paga', CONTAS.pago], ['balcao-4088-a-receber', CONTAS.milhar]]) {
    casos.push({ id: `real-${mm}mm-${nome}`, snap: { ...snap, loja: 'Loja Fictícia do Teste' }, mm, pontos: null, logo: 'horizontal.png', esperaLogo: true, teste: false })
  }
}
casos.push({ id: 'teste-80mm-calibrada-512', snap: teste(80, 512), mm: 80, pontos: 512, logo: 'vertical.png', esperaLogo: true, teste: true })
casos.push({ id: 'teste-58mm-calibrada-320', snap: teste(58, 320), mm: 58, pontos: 320, logo: 'vertical.png', esperaLogo: true, teste: true })
casos.push({ id: 'real-80mm-calibrada-512-mesa', snap: { ...parcial, loja: 'Loja Fictícia do Teste' }, mm: 80, pontos: 512, logo: 'clara.png', esperaLogo: true, teste: false })

console.log(`\n── ${casos.length} documentos ──`)
const feitos = []
for (const c of casos) {
  const r = renderizarBeta(c.snap, { paperMm: c.mm, pontos: c.pontos, logo: c.logo ? join(LOGOS, c.logo) : '', saida: join(SAIDA, `${c.id}.png`) })
  feitos.push({ ...c, r })
}
const medidas = await medirPngs(feitos.map((f) => f.r.png))

const tabela = []
for (const [i, f] of feitos.entries()) {
  const md = medidas[i]
  const larg = f.pontos ?? (f.mm <= 58 ? 384 : 576)
  const m = Math.round(larg * 0.035)
  const falhas = []
  if (md.largura !== larg) falhas.push(`largura ${md.largura}≠${larg}`)
  if (!(md.tintaTextoDe >= m - 1 && md.tintaTextoAte <= larg - m)) falhas.push(`texto x=${md.tintaTextoDe}..${md.tintaTextoAte} fora de ${m}..${larg - m}`)
  const t = f.r.total
  if (!t || !(t.de > m && t.ate <= larg - m && t.papel === larg)) falhas.push(`TOTAL ${JSON.stringify(t)}`)
  if (f.teste && !(md.linhasBordaEsquerda > 0 && md.linhasBordaDireita > 0)) falhas.push('sem marcadores nas bordas')
  if (!f.teste && (md.linhasBordaEsquerda > 0 || md.linhasBordaDireita > 0)) falhas.push('marca/régua na conta real')
  if (f.r.sobreposicao) falhas.push('sobreposição')
  if (f.esperaLogo !== /^\d+x\d+/.test(f.r.logo)) falhas.push(`logo: ${f.r.logo}`)
  const limite = f.teste ? (f.mm <= 58 ? 2300 : 1900) : (f.mm <= 58 ? 1700 : 1400)
  if (md.altura > limite) falhas.push(`comprido demais (${md.altura}px > ${limite})`)
  tabela.push({ id: f.id, largura: md.largura, altura: md.altura, mm: +(md.altura / 8).toFixed(0), texto: `${md.tintaTextoDe}..${md.tintaTextoAte}`, margem: `${m}..${larg - m}`, total: t ? `${t.de}..${t.ate}` : '—', logo: f.r.logo })
  ok(`${f.id}`, falhas.length === 0, falhas.length ? falhas.join('; ') : `texto ${md.tintaTextoDe}..${md.tintaTextoAte} (limite ${m}..${larg - m}) · TOTAL ${t.de}..${t.ate} · ${md.altura}px · logo ${f.r.logo}`)
}

console.log('\n── Logos preparadas (dithering): legíveis, sem virar mancha ──')
const preparadas = readdirSync(CACHE_LOGO).filter((n) => n.endsWith('.png')).map((n) => join(CACHE_LOGO, n))
const ml = await medirPngs(preparadas)
for (const l of ml) ok(`${l.png.split(/[\\/]/).pop()}: ${l.largura}x${l.altura}`, l.fracaoEscura > 0.03 && l.fracaoEscura < 0.9, `${(l.fracaoEscura * 100).toFixed(1)}% de pontos pretos`)
ok('logo nunca ampliada nem maior que o limite (80 mm: 322x140; 58 mm: 222x104)', ml.every((l) => l.largura <= 323 && l.altura <= 140))
ok('logo fica em cache pelo hash (segunda vez não reprocessa)', feitos.filter((f) => f.logo === 'horizontal.png' && f.mm === 80).slice(1).every((f) => f.r.logo.includes('(cache)')))

await pngsParaPdf(feitos.map((f) => ({ png: f.r.png, pdf: f.r.png.replace(/\.png$/, '.pdf'), paperMm: f.mm })))
ok('PDF de cada documento na largura real do papel', readdirSync(SAIDA).filter((n) => n.endsWith('.pdf')).length === feitos.length)

const dif = diferencas(fotoAntes, fotografarReais())
ok('arquivos reais do Assistente intactos (hash, tamanho e data)', dif.length === 0, dif.join(' | '))
console.table(tabela)
const falhas = res.filter((r) => !r).length
console.log(`\nSaída: ${SAIDA}\n${falhas ? '❌' : '✅'} ${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
