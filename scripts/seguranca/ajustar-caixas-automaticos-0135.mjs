/**
 * Ajuste único em PRODUÇÃO depois da 0135 (2026-10-03). Sem apagar nada e sem mexer em valores ou entregas:
 *
 * Ponto 400 Hamburgueria (sem financeiro): o caixa aberto sozinho em 30/09 23:01 nunca fechou e a
 * Logística somava as entregas desde então. Passa a ser um turno por DIA OPERACIONAL (05:00–05:00):
 *   - o turno de 30/09 fecha às 05:00 de 01/10 (fim do dia dele);
 *   - nasce o turno de 01/10 (05:00 → 05:00 de 02/10), já fechado;
 *   - nasce o turno de 02/10 (desde 05:00), aberto — fecha sozinho às 05:00 de 03/10 pela regra nova.
 * Menuzia (financeiro, loja de teste): o caixa 3 (aberto sozinho em 02/10 07:57, sem nenhum lançamento)
 * é encerrado pelo sistema; a entrega em dinheiro dele que ainda não foi acertada vira "a acertar"
 * (pendência do motoboy, regra nova); os 2 alertas de teste ficam marcados como lidos.
 * Tudo na auditoria. Backup feito antes em ~/backups/menuzia/2026-10-02-caixas-automaticos/.
 *
 *   node scripts/seguranca/ajustar-caixas-automaticos-0135.mjs            (DRY-RUN: faz e desfaz)
 *   node scripts/seguranca/ajustar-caixas-automaticos-0135.mjs --aplicar --confirmar-producao
 */
import { readFileSync } from 'node:fs'
import pg from 'pg'

for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const aplicar = process.argv.includes('--aplicar') && process.argv.includes('--confirmar-producao')
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const q = async (s, p = []) => (await c.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const log = (...a) => console.log(' ', ...a)

await c.query('begin')
try {
  if (!(await um(`select 1 from schema_migrations where name='0135_pdv_pagamento_caixa_dia.sql'`))) throw new Error('aplique a 0135 antes')
  const fotoAntes = await q(`select restaurante_id, count(*)::int n, sum(total)::numeric s from pedidos where restaurante_id in (select id from restaurantes where slug in ('ponto-400-hamburgueria','menuzia')) group by 1 order by 1`)

  // ── Ponto 400 ─────────────────────────────────────────────────────────────
  const p4 = await um(`select id from restaurantes where slug='ponto-400-hamburgueria'`)
  const t = await um(`select * from caixa_turnos where restaurante_id=$1 and fechado_em is null`, [p4.id])
  if (t && /Automático/.test(t.aberto_por_nome ?? '')) {
    const fim = (await um(`select caixa_inicio_dia_operacional($1) + interval '1 day' f`, [t.aberto_em])).f
    await c.query(`update caixa_turnos set fechado_em=$2, fechado_por_nome='Automático (fim do dia)', observacao=coalesce(observacao||' · ','')||'Encerrado no fim do dia operacional (ajuste 0135: a Logística passa a separar por dia).' where id=$1`, [t.id, fim])
    await c.query(`select auditoria_registrar($1, null, 'Sistema', 'caixa.fechou_turno', 'caixa', $2, $3::jsonb)`, [p4.id, t.id, JSON.stringify({ automatico: true, motivo: 'ajuste 0135: separação por dia operacional', aberto_em: t.aberto_em, fechado_em: fim })])
    log('Ponto 400: turno de 30/09 fechado em', fim.toISOString())
    // Dias operacionais seguintes até hoje: um turno por dia (o de hoje fica aberto).
    const hoje = (await um(`select caixa_inicio_dia_operacional(now()) h`)).h
    for (let ini = new Date(fim); ini <= hoje; ini = new Date(ini.getTime() + 86_400_000)) {
      const ehHoje = ini.getTime() === hoje.getTime()
      const nt = await um(`insert into caixa_turnos (restaurante_id, aberto_em, aberto_por_nome, fechado_em, fechado_por_nome, observacao) values ($1,$2,'Automático (dia operacional)',$3,$4,'Criado no ajuste 0135 (um turno por dia).') returning id, status`,
        [p4.id, ini, ehHoje ? null : new Date(ini.getTime() + 86_400_000), ehHoje ? null : 'Automático (fim do dia)'])
      await c.query(`select auditoria_registrar($1, null, 'Sistema', 'caixa.abriu_turno', 'caixa', $2, $3::jsonb)`, [p4.id, nt.id, JSON.stringify({ automatico: true, motivo: 'ajuste 0135: um turno por dia operacional', aberto_em: ini, status: nt.status })])
      log('Ponto 400: turno do dia', ini.toISOString(), nt.status)
    }
  } else log('Ponto 400: nada a fazer')

  // ── Menuzia ───────────────────────────────────────────────────────────────
  const mz = await um(`select id from restaurantes where slug='menuzia'`)
  const t3 = await um(`select * from caixa_turnos where restaurante_id=$1 and fechado_em is null`, [mz.id])
  if (t3 && /Automático/.test(t3.aberto_por_nome ?? '')) {
    const lanc = (await um(`select count(*)::int n from fin_lancamentos where turno_id=$1`, [t3.id])).n
    if (lanc > 0) throw new Error(`caixa 3 da Menuzia tem ${lanc} lançamentos — revisar à mão`)
    // Entregas em dinheiro não pagas desde a entrada do financeiro e sem acerto: pendência do motoboy.
    const pend = await q(`select p.* from pedidos p where p.restaurante_id=$1 and p.forma_pagamento='dinheiro' and p.status='entregue' and p.entregador_id is not null and not p.pago
      and p.entregue_em >= (select min(criado_em) from fin_lancamentos where restaurante_id=$1)
      and not exists (select 1 from fechamentos_caixa f where f.entregador_id=p.entregador_id and f.criado_em > p.entregue_em)
      and not exists (select 1 from fin_lancamentos l where l.pedido_id=p.id and l.tipo='pendencia_motoboy')
      and not (p.comanda_id is not null and exists (select 1 from comanda_totais(p.comanda_id) t where t.total > 0 and t.restante <= 0.004))`, [mz.id])
    for (const p of pend) {
      await c.query(`insert into fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, entregador_id, tipo, valor_centavos, forma, origem, pedido_id, comanda_id, usuario_nome, chave_idempotencia, dados)
        values ($1, gen_random_uuid(), 1, null, 'motoboy', $2, 'pendencia_motoboy', $3, 'dinheiro', 'delivery', $4, $5, 'Sistema', $6, $7::jsonb)`,
        [mz.id, p.entregador_id, Math.round(Number(p.total) * 100), p.id, p.comanda_id, `pend:${p.id}`, JSON.stringify({ numero: p.numero, ajuste: '0135' })])
      log(`Menuzia: pedido #${p.numero} (R$ ${p.total}) → a acertar`)
    }
    await c.query(`update caixa_turnos set fechado_em=now(), fechado_por_nome='Sistema (ajuste 0135)', contado_dinheiro_centavos=0, contado_cartao_centavos=0,
      esperado_dinheiro_centavos=0, esperado_cartao_centavos=0, diferenca_centavos=0, diferenca_cartao_centavos=0,
      justificativa='Caixa aberto sozinho pela regra antiga (1ª entrega), sem nenhum lançamento. Encerrado na mudança de regra (0135); as entregas em dinheiro ficaram a acertar.',
      pendencias=$2::jsonb where id=$1`, [t3.id, JSON.stringify({ a_acertar: pend.map((p) => ({ pedido: p.numero, total: Number(p.total) })) })])
    await c.query(`select auditoria_registrar($1, null, 'Sistema', 'caixa.fechou_turno', 'caixa', $2, $3::jsonb)`, [mz.id, t3.id, JSON.stringify({ automatico: true, motivo: 'ajuste 0135: caixa aberto pela regra antiga, sem lançamentos', a_acertar: pend.length })])
    log('Menuzia: caixa 3 encerrado')
  } else log('Menuzia: nenhum caixa automático aberto')
  const lidos = await q(`update fin_alertas set lido_em=now(), lido_por_nome='Sistema (ajuste de teste 0135)' where restaurante_id=$1 and lido_em is null and tipo in ('caixa_divergente','caixa_aberto_automatico') returning tipo`, [mz.id])
  log('Menuzia: alertas de teste marcados como lidos:', lidos.map((x) => x.tipo).join(', ') || 'nenhum')

  const fotoDepois = await q(`select restaurante_id, count(*)::int n, sum(total)::numeric s from pedidos where restaurante_id in (select id from restaurantes where slug in ('ponto-400-hamburgueria','menuzia')) group by 1 order by 1`)
  if (JSON.stringify(fotoAntes) !== JSON.stringify(fotoDepois)) throw new Error('pedidos mudaram — abortado')
  log('Pedidos intactos (quantidade e soma iguais):', JSON.stringify(fotoDepois))
  const integ = await q(`select r.slug, (select count(*) from auditoria_verificar_cadeia(r.id))::int quebras from restaurantes r where r.slug in ('ponto-400-hamburgueria','menuzia')`)
  log('Integridade:', JSON.stringify(integ))
  if (integ.some((x) => x.quebras > 0)) throw new Error('corrente de assinaturas quebrada — abortado')

  if (aplicar) { await c.query('commit'); console.log('✅ APLICADO') } else { await c.query('rollback'); console.log('DRY-RUN ok — DESFEITO') }
} catch (e) {
  await c.query('rollback').catch(() => {}); console.error('❌', e.message); process.exitCode = 1
} finally { await c.end() }
