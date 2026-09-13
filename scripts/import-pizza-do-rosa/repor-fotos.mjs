/**
 * Repõe SÓ as fotos que falharam no import, sem reimportar nada.
 *
 * O `importar.mjs` de propósito não aborta quando uma foto não baixa — uma
 * imagem perdida é recuperável, um cardápio importado pela metade não é. Ele
 * conta e nomeia as falhas no fim; este script é o conserto delas.
 *
 * O que ele NÃO faz: não cria linha nenhuma, não apaga nada, não mexe em item
 * ou sabor que já tem foto. Ele só procura as linhas desta loja cuja coluna de
 * imagem ficou NULL, rebaixa a foto da origem e faz UPDATE daquela coluna.
 * Rodar de novo depois de tudo resolvido é no-op.
 *
 *   node scripts/import-pizza-do-rosa/repor-fotos.mjs            # dry-run
 *   node scripts/import-pizza-do-rosa/repor-fotos.mjs --apply    # grava
 *
 * A URL de origem de cada linha vem do mesmo `dados/cardapio-menuzia.json` que
 * o import usou, casada por nome — é a única ligação que sobrou entre a linha
 * no banco e a foto lá na origem (o banco não guarda a URL de origem).
 */
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

const SLUG = 'pizza-do-rosa'
const MARCA = 'import-expresso-2026-09' // mesma pasta do import, pra reversão continuar pegando tudo
const APPLY = process.argv.includes('--apply')

const env = Object.fromEntries(
  fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const plano = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'dados/cardapio-menuzia.json'), 'utf8'))

const EXT_VALIDAS = new Set(['jpg', 'jpeg', 'png', 'webp'])
const log = (...a) => console.log(APPLY ? '[apply]' : '[dry-run]', ...a)

function slugificar(nome) {
  return nome.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()
}

function extensaoDe(url) {
  const bruta = (url.split('.').pop() ?? '').split('?')[0].toLowerCase()
  return EXT_VALIDAS.has(bruta) ? bruta : 'jpg'
}

/** Mesmo contrato do import: nunca lança. Devolve a URL pública ou null. */
async function baixarESubir(url, caminho) {
  let r
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  } catch (e) {
    console.warn('  ! download falhou', url, String(e.message ?? e))
    return null
  }
  if (!r.ok) { console.warn('  ! download HTTP', r.status, url); return null }
  let buf
  try {
    buf = Buffer.from(await r.arrayBuffer())
  } catch (e) {
    console.warn('  ! leitura falhou', url, String(e.message ?? e))
    return null
  }
  const { error } = await db.storage.from('cardapio').upload(caminho, buf, {
    contentType: r.headers.get('content-type') ?? 'image/jpeg',
    upsert: true,
  })
  if (error) { console.warn('  ! upload falhou', caminho, error.message); return null }
  return db.storage.from('cardapio').getPublicUrl(caminho).data.publicUrl
}

async function main() {
  const { data: loja, error: eLoja } = await db.from('restaurantes').select('id, nome').eq('slug', SLUG).single()
  if (eLoja) throw eLoja
  const rid = loja.id
  log('loja', loja.nome, rid)

  // Índice nome → URL de origem, a partir do mesmo plano que o import consumiu.
  const urlDoItem = new Map()
  const urlDoSabor = new Map()
  for (const g of plano.grupos) {
    for (const it of g.itens) {
      if (it.imagemOrigem) urlDoItem.set(it.nome, { url: it.imagemOrigem, grupo: g.nome })
      for (const s of it.sabores ?? []) {
        if (s.imagemOrigem) urlDoSabor.set(s.nome, { url: s.imagemOrigem })
      }
    }
  }

  const { data: itens, error: eItens } = await db
    .from('itens_cardapio').select('id, nome, imagem_url, imagem_thumb_url').eq('restaurante_id', rid)
  if (eItens) throw eItens
  const ids = itens.map((i) => i.id)

  const { data: sabores, error: eSab } = await db
    .from('pizza_sabores').select('id, nome, imagem_url').in('item_id', ids)
  if (eSab) throw eSab

  const pendentes = []
  for (const i of itens) {
    const o = urlDoItem.get(i.nome)
    if (!o) continue
    if (!i.imagem_url) pendentes.push({ tabela: 'itens_cardapio', id: i.id, coluna: 'imagem_url', nome: i.nome, base: `${o.grupo}-${i.nome}`, url: o.url })
    if (!i.imagem_thumb_url) pendentes.push({ tabela: 'itens_cardapio', id: i.id, coluna: 'imagem_thumb_url', nome: i.nome, base: `${o.grupo}-${i.nome}`, url: o.url.replace('/800/', '/600/'), sufixo: '-thumb' })
  }
  for (const s of sabores) {
    if (s.imagem_url) continue
    const o = urlDoSabor.get(s.nome)
    if (!o) continue
    pendentes.push({ tabela: 'pizza_sabores', id: s.id, coluna: 'imagem_url', nome: s.nome, base: `sabor-${s.nome}`, url: o.url })
  }

  if (pendentes.length === 0) { log('nada pendente — todas as imagens já estão no lugar'); return }

  log(`${pendentes.length} imagem(ns) pendente(s):`)
  for (const p of pendentes) log(`  ${p.tabela}.${p.coluna}`, `"${p.nome}"`, '←', p.url)

  let repostas = 0
  const falhas = []
  for (const p of pendentes) {
    const caminho = `${rid}/${MARCA}/${slugificar(p.base)}${p.sufixo ?? ''}-${Date.now()}.${extensaoDe(p.url)}`
    if (!APPLY) { log('  (dry-run) subiria', caminho); continue }
    const publica = await baixarESubir(p.url, caminho)
    if (!publica) { falhas.push(p); continue }
    const { error } = await db.from(p.tabela).update({ [p.coluna]: publica }).eq('id', p.id)
    if (error) { console.warn('  ! update falhou', p.tabela, p.id, error.message); falhas.push(p); continue }
    repostas++
    log('  ✔', p.tabela, `"${p.nome}"`, p.coluna)
  }

  log(`FIM — ${repostas} reposta(s), ${falhas.length} ainda falhando`)
  for (const f of falhas) log(`  ! segue sem foto: ${f.tabela} "${f.nome}" — ${f.url}`)
}

main().catch((e) => {
  console.error('ERRO:', e.message)
  if (e.details) console.error('  details:', e.details)
  if (e.hint) console.error('  hint:', e.hint)
  console.error(e.stack)
  process.exit(1)
})
