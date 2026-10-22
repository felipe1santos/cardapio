// Converte as imagens JÁ CADASTRADAS que estão fora do padrão do painel (não-WebP ou acima do limite do perfil)
// — todas as lojas, 22/10/2026. Os arquivos originais NÃO são apagados: o novo sobe ao lado
// ("<nome>-otim-<perfil>.webp") e o banco passa a apontar para ele. A lista antigo → novo fica em
// ~/menuzia-backups/imagens-<data>.json (para desfazer: trocar de volta pelo mesmo script com --desfazer <arquivo>).
// Logos ficam de fora (a impressão usa a logo; são poucos KB).
//   node scripts/imagens/converter-existentes.mjs             → ENSAIO: converte em memória, só mostra a economia
//   node scripts/imagens/converter-existentes.mjs --aplicar   → sobe os novos e troca no banco (uma transação)
//   node scripts/imagens/converter-existentes.mjs --desfazer ~/menuzia-backups/imagens-….json
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { otimizarBuffer } from './otimizar.mjs'

for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const aplicar = process.argv.includes('--aplicar')
const idxDesfazer = process.argv.indexOf('--desfazer')

/** [tabela, coluna, perfil, ehLista] — o que a vitrine e o painel mostram. */
const COLUNAS = [
  ['itens_cardapio', 'imagem_url', 'produto'], ['itens_cardapio', 'imagem_thumb_url', 'thumb'],
  ['grupos_cardapio', 'imagem_url', 'produto'], ['grupos_cardapio', 'imagem_ficha_url', 'produto'],
  ['pizza_sabores', 'imagem_url', 'produto'],
  ['item_complementos', 'imagem_url', 'thumb'], ['preset_complemento_itens', 'imagem_url', 'thumb'],
  ['restaurantes', 'banner_url', 'banner'], ['restaurantes', 'banner_mobile_url', 'bannerMobile'], ['restaurantes', 'banner_promocional_url', 'banner'],
  ['restaurantes', 'banner_promo_urls', 'banner', true], ['restaurantes', 'mesa_carrossel_urls', 'banner', true],
]
const LIMITE_BYTES = { produto: 400_000, thumb: 60_000, banner: 500_000, bannerMobile: 250_000 }

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await db.connect()
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const kb = (b) => `${(b / 1024).toFixed(0)} KB`
const mb = (b) => `${(b / 1048576).toFixed(1)} MB`

async function trocarNoBanco(mapa) {
  await db.query('begin')
  try {
    let linhas = 0
    for (const [tab, col, , lista] of COLUNAS) {
      for (const [antiga, nova] of Object.entries(mapa)) {
        const r = lista
          ? await db.query(`update public.${tab} set ${col} = array_replace(${col}, $1, $2) where $1 = any(${col})`, [antiga, nova])
          : await db.query(`update public.${tab} set ${col} = $2 where ${col} = $1`, [antiga, nova])
        linhas += r.rowCount
      }
    }
    await db.query('commit')
    return linhas
  } catch (e) { await db.query('rollback'); throw e }
}

if (idxDesfazer > 0) {
  const arq = process.argv[idxDesfazer + 1].replace(/^~/, homedir())
  const { mapa } = JSON.parse(readFileSync(arq, 'utf8'))
  const inverso = Object.fromEntries(Object.entries(mapa).map(([a, n]) => [n, a]))
  console.log('desfeito: linhas trocadas de volta =', await trocarNoBanco(inverso))
  await db.end(); process.exit(0)
}

const objetos = new Map((await db.query("select name, (metadata->>'size')::bigint b, metadata->>'mimetype' t from storage.objects where bucket_id='cardapio'")).rows.map((r) => [r.name, r]))
const nomeDe = (url) => { const m = /\/object\/public\/cardapio\/([^?]+)/.exec(url ?? ''); return m ? decodeURIComponent(m[1]) : null }

// URLs fora do padrão, cada uma com o perfil mais exigente em que aparece (thumb < bannerMobile < produto < banner).
const ORDEM = ['thumb', 'bannerMobile', 'produto', 'banner']
const alvo = new Map()
for (const [tab, col, perfil, lista] of COLUNAS) {
  const sql = lista ? `select distinct unnest(${col}) u from public.${tab}` : `select distinct ${col} u from public.${tab} where ${col} is not null`
  for (const { u } of (await db.query(sql)).rows) {
    const o = objetos.get(nomeDe(u))
    if (!o || /-otim-[a-zA-Z]+\.webp$/.test(o.name)) continue
    if (o.t === 'image/webp' && Number(o.b) <= LIMITE_BYTES[perfil]) continue
    const atual = alvo.get(u)
    if (!atual || ORDEM.indexOf(perfil) < ORDEM.indexOf(atual.perfil)) alvo.set(u, { obj: o, perfil })
  }
}
console.log(`${alvo.size} imagens fora do padrão (${aplicar ? 'APLICANDO' : 'ENSAIO — nada é gravado'})`)

const mapa = {}
let antes = 0, depois = 0, iguais = 0, falhas = 0, n = 0
for (const [url, { obj, perfil }] of alvo) {
  n++
  try {
    const { data, error } = await sb.storage.from('cardapio').download(obj.name)
    if (error) throw error
    const original = Buffer.from(await data.arrayBuffer())
    const r = await otimizarBuffer(original, perfil, obj.t)
    if (!r.mudou) { iguais++; continue }
    antes += original.length; depois += r.buffer.length
    const novoNome = obj.name.replace(/\.[a-z0-9]+$/i, '') + `-otim-${perfil}.webp`
    if (aplicar) {
      const up = await sb.storage.from('cardapio').upload(novoNome, r.buffer, { contentType: 'image/webp', cacheControl: '31536000', upsert: true })
      if (up.error) throw up.error
      mapa[url] = url.replace(encodeURI(obj.name), encodeURI(novoNome)).replace(obj.name, novoNome)
    }
    if (n % 50 === 0) console.log(`  ${n}/${alvo.size} · ${mb(antes)} → ${mb(depois)}`)
  } catch (e) { falhas++; console.log('  falhou', obj.name, (e?.message ?? e).toString().slice(0, 80)) }
}
console.log(`convertidas: ${n - iguais - falhas} · já estavam boas: ${iguais} · falhas: ${falhas}`)
console.log(`peso: ${mb(antes)} → ${mb(depois)} (${antes ? Math.round((1 - depois / antes) * 100) : 0}% menor)`)

if (aplicar && Object.keys(mapa).length) {
  const pasta = join(homedir(), 'menuzia-backups'); mkdirSync(pasta, { recursive: true })
  const arq = join(pasta, `imagens-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`)
  writeFileSync(arq, JSON.stringify({ criado: new Date().toISOString(), mapa }, null, 1))
  console.log('lista antigo → novo (para desfazer):', arq)
  console.log('linhas trocadas no banco:', await trocarNoBanco(mapa))
}
await db.end()
