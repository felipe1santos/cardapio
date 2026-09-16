/**
 * Auditoria SOMENTE LEITURA — procura indícios de exploração das falhas V1/V2.
 *
 * V1: token do Assistente de Impressão legível pela chave anônima.
 * V2: INSERT anônimo em `pedidos` / `pedido_itens`.
 *
 * Só executa SELECT. Não altera, não apaga, não cria nada — pode rodar contra
 * produção. Nenhum token é impresso: o script só reporta se existe e quando foi
 * visto pela última vez.
 *
 *   DATABASE_URL=... node scripts/seguranca/auditar-indicios-abuso.mjs
 *
 * Limite conhecido: não existe log de acesso ao PostgREST nem à rota do agente
 * neste banco. Um vazamento que tenha só LIDO dados não deixa rastro aqui — os
 * indícios abaixo cobrem escrita forjada e anomalia de impressão. Para leitura,
 * a fonte é o log do Supabase/Kong, fora deste script.
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

if (!process.env.DATABASE_URL && !process.env.DB_URL) {
  try {
    const raw = readFileSync(join(raiz, '.env.local'), 'utf8')
    for (const linha of raw.split('\n')) {
      const t = linha.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq === -1) continue
      let v = t.slice(eq + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      const k = t.slice(0, eq).trim()
      if (!(k in process.env)) process.env[k] = v
    }
  } catch { /* segue com o ambiente */ }
}

const DB_URL = process.env.DB_URL ?? process.env.DATABASE_URL
if (!DB_URL) { console.error('\n❌ Defina DATABASE_URL.\n'); process.exit(1) }

const ehLoopback = /@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)
const db = new pg.Client({ connectionString: DB_URL, ssl: ehLoopback ? undefined : { rejectUnauthorized: false } })
await db.connect()

const achados = []
function secao(titulo, linhas, suspeito) {
  console.log(`\n── ${titulo} ──`)
  if (!linhas.length) { console.log('   nada encontrado'); return }
  console.table(linhas)
  if (suspeito) achados.push(`${titulo}: ${linhas.length}`)
}

// 1. Pedido sem nenhum item. `criarPedido` sempre grava itens na mesma transação
//    lógica; um INSERT forjado pelo PostgREST tipicamente não cria os filhos.
secao('Pedidos sem itens', (await db.query(`
  select p.id, p.numero, p.criado_em, p.status, p.total, p.origem
    from pedidos p
   where not exists (select 1 from pedido_itens i where i.pedido_id = p.id)
   order by p.criado_em desc limit 50`)).rows, true)

// 2. Total divergente da soma dos itens (+ taxa − desconto). O servidor recalcula
//    tudo; divergência indica linha escrita por fora.
secao('Total divergente da soma dos itens', (await db.query(`
  select p.id, p.numero, p.criado_em, p.total,
         round((coalesce(s.soma,0) + coalesce(p.taxa_entrega,0) - coalesce(p.desconto,0))::numeric, 2) esperado
    from pedidos p
    left join (select pedido_id, sum(preco_unitario * quantidade) soma
                 from pedido_itens group by pedido_id) s on s.pedido_id = p.id
   where abs(p.total - (coalesce(s.soma,0) + coalesce(p.taxa_entrega,0) - coalesce(p.desconto,0))) > 0.05
   order by p.criado_em desc limit 50`)).rows, true)

// 3. Origem fora do conjunto que o código escreve.
secao('Origem inesperada', (await db.query(`
  select origem, count(*)::int n, min(criado_em) primeiro, max(criado_em) ultimo
    from pedidos where origem not in ('cardapio','pdv') group by 1`)).rows, true)

// 4. Pedido de entrega marcado como pago na criação — a vitrine nunca faz isso.
secao('Entrega já paga e sem cliente identificado', (await db.query(`
  select id, numero, criado_em, total, forma_pagamento
    from pedidos
   where pago = true and tipo = 'entrega'
     and (cliente_nome is null or cliente_nome = '' or cliente_telefone is null or cliente_telefone = '')
   order by criado_em desc limit 50`)).rows, true)

// 5. Buraco na numeração por loja: pedido apagado ou número consumido por fora.
secao('Buracos na numeração', (await db.query(`
  with seq as (
    select restaurante_id, numero,
           lag(numero) over (partition by restaurante_id order by numero) anterior
      from pedidos)
  select restaurante_id, anterior, numero, (numero - anterior - 1) faltando
    from seq where anterior is not null and numero - anterior > 1
   order by faltando desc limit 20`)).rows, true)

// 6. Impresso sem o agente ter dado sinal de vida por perto (12 h de folga).
secao('Marcado como impresso com o agente fora do ar', (await db.query(`
  select p.id, p.numero, p.criado_em, r.slug, r.impressao_agente_visto_em
    from pedidos p join restaurantes r on r.id = p.restaurante_id
   where p.impresso = true
     and r.impressao_ativar_assistente = true
     and (r.impressao_agente_visto_em is null
          or r.impressao_agente_visto_em < p.criado_em - interval '12 hours')
   order by p.criado_em desc limit 50`)).rows, true)

// 7. Situação dos tokens (sem imprimir valor) — quais precisam de rotação.
secao('Tokens do agente (valor omitido de propósito)', (await db.query(`
  select slug,
         (impressao_agente_token is not null) tem_token,
         impressao_ativar_assistente ativo,
         impressao_agente_visto_em ultimo_sinal
    from restaurantes order by slug`)).rows, false)

await db.end()

console.log(`\n${achados.length ? '⚠️  indícios a investigar:\n   - ' + achados.join('\n   - ') : '✅ nenhum indício de escrita forjada'}`)
console.log('\nLembrete: leitura indevida do token não deixa rastro aqui — ver logs do Supabase/Kong.\n')
