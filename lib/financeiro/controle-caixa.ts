import type { SupabaseClient } from '@supabase/supabase-js'
import { formatarCentavos } from './centavos'

/**
 * "Ativar controle de caixa" (nível 2, 0167) — o passo a passo do guia (/admin/financeiro/guia#ativacao).
 * Passos 1 a 4 obrigatórios; o 5 (custo dos mais vendidos) é recomendado. Só o dono ativa ou desativa.
 */
export type IdPasso = 'pin' | 'contas' | 'motoboys' | 'fundo' | 'custo'
export interface Passo { id: IdPasso; titulo: string; ok: boolean; obrigatorio: boolean; detalhe: string }

export interface DadosAtivacao {
  aprovadoresComPin: string[]
  contasAntigas: { numero: number | null; desde: string; totalCentavos: number }[]
  motoboysPendentes: { nome: string; centavos: number }[]
  entregasEmRota: number
  fundoCentavos: number | null
  toleranciaCentavos: number | null
  topComCusto: number
  topTotal: number
}

/** Conta aberta há mais disto é "antiga" (esquecida). */
export const CONTA_ANTIGA_H = 12

/** Regra pura dos passos (testes em controle-caixa.test.ts). */
export function passosAtivacao(d: DadosAtivacao): Passo[] {
  const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const fundoOk = d.fundoCentavos !== null && d.fundoCentavos >= 0 && d.toleranciaCentavos !== null && d.toleranciaCentavos >= 0
  return [
    { id: 'pin', titulo: 'Criar o seu PIN (ou ter um gerente com PIN)', obrigatorio: true, ok: d.aprovadoresComPin.length > 0,
      detalhe: d.aprovadoresComPin.length ? `Aprova: ${d.aprovadoresComPin.join(', ')}.` : 'Ninguém tem PIN. Toque no seu nome no canto de cima › Criar meu PIN.' },
    { id: 'contas', titulo: 'Fechar as contas antigas abertas', obrigatorio: true, ok: d.contasAntigas.length === 0,
      detalhe: d.contasAntigas.length ? d.contasAntigas.map((c) => `#${c.numero ?? '—'} (${formatarCentavos(c.totalCentavos)}, desde ${data(c.desde)})`).join(', ') + '. Feche ou cancele no PDV.' : 'Nenhuma conta esquecida aberta.' },
    { id: 'motoboys', titulo: 'Acertar os motoboys pendentes', obrigatorio: true, ok: d.motoboysPendentes.length === 0 && d.entregasEmRota === 0,
      detalhe: d.motoboysPendentes.length || d.entregasEmRota
        ? [d.motoboysPendentes.map((m) => `${m.nome} com ${formatarCentavos(m.centavos)}`).join(', '), d.entregasEmRota ? `${d.entregasEmRota} entrega(s) em rota agora` : ''].filter(Boolean).join('; ') + '. Acerte na Logística e espere as entregas voltarem.'
        : 'Nenhum motoboy com dinheiro a acertar e nenhuma entrega em rota.' },
    { id: 'fundo', titulo: 'Definir o fundo de caixa e a tolerância', obrigatorio: true, ok: fundoOk,
      detalhe: fundoOk ? `Fundo ${formatarCentavos(d.fundoCentavos!)} · tolerância ${formatarCentavos(d.toleranciaCentavos!)}.` : 'Informe o troco que fica na gaveta e até quanto de diferença aceita só uma explicação.' },
    { id: 'custo', titulo: 'Cadastrar o custo dos 15 itens mais vendidos (recomendado)', obrigatorio: false, ok: d.topTotal > 0 && d.topComCusto >= d.topTotal,
      detalhe: d.topTotal ? `${d.topComCusto} de ${d.topTotal} com custo (Financeiro › Precificação / CMV).` : 'Ainda não há vendas entregues nos últimos 30 dias.' },
  ]
}

export const podeAtivar = (passos: Passo[]) => passos.every((p) => !p.obrigatorio || p.ok)

export async function carregarDadosAtivacao(admin: SupabaseClient, loja: string): Promise<DadosAtivacao> {
  const limite = new Date(Date.now() - CONTA_ANTIGA_H * 3_600_000).toISOString()
  const desde30 = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const [{ data: equipe }, { data: contas }, { data: motos }, { count: emRota }, { data: cfg }, { data: vendidos }, { data: fichas }, { data: gestao }] = await Promise.all([
    admin.from('usuarios').select('nome, papel, pin_hash').eq('restaurante_id', loja).is('desativado_em', null),
    admin.from('comandas').select('id, numero, aberta_em').eq('restaurante_id', loja).eq('status', 'aberta').lt('aberta_em', limite).order('aberta_em'),
    admin.from('fin_lancamentos').select('entregador_id, valor_centavos, entregadores ( nome )').eq('restaurante_id', loja).eq('carteira', 'motoboy').limit(5000),
    admin.from('pedidos').select('id', { count: 'exact', head: true }).eq('restaurante_id', loja).eq('status', 'em_rota'),
    admin.from('fin_config').select('fundo_padrao_centavos, tolerancia_fechamento_centavos').eq('restaurante_id', loja).maybeSingle(),
    admin.from('pedido_itens').select('item_id, quantidade, pedidos!inner ( restaurante_id, status, criado_em )').eq('pedidos.restaurante_id', loja).eq('pedidos.status', 'entregue').gte('pedidos.criado_em', desde30).is('cancelado_em', null).not('item_id', 'is', null).limit(20000),
    admin.from('cmv_fichas').select('item_id, cmv_ficha_componentes!inner ( id )').eq('restaurante_id', loja).not('item_id', 'is', null),
    admin.from('itens_cardapio_gestao').select('item_id').eq('restaurante_id', loja).gt('preco_custo', 0),
  ])
  const totais = await Promise.all((contas ?? []).map(async (c) => {
    const { data } = await admin.rpc('comanda_totais', { p_comanda: c.id }).maybeSingle()
    return { numero: (c.numero as number | null) ?? null, desde: c.aberta_em as string, totalCentavos: Math.round(Number((data as { total?: number } | null)?.total ?? 0) * 100) }
  }))
  const porMoto = new Map<string, { nome: string; centavos: number }>()
  for (const l of motos ?? []) {
    const k = l.entregador_id as string
    const m = porMoto.get(k) ?? { nome: (l.entregadores as unknown as { nome?: string } | null)?.nome ?? 'Motoboy', centavos: 0 }
    m.centavos += Number(l.valor_centavos)
    porMoto.set(k, m)
  }
  const qtd = new Map<string, number>()
  for (const v of vendidos ?? []) qtd.set(v.item_id as string, (qtd.get(v.item_id as string) ?? 0) + Number(v.quantidade))
  const top = [...qtd.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([id]) => id)
  const comCusto = new Set([...(fichas ?? []).map((f) => f.item_id as string), ...(gestao ?? []).map((g) => g.item_id as string)])
  return {
    aprovadoresComPin: (equipe ?? []).filter((u) => u.pin_hash && ['dono', 'gerente'].includes(u.papel as string)).map((u) => u.nome as string),
    contasAntigas: totais,
    motoboysPendentes: [...porMoto.values()].filter((m) => m.centavos !== 0),
    entregasEmRota: emRota ?? 0,
    fundoCentavos: cfg ? Number(cfg.fundo_padrao_centavos) : null,
    toleranciaCentavos: cfg ? Number(cfg.tolerancia_fechamento_centavos) : null,
    topComCusto: top.filter((id) => comCusto.has(id)).length,
    topTotal: top.length,
  }
}
