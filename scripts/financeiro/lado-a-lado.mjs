/**
 * Monta, para cada tela do Financeiro, uma imagem com ANTES | DEPOIS | referência da Meta
 * (docs/financeiro-redesign/lado-a-lado/). Usa as capturas de scripts/financeiro/capturas-redesign.mjs.
 *   node scripts/financeiro/lado-a-lado.mjs
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const RAIZ = 'docs/financeiro-redesign'
const SAIDA = join(RAIZ, 'lado-a-lado')
mkdirSync(SAIDA, { recursive: true })
const META = join(RAIZ, 'referencia-meta')
// Qual print da Meta serve de referência para cada tela (pelo componente principal dela).
const REFERENCIA = {
  dashboard: 'linhas-detalhamento.png', fluxo: 'barras-origem-menu.png', 'cmv-precos': 'medidor-avisos-botoes.png', 'cmv-vendas': 'medidor-avisos-botoes.png',
  caixa: 'contas-cards-botoes.png', movimentacoes: 'contas-cards-botoes.png', auditoria: 'medidor-avisos-botoes.png', 'contas-dre': 'contas-cards-botoes.png',
  regras: 'linha-meta-tracejada.png', risco: 'barras-origem-menu.png',
}
const dataUrl = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`
const browser = await chromium.launch()
const p = await browser.newPage({ viewport: { width: 2400, height: 1000 } })
let n = 0
for (const arq of readdirSync(join(RAIZ, 'antes')).filter((f) => f.endsWith('.png'))) {
  const depois = join(RAIZ, 'depois', arq)
  if (!existsSync(depois)) continue
  const tela = arq.replace(/-(desktop|celular)\.png$/, '')
  const ref = REFERENCIA[tela] ?? 'contas-cards-botoes.png'
  const celular = arq.includes('-celular')
  const col = (titulo, src, largura) => `<figure style="margin:0;width:${largura}px"><figcaption style="font:600 22px system-ui;color:#1C2B33;margin:0 0 10px">${titulo}</figcaption><img src="${src}" style="width:100%;border:1px solid #CBD2D9;border-radius:8px"></figure>`
  const w = celular ? 420 : 760
  await p.setContent(`<body style="margin:0;padding:24px;background:#F5F7F9;display:flex;gap:24px;align-items:flex-start">
    ${col('Antes', dataUrl(join(RAIZ, 'antes', arq)), w)}${col('Depois (estilo Meta)', dataUrl(depois), w)}${col('Referência da Meta', dataUrl(join(META, ref)), 760)}</body>`)
  await p.waitForTimeout(150)
  await p.screenshot({ path: join(SAIDA, arq), fullPage: true })
  n++
}
await browser.close()
console.log(`${n} imagens em ${SAIDA}`)
