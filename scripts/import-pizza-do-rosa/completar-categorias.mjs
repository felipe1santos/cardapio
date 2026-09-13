/**
 * Preenche o `catBackground` que faltava em `dados/cardapio-origem.json`.
 *
 * O `extrair.mjs` que gerou o arquivo commitado não capturava esse campo (já
 * corrigido nele para futuras extrações). Só falta o dado nas 12 sessões já
 * salvas — reextrair o cardápio inteiro de novo arriscaria divergir do que foi
 * de fato importado (o lojista pode ter editado o cardápio dele desde então).
 *
 * Por isso este script faz UMA única requisição HTTP à página pública do
 * cardápio, lê o mesmo blob `sessions` que o `extrair.mjs` lê, e funde só o
 * campo `catBackground` em cada sessão já existente no JSON — por `link`
 * (chave `sessao_link` na origem, que já é o campo `link` salvo). Nenhum outro
 * campo do arquivo é tocado.
 *
 *   node scripts/import-pizza-do-rosa/completar-categorias.mjs
 */
import fs from 'fs'
import path from 'path'

const BASE = 'https://www.pizzadorosa.com.br'
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/152 Mobile Safari/537.36'
const CAMINHO = path.join(import.meta.dirname, 'dados/cardapio-origem.json')

const dec = (s) => s.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')

async function main() {
  const r = await fetch(`${BASE}/cardapio/?dvc=mobile&ed_mobile_iframe=1`, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`GET /cardapio/ respondeu HTTP ${r.status}`)
  const html = await r.text()
  const bruto = html.match(/id="sessions" value='([\s\S]*?)'>/)
  if (!bruto) throw new Error('não achei o blob #sessions na página — layout pode ter mudado')
  const sessions = JSON.parse(dec(bruto[1]))

  const fundoPorLink = new Map(sessions.map((s) => [s.sessao_link, s.sessao_catbackgroundmobile]))

  const origem = JSON.parse(fs.readFileSync(CAMINHO, 'utf8'))
  let atualizadas = 0
  const semFundo = []
  for (const s of origem.sessoes) {
    const fundo = fundoPorLink.get(s.link)
    if (fundo) { s.catBackground = fundo; atualizadas++; console.log('  ✔', s.link, '←', fundo) }
    else semFundo.push(s.link)
  }

  fs.writeFileSync(CAMINHO, JSON.stringify(origem, null, 2))
  console.log(`FIM — ${atualizadas}/${origem.sessoes.length} sessão(ões) com catBackground preenchido`)
  if (semFundo.length) console.log('  ! sem fundo na origem:', semFundo.join(', '))
}

main().catch((e) => { console.error('ERRO:', e.message); console.error(e.stack); process.exit(1) })
