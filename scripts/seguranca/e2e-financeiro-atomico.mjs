/**
 * E2E — atomicidade das gravações de dinheiro/custo do financeiro (Fases 5, 5b e 6).
 * Injeta uma FALHA no meio de cada operação (gatilho temporário no banco LOCAL que recusa um passo do meio) e confere
 * que nada ficou pela metade; repete a requisição e confere que não duplica. Os gatilhos de falha são removidos no fim.
 *
 *   node scripts/seguranca/e2e-financeiro-atomico.mjs
 */
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'fin-int'
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const loja = await um(`select id from restaurantes where slug=$1`, [SLUG])
await db.query(`update restaurantes set financeiro_ativo=true where id=$1`, [loja.id])
const SENHA = 'demo-local-123456'
const SUF = Math.random().toString(36).slice(2, 6)
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const texto = (v) => JSON.stringify(v)
const browser = await chromium.launch()
async function logar(login) {
  const ctx = await browser.newContext({ locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login); await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  return { ctx, p }
}
const api = (p, url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  let j = null; try { j = await r.json() } catch { /* */ }
  return { s: r.status, j }
}, { url: `${BASE}${url}`, metodo, corpo })

// Falha injetada: gatilho temporário que recusa a gravação de um passo do meio quando o dado tem a marca.
const falhas = []
async function falharEm(tabela, condicao) {
  const nome = `e2e_falha_${tabela}_${falhas.length}`
  await db.query(`create or replace function public.${nome}() returns trigger language plpgsql as $f$ begin if ${condicao} then raise exception 'falha_injetada_e2e'; end if; return new; end $f$`)
  await db.query(`create trigger ${nome} before insert or update on public.${tabela} for each row execute function public.${nome}()`)
  falhas.push([nome, tabela])
}
async function limparFalhas() {
  for (const [nome, tabela] of falhas.splice(0)) {
    await db.query(`drop trigger if exists ${nome} on public.${tabela}`).catch(() => {})
    await db.query(`drop function if exists public.${nome}()`).catch(() => {})
  }
}
const contar = async (sql, p) => Number((await um(sql, p)).n)
const hoje = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const contas = (p) => api(p, '/api/admin/financeiro/contas?tipo=pagar&situacao=todas')

const dono = await logar('dono.finint')
try {
  secao('Fase 5 — insumo (insumo + componentes + histórico + auditoria)')
  const cria = await api(dono.p, '/api/admin/financeiro/cmv/insumos', 'POST', { nome: `TESTE Atomico ${SUF}`, unidadeCompra: 'kg', quantidadeCompra: 1, custoCompraCentavos: 1000, aproveitamentoPct: 100 })
  ok('insumo criado', cria.s === 201, texto(cria.j))
  const id = cria.j.id
  const hist0 = await contar(`select count(*) n from cmv_custos_historico where insumo_id=$1`, [id])
  const aud0 = await contar(`select count(*) n from eventos_auditoria where entidade_id=$1`, [id])
  await falharEm('cmv_custos_historico', `new.motivo like 'TESTE FALHA%'`)
  const ed = await api(dono.p, `/api/admin/financeiro/cmv/insumos/${id}`, 'PATCH', { acao: 'editar', nome: `TESTE Atomico ${SUF}`, unidadeCompra: 'kg', quantidadeCompra: 1, custoCompraCentavos: 2500, aproveitamentoPct: 100, motivo: 'TESTE FALHA no histórico' })
  const ins = await um(`select custo_compra_centavos::int c from cmv_insumos where id=$1`, [id])
  ok('falha no histórico: o custo NÃO mudou (nada pela metade)', ed.s >= 500 && ins.c === 1000, `${ed.s} custo=${ins.c}`)
  ok('…nem histórico nem auditoria gravados', await contar(`select count(*) n from cmv_custos_historico where insumo_id=$1`, [id]) === hist0 && await contar(`select count(*) n from eventos_auditoria where entidade_id=$1`, [id]) === aud0)
  await limparFalhas()
  const ed2 = await api(dono.p, `/api/admin/financeiro/cmv/insumos/${id}`, 'PATCH', { acao: 'editar', nome: `TESTE Atomico ${SUF}`, unidadeCompra: 'kg', quantidadeCompra: 1, custoCompraCentavos: 2500, aproveitamentoPct: 100, motivo: 'TESTE reajuste' })
  ok('sem a falha: custo, histórico e auditoria juntos', ed2.s === 200 && (await um(`select custo_compra_centavos::int c from cmv_insumos where id=$1`, [id])).c === 2500
    && await contar(`select count(*) n from cmv_custos_historico where insumo_id=$1`, [id]) === hist0 + 1)

  secao('Fase 5 — ficha de custo (ficha + componentes + auditoria)')
  const grupo = await um(`select id from grupos_cardapio where restaurante_id=$1 order by posicao limit 1`, [loja.id])
  const item = (await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, preco, status, tipo_item) values ($1,$2,$3,20,'disponivel','simples') returning id`, [loja.id, grupo.id, `TESTE Atomico Item ${SUF}`])).id
  ok('ficha salva', (await api(dono.p, '/api/admin/financeiro/cmv/ficha', 'PUT', { tipo: 'item', id: item, componentes: [{ insumoId: id, quantidadeBase: 100 }] })).s === 200)
  await falharEm('cmv_ficha_componentes', `new.quantidade_base = 777`)
  const f2 = await api(dono.p, '/api/admin/financeiro/cmv/ficha', 'PUT', { tipo: 'item', id: item, componentes: [{ insumoId: id, quantidade: 1, quantidadeBase: 777 }] })
  const comps = await q(`select quantidade_base::float qb from cmv_ficha_componentes fc join cmv_fichas f on f.id=fc.ficha_id where f.alvo_id=$1`, [item])
  ok('falha nos componentes: a ficha antiga continua inteira (100 g)', f2.s >= 500 && comps.length === 1 && comps[0].qb === 100, `${f2.s} ${texto(comps)}`)
  await limparFalhas()
  await db.query(`delete from cmv_fichas where alvo_id=$1`, [item]); await db.query(`delete from itens_cardapio where id=$1`, [item])

  if ((await um(`select to_regclass('public.fin_contas') t`)).t) {
    secao('Fase 5b — compra de insumos (nota + itens + conta + custo + histórico + auditoria)')
    const contas0 = await contas(dono.p)
    const catOutros = contas0.j.categorias.find((c) => c.nome === 'Outros')
    const custoAntes = (await um(`select custo_compra_centavos::int c from cmv_insumos where id=$1`, [id])).c
    await falharEm('cmv_custos_historico', `new.motivo like 'Compra nota TF${SUF}%'`)
    const nota = `TF${SUF}`
    const cf = await api(dono.p, '/api/admin/financeiro/contas/compras', 'POST', { chave: `atom-${SUF}-c1`, numeroNota: nota, dataCompra: hoje(), pagamento: 'a_prazo', vencimento: hoje(), forma: 'boleto', itens: [{ insumoId: id, quantidade: 2, unidade: 'kg', valorCentavos: 9000 }] })
    ok('falha no histórico do custo: a compra inteira é desfeita', cf.s >= 500 && await contar(`select count(*) n from fin_compras where restaurante_id=$1 and numero_nota=$2`, [loja.id, nota]) === 0
      && await contar(`select count(*) n from fin_contas where restaurante_id=$1 and descricao like $2`, [loja.id, `%nota ${nota}%`]) === 0
      && (await um(`select custo_compra_centavos::int c from cmv_insumos where id=$1`, [id])).c === custoAntes, `${cf.s}`)
    await limparFalhas()
    const c1 = await api(dono.p, '/api/admin/financeiro/contas/compras', 'POST', { chave: `atom-${SUF}-c1`, numeroNota: nota, dataCompra: hoje(), pagamento: 'a_prazo', vencimento: hoje(), forma: 'boleto', itens: [{ insumoId: id, quantidade: 2, unidade: 'kg', valorCentavos: 9000 }] })
    const c1b = await api(dono.p, '/api/admin/financeiro/contas/compras', 'POST', { chave: `atom-${SUF}-c1`, numeroNota: nota, dataCompra: hoje(), pagamento: 'a_prazo', vencimento: hoje(), forma: 'boleto', itens: [{ insumoId: id, quantidade: 2, unidade: 'kg', valorCentavos: 9000 }] })
    ok('sem a falha: nota, conta e custo juntos; repetir não duplica', c1.s === 201 && c1b.s === 200 && c1b.j.repetido === true && c1b.j.id === c1.j.id
      && await contar(`select count(*) n from fin_compras where restaurante_id=$1 and numero_nota=$2`, [loja.id, nota]) === 1
      && (await um(`select custo_compra_centavos::int c from cmv_insumos where id=$1`, [id])).c === 4500, texto([c1.s, c1b.s]))

    secao('Fase 5b — baixa e estorno (livro-caixa + status + auditoria)')
    const k = await api(dono.p, '/api/admin/financeiro/contas', 'POST', { chave: `atom-${SUF}-k1`, tipo: 'pagar', descricao: `TESTE FALHA baixa ${SUF}`, categoriaId: catOutros.id, valorCentavos: 1500, vencimento: hoje() })
    await falharEm('fin_contas', `new.status = 'pago' and new.descricao like 'TESTE FALHA%'`)
    const b0 = await api(dono.p, `/api/admin/financeiro/contas/${k.j.id}`, 'PATCH', { acao: 'baixar', carteira: 'empresa', forma: 'pix' })
    ok('falha ao marcar paga: nenhuma linha no livro-caixa e a conta segue em aberto', b0.s >= 500 && await contar(`select count(*) n from fin_lancamentos where restaurante_id=$1 and dados->>'conta_id'=$2`, [loja.id, k.j.id]) === 0
      && (await um(`select status from fin_contas where id=$1`, [k.j.id])).status === 'a_pagar', `${b0.s}`)
    await limparFalhas()
    const b1 = await api(dono.p, `/api/admin/financeiro/contas/${k.j.id}`, 'PATCH', { acao: 'baixar', carteira: 'empresa', forma: 'pix' })
    const b2 = await api(dono.p, `/api/admin/financeiro/contas/${k.j.id}`, 'PATCH', { acao: 'baixar', carteira: 'empresa', forma: 'pix' })
    ok('baixa sem a falha; repetir não lança de novo', b1.s === 200 && b2.s === 200 && b2.j.repetido === true && await contar(`select count(*) n from fin_lancamentos where restaurante_id=$1 and dados->>'conta_id'=$2`, [loja.id, k.j.id]) === 2)
    await falharEm('fin_contas', `new.status = 'a_pagar' and old.status = 'pago' and new.descricao like 'TESTE FALHA%'`)
    const e0 = await api(dono.p, `/api/admin/financeiro/contas/${k.j.id}`, 'PATCH', { acao: 'estornar', motivo: 'TESTE estorno com falha injetada' })
    ok('falha no estorno: nenhuma linha oposta e a conta segue paga', e0.s >= 500 && await contar(`select count(*) n from fin_lancamentos where restaurante_id=$1 and dados->>'conta_id'=$2`, [loja.id, k.j.id]) === 2
      && (await um(`select status from fin_contas where id=$1`, [k.j.id])).status === 'pago', `${e0.s}`)
    await limparFalhas()
    const e1 = await api(dono.p, `/api/admin/financeiro/contas/${k.j.id}`, 'PATCH', { acao: 'estornar', motivo: 'TESTE estorno sem falha' })
    ok('estorno sem a falha: linhas opostas e conta em aberto', e1.s === 200 && await contar(`select count(*) n from fin_lancamentos where restaurante_id=$1 and dados->>'conta_id'=$2`, [loja.id, k.j.id]) === 4
      && (await um(`select status from fin_contas where id=$1`, [k.j.id])).status === 'a_pagar')
    await falharEm('eventos_auditoria', `new.acao = 'contas.cancelou' and new.dados->>'motivo' like 'TESTE FALHA%'`)
    const x0 = await api(dono.p, `/api/admin/financeiro/contas/${k.j.id}`, 'PATCH', { acao: 'cancelar', motivo: 'TESTE FALHA na auditoria' })
    ok('falha na auditoria do cancelamento: a conta NÃO fica cancelada sem registro', x0.s >= 500 && (await um(`select status from fin_contas where id=$1`, [k.j.id])).status === 'a_pagar', `${x0.s}`)
    await limparFalhas()
    ok('cancelar sem a falha', (await api(dono.p, `/api/admin/financeiro/contas/${k.j.id}`, 'PATCH', { acao: 'cancelar', motivo: 'TESTE limpeza' })).s === 200)
    await falharEm('eventos_auditoria', `new.acao = 'compras.cancelou' and new.dados->>'motivo' like 'TESTE FALHA%'`)
    const cc0 = await api(dono.p, '/api/admin/financeiro/contas/compras', 'PATCH', { id: c1.j.id, motivo: 'TESTE FALHA cancelar compra' })
    ok('falha ao cancelar compra: compra e conta continuam ativas', cc0.s >= 500 && (await um(`select status from fin_compras where id=$1`, [c1.j.id])).status === 'ativa'
      && (await um(`select status from fin_contas where id=$1`, [c1.j.contaId])).status === 'a_pagar', `${cc0.s}`)
    await limparFalhas()
    ok('cancelar compra sem a falha: compra e conta juntas', (await api(dono.p, '/api/admin/financeiro/contas/compras', 'PATCH', { id: c1.j.id, motivo: 'TESTE limpeza' })).s === 200
      && (await um(`select status from fin_contas where id=$1`, [c1.j.contaId])).status === 'cancelado')
  }
  await db.query(`update cmv_insumos set ativo=false where id=$1`, [id])

  if ((await um(`select to_regclass('public.fin_aprovacao_pedidos') t`)).t) {
    const ger = await logar('gerente.finint')
    const D = (await um(`select id from usuarios where restaurante_id=$1 and papel='dono' and desativado_em is null order by criado_em limit 1`, [loja.id])).id
    await api(dono.p, '/api/sessao/pin', 'POST', { senha: SENHA, pin: '615283' })
    if (!(await um(`select id from caixa_turnos where restaurante_id=$1 and fechado_em is null`, [loja.id]))) await api(dono.p, '/api/admin/financeiro/caixa', 'POST', { acao: 'abrir', fundoCentavos: 0 })
    const turno = await um(`select id from caixa_turnos where restaurante_id=$1 and fechado_em is null`, [loja.id])

    secao('Fase 6 — decisão do aprovador (aprovação + pedido + auditoria)')
    const p1 = await api(ger.p, '/api/admin/financeiro/aprovacoes-remotas', 'POST', { acao: 'sangria', valorCentavos: 12000, motivo: 'TESTE FALHA na decisão' })
    await falharEm('eventos_auditoria', `new.acao = 'fin.aprovou' and new.dados->>'motivo' like 'TESTE FALHA%'`)
    const d0 = await api(dono.p, '/api/admin/financeiro/aprovacoes-remotas', 'PATCH', { id: p1.j.id, decisao: 'aprovar', pin: '615283' })
    ok('falha na auditoria da decisão: o pedido segue pendente e nenhuma aprovação fica gravada', d0.s >= 500 && (await um(`select status from fin_aprovacao_pedidos where id=$1`, [p1.j.id])).status === 'pendente'
      && await contar(`select count(*) n from fin_aprovacoes where contexto->>'pedido'=$1`, [p1.j.id]) === 0, `${d0.s}`)
    await limparFalhas()

    secao('Fase 6 — aprovação pelo celular só é gasta junto com o dinheiro')
    const p2 = await api(ger.p, '/api/admin/financeiro/aprovacoes-remotas', 'POST', { acao: 'sangria', valorCentavos: 12000, motivo: 'TESTE aprovação remota atômica' })
    ok('aprovada pelo dono no celular', (await api(dono.p, '/api/admin/financeiro/aprovacoes-remotas', 'PATCH', { id: p2.j.id, decisao: 'aprovar', pin: '615283' })).s === 200)
    await falharEm('fin_lancamentos', `new.motivo like 'TESTE FALHA%'`)
    const s0 = await api(ger.p, '/api/admin/financeiro/caixa', 'POST', { acao: 'movimento', movimento: 'sangria', valorCentavos: 12000, motivo: 'TESTE FALHA na sangria', chave: `atom-${SUF}-s0`, aprovacao: { remotaId: p2.j.id } })
    ok('falha ao gravar a sangria: nada no livro-caixa e a aprovação CONTINUA valendo', s0.s >= 500 && (await um(`select status from fin_aprovacao_pedidos where id=$1`, [p2.j.id])).status === 'aprovado'
      && await contar(`select count(*) n from fin_lancamentos where restaurante_id=$1 and chave_idempotencia=$2`, [loja.id, `mov:atom-${SUF}-s0`]) === 0, `${s0.s}`)
    await limparFalhas()
    const s1 = await api(ger.p, '/api/admin/financeiro/caixa', 'POST', { acao: 'movimento', movimento: 'sangria', valorCentavos: 12000, motivo: 'TESTE sangria aprovada', chave: `atom-${SUF}-s1`, aprovacao: { remotaId: p2.j.id } })
    ok('sem a falha: a sangria entra e a aprovação vira "usada" junto', s1.s === 200 && (await um(`select status from fin_aprovacao_pedidos where id=$1`, [p2.j.id])).status === 'usado')
    const s2 = await api(ger.p, '/api/admin/financeiro/caixa', 'POST', { acao: 'movimento', movimento: 'sangria', valorCentavos: 12000, motivo: 'TESTE de novo', chave: `atom-${SUF}-s2`, aprovacao: { remotaId: p2.j.id } })
    ok('usar a mesma aprovação de novo → recusado', s2.s === 409 && await contar(`select count(*) n from fin_lancamentos where restaurante_id=$1 and chave_idempotencia=$2`, [loja.id, `mov:atom-${SUF}-s2`]) === 0, `${s2.s} ${s2.j?.codigo}`)

    secao('Fase 6 — fechamento do caixa (ajuste + turno + aprovação + auditoria)')
    const esp = Number((await um(`select coalesce(sum(valor_centavos),0) s from fin_lancamentos where turno_id=$1 and carteira='gaveta'`, [turno.id])).s)
    await falharEm('caixa_turnos', `new.fechado_em is not null and new.justificativa like 'TESTE FALHA%'`)
    const f0 = await api(dono.p, '/api/admin/financeiro/caixa', 'POST', { acao: 'fechar', contadoDinheiroCentavos: Math.max(0, esp) + 700, contadoCartaoCentavos: 0, aceitarPendencias: true, justificativa: 'TESTE FALHA ao fechar o caixa' })
    ok('falha ao fechar: o caixa continua aberto e o ajuste da contagem não fica no livro-caixa', f0.s >= 500 && !(await um(`select fechado_em from caixa_turnos where id=$1`, [turno.id])).fechado_em
      && await contar(`select count(*) n from fin_lancamentos where turno_id=$1 and tipo='ajuste' and chave_idempotencia like 'fechamento:%'`, [turno.id]) === 0, `${f0.s} ${texto(f0.j)}`)
    await limparFalhas()
    const f1 = await api(dono.p, '/api/admin/financeiro/caixa', 'POST', { acao: 'fechar', contadoDinheiroCentavos: Math.max(0, esp), contadoCartaoCentavos: Math.max(0, Number((await um(`select coalesce(sum(valor_centavos),0) s from fin_lancamentos where turno_id=$1 and carteira='cartao'`, [turno.id])).s)), aceitarPendencias: true, justificativa: 'TESTE fechamento do teste de atomicidade' })
    ok('sem a falha: fecha', f1.s === 200, `${f1.s} ${texto(f1.j)}`)
    void D
    await ger.ctx.close()
  }
} catch (e) {
  ok('fluxo sem erro', false, String(e?.stack ?? e).slice(0, 500))
} finally {
  await limparFalhas()
  await browser.close()
  await db.end()
}
const n = res.filter((x) => !x).length
console.log(`\n${res.length - n}/${res.length} verificações passaram`)
process.exit(n ? 1 : 0)
