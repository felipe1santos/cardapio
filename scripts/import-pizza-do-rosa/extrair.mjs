import fs from 'fs'
import path from 'path'

const BASE = 'https://www.pizzadorosa.com.br'
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/152 Mobile Safari/537.36'
const DADOS = path.join(import.meta.dirname, 'dados')

let cookie = ''

async function get(url, comReferer = false) {
  const headers = { 'User-Agent': UA }
  if (cookie) headers['Cookie'] = cookie
  if (comReferer) {
    // Sem o Referer o endpoint responde 200 com corpo vazio — não dá erro,
    // não devolve 403, só nada. Sem saber disso parece que a API está fora
    // do ar ou que o cookie de sessão expirou.
    headers['Referer'] = `${BASE}/cardapio/`
    headers['X-Requested-With'] = 'XMLHttpRequest'
  }
  const r = await fetch(url, { headers })
  const setCookie = r.headers.getSetCookie?.() ?? []
  for (const c of setCookie) {
    const par = c.split(';')[0]
    if (par.startsWith('__Secure-PHPSESSID')) cookie = cookie ? `${cookie}; ${par}` : par
  }
  return r.text()
}

const dec = (s) => s.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')

/**
 * Lê `var <nome> = [...]` / `{...}` respeitando strings e escapes.
 * São literais de JS dentro de um `<script>`, não JSON — um regex ingênuo ou
 * um `JSON.parse` de um slice quebra na primeira chave/colchete dentro de string.
 */
function varJson(html, nome) {
  const i = html.indexOf('var ' + nome + ' =')
  if (i < 0) return null
  let j = html.indexOf('=', i) + 1
  while (' \t\n'.includes(html[j])) j++
  const open = html[j]
  if (open !== '[' && open !== '{') return null
  const close = open === '[' ? ']' : '}'
  const BS = String.fromCharCode(92)
  let depth = 0, inStr = false, esc = false, k = j
  for (; k < html.length; k++) {
    const c = html[k]
    if (esc) { esc = false; continue }
    if (c === BS) { esc = true; continue }
    if (inStr) { if (c === '"') inStr = false; continue }
    if (c === '"') { inStr = true; continue }
    if (c === open) depth++
    else if (c === close) { depth--; if (depth === 0) { k++; break } }
  }
  return JSON.parse(html.slice(j, k))
}

function parseItens(html) {
  const itens = []
  const catRe = /id='itenscategs_(\d+)_\d+'><h2[^>]*>(?:<i[^>]*>[^<]*<\/i>)?\s*([^<]+)<\/h2>/g
  const cortes = []
  let cm
  while ((cm = catRe.exec(html))) cortes.push({ nome: dec(cm[2]).trim(), start: cm.index })
  if (cortes.length === 0) cortes.push({ nome: '', start: 0 })
  cortes.forEach((c, i) => { c.end = i + 1 < cortes.length ? cortes[i + 1].start : html.length })

  for (const corte of cortes) {
    const partes = html.slice(corte.start, corte.end).split(/<div\s+itemscope itemtype='http:\/\/schema\.org\/Product'/).slice(1)
    for (const p of partes) {
      const dados = (p.match(/data-dadositem='([^']+)'/) || [])[1]
      let d = {}
      if (dados) { try { d = JSON.parse(dec(dados)) } catch { d = {} } }
      const nome = (p.match(/itemprop='name'[^>]*>([\s\S]*?)<\/p>/) || [])[1] || d.nomeitem
      if (!nome) continue
      const img = (p.match(/<img[^>]*itemprop='image'[^>]*src='([^']+)'/) || [])[1] || null
      itens.push({
        coditem: d.coditem ?? null,
        nome: dec(nome).trim(),
        descricao: dec((p.match(/class='desc-item-menu'>([\s\S]*?)<\/p>/) || [])[1] || '').replace(/<[^>]+>/g, '').trim(),
        preco: (p.match(/itemprop='price' content='([^']+)'/) || [])[1] || d.precoitem || null,
        // O card sempre traz a miniatura em /180/; /600/ e /800/ também existem
        // no mesmo host, /1200/ e a original sem tamanho dão 404. /800/ é a maior que funciona.
        imagem: img ? img.replace('/180/', '/800/') : null,
        subcategoria: corte.nome,
      })
    }
  }
  return itens
}

async function main() {
  fs.mkdirSync(DADOS, { recursive: true })
  // A API de itens por sessão não responde nada sem esse cookie — precisa
  // vir de um GET simples na home antes de qualquer chamada à API.
  await get(`${BASE}/?dvc=mobile&ed_mobile_iframe=1`) // pega o cookie de sessão

  const cardapioHtml = await get(`${BASE}/cardapio/?dvc=mobile&ed_mobile_iframe=1`)
  // O JSON das sessões vem com entidades HTML escapadas por estar dentro do
  // valor de um atributo — por isso o dec() antes do JSON.parse.
  const sessions = JSON.parse(dec(cardapioHtml.match(/id="sessions" value='([\s\S]*?)'>/)[1]))

  const sessoes = []
  for (const s of sessions) {
    const html = await get(`${BASE}/cardapio/itens/${s.sessao_link}?dvc=mobile&ed_mobile_iframe=1`)
    let api = null
    if (s.sessao_especifico === 'S') {
      const txt = await get(`${BASE}/exec/menu/getItemsBySession?sessionId=${s.sessao_id}`, true)
      const json = txt.length > 100 ? JSON.parse(txt) : null
      if (json?.res) {
        api = {
          tamanhos: json.data.sizes.map((t) => ({
            id: t.tamanho_id,
            descricao: t.tamanho_descricao,
            maxSabores: JSON.parse(t.tamanho_qtdmaxsabores).map(Number),
          })),
          adicionais: json.data.ingredients.map((g) => ({
            nome: g.ingrediente_nome,
            precoPorTamanho: Object.fromEntries(g.ingredientes_precotamanho.map((p) => [p.ingrediente_precotamannho_tamanhoid, p.ingrediente_precotamannho_preco])),
          })),
          precosPorItem: Object.fromEntries(
            json.data.items.map((i) => [i.name, i.priceSizes.map((p) => ({ sizeId: p.sizeId, sizeName: p.sizeName, price: p.sizePrice }))]),
          ),
        }
      }
      await new Promise((r) => setTimeout(r, 800)) // educação com o servidor alheio
    }
    sessoes.push({
      sessaoId: s.sessao_id,
      nome: s.sessao_nome,
      link: s.sessao_link,
      especifico: s.sessao_especifico,
      formaCalculoItem: s.sessao_formacalculoitem,
      itens: parseItens(html),
      api,
    })
    console.log(s.sessao_link.padEnd(20), sessoes.at(-1).itens.length, 'itens', api ? '(+api)' : '')
  }

  const montHtml = await get(`${BASE}/montar/pizza/?dvc=mobile&ed_mobile_iframe=1`)
  const bordas = (varJson(montHtml, 'bordas_lista') ?? []).map((b) => ({ nome: b.borda_nome.replace(/^Borda:\s*/, ''), preco: b.borda_preco }))
  const tamanhosPizza = (varJson(montHtml, 'alltamanho') ?? [])
    .filter((t) => t.tamanho_sessaoid === '1')
    .map((t) => ({ id: t.tamanho_id, nome: t.tamanho_nome, fatias: t.tamanho_descricao, maxSabores: JSON.parse(t.tamanho_qtdsabormaxima).length }))

  fs.writeFileSync(path.join(DADOS, 'cardapio-origem.json'), JSON.stringify({ sessoes, bordas, tamanhosPizza }, null, 2))
  console.log('bordas', bordas.length, '| tamanhos', tamanhosPizza.length)
}

main()
