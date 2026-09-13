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

/** Envolve um erro do PostgREST numa Error comum sem perder `details`/`hint`
 *  — são eles que dizem qual constraint/coluna quebrou, e sem isso o catch
 *  final só tem a mensagem genérica. */
function erroDb(mensagem, origem) {
  const e = new Error(mensagem)
  if (origem) { e.details = origem.details; e.hint = origem.hint }
  return e
}

async function ins(tabela, linha, select = 'id') {
  criados++
  if (!APPLY) return { id: `fake-${tabela}-${criados}` }
  const { data, error } = await db.from(tabela).insert(linha).select(select).single()
  if (error) throw erroDb(`${tabela}: ${error.message} — ${JSON.stringify(linha).slice(0, 200)}`, error)
  return data
}

/** Conta linhas já existentes pro tenant numa tabela; nunca deixa um erro ou
 *  uma contagem nula passar como "zero" — o único jeito seguro de tratar um
 *  problema no meio da checagem de segurança é abortar, não seguir gravando. */
async function contar(tabela, rid) {
  const { count, error } = await db.from(tabela).select('id', { count: 'exact', head: true }).eq('restaurante_id', rid)
  if (error) throw erroDb(`contagem de ${tabela} falhou: ${error.message} — abortando em vez de assumir loja vazia`, error)
  if (count == null) throw new Error(`contagem de ${tabela} veio nula — abortando em vez de assumir loja vazia`)
  return count
}

// ── Fotos ──────────────────────────────────────────────────────────────────

// Extensões que o navegador/CDN tratam sem drama; qualquer outra cai pra
// jpg — é só o nome do objeto no bucket, o content-type real (o que o
// navegador de fato usa) vem do header da resposta na hora do upload.
const EXT_VALIDAS = new Set(['jpg', 'jpeg', 'png', 'webp'])
let fotosChecadas = 0
const fotosExtFallback = []

/** Validação puramente local (sem rede) da extensão de uma URL de foto —
 *  roda em dry-run também, pra pegar uma URL sem extensão reconhecível
 *  (ex.: último segmento do path sem ponto) antes da rodada real, não
 *  durante ela. */
function extensaoDe(url) {
  fotosChecadas++
  const bruta = (url.split('.').pop() ?? '').split('?')[0].toLowerCase()
  if (EXT_VALIDAS.has(bruta)) return bruta
  fotosExtFallback.push(url)
  return 'jpg'
}

function slugificar(nome) {
  return nome.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()
}

/** Baixa uma foto de `url` e sobe pro bucket `cardapio` no caminho dado.
 *  Nunca lança: rede, leitura do corpo e upload viram warn + null — uma
 *  foto faltando é recuperável depois (o item fica sem imagem), um import
 *  abortado no meio da noite por causa de uma foto não é. */
async function baixarESubir(url, caminho) {
  let r
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  } catch (e) {
    console.warn('  ! foto falhou (rede)', e.message, url)
    return null
  }
  if (!r.ok) { console.warn('  ! foto falhou', r.status, url); return null }
  let buf
  try {
    buf = Buffer.from(await r.arrayBuffer())
  } catch (e) {
    console.warn('  ! foto falhou (leitura do corpo)', e.message, url)
    return null
  }
  const { error } = await db.storage.from('cardapio').upload(caminho, buf, { contentType: r.headers.get('content-type') ?? 'image/jpeg', upsert: true })
  if (error) { console.warn('  ! upload falhou', error.message, caminho); return null }
  return db.storage.from('cardapio').getPublicUrl(caminho).data.publicUrl
}

/** Foto principal de um item ou sabor — sobe a variante /800/ da origem.
 *  Dry-run não faz nenhuma chamada de rede pro site de origem: só monta o
 *  caminho que seria usado (a extensão já é validada localmente por
 *  `extensaoDe`) e retorna `dry-run://<caminho>`. Baixar as ~231 fotos
 *  reais (121 itens + 110 sabores) do site de produção de um cliente real
 *  a cada rodada de dry-run — que roda várias vezes: aqui, na revisão, no
 *  controller — seria abuso do servidor de terceiro sem necessidade; o
 *  dry-run existe pra conferir contagens e plano, não a saúde das fotos. */
async function subirImagem(restauranteId, url, nomeBase) {
  if (!url) return null
  const caminho = `${restauranteId}/${MARCA}/${slugificar(nomeBase)}-${Date.now()}.${extensaoDe(url)}`
  if (!APPLY) return `dry-run://${caminho}`
  return baixarESubir(url, caminho)
}

/** Miniatura de item (sabor não tem coluna de thumb, então não se aplica).
 *  Em vez de gerar uma miniatura localmente (o app normalmente faz isso no
 *  canvas do navegador, no upload — não dá pra fazer isso a partir do
 *  Node, e não vale trazer uma lib de imagem só pra este script), reusa o
 *  que a própria origem já serve: o mesmo arquivo nas variantes /180/,
 *  /600/ e /800/. `imagemOrigem` já vem como /800/ (ver extrair.mjs); aqui
 *  troca pra /600/ — não /180/: a coluna documenta um contrato de ~400px
 *  (`0047_item_imagem_thumb.sql`, `vitrine.tsx:305`), e `urlDeListagem()`
 *  (`vitrine.tsx:308`) alimenta o `ProductCard`, que renderiza a foto num
 *  box `aspect-[4/3]` de card inteiro (`vitrine.tsx:385`), não só na
 *  `ProductThumb` pequena — /180/ ficaria visivelmente mole aí, ainda mais
 *  em tela retina. /600/ é a variante mais próxima do contrato da coluna
 *  que a origem oferece: 27006 bytes medidos contra 37204 do /800/ e 5992
 *  do /180/ — mais leve que a full, sem ficar borrado no card. */
async function subirThumb(restauranteId, urlFull, nomeBase) {
  if (!urlFull) return null
  const urlThumb = urlFull.replace('/800/', '/600/')
  if (urlThumb === urlFull) return null // não achou o segmento /800/ pra trocar — sem thumb, cai no fallback imagem_url
  const caminho = `${restauranteId}/${MARCA}/${slugificar(nomeBase)}-thumb-${Date.now()}.${extensaoDe(urlThumb)}`
  if (!APPLY) return `dry-run://${caminho}`
  return baixarESubir(urlThumb, caminho)
}

async function main() {
  const { data: loja, error } = await db.from('restaurantes').select('id, nome').eq('slug', SLUG).single()
  if (error) throw error
  const rid = loja.id
  log('loja', loja.nome, rid)

  // Guarda: este script só sabe popular cardápio vazio. Checa toda tabela
  // que o import grava diretamente por restaurante_id — não só itens: se a
  // loja já tem tamanho/borda/preset (ex. de onboarding manual), o import
  // duplicaria silenciosamente ("Grande" duas vezes no seletor) e a
  // reversão por restaurante_id (ver README) apagaria também o que já era
  // do lojista. Cada contagem aborta em erro ou em nulo — nunca assume
  // "vazio" sem confirmar.
  for (const tabela of ['itens_cardapio', 'tamanhos_padrao_pizza', 'bordas_pizza', 'presets_complementos']) {
    const n = await contar(tabela, rid)
    if (n > 0) throw new Error(`A loja já tem ${n} linha(s) em ${tabela}. Reverta antes (ver README) ou rode com a loja vazia.`)
  }

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
    preset[p.nome] = { id: row.id, itens: p.itens, obrigatorio: p.obrigatorio, minEscolhas: p.minEscolhas, maxEscolhas: p.maxEscolhas }
    for (const i of p.itens) await ins('preset_complemento_itens', { preset_id: row.id, nome: i.nome, preco: i.preco, posicao: i.posicao })
    log('preset', p.nome, `${p.itens.length} complementos`)
  }

  // ── Grupos, itens, sabores ───────────────────────────────────────────────
  for (const g of plano.grupos) {
    const grupo = await ins('grupos_cardapio', { restaurante_id: rid, nome: g.nome, posicao: g.posicao })
    log('grupo', g.nome, `${g.itens.length} item(ns)`)

    for (const it of g.itens) {
      const imagemUrl = await subirImagem(rid, it.imagemOrigem, `${g.nome}-${it.nome}`)
      const imagemThumbUrl = await subirThumb(rid, it.imagemOrigem, `${g.nome}-${it.nome}`)
      const item = await ins('itens_cardapio', {
        restaurante_id: rid, grupo_id: grupo.id, nome: it.nome, descricao: it.descricao,
        preco: it.preco, imagem_url: imagemUrl, imagem_thumb_url: imagemThumbUrl, status: 'disponivel',
        dias_disponiveis: [0, 1, 2, 3, 4, 5, 6], tipo_item: it.tipoItem, tag: it.tag,
      })
      log('  item', it.nome, it.tipoItem, it.preco || '')

      for (const nomePreset of it.presets) {
        const p = preset[nomePreset]
        if (!p) continue
        const grupoComp = await ins('grupos_item_complementos', {
          item_id: item.id, preset_origem_id: p.id, nome: nomePreset,
          obrigatorio: p.obrigatorio, min_escolhas: p.minEscolhas, max_escolhas: p.maxEscolhas, posicao: 0, permite_quantidade: false,
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

  log('fotos', `${fotosChecadas} URLs verificadas`, `${fotosExtFallback.length} sem extensão reconhecida (fallback .jpg)`)
  for (const u of fotosExtFallback) log('  ! ext fallback', u)

  log('FIM —', criados, 'linhas', APPLY ? 'gravadas' : 'seriam gravadas')
}

main().catch((e) => {
  console.error('ERRO:', e.message)
  if (e.details) console.error('  details:', e.details)
  if (e.hint) console.error('  hint:', e.hint)
  if (e.stack) console.error(e.stack)
  process.exit(1)
})
