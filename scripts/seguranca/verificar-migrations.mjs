/**
 * As migrations rodam do zero, e rodam sobre o schema que está em produção?
 *
 * Duas provas, em bancos descartáveis criados e derrubados por este script:
 *
 * 1. **Do zero.** Banco vazio → todas as migrations em ordem. Prova que um ambiente
 *    novo (outra região, uma cópia para testes) nasce com o schema certo.
 * 2. **Sobre o que está em produção.** Banco vazio → só até a última migration já
 *    aplicada em produção (0056) → depois as da feature (0057+). Prova que o passo de
 *    deploy funciona a partir do estado real, e não só a partir do zero.
 *
 * E reaplica as da feature uma segunda vez, porque um deploy interrompido pode repetir
 * um arquivo. Toda migration desta entrega é idempotente.
 *
 * A **0054 fica de fora das duas**: o DDL dela já está no schema de produção sem
 * registro em `schema_migrations`, e ela segue congelada à parte (ver a decisão no
 * spec do checkpoint S). Aplicá-la aqui daria uma falsa sensação de que ela entrou.
 *
 * Só loopback.
 *   node scripts/seguranca/verificar-migrations.mjs
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL)

/** Congelada de propósito — ver o cabeçalho. */
const FORA = ['0054']
/** Última migration aplicada em produção hoje. */
// Sobrescrevível: a produção já passou da 0056 (em 2026-09-24 estava na 0079).
const ULTIMA_EM_PRODUCAO = process.env.ULTIMA_EM_PRODUCAO ?? '0056'

const dir = join(process.cwd(), 'supabase', 'migrations')
const arquivos = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => !FORA.some((p) => f.startsWith(p)))
  .sort()

const daFeature = arquivos.filter((f) => f.slice(0, 4) > ULTIMA_EM_PRODUCAO)
const deProducao = arquivos.filter((f) => f.slice(0, 4) <= ULTIMA_EM_PRODUCAO)

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe !== undefined && detalhe !== '' ? ` — ${detalhe}` : ''}`)
}
const secao = (t) => console.log(`\n── ${t} ──`)

const url = new URL(DB_URL)
const base = url.pathname.replace(/^\//, '')

async function comBanco(nome, fn) {
  const admin = new pg.Client({ connectionString: DB_URL })
  await admin.connect()
  await admin.query(`drop database if exists ${nome}`)
  await admin.query(`create database ${nome}`)
  await admin.end()

  const alvoUrl = new URL(DB_URL)
  alvoUrl.pathname = `/${nome}`
  const cliente = new pg.Client({ connectionString: alvoUrl.toString() })
  await cliente.connect()
  try {
    // As migrations assumem o ambiente Supabase: extensões, o schema `auth` e os papéis.
    // Num banco cru isso não existe, então o mínimo é montado aqui.
    await cliente.query(`create extension if not exists pgcrypto`)
    await cliente.query(`create schema if not exists auth`)
    await cliente.query(`
      create table if not exists auth.users (
        id uuid primary key default gen_random_uuid(),
        email text,
        encrypted_password text,
        email_confirmed_at timestamptz,
        created_at timestamptz default now()
      )`)
    await cliente.query(`
      create or replace function auth.uid() returns uuid
      language sql stable as $$ select null::uuid $$`)
    await cliente.query(`
      create or replace function auth.role() returns text
      language sql stable as $$ select 'authenticated'::text $$`)
    // O bucket de imagens e as policies dele moram na 0002, que assume o schema
    // `storage` do Supabase. Um banco cru não tem — então o mínimo é montado aqui.
    await cliente.query(`create schema if not exists storage`)
    await cliente.query(`
      create table if not exists storage.buckets (
        id text primary key, name text not null, public boolean default false,
        created_at timestamptz default now()
      )`)
    await cliente.query(`
      create table if not exists storage.objects (
        id uuid primary key default gen_random_uuid(),
        bucket_id text references storage.buckets(id),
        name text, owner uuid, created_at timestamptz default now()
      )`)
    await cliente.query(`alter table storage.objects enable row level security`)
    await cliente.query(`
      create or replace function storage.foldername(name text) returns text[]
      language sql immutable as $$ select string_to_array(name, '/') $$`)
    // A publicação do Realtime é criada pelo Supabase; as migrations só adicionam tabela.
    await cliente.query(`do $$ begin
      if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        create publication supabase_realtime;
      end if;
    end $$`)

    for (const papel of ['anon', 'authenticated', 'service_role']) {
      await cliente.query(`do $$ begin
        if not exists (select 1 from pg_roles where rolname = '${papel}') then create role ${papel} nologin; end if;
      end $$`)
      await cliente.query(`grant usage on schema public to ${papel}`)
      await cliente.query(`grant usage on schema storage to ${papel}`)
    }
    await fn(cliente, nome)
  } finally {
    await cliente.end()
    const limpeza = new pg.Client({ connectionString: DB_URL })
    await limpeza.connect()
    await limpeza.query(`drop database if exists ${nome}`)
    await limpeza.end()
  }
}

/** Aplica um arquivo na sua própria transação, como o runner do projeto faz. */
async function aplicar(cliente, arquivo) {
  const sql = readFileSync(join(dir, arquivo), 'utf8')
  await cliente.query('begin')
  try {
    await cliente.query(sql)
    await cliente.query('commit')
    return null
  } catch (e) {
    await cliente.query('rollback')
    return e.message
  }
}

async function aplicarLista(cliente, lista, rotulo) {
  const falhas = []
  for (const arquivo of lista) {
    const erro = await aplicar(cliente, arquivo)
    if (erro) falhas.push(`${arquivo}: ${erro.split('\n')[0]}`)
  }
  ok(`${rotulo} (${lista.length} arquivos)`, falhas.length === 0, falhas.slice(0, 3).join(' | '))
  return falhas.length === 0
}

console.log(`Banco de referência: ${base} · ${arquivos.length} migrations (fora: ${FORA.join(', ')})`)

// ════════════════════════════════════════════════════════════════════════════
secao('1. do zero, num banco vazio')
await comBanco('menuzia_migr_zero', async (cliente) => {
  const passou = await aplicarLista(cliente, arquivos, 'todas as migrations aplicam em ordem')
  if (!passou) return

  // O schema resultante precisa ter o que a feature promete.
  const tabela = async (t) =>
    (await cliente.query(`select to_regclass($1) is not null as existe`, [`public.${t}`])).rows[0].existe
  for (const t of ['mesas', 'comandas', 'sessoes_mesa', 'selecoes_mesa', 'selecao_itens', 'chamados_mesa', 'pagamentos_comanda', 'eventos_auditoria', 'solicitacoes_cancelamento']) {
    ok(`tabela ${t} existe`, await tabela(t))
  }

  const coluna = async (t, c) =>
    (await cliente.query(
      `select count(*)::int as n from information_schema.columns where table_name=$1 and column_name=$2`, [t, c])).rows[0].n === 1
  for (const [t, c] of [
    ['pedidos', 'canal'], ['pedidos', 'chave_idempotencia'], ['itens_cardapio', 'disponivel_salao'],
    ['itens_cardapio', 'disponivel_delivery'], ['restaurantes', 'modulo_mesas_ativo'],
    ['restaurantes', 'taxa_servico_padrao'], ['comandas', 'cancelada_motivo'], ['mesas', 'token'],
    // 0071 e 0072
    ['restaurantes', 'salao_garcom_recebe'], ['mesas', 'qr_revogado_em'], ['eventos_auditoria', 'papel'],
    ['eventos_auditoria', 'correlacao'], ['comandas', 'desconto_tipo'], ['comandas', 'numero'],
    ['pagamentos_comanda', 'observacao'],
  ]) {
    ok(`coluna ${t}.${c} existe`, await coluna(t, c))
  }

  const funcao = async (f) =>
    (await cliente.query(`select count(*)::int as n from pg_proc where proname = $1`, [f])).rows[0].n > 0
  for (const f of ['comanda_totais', 'comanda_registrar_pagamento', 'comanda_fechar', 'comanda_cancelar',
    'mesa_transferir', 'itens_transferir', 'item_cancelar', 'chamado_abrir', 'chamado_assumir', 'chamado_concluir',
    'auth_modulo_mesas', 'comanda_ajustar_valores', 'cancelamento_solicitar', 'cancelamento_decidir', 'pedido_mesa_cancelar']) {
    ok(`função ${f} existe`, await funcao(f))
  }

  // Defaults que não podem mudar o comportamento de loja nenhuma.
  const { rows: defaults } = await cliente.query(`
    select column_name, column_default from information_schema.columns
     where (table_name='restaurantes' and column_name in ('modulo_mesas_ativo','taxa_servico_padrao'))
        or (table_name='itens_cardapio' and column_name in ('disponivel_salao','disponivel_delivery'))`)
  const porNome = Object.fromEntries(defaults.map((d) => [d.column_name, d.column_default]))
  ok('modulo_mesas_ativo nasce false', /false/.test(porNome.modulo_mesas_ativo ?? ''), porNome.modulo_mesas_ativo)
  ok('taxa_servico_padrao nasce 0', /^0/.test(porNome.taxa_servico_padrao ?? ''), porNome.taxa_servico_padrao)
  ok('disponivel_salao nasce true', /true/.test(porNome.disponivel_salao ?? ''), porNome.disponivel_salao)
  ok('disponivel_delivery nasce true', /true/.test(porNome.disponivel_delivery ?? ''), porNome.disponivel_delivery)

  // Nenhuma função da feature executável por usuário autenticado ou anônimo.
  const { rows: expostas } = await cliente.query(`
    select p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('comanda_totais','comanda_registrar_pagamento','comanda_estornar_pagamento',
                         'comanda_fechar','comanda_cancelar','mesa_transferir','itens_transferir',
                         'item_cancelar','pedido_recalcular','chamado_abrir','chamado_assumir','chamado_concluir',
                         'comanda_ajustar_valores','cancelamento_solicitar','cancelamento_decidir','pedido_mesa_cancelar',
                         'comanda_conferir_pago')
       and (has_function_privilege('authenticated', p.oid, 'execute')
            or has_function_privilege('anon', p.oid, 'execute'))`)
  ok('nenhuma função de dinheiro ou chamado executável por anon/authenticated',
    expostas.length === 0, expostas.map((e) => e.proname).join(', '))

  // Uma assinatura só por função: sobrecarga esquecida seria uma segunda porta.
  const { rows: sobrecargas } = await cliente.query(`
    select proname, count(*)::int n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname='public' and proname in ('mesa_transferir','itens_transferir','comanda_registrar_pagamento')
     group by proname having count(*) > 1`)
  ok('transferências e pagamento sem assinatura antiga sobrando', sobrecargas.length === 0, sobrecargas.map((x) => x.proname).join(', '))

  const { rows: colsToken } = await cliente.query(
    `select has_column_privilege('authenticated', 'public.mesas', 'token', 'select') as ler,
            has_column_privilege('authenticated', 'public.mesas', 'token', 'update') as escrever,
            has_column_privilege('authenticated', 'public.mesas', 'nome', 'select') as nome`)
  ok('authenticated lê as mesas mas não lê nem escreve o token', colsToken[0].nome && !colsToken[0].ler && !colsToken[0].escrever)
})

// ════════════════════════════════════════════════════════════════════════════
secao(`2. sobre o schema de produção (até a ${ULTIMA_EM_PRODUCAO})`)
await comBanco('menuzia_migr_prod', async (cliente) => {
  const base = await aplicarLista(cliente, deProducao, `estado de produção até a ${ULTIMA_EM_PRODUCAO}`)
  if (!base) return

  // Uma loja e um item que já existiam ANTES da feature: o deploy não pode mexer neles.
  const loja = (await cliente.query(
    `insert into restaurantes (nome, slug) values ('Loja Antiga', 'loja-antiga') returning id`)).rows[0].id
  const grupo = (await cliente.query(
    `insert into grupos_cardapio (restaurante_id, nome, posicao) values ($1,'Pratos',0) returning id`, [loja])).rows[0].id
  const item = (await cliente.query(
    `insert into itens_cardapio (restaurante_id, grupo_id, nome, preco, descricao, status)
     values ($1,$2,'Prato Antigo',42,'','disponivel') returning id`, [loja, grupo])).rows[0].id
  const pedidoAntigo = (await cliente.query(
    `insert into pedidos (restaurante_id, tipo, status, subtotal, total, cliente_nome)
     values ($1,'entrega','entregue',42,42,'Cliente Antigo') returning id`, [loja])).rows[0].id

  const subiu = await aplicarLista(cliente, daFeature, 'migrations da feature sobem sobre esse estado')
  if (!subiu) return
  await aplicarLista(cliente, daFeature, 'e são reaplicáveis (deploy interrompido e repetido)')

  const item1 = (await cliente.query(
    `select disponivel_delivery, disponivel_salao, preco, nome from itens_cardapio where id=$1`, [item])).rows[0]
  ok('item que já existia continua nos dois canais', item1.disponivel_delivery === true && item1.disponivel_salao === true)
  ok('e com nome e preço intactos', item1.nome === 'Prato Antigo' && Number(item1.preco) === 42)

  const p = (await cliente.query(`select canal, status, total from pedidos where id=$1`, [pedidoAntigo])).rows[0]
  ok('pedido antigo é classificado como delivery pelo backfill', p.canal === 'delivery', p.canal)
  ok('e não tem status nem total alterados', p.status === 'entregue' && Number(p.total) === 42)

  const r = (await cliente.query(
    `select modulo_mesas_ativo, taxa_servico_padrao, formas_pagamento_mesa from restaurantes where id=$1`, [loja])).rows[0]
  ok('loja que já existia NÃO ganha o módulo ligado', r.modulo_mesas_ativo === false)
  ok('nem passa a cobrar taxa de serviço', Number(r.taxa_servico_padrao) === 0)
  ok('e nasce com as formas de pagamento padrão', Array.isArray(r.formas_pagamento_mesa) && r.formas_pagamento_mesa.length > 0,
    (r.formas_pagamento_mesa ?? []).join(','))

  // A comanda de mesa criada pelo PDV antes da feature é reclassificada como 'mesa'.
  const mesa = (await cliente.query(
    `insert into mesas (restaurante_id, nome, ordem) values ($1,'Mesa Antiga',0) returning id`, [loja])).rows[0].id
  const comanda = (await cliente.query(
    `insert into comandas (restaurante_id, mesa_id) values ($1,$2) returning id`, [loja, mesa])).rows[0].id
  const dePdv = (await cliente.query(
    `insert into pedidos (restaurante_id, tipo, status, subtotal, total, cliente_nome, origem, comanda_id, canal)
     values ($1,'retirada','recebido',10,10,'Mesa Antiga','pdv',$2,'mesa') returning canal`, [loja, comanda])).rows[0]
  ok('pedido de PDV com comanda continua aceito como canal mesa', dePdv.canal === 'mesa')

  // 0071/0072 sobre dado que já existia: nada muda de valor.
  const regras = (await cliente.query(
    `select salao_garcom_recebe, salao_garcom_transfere, salao_caixa_desconto, comanda_seq from restaurantes where id=$1`, [loja])).rows[0]
  ok('loja antiga fica com as regras do salão no padrão da matriz',
    regras.salao_garcom_recebe === false && regras.salao_garcom_transfere === true && regras.salao_caixa_desconto === false)
  const antigaDepois = (await cliente.query(`select desconto_tipo, numero from comandas where id=$1`, [comanda])).rows[0]
  ok('comanda criada antes da feature: desconto continua em reais', antigaDepois.desconto_tipo === 'valor', antigaDepois.desconto_tipo)
  const nova = (await cliente.query(
    `insert into comandas (restaurante_id, mesa_id) values ($1,$2) returning numero`,
    [loja, (await cliente.query(`insert into mesas (restaurante_id, nome, ordem) values ($1,'Mesa Nova',1) returning id`, [loja])).rows[0].id])).rows[0]
  ok('comanda nova ganha número sequencial', Number.isInteger(nova.numero) && nova.numero >= 1, nova.numero)

  // Rollback da 0098 (se ela estiver entre as da feature): tira só gatilho e função, sem
  // tocar em dado; reaplicar a 0098 depois devolve o gatilho.
  if (daFeature.some((f) => f.startsWith('0098'))) {
    const foto = async () => (await cliente.query(
      `select (select count(*) from pedidos)::int as pedidos, (select count(*) from comandas)::int as comandas,
              (select count(*) from itens_cardapio)::int as itens, (select count(*) from eventos_auditoria)::int as auditoria,
              (select md5(string_agg(id::text || status::text || total::text, ',' order by id)) from pedidos) as assinatura`)).rows[0]
    const temGatilho = async () => (await cliente.query(`select count(*)::int n from pg_trigger where tgname = 'pedidos_balcao_entrega_destino'`)).rows[0].n === 1
    const antes = await foto()
    ok('0098 aplicada: gatilho de destino da entrega do balcão existe', await temGatilho())
    await cliente.query(readFileSync(join(process.cwd(), 'docs', 'rollback', '0098_balcao_entrega_destino.down.sql'), 'utf8'))
    const depois = await foto()
    ok('rollback da 0098 remove gatilho e função', !(await temGatilho()) &&
      (await cliente.query(`select to_regprocedure('public.pedido_entrega_balcao_destino()') is null as sumiu`)).rows[0].sumiu)
    ok('rollback da 0098 não apaga nem altera dado', JSON.stringify(antes) === JSON.stringify(depois), JSON.stringify(depois))
    await cliente.query(readFileSync(join(dir, daFeature.find((f) => f.startsWith('0098'))), 'utf8'))
    ok('reaplicar a 0098 depois do rollback devolve o gatilho', await temGatilho())
  }
})

const falhas = res.filter((r) => !r).length
console.log(`\n${falhas === 0 ? '✅' : '❌'} ${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas === 0 ? 0 : 1)
