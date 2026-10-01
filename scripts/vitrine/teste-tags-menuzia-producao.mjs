/**
 * Produtos "TESTE …" das tags na loja Menuzia em PRODUÇÃO (2026-10-01). SÓ a Menuzia.
 *
 *   node scripts/vitrine/teste-tags-menuzia-producao.mjs criar  --confirmar-producao
 *   node scripts/vitrine/teste-tags-menuzia-producao.mjs ocultar --confirmar-producao
 *
 * criar: categoria "TESTE Tags" (no topo) com os casos da regra; ocultar: pausa os itens e
 * a categoria (nada é apagado — ficam listados no relatório).
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
for (const l of readFileSync(join(raiz, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const acao = process.argv[2]
if (!['criar', 'ocultar'].includes(acao) || !process.argv.includes('--confirmar-producao')) {
  console.error('uso: criar|ocultar --confirmar-producao'); process.exit(1)
}
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const um = async (s, p = []) => (await c.query(s, p)).rows[0]
const loja = await um(`select id, slug from restaurantes where slug='menuzia'`)
if (!loja) throw new Error('loja menuzia não encontrada')

const CASOS = [
  ['TESTE X-Burger', { mais_vendido: true, serve_pessoas: 4, item_promocional: true }, 'Pão, bife de hambúrguer, queijo, alface, tomate, milho, batata palha'],
  ['TESTE Combo', { combo_especial: true }],
  ['TESTE Oferta', { edicao_limitada: true }],
  ['TESTE Quatro de topo', { mais_vendido: true, combo_especial: true, edicao_limitada: true, novidade: true }],
  ['TESTE Serve 1', { serve_pessoas: 1 }],
  ['TESTE Serve 10', { serve_pessoas: 10 }],
  ['TESTE Personalizada preta', { tag_personalizada: 'Receita da casa especial', tag_personalizada_cor: 'preta' }],
  ['TESTE Personalizada azul', { tag_personalizada: 'Sem glúten e sem lactose', tag_personalizada_cor: 'azul' }],
  ['TESTE X-Burger artesanal duplo com cheddar e bacon crocante', { mais_vendido: true }],
  ['TESTE Desconto', { promocao_preco: 5.63 }],
  ['TESTE Desconto com tags', { promocao_preco: 5.63, combo_especial: true, serve_pessoas: 2, item_promocional: true }],
  ['TESTE Sem tags', {}],
]

if (acao === 'criar') {
  await c.query('begin')
  const existe = await um(`select id from grupos_cardapio where restaurante_id=$1 and nome='TESTE Tags'`, [loja.id])
  const grupoId = existe?.id ?? (await um(`insert into grupos_cardapio (restaurante_id, nome, posicao) values ($1,'TESTE Tags',-1) returning id`, [loja.id])).id
  await c.query(`delete from itens_cardapio where grupo_id=$1 and nome like 'TESTE %' and restaurante_id=$2`, [grupoId, loja.id])
  let pos = 0
  for (const [nome, k, desc] of CASOS) {
    await c.query(`insert into itens_cardapio (restaurante_id, grupo_id, nome, descricao, preco, promocao_preco, status, dias_disponiveis, mais_vendido,
        novidade_ate, combo_especial, edicao_limitada, item_promocional, serve_pessoas, tag_personalizada, tag_personalizada_cor, tipo_item, posicao)
      values ($1,$2,$3,$4,7.50,$5,'disponivel','{0,1,2,3,4,5,6}',$6, case when $7 then now() + interval '30 days' end,$8,$9,$10,$11,$12,$13,'simples',$14)`,
      [loja.id, grupoId, nome, desc ?? 'Produto de teste das tags.', k.promocao_preco ?? null, !!k.mais_vendido, !!k.novidade, !!k.combo_especial,
        !!k.edicao_limitada, !!k.item_promocional, k.serve_pessoas ?? null, k.tag_personalizada ?? null, k.tag_personalizada_cor ?? 'preta', pos++])
  }
  const ap = await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, descricao, preco, status, dias_disponiveis, tipo_item, posicao, combo_especial)
    values ($1,$2,'TESTE A partir de','Escolha o tamanho.',0,'disponivel','{0,1,2,3,4,5,6}','simples',$3,true) returning id`, [loja.id, grupoId, pos++])
  await c.query(`insert into tamanhos_item (item_id, nome, preco, posicao) values ($1,'Pequeno',20,0),($1,'Grande',30,1)`, [ap.id])
  await c.query('commit')
  console.log(`criados ${pos} produtos TESTE na categoria "TESTE Tags" da Menuzia`)
} else {
  const r = await c.query(`update itens_cardapio set status='pausado' where restaurante_id=$1 and nome like 'TESTE %' and grupo_id in (select id from grupos_cardapio where restaurante_id=$1 and nome='TESTE Tags') returning nome`, [loja.id])
  console.log(`pausados ${r.rowCount}: ${r.rows.map((x) => x.nome).join(' · ')}`)
}
await c.end()
