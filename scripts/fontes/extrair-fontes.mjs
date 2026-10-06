/**
 * Fontes dentro do projeto (2026-10-07): o build do Coolify falhou duas vezes ao baixar o Google
 * Fonts (next/font/google) e o site ficou sem fonte. Este script tira do último build local — feito
 * ainda com next/font/google — as MESMAS regras @font-face (subconjuntos, unicode-range, pesos e a
 * fonte de reserva com métricas ajustadas) e os MESMOS arquivos woff2, e grava:
 *   public/fontes/<arquivo>.woff2   (nome com hash: pode ficar em cache para sempre)
 *   app/fontes.css                  (as regras, com url(/fontes/…), e as classes das variáveis)
 * Rodar só para trocar/atualizar fonte:  node scripts/seguranca/servidor-local.mjs build (com
 * next/font/google) → node scripts/fontes/extrair-fontes.mjs
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FAMILIAS = { Inter: '--font-inter', Mulish: '--font-painel', Figtree: '--font-meta', Montserrat: '--font-vitrine' }
const CSS = '.next/static/css'
const regras = new Map()
for (const f of readdirSync(CSS)) {
  const s = readFileSync(join(CSS, f), 'utf8')
  for (const [bloco] of s.matchAll(/@font-face\{[^}]*\}/g)) {
    const fam = bloco.match(/font-family:([^;]+);/)?.[1].replace(/["']/g, '')
    if (!fam || !Object.keys(FAMILIAS).some((k) => fam === k || fam === `${k} Fallback`)) continue
    regras.set(bloco, fam)
  }
}
mkdirSync('public/fontes', { recursive: true })
const arquivos = new Set()
let saida = `/* Gerado por scripts/fontes/extrair-fontes.mjs a partir do build com next/font/google.
   Mesmas regras e mesmos arquivos de antes, servidos de /fontes (sem Google Fonts no build). */\n`
for (const fam of Object.keys(FAMILIAS)) {
  const blocos = [...regras].filter(([, f]) => f === fam || f === `${fam} Fallback`).map(([b]) => b)
  if (!blocos.length) throw new Error(`sem @font-face de ${fam} no build`)
  saida += `\n/* ${fam} */\n`
  for (let b of blocos) {
    b = b.replace(/url\(\/_next\/static\/media\/([^)]+)\)/g, (_, arq) => { arquivos.add(arq); return `url(/fontes/${arq})` })
    saida += b + '\n'
  }
}
saida += `\n/* Variáveis (mesmos nomes que o next/font usava) */\n`
const classe = { Inter: 'fonte-inter', Mulish: 'fonte-painel', Figtree: 'fonte-meta', Montserrat: 'fonte-vitrine-var' }
for (const [fam, v] of Object.entries(FAMILIAS)) saida += `.${classe[fam]}{${v}:"${fam}","${fam} Fallback"}\n`
for (const a of arquivos) copyFileSync(join('.next/static/media', a), join('public/fontes', a))
writeFileSync('app/fontes.css', saida)
console.log('regras', regras.size, 'arquivos', arquivos.size)
console.log('preload (latin, .p):', [...arquivos].filter((a) => a.includes('.p.')).join(' '))
