/**
 * Semeia a foto de cada categoria da Pizza do Rosa a partir da origem.
 *
 * A plataforma antiga serve uma imagem de fundo por sessão (`catBackground`,
 * preenchido pelo `completar-categorias.mjs` a partir de `sessao_catbackgroundmobile`
 * da origem). As 15 categorias do Menuzia derivam das 12 sessões da origem, então
 * quase todas ficam cobertas e o lojista pode ligar o modo gaveta sem subir foto
 * à mão — exceto onde a própria origem não tinha fundo (ver DE_ONDE).
 *
 * Só grava em categoria cujo `imagem_url` é NULL. Não cria nem apaga linha.
 * Rodar de novo é no-op.
 *
 * O relatório final separa dois tipos de pendência: falha técnica (download,
 * upload ou update deram erro) é retentável — rodar de novo pode resolver.
 * "sem foto na origem" é permanente — a origem nunca teve fundo pra aquela
 * sessão, e só um upload manual do lojista no gestor de cardápio destrava o
 * modo gaveta pra essa categoria.
 *
 *   node scripts/import-pizza-do-rosa/semear-fotos-categoria.mjs           # dry-run
 *   node scripts/import-pizza-do-rosa/semear-fotos-categoria.mjs --apply
 */
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

const SLUG = 'pizza-do-rosa'
const MARCA = 'import-expresso-2026-09' // mesma pasta do import, pra reversão continuar pegando tudo
const APPLY = process.argv.includes('--apply')
const BASE_ORIGEM = 'https://static.expressodelivery.com.br/imagens'

/** Categoria do Menuzia → sessão da origem de onde sai a foto. */
const DE_ONDE = {
  'Pizzas Salgadas': 'PIZZA',
  'Pizzas Doces': 'PIZZA',
  'Pizza Promocional': 'Pizza Promocional',
  'Pizza Brotinho': 'Pizza Brotinho',
  'Hambúrguers': 'Hambúrguers',
  'Pizza Burguer': 'Hambúrguers',
  'Porções': 'Porções',
  'Massas': 'Massas',
  'Saladas': 'Saladas',
  'Sobremesas': 'Sobremesas',
  'Bebidas': 'Bebidas',
  'Cervejas e Vinhos': 'Bebidas',
  'Molhos': 'Molhos',
  'Congelados': 'Congelados',
  'Loja Virtual': 'Loja Virtual',
}

const env = Object.fromEntries(
  fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const origem = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'dados/cardapio-origem.json'), 'utf8'))

const log = (...a) => console.log(APPLY ? '[apply]' : '[dry-run]', ...a)
const slugificar = (n) => n.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()

async function baixarESubir(url, caminho) {
  let r
  try { r = await fetch(url, { signal: AbortSignal.timeout(30_000) }) }
  catch (e) { console.warn('  ! download falhou', url, String(e.message ?? e)); return null }
  if (!r.ok) { console.warn('  ! download HTTP', r.status, url); return null }
  let buf
  try { buf = Buffer.from(await r.arrayBuffer()) }
  catch (e) { console.warn('  ! leitura falhou', url, String(e.message ?? e)); return null }
  const { error } = await db.storage.from('cardapio').upload(caminho, buf, {
    contentType: r.headers.get('content-type') ?? 'image/jpeg', upsert: true,
  })
  if (error) { console.warn('  ! upload falhou', caminho, error.message); return null }
  return db.storage.from('cardapio').getPublicUrl(caminho).data.publicUrl
}

async function main() {
  const { data: loja, error: eLoja } = await db.from('restaurantes').select('id, nome').eq('slug', SLUG).single()
  if (eLoja) throw eLoja
  log('loja', loja.nome, loja.id)

  const fundoDaSessao = new Map(
    origem.sessoes.filter((s) => s.catBackground).map((s) => [s.nome, s.catBackground]),
  )

  // A migration 0051 (que adiciona `grupos_cardapio.imagem_url`) pode ainda não
  // ter sido aplicada em produção quando isto roda em dry-run — não faz o
  // dry-run depender dela existir. Sem a coluna, toda categoria é tratada como
  // pendente (é o que ela será assim que a coluna existir, vazia). Depois que a
  // 0051 estiver aplicada em produção este bloco de fallback vira código morto
  // e deve ser apagado — a query normal abaixo passa a bastar sozinha.
  let grupos
  {
    const r = await db.from('grupos_cardapio').select('id, nome, imagem_url').eq('restaurante_id', loja.id).order('posicao')
    if (r.error && /imagem_url/.test(r.error.message) && /does not exist/.test(r.error.message)) {
      log('coluna grupos_cardapio.imagem_url ainda não existe (migration pendente) — tratando todas as categorias como pendentes')
      const r2 = await db.from('grupos_cardapio').select('id, nome').eq('restaurante_id', loja.id).order('posicao')
      if (r2.error) throw r2.error
      grupos = r2.data.map((g) => ({ ...g, imagem_url: null }))
    } else if (r.error) {
      throw r.error
    } else {
      grupos = r.data
    }
  }

  const pendentes = grupos.filter((g) => !g.imagem_url)
  if (pendentes.length === 0) { log('nada pendente — todas as categorias já têm foto'); return }
  log(`${pendentes.length} categoria(s) sem foto`)

  let ok = 0
  // `falhas`: técnicas, retentáveis (download/upload/update deram problema).
  // `semFonte`: permanentes — a origem nunca teve foto pra essa sessão, rodar
  // de novo não muda nada. Misturar as duas faria alguém achar que "rodar de
  // novo" resolve um caso que só um upload manual do lojista resolve.
  const falhas = []
  const semFonte = []
  for (const g of pendentes) {
    const sessao = DE_ONDE[g.nome]
    const caminhoOrigem = sessao ? fundoDaSessao.get(sessao) : null
    if (!caminhoOrigem) { semFonte.push(g.nome); continue }
    const url = `${BASE_ORIGEM}${caminhoOrigem}`
    const ext = (url.split('.').pop() ?? 'jpg').split('?')[0].toLowerCase()
    const destino = `${loja.id}/${MARCA}/categoria-${slugificar(g.nome)}-${Date.now()}.${['jpg','jpeg','png','webp'].includes(ext) ? ext : 'jpg'}`
    if (!APPLY) { log('  (dry-run)', g.nome, '←', url); continue }
    const publica = await baixarESubir(url, destino)
    if (!publica) { falhas.push({ nome: g.nome, motivo: url }); continue }
    const { error } = await db.from('grupos_cardapio').update({ imagem_url: publica }).eq('id', g.id)
    if (error) { falhas.push({ nome: g.nome, motivo: error.message }); continue }
    ok++
    log('  ✔', g.nome)
  }

  log(`FIM — ${ok} semeada(s), ${falhas.length} falhando (retentável), ${semFonte.length} sem foto na origem (permanente)`)
  for (const f of falhas) log(`  ! falha retentável — ${f.nome} — ${f.motivo}`)
  for (const nome of semFonte) log(`  ! sem foto na origem (permanente) — ${nome} — precisa de upload manual no gestor de cardápio; modo gaveta continua bloqueado até essa categoria ter foto`)
}

main().catch((e) => {
  console.error('ERRO:', e.message)
  if (e.details) console.error(' details:', e.details)
  if (e.hint) console.error(' hint:', e.hint)
  console.error(e.stack)
  process.exit(1)
})
