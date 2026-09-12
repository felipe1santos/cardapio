import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

const SLUG = 'pizza-do-rosa'
const MARCA = 'import-expresso-2026-09' // pra achar e reverter tudo que este script criou
const APPLY = process.argv.includes('--apply')

const env = Object.fromEntries(
  fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const plano = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'dados/cardapio-menuzia.json'), 'utf8'))

let criados = 0
function log(o, ...args) { console.log(APPLY ? '[apply]' : '[dry-run]', o, ...args) }

async function ins(tabela, linha, select = 'id') {
  criados++
  if (!APPLY) return { id: `fake-${tabela}-${criados}` }
  const { data, error } = await db.from(tabela).insert(linha).select(select).single()
  if (error) throw new Error(`${tabela}: ${error.message} — ${JSON.stringify(linha).slice(0, 200)}`)
  return data
}

/** Baixa a foto da origem e sobe pro bucket `cardapio` sob <restauranteId>/. */
async function subirImagem(restauranteId, url, nomeBase) {
  if (!url) return null
  const ext = (url.split('.').pop() ?? 'jpg').split('?')[0].toLowerCase()
  const caminho = `${restauranteId}/${MARCA}/${nomeBase.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}-${Date.now()}.${ext}`
  // Dry-run não faz nenhuma chamada de rede pro site de origem — só monta o
  // caminho que seria usado. Baixar 231 fotos (121 itens + 110 sabores) do
  // site de produção de um cliente real a cada rodada de dry-run (que roda
  // várias vezes: aqui, na revisão, no controller) seria abuso do servidor
  // de terceiro sem necessidade — o dry-run existe pra conferir contagens e
  // plano, não a saúde das URLs de foto.
  if (!APPLY) return `dry-run://${caminho}`
  const r = await fetch(url)
  if (!r.ok) { console.warn('  ! foto falhou', r.status, url); return null }
  const buf = Buffer.from(await r.arrayBuffer())
  const { error } = await db.storage.from('cardapio').upload(caminho, buf, { contentType: r.headers.get('content-type') ?? 'image/jpeg', upsert: true })
  if (error) throw new Error(`upload ${caminho}: ${error.message}`)
  return db.storage.from('cardapio').getPublicUrl(caminho).data.publicUrl
}

async function main() {
  const { data: loja, error } = await db.from('restaurantes').select('id, nome').eq('slug', SLUG).single()
  if (error) throw error
  const rid = loja.id
  log('loja', loja.nome, rid)

  // Guarda: este script só sabe popular cardápio vazio.
  const { count } = await db.from('itens_cardapio').select('id', { count: 'exact', head: true }).eq('restaurante_id', rid)
  if (count && count > 0) throw new Error(`A loja já tem ${count} itens. Reverta antes (ver README) ou rode com a loja vazia.`)

  // ── Tamanhos de pizza ────────────────────────────────────────────────────
  const idTamanho = {}
  for (const t of plano.tamanhosPizza) {
    const row = await ins('tamanhos_padrao_pizza', { restaurante_id: rid, nome: t.nome, fatias: t.fatias, max_sabores: t.maxSabores, posicao: t.posicao })
    idTamanho[t.nome] = row.id
    log('tamanho', t.nome, `${t.fatias} fatias`, `máx ${t.maxSabores}`)
  }

  // ── Bordas ───────────────────────────────────────────────────────────────
  for (const b of plano.bordas) {
    await ins('bordas_pizza', { restaurante_id: rid, nome: b.nome, preco: b.preco, posicao: b.posicao })
    log('borda', b.nome, b.preco)
  }

  // ── Regra de preço da loja ───────────────────────────────────────────────
  if (APPLY) {
    const { error: e } = await db.from('restaurantes').update({ pizza_calculo_preco: 'media' }).eq('id', rid)
    if (e) throw e
  }
  log('regra de preço', 'media')

  // ── Presets ──────────────────────────────────────────────────────────────
  const preset = {}
  for (const p of plano.presets) {
    const row = await ins('presets_complementos', {
      restaurante_id: rid, nome: p.nome, obrigatorio: p.obrigatorio,
      min_escolhas: p.minEscolhas, max_escolhas: p.maxEscolhas, permite_quantidade: false,
    })
    preset[p.nome] = { id: row.id, itens: p.itens }
    for (const i of p.itens) await ins('preset_complemento_itens', { preset_id: row.id, nome: i.nome, preco: i.preco, posicao: i.posicao })
    log('preset', p.nome, `${p.itens.length} complementos`)
  }

  // ── Grupos, itens, sabores ───────────────────────────────────────────────
  for (const g of plano.grupos) {
    const grupo = await ins('grupos_cardapio', { restaurante_id: rid, nome: g.nome, posicao: g.posicao })
    log('grupo', g.nome, `${g.itens.length} item(ns)`)

    for (const it of g.itens) {
      const imagemUrl = await subirImagem(rid, it.imagemOrigem, `${g.nome}-${it.nome}`)
      const item = await ins('itens_cardapio', {
        restaurante_id: rid, grupo_id: grupo.id, nome: it.nome, descricao: it.descricao,
        preco: it.preco, imagem_url: imagemUrl, status: 'disponivel',
        dias_disponiveis: [0, 1, 2, 3, 4, 5, 6], tipo_item: it.tipoItem, tag: it.tag,
      })
      log('  item', it.nome, it.tipoItem, it.preco || '')

      for (const nomePreset of it.presets) {
        const p = preset[nomePreset]
        if (!p) continue
        const grupoComp = await ins('grupos_item_complementos', {
          item_id: item.id, preset_origem_id: p.id, nome: nomePreset,
          obrigatorio: false, min_escolhas: 0, max_escolhas: p.itens.length, posicao: 0, permite_quantidade: false,
        })
        for (const c of p.itens) {
          await ins('item_complementos', { item_id: item.id, grupo_id: grupoComp.id, nome: c.nome, preco: c.preco, posicao: c.posicao, preset_origem_id: p.id })
        }
        log('    preset', nomePreset)
      }

      for (const s of it.sabores ?? []) {
        const imgSabor = await subirImagem(rid, s.imagemOrigem, `sabor-${s.nome}`)
        const sabor = await ins('pizza_sabores', {
          item_id: item.id, nome: s.nome, descricao: s.descricao, imagem_url: imgSabor, status: 'disponivel', posicao: s.posicao,
        })
        for (const p of s.precos) {
          await ins('pizza_sabor_precos', { sabor_id: sabor.id, tamanho_padrao_id: idTamanho[p.tamanho], preco: p.preco })
        }
        log('    sabor', s.nome, s.precos.map((p) => `${p.tamanho} ${p.preco}`).join(' | '))
      }
    }
  }

  log('FIM —', criados, 'linhas', APPLY ? 'gravadas' : 'seriam gravadas')
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1) })
