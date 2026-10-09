import type { SupabaseClient } from '@supabase/supabase-js'
import { diaSemanaSaoPaulo, type HorarioFuncionamento, type StatusLoja } from '@/lib/timezone'
import { criarAlerta } from './alertas'
import { turnoAberto } from './caixa'
import { formatarCentavos } from './centavos'
import { descontoAlto, horasDesde, minutosDesdeAbertura } from './vigia-regras'
import { nivelDe } from './nivel'

/**
 * Vigia do financeiro (Fase 6): alertas que dependem de TEMPO ou de olhar o conjunto, feitos por varredura
 * (cron a cada 15 min, só lojas com o financeiro ligado). Cada alerta tem chave própria e não se repete
 * (dedupe). Os alertas imediatos continuam onde a coisa acontece: divergência no fechamento, caixa reaberto,
 * login simultâneo, PIN bloqueado, valor manipulado (vitrine), venda manual suspeita, estorno de conta.
 *
 *   caixa_aberto_demais       turno aberto há mais de N h (fin_config.horas_caixa_aberto)
 *   caixa_sem_abrir           loja aberta pela grade há mais de N min e nenhum caixa aberto
 *   motoboy_pendente          motoboy com dinheiro a acertar há mais de N h (horas_motoboy_pendente)
 *   desconto_alto             desconto da conta acima do limite (% ou R$) da loja
 *   cancelamento_apos_pagamento  pedido/conta cancelado que já tinha recebimento
 *   sangria_alta              sangria/retirada acima do limite de saída
 *   acoes_sensiveis           funcionário com mais ações sensíveis no turno que o limite da loja
 */
const JANELA_H = 24
const SENSIVEIS = ['conta.cancelou_item', 'conta.cancelou_pedido', 'conta.cancelou_comanda', 'pedido.cancelou', 'conta.desconto', 'conta.estorno',
  'conta.reimprimiu', 'caixa.sangria', 'caixa.retirada', 'caixa.perda', 'contas.estornou_baixa', 'conta.aprovou_cancelamento']

/** `agora`: relógio (o cron de teste local pode adiantar; em produção é sempre o do servidor). */
export async function varrerLoja(admin: SupabaseClient, loja: string, agora = Date.now()): Promise<Record<string, number>> {
  const n: Record<string, number> = {}
  const conta = (k: string, id: string | null) => { if (id) n[k] = (n[k] ?? 0) + 1 }
  const desde = new Date(agora - JANELA_H * 3_600_000).toISOString()
  const agoraIso = new Date(agora).toISOString()
  const horaSP = new Date(agora).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
  const diaSP = new Date(agora).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const [{ data: cfg }, { data: rest }, turno] = await Promise.all([
    admin.from('fin_config').select('*').eq('restaurante_id', loja).maybeSingle(),
    admin.from('restaurantes').select('status_loja, horario_funcionamento, financeiro_ativo, controle_caixa_ativo').eq('id', loja).maybeSingle(),
    turnoAberto(admin, loja),
  ])
  const c = {
    horasMotoboy: Number(cfg?.horas_motoboy_pendente ?? 3), horasCaixa: Number(cfg?.horas_caixa_aberto ?? 14), limiteSaida: Number(cfg?.limite_saida_centavos ?? 10000),
    limitePct: Number(cfg?.limite_desconto_pct ?? 10), limiteDesconto: Number(cfg?.limite_desconto_centavos ?? 2000),
    minSemAbrir: Number(cfg?.minutos_caixa_sem_abrir ?? 30), maxSensiveis: Number(cfg?.max_acoes_sensiveis_turno ?? 10),
  }

  // Caixa e motoboy só com o controle de caixa ativo (nível 2, 0167): no nível 1 o caixa é automático.
  const controle = nivelDe(rest as { financeiro_ativo?: boolean; controle_caixa_ativo?: boolean } | null).controleCaixa

  // Caixa esquecido aberto.
  if (controle && turno && horasDesde(turno.aberto_em, agora) >= c.horasCaixa) {
    conta('caixa_aberto_demais', await criarAlerta(admin, { restauranteId: loja, tipo: 'caixa_aberto_demais', gravidade: 'atencao',
      mensagem: `O caixa aberto por ${turno.aberto_por_nome ?? '—'} está aberto há ${Math.floor(horasDesde(turno.aberto_em, agora))} horas.`,
      dedupeMin: 6 * 60, dedupeChave: turno.id }))
  }

  // Caixa sem abrir no horário de funcionamento.
  if (controle && !turno && rest) {
    const min = minutosDesdeAbertura({ statusLoja: (rest.status_loja as StatusLoja) ?? 'automatico', grade: (rest.horario_funcionamento as HorarioFuncionamento | null) ?? null,
      dia: diaSemanaSaoPaulo(agoraIso), hora: horaSP })
    if (min !== null && min >= c.minSemAbrir) {
      conta('caixa_sem_abrir', await criarAlerta(admin, { restauranteId: loja, tipo: 'caixa_sem_abrir', gravidade: 'atencao',
        mensagem: `A loja está aberta há ${min} min e ninguém abriu o caixa. Vendas em dinheiro ficam sem gaveta conferida.`,
        dedupeMin: 6 * 60, dedupeChave: diaSP }))
    }
  }

  // Motoboy com dinheiro pendente há mais de N h: idade = linha mais antiga depois do último acerto.
  const { data: motos } = await admin.from('fin_lancamentos').select('entregador_id, valor_centavos, tipo, criado_em, id').eq('restaurante_id', loja).eq('carteira', 'motoboy').order('id').limit(5000)
  const porMoto = new Map<string, { saldo: number; desde: string | null }>()
  for (const l of motos ?? []) {
    const k = l.entregador_id as string
    const s = porMoto.get(k) ?? { saldo: 0, desde: null }
    if (l.tipo === 'acerto_motoboy') s.desde = null
    s.saldo += Number(l.valor_centavos)
    if (s.saldo !== 0 && !s.desde) s.desde = l.criado_em as string
    if (s.saldo === 0) s.desde = null
    porMoto.set(k, s)
  }
  for (const [ent, s] of porMoto) {
    if (!controle) break
    if (!s.saldo || !s.desde || horasDesde(s.desde, agora) < c.horasMotoboy) continue
    const { data: e } = await admin.from('entregadores').select('nome').eq('id', ent).maybeSingle()
    conta('motoboy_pendente', await criarAlerta(admin, { restauranteId: loja, tipo: 'motoboy_pendente', gravidade: 'atencao',
      mensagem: `${e?.nome ?? 'Motoboy'} está com ${formatarCentavos(s.saldo)} a acertar há mais de ${c.horasMotoboy} h.`,
      dedupeMin: c.horasMotoboy * 60, dedupeChave: `${ent}:${s.desde}` }))
  }

  // Auditoria recente: descontos, sangrias e ações sensíveis.
  const { data: evs } = await admin.from('eventos_auditoria').select('id, acao, usuario_id, usuario_nome, entidade_id, dados, criado_em')
    .eq('restaurante_id', loja).gte('criado_em', desde).in('acao', SENSIVEIS).order('criado_em').limit(2000)
  const comandasComDesconto = new Set<string>()
  for (const e of evs ?? []) {
    if (e.acao === 'conta.desconto' && e.entidade_id) comandasComDesconto.add(e.entidade_id as string)
    if ((e.acao === 'caixa.sangria' || e.acao === 'caixa.retirada') && Number((e.dados as Record<string, unknown> | null)?.valor_centavos ?? 0) > c.limiteSaida) {
      const v = Number((e.dados as Record<string, unknown>).valor_centavos)
      conta('sangria_alta', await criarAlerta(admin, { restauranteId: loja, tipo: 'sangria_alta', gravidade: 'atencao', usuario: { id: e.usuario_id as string | null, nome: e.usuario_nome as string },
        mensagem: `${e.usuario_nome} fez ${e.acao === 'caixa.sangria' ? 'sangria' : 'retirada'} de ${formatarCentavos(v)} (acima de ${formatarCentavos(c.limiteSaida)})` +
          ((e.dados as Record<string, unknown>).aprovado_por ? `, aprovada por ${(e.dados as Record<string, unknown>).aprovado_por}.` : '.'),
        dedupeMin: 7 * 24 * 60, dedupeChave: e.id as string }))
    }
  }
  for (const comandaId of comandasComDesconto) {
    const { data: t } = await admin.rpc('comanda_totais', { p_comanda: comandaId })
    const tot = (Array.isArray(t) ? t[0] : t) as { subtotal?: number; desconto?: number } | null
    if (!tot) continue
    const desc = Math.round(Number(tot.desconto ?? 0) * 100), sub = Math.round(Number(tot.subtotal ?? 0) * 100)
    if (!descontoAlto({ descontoCentavos: desc, subtotalCentavos: sub, limitePct: c.limitePct, limiteCentavos: c.limiteDesconto })) continue
    const ultimo = [...(evs ?? [])].reverse().find((e) => e.acao === 'conta.desconto' && e.entidade_id === comandaId)
    conta('desconto_alto', await criarAlerta(admin, { restauranteId: loja, tipo: 'desconto_alto', gravidade: 'atencao', usuario: ultimo ? { id: ultimo.usuario_id as string | null, nome: ultimo.usuario_nome as string } : null,
      mensagem: `Desconto alto numa conta: ${formatarCentavos(desc)} sobre ${formatarCentavos(sub)} (${sub ? ((desc / sub) * 100).toFixed(0) : '100'}%)${ultimo ? `, dado por ${ultimo.usuario_nome}` : ''}. Limite da loja: ${c.limitePct}% ou ${formatarCentavos(c.limiteDesconto)}.`,
      dedupeMin: 7 * 24 * 60, dedupeChave: `${comandaId}:${desc}`, dados: { comanda: comandaId } }))
  }
  // Muitas ações sensíveis por um funcionário no turno (ou nas últimas 24 h, sem caixa aberto).
  const inicio = turno?.aberto_em ?? desde
  const porPessoa = new Map<string, { nome: string; n: number }>()
  for (const e of evs ?? []) {
    if (!e.usuario_id || (e.criado_em as string) < inicio) continue
    const p = porPessoa.get(e.usuario_id as string) ?? { nome: e.usuario_nome as string, n: 0 }
    p.n++; porPessoa.set(e.usuario_id as string, p)
  }
  for (const [uid, p] of porPessoa) {
    if (p.n <= c.maxSensiveis) continue
    conta('acoes_sensiveis', await criarAlerta(admin, { restauranteId: loja, tipo: 'acoes_sensiveis', gravidade: 'atencao', usuario: { id: uid, nome: p.nome },
      mensagem: `${p.nome} fez ${p.n} ações sensíveis (cancelar, desconto, estorno, reimpressão, sangria) ${turno ? 'neste turno' : 'nas últimas 24 h'} — o limite da loja é ${c.maxSensiveis}. Veja o relatório de risco.`,
      dedupeMin: 12 * 60, dedupeChave: `${uid}:${turno?.id ?? 'dia'}` }))
  }

  // Cancelamento depois de pago: pedido com recebimento no livro-caixa, ou conta com pagamento registrado.
  const { data: canc } = await admin.from('pedidos').select('id, numero, total, comanda_id, cancelado_em, cancelado_motivo').eq('restaurante_id', loja).eq('status', 'cancelado').gte('cancelado_em', desde).limit(300)
  for (const p of canc ?? []) {
    const { count } = await admin.from('fin_lancamentos').select('id', { count: 'exact', head: true }).eq('restaurante_id', loja).eq('pedido_id', p.id).eq('tipo', 'recebimento')
    if (!count) continue
    conta('cancelamento_apos_pagamento', await criarAlerta(admin, { restauranteId: loja, tipo: 'cancelamento_apos_pagamento', gravidade: 'grave',
      mensagem: `Pedido #${p.numero} (${formatarCentavos(Math.round(Number(p.total) * 100))}) foi cancelado DEPOIS de pago. Motivo: ${p.cancelado_motivo ?? '—'}. Confira o estorno.`,
      dedupeMin: 30 * 24 * 60, dedupeChave: p.id as string, dados: { pedido: p.id } }))
  }
  const { data: cc } = await admin.from('comandas').select('id, numero, cancelada_em, cancelada_por_nome, cancelada_motivo').eq('restaurante_id', loja).eq('status', 'cancelada').gte('cancelada_em', desde).limit(300)
  for (const k of cc ?? []) {
    const { count } = await admin.from('pagamentos_comanda').select('id', { count: 'exact', head: true }).eq('comanda_id', k.id)
    if (!count) continue
    conta('cancelamento_apos_pagamento', await criarAlerta(admin, { restauranteId: loja, tipo: 'cancelamento_apos_pagamento', gravidade: 'grave',
      mensagem: `Conta${k.numero ? ` #${k.numero}` : ''} cancelada DEPOIS de receber pagamento${k.cancelada_por_nome ? `, por ${k.cancelada_por_nome}` : ''}. Motivo: ${k.cancelada_motivo ?? '—'}. Confira o estorno.`,
      dedupeMin: 30 * 24 * 60, dedupeChave: k.id as string, dados: { comanda: k.id } }))
  }
  return n
}
