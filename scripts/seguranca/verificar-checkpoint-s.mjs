/**
 * Verificador do checkpoint de segurança S — grants, policies e sondas anônimas.
 *
 * S1: a chave anônima não pode ler `restaurantes.impressao_agente_token`.
 * S2: a chave anônima não pode inserir em `pedidos` nem `pedido_itens`.
 *
 * Roda SÓ contra a stack local descartável. Qualquer host que não seja loopback
 * é recusado: este script sonda escrita, e sonda de escrita não encosta em
 * produção.
 *
 *   node scripts/seguranca/verificar-checkpoint-s.mjs
 *
 * Variáveis (default = supabase local padrão):
 *   DB_URL, API_URL, ANON_KEY
 */

import pg from 'pg'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const { DB_URL, API_URL, ANON_KEY } = chavesLocais()
exigirLoopback(DB_URL, API_URL)

const cabecalhoAnon = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }
const resultados = []

function checar(nome, ok, detalhe) {
  resultados.push({ nome, ok, detalhe })
  console.log(`${ok ? '✅' : '❌'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
}

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()

// --- 1. grants de tabela ----------------------------------------------------
const { rows: grantsTabela } = await db.query(`
  select table_name, grantee, string_agg(distinct privilege_type, ',' order by privilege_type) privs
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('restaurantes','pedidos','pedido_itens')
     and grantee in ('anon','authenticated')
   group by 1, 2 order by 1, 2`)

console.log('\n── GRANTS DE TABELA ──')
for (const g of grantsTabela) console.log(`   ${g.table_name.padEnd(13)} ${g.grantee.padEnd(14)} ${g.privs}`)

const anonRestaurantes = grantsTabela.find((g) => g.table_name === 'restaurantes' && g.grantee === 'anon')
checar('anon sem SELECT de tabela em restaurantes', !anonRestaurantes?.privs.includes('SELECT'),
  anonRestaurantes ? `tem: ${anonRestaurantes.privs}` : 'nenhum grant de tabela')

for (const t of ['pedidos', 'pedido_itens']) {
  const g = grantsTabela.find((x) => x.table_name === t && x.grantee === 'anon')
  checar(`anon sem nenhum grant em ${t}`, !g, g ? `tem: ${g.privs}` : 'nenhum')
  const a = grantsTabela.find((x) => x.table_name === t && x.grantee === 'authenticated')
  checar(`authenticated sem INSERT/DELETE em ${t}`,
    !!a && !a.privs.includes('INSERT') && !a.privs.includes('DELETE'), a ? `tem: ${a.privs}` : 'nenhum')
}

// --- 2. grants de coluna ----------------------------------------------------
const { rows: colunasAnon } = await db.query(`
  select column_name from information_schema.column_privileges
   where table_schema='public' and table_name='restaurantes'
     and grantee='anon' and privilege_type='SELECT'
   order by column_name`)
const nomes = colunasAnon.map((c) => c.column_name)
console.log(`\n── COLUNAS DE restaurantes LIBERADAS PARA anon (${nomes.length}) ──`)
console.log('   ' + (nomes.join(', ') || '(nenhuma)'))
checar('impressao_agente_token fora do grant de anon', !nomes.includes('impressao_agente_token'))
checar('evolution_instance fora do grant de anon', !nomes.includes('evolution_instance'))
checar('colunas da vitrine presentes', ['id','nome','slug','logo_url','status_loja','horario_funcionamento'].every((c) => nomes.includes(c)))

// --- 3. policies de INSERT anônimo -----------------------------------------
const { rows: pol } = await db.query(`
  select tablename, policyname, roles::text roles, coalesce(with_check,'') wc
    from pg_policies
   where schemaname='public' and cmd='INSERT' and tablename in ('pedidos','pedido_itens')`)
checar('nenhuma policy de INSERT anônimo em pedidos/itens', pol.length === 0,
  pol.map((p) => `${p.tablename}:${p.policyname}`).join(', '))

// --- 4. sondas reais pelo PostgREST com a chave anônima ---------------------
console.log('\n── SONDAS ANÔNIMAS (PostgREST) ──')

const rToken = await fetch(`${API_URL}/rest/v1/restaurantes?select=slug,impressao_agente_token&limit=1`, { headers: cabecalhoAnon })
const corpoToken = await rToken.text()
checar('anon NÃO lê impressao_agente_token', rToken.status >= 400 && !corpoToken.includes('impressao_agente_token"'),
  `HTTP ${rToken.status}`)

const rVitrine = await fetch(
  `${API_URL}/rest/v1/restaurantes?select=id,nome,slug,logo_url,status_loja,horario_funcionamento,aceita_entrega,taxa_entrega_padrao,layout_cardapio,cor_tema&limit=1`,
  { headers: cabecalhoAnon },
)
checar('anon AINDA lê as colunas da vitrine', rVitrine.ok, `HTTP ${rVitrine.status}`)

const rEstrela = await fetch(`${API_URL}/rest/v1/restaurantes?select=*&limit=1`, { headers: cabecalhoAnon })
const corpoEstrela = await rEstrela.text()
checar('select(*) anônimo não vaza o token', !corpoEstrela.includes('impressao_agente_token'),
  `HTTP ${rEstrela.status}`)

const rInsere = await fetch(`${API_URL}/rest/v1/pedidos`, {
  method: 'POST',
  headers: { ...cabecalhoAnon, 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ restaurante_id: '00000000-0000-0000-0000-000000000000', total: 0.01, status: 'recebido' }),
})
checar('anon NÃO insere em pedidos', rInsere.status >= 400, `HTTP ${rInsere.status}`)

const rInsereItem = await fetch(`${API_URL}/rest/v1/pedido_itens`, {
  method: 'POST',
  headers: { ...cabecalhoAnon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ pedido_id: '00000000-0000-0000-0000-000000000000', quantidade: 1 }),
})
checar('anon NÃO insere em pedido_itens', rInsereItem.status >= 400, `HTTP ${rInsereItem.status}`)

const rUsuarios = await fetch(`${API_URL}/rest/v1/usuarios?select=*&limit=1`, { headers: cabecalhoAnon })
const corpoUsuarios = await rUsuarios.text()
checar('anon não lê usuarios', !rUsuarios.ok || corpoUsuarios.trim() === '[]', `HTTP ${rUsuarios.status}`)

await db.end()

const falhas = resultados.filter((r) => !r.ok)
console.log(`\n${falhas.length ? '❌' : '✅'} ${resultados.length - falhas.length}/${resultados.length} verificações passaram`)
process.exit(falhas.length ? 1 : 0)
